import { isAbsolute, resolve } from "@std/path";
import { z } from "zod";

const PROJECTS_PREFIX = ["projects"] as const;

/** A project folder that has been opened by Open Director at least once. */
export const ProjectRecordSchema = z.object({
    path: z.string().refine(isAbsolute, "Project path must be absolute"),
    firstOpenedAt: z.iso.datetime(),
    lastOpenedAt: z.iso.datetime(),
}).strict();

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

/** Register an explicit open of `path`, updating its recency metadata. */
export async function registerProject(
    kv: Deno.Kv,
    path: string,
    openedAt = new Date().toISOString(),
): Promise<ProjectRecord> {
    return await upsertProject(kv, path, openedAt);
}

/** Return every known project, most recently opened first. */
export async function listProjects(kv: Deno.Kv): Promise<ProjectRecord[]> {
    const projects: ProjectRecord[] = [];
    for await (
        const entry of kv.list<unknown>({ prefix: PROJECTS_PREFIX })
    ) {
        const parsed = ProjectRecordSchema.safeParse(entry.value);
        if (!parsed.success) {
            console.error(parsed.error)
            await kv.atomic().check(entry).delete(entry.key).commit();
            continue;
        }
        projects.push(parsed.data);
    }
    return projects.toSorted((a, b) =>b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

/** Return the most recently opened project, or null when none exists. */
export async function getLastOpenedProject(
    kv: Deno.Kv,
): Promise<ProjectRecord | null> {
    return (await listProjects(kv))[0] ?? null;
}

async function upsertProject(
    kv: Deno.Kv,
    path: string,
    openedAt: string,
): Promise<ProjectRecord> {
    const canonicalPath = await canonicalizeProjectPath(path);
    const key = projectKey(canonicalPath);

    // KV transactions are optimistic. Retry if another request registers or
    // updates this same project between our read and commit.
    for (;;) {
        const entry = await kv.get<unknown>(key);
        const parsed = ProjectRecordSchema.safeParse(entry.value);
        if (parsed.success) {
            const updated: ProjectRecord = {
                path: canonicalPath,
                firstOpenedAt: parsed.data.firstOpenedAt,
                lastOpenedAt: openedAt,
            };
            const result = await kv.atomic()
                .check(entry)
                .set(key, updated)
                .commit();
            if (result.ok) return updated;
            continue;
        }
        if (entry.value !== null) {
            await kv.atomic().check(entry).delete(key).commit();
            continue;
        }

        const project: ProjectRecord = {
            path: canonicalPath,
            firstOpenedAt: openedAt,
            lastOpenedAt: openedAt,
        };
        const result = await kv.atomic()
            .check(entry)
            .set(key, project)
            .commit();
        if (result.ok) return project;
    }
}

function projectKey(path: string): Deno.KvKey {
    return [...PROJECTS_PREFIX, pathIdentity(path)];
}

function pathIdentity(path: string): string {
    return Deno.build.os === "windows" ? path.toLocaleLowerCase() : path;
}

/** Resolve aliases/symlinks when possible while retaining missing old paths. */
async function canonicalizeProjectPath(path: string): Promise<string> {
    const absolute = resolve(path);
    try {
        return await Deno.realPath(absolute);
    } catch (error) {
        if (
            error instanceof Deno.errors.NotFound ||
            error instanceof Deno.errors.PermissionDenied
        ) {
            return absolute;
        }
        throw error;
    }
}
