/**
 * tRPC app router — https://trpc.io/docs/quickstart
 *
 * The exported `AppRouter` type is consumed by the client for end-to-end
 * type safety. Never import the router implementation into the client.
 */
import { z } from "zod";
import { basename, join } from "@std/path";
import { publicProcedure, router } from "./init.ts";
import {
    loadFileExplorerState,
    pickProjectFolder,
    resolveInProject,
} from "../project.ts";
import {
    archiveGeneration,
    clearGenerationReaction,
    createGeneration,
    db,
    Generation,
    getGenerationById,
    getGenerationByTaskId,
    getGenerationDetail,
    getGenerationIdByContentHash,
    getGenerationReaction,
    getGenerationRequest,
    listArchivedGenerationIds,
    listGenerationReactions,
    listGenerations,
    recordGeneration,
    reopenDb,
    setGenerationReaction,
    unarchiveGeneration,
    updateGeneration,
} from "../db.ts";
import { seedance_client, setSeedanceApiKey } from "../seedance_client.ts";
import { externalizeAttachments } from "../uploads.ts";
import type {
    ContentItem,
    CreateTaskRequest,
    Task,
    TaskStatus,
} from "../seedance/seedance.ts";
import { chan, closed } from "@blowater/csp";
import { get_video_url, sha256Hex } from "../utils.ts";

/** Directory under the project root where generated videos are stored. */
export const VIDEOS_DIR = ".open-director/generations";

/** Obscure an API key for display, keeping only its head and tail. */
function maskKey(key: string): string {
    if (key.length <= 12) return "••••";
    return `${key.slice(0, 8)}…${key.slice(-5)}`;
}
/** Directory under the project root where uploaded attachments are stored. */
const UPLOADS_DIR = ".open-director/uploads";
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i;
export const global_event_bus = chan<
    | {
        type: "tick";
        n: number;
    }
    | {
        type: "generation_finished";
        gen: Generation;
    }
    | {
        type: "generation_created";
        gen: {
            id: string;
            status: string;
            request_json: CreateTaskRequest;
            created_at: string;
        };
    }
    | { type: "fs_changed" }
>();

async function exists(path: string): Promise<boolean> {
    try {
        await Deno.lstat(path);
        return true;
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) return false;
        throw err;
    }
}

interface DirEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymlink: boolean;
}

/** Read a directory into a sorted list (directories first, then alphabetical). */
async function listDir(absPath: string): Promise<DirEntry[]> {
    const entries: DirEntry[] = [];
    for await (const entry of Deno.readDir(absPath)) {
        entries.push({
            name: entry.name,
            isDirectory: entry.isDirectory,
            isFile: entry.isFile,
            isSymlink: entry.isSymlink,
        });
    }
    entries.sort((a, b) =>
        a.isDirectory === b.isDirectory
            ? a.name.localeCompare(b.name)
            : a.isDirectory
            ? -1
            : 1
    );
    return entries;
}

/** A generated-video entry as the grid consumes it. */
type VideoListItem = {
    id: string;
    created_at: string;
    status: TaskStatus;
    /** Whether a create request is stored (drives the reuse button);
     * the request itself is fetched on demand via getGenerationRequest. */
    has_request: boolean;
    url?: string;
    failed_reason?: string;
    reaction?: "liked" | "disliked";
    reason?: string | null;
};

/** Which slice of generations a grid tab is asking for. */
type VideoListScope = "active" | "archived" | "reacted";

/**
 * Build the Task-like video list for `projectRoot`, scoped to the active
 * (non-archived) set, the archived set, or the set with a like/dislike
 * reaction — depending on `scope`. Creates the videos directory if it
 * doesn't exist yet.
 */
async function buildVideoList(
    projectRoot: string,
    scope: VideoListScope,
): Promise<VideoListItem[]> {
    const resolvedDir = await resolveInProject(projectRoot, VIDEOS_DIR);
    if (resolvedDir instanceof Error) throw resolvedDir;
    const dir = resolvedDir;
    // Creates the dir if missing; a no-op (no throw) when it already exists.
    await Deno.mkdir(dir, { recursive: true });

    if (!db) return [];
    const rows = listGenerations(db);
    const rowById = new Map(rows.map((r) => [r.task_id, r]));
    const archivedIds = new Set(listArchivedGenerationIds(db));
    const reactions = listGenerationReactions(db);
    const onDisk = new Set<string>();

    // Whether a row (by its ULID id) belongs in this scope.
    const included = (id: string) =>
        scope === "reacted"
            ? reactions.has(id)
            : archivedIds.has(id) === (scope === "archived");

    const videos: VideoListItem[] = [];

    // 1. Video files on disk — these are the succeeded, downloaded outputs.
    //    Merge in any matching log row; if there's none, fall back to the
    //    file alone. A file with no log row can never be archived or
    //    reacted to (there's no ULID id to key on).
    for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile || !VIDEO_EXT.test(entry.name)) continue;
        const taskId = entry.name.replace(VIDEO_EXT, "");
        onDisk.add(taskId);

        const localUrl = get_video_url(taskId);

        const row = rowById.get(taskId);
        if (!row) {
            if (scope !== "active") continue;
            videos.push({
                status: "succeeded",
                id: taskId,
                url: localUrl,
                created_at: "",
                has_request: false,
            });
            continue;
        }
        if (!included(row.id)) continue;
        const reaction = reactions.get(row.id);
        videos.push({
            status: "succeeded",
            id: taskId,
            url: localUrl,
            created_at: row.created_at,
            has_request: row.request_json != null,
            reaction: reaction?.reaction,
            reason: reaction?.reason,
        });
    }

    // 2. Log rows with no file on disk — the video either failed or is
    //    still queued/running on the seedance server. Surface them with
    //    whatever status we last recorded.
    for (const row of rows) {
        if (row.task_id && onDisk.has(row.task_id)) continue;
        if (!included(row.id)) continue;
        const reaction = reactions.get(row.id);
        videos.push({
            status: row.status,
            // Not-yet-submitted generations have no task_id; key on the
            // local ULID id instead.
            id: row.task_id ?? row.id,
            created_at: row.created_at,
            has_request: row.request_json != null,
            failed_reason: row.failed_reason ?? undefined,
            reaction: reaction?.reaction,
            reason: reaction?.reason,
        });
    }

    return videos;
}

export const appRouter = router({
    // Open a native OS folder picker, switch the active project to the chosen
    // folder, and persist it (Deno KV) so the next launch reopens it. Returns
    // the new path, or null if the user cancelled. The client should reload
    // afterwards so all views re-fetch against the new project.
    pickProject: publicProcedure.mutation(async () => {
        const path = await pickProjectFolder();
        if (!path) return null;
        await setStoredProjectPath(path);
        reopenDb(); // point the generations DB at the new project
        return { path };
    }),

    // Archived generations for the same project, in the same shape — shown in
    // the grid's "Archived" tab.
    listArchivedGenerations: publicProcedure.input(z.object({
        project_root: z.string(),
    })).query(({ input }) => buildVideoList(input.project_root, "archived")),

    // Look up a generation by a project file's content — hashes the file at
    // `path` and matches it against recorded video hashes, so a copy or
    // rename of a generated video (e.g. dragged into a folder) can still be
    // traced back to the prompt that produced it. Null when there's no
    // project DB, the file can't be read, or no generation matches.
    getGenerationIdForFile: publicProcedure
        .input(z.object({ project_root: z.string(), path: z.string() }))
        .query(async ({ input }) => {
            if (!db) return null;
            const target = await resolveInProject(
                input.project_root,
                input.path,
            );
            if (target instanceof Error) return null;
            let bytes: Uint8Array;
            try {
                bytes = await Deno.readFile(target);
            } catch {
                return null;
            }
            const hash = await sha256Hex(bytes);
            return getGenerationIdByContentHash(db, hash);
        }),

    // Read the immediate (non-recursive) entries of `<projectRoot>/<path>`.
    // `path` is relative to the given project root; "" reads the root itself.
    readDir: publicProcedure
        .input(z.object({ projectRoot: z.string(), path: z.string() }))
        .query(async (opts): Promise<DirEntry[]> => {
            const target = await resolveInProject(
                opts.input.projectRoot,
                opts.input.path,
            );
            if (target instanceof Error) {
                throw target;
            }
            return await listDir(target);
        }),

    // Load everything the file explorer needs in one round trip: the active
    // project's absolute root path, its root-level entries, the restored
    // expanded directories (with their children pre-loaded) and the saved
    // selection. Returns null when no project is open.
    loadProjectData: publicProcedure.query(async () => {
        const rootPath = await getStoredProjectPath();
        if (!rootPath) return null;

        const savedState = await loadFileExplorerState(rootPath);
        if (savedState instanceof Error) {
            throw savedState;
        }
        const { expanded, selected } = savedState;

        const rootEntries = await listDir(rootPath);

        // Pre-load the children of each restored-expanded directory so the tree
        // paints fully expanded on first render.
        const childrenByPath: Record<string, DirEntry[]> = {};
        for (const rel of expanded) {
            const target = await resolveInProject(rootPath, rel);
            if (target instanceof Error) {
                throw target;
            }
            try {
                childrenByPath[rel] = await listDir(target);
            } catch {
                // Directory removed since last session — drop it silently.
            }
        }

        return { rootPath, rootEntries, childrenByPath, expanded, selected };
    }),

    // Open a project file/dir with the OS default program.
    openInDefaultApp: publicProcedure
        .input(z.string())
        .mutation(async (opts): Promise<{ ok: boolean }> => {
            const projectRoot = await getStoredProjectPath();
            if (!projectRoot) {
                return { ok: false };
            }
            const target = await resolveInProject(projectRoot, opts.input);
            if (target instanceof Error) throw target;
            const command = Deno.build.os === "windows"
                ? new Deno.Command("cmd", { args: ["/c", "start", "", target] })
                : Deno.build.os === "darwin"
                ? new Deno.Command("open", { args: [target] })
                : new Deno.Command("xdg-open", { args: [target] });

            const { success, code, stderr } = await command.output();
            if (!success) {
                throw new Error(
                    `Failed to open (exit ${code}): ${
                        new TextDecoder().decode(stderr)
                    }`,
                );
            }
            return { ok: true };
        }),

    // Copy a project file into a project directory (both paths relative to the
    // project root). Used when dragging a generated video onto a folder.
    copyIntoDir: publicProcedure
        .input(z.object({ src: z.string(), destDir: z.string() }))
        .mutation(async (opts): Promise<{ dest: string }> => {
            const { src, destDir } = opts.input;
            const projectRoot = await getStoredProjectPath();
            if (!projectRoot) throw new Error("Project not initialized");
            const srcAbs = await resolveInProject(projectRoot, src);
            const destDirAbs = await resolveInProject(projectRoot, destDir);
            if (srcAbs instanceof Error) throw srcAbs;
            if (destDirAbs instanceof Error) throw destDirAbs;

            const base = basename(srcAbs);
            if (!base) throw new Error("Invalid source path");

            await Deno.mkdir(destDirAbs, { recursive: true });

            // Don't clobber: if the name is taken, append " (n)" before the ext.
            const dot = base.lastIndexOf(".");
            const stem = dot > 0 ? base.slice(0, dot) : base;
            const ext = dot > 0 ? base.slice(dot) : "";
            let name = base;
            for (let n = 1; await exists(`${destDirAbs}/${name}`); n++) {
                name = `${stem} (${n})${ext}`;
            }

            await Deno.copyFile(srcAbs, `${destDirAbs}/${name}`);
            return { dest: `${destDir}/${name}` };
        }),

    // Rename a project file/dir in place. `path` is the existing entry (relative
    // to the project root); `name` is the new base name (no slashes).
    renameFile: publicProcedure
        .input(z.object({ path: z.string(), name: z.string() }))
        .mutation(async (opts): Promise<{ path: string }> => {
            const { path, name } = opts.input;
            if (!name || name.includes("/") || name.includes("\\")) {
                throw new Error("Invalid name");
            }
            const slash = path.lastIndexOf("/");
            const dir = slash === -1 ? "" : path.slice(0, slash);
            const dest = dir ? `${dir}/${name}` : name;
            if (dest === path) return { path };

            const projectRoot = await getStoredProjectPath();
            if (!projectRoot) throw new Error("Project not initialized");
            const srcAbs = await resolveInProject(projectRoot, path);
            const destAbs = await resolveInProject(projectRoot, dest);
            if (srcAbs instanceof Error) throw srcAbs;
            if (destAbs instanceof Error) throw destAbs;
            if (await exists(destAbs)) {
                throw new Error(`已存在同名文件：${name}`);
            }
            try {
                await Deno.rename(srcAbs, destAbs);
            } catch (err) {
                console.log(err);
            }
            return { path: dest };
        }),

    // Archive a generation (by ULID id or task id) — hides it from the grid
    // without deleting its DB row or video file.
    archiveGeneration: publicProcedure
        .input(z.object({ project_root: z.string(), id: z.string() }))
        .mutation(async (opts) => {
            if (!db) {
                throw new Error("Database not initialized");
            }
            // The generations DB is currently a single global handle for
            // whichever project is active — but callers always state which
            // project they mean, so a future per-project DB can be routed to
            // without changing this procedure's contract.
            const activeRoot = await getStoredProjectPath();
            if (activeRoot !== opts.input.project_root) {
                throw new Error(
                    "project_root is not the active project",
                );
            }

            const gen = getGenerationDetail(db, opts.input.id);
            if (gen instanceof Error) {
                throw gen;
            }
            if (!gen) {
                throw new Error(`No generation with id ${opts.input.id}`);
            }
            const err = archiveGeneration(db, gen.id);
            if (err instanceof Error) {
                throw err;
            }
            return { ok: true };
        }),

    // Restore an archived generation (by ULID id or task id) — undoes
    // archiveGeneration.
    unarchiveGeneration: publicProcedure
        .input(z.object({ project_root: z.string(), id: z.string() }))
        .mutation(async (opts) => {
            if (!db) {
                throw new Error("Database not initialized");
            }
            const activeRoot = await getStoredProjectPath();
            if (activeRoot !== opts.input.project_root) {
                throw new Error(
                    "project_root is not the active project",
                );
            }

            const gen = getGenerationDetail(db, opts.input.id);
            if (gen instanceof Error) {
                throw gen;
            }
            if (!gen) {
                throw new Error(`No generation with id ${opts.input.id}`);
            }
            const err = unarchiveGeneration(db, gen.id);
            if (err instanceof Error) {
                throw err;
            }
            return { ok: true };
        }),

    // Whether a Seedance API key is configured, plus a masked preview for the
    // settings modal. The full key is never sent to the client.
    getApiKeyStatus: publicProcedure.query(async () => {
        const key = await getStoredApiKey();
        return {
            hasKey: !!key,
            masked: key ? maskKey(key) : null,
        };
    }),

    // Save the Seedance API key (machine-level in Deno KV) and rebuild the
    // shared client so subsequent generations use it immediately.
    setApiKey: publicProcedure
        .input(z.object({ apiKey: z.string().trim().min(1) }))
        .mutation(async (opts) => {
            const key = opts.input.apiKey;
            await setStoredApiKey(key);
            setSeedanceApiKey(key);
            return { hasKey: true, masked: maskKey(key) };
        }),

    saveExplorerState: publicProcedure
        .input(z.object({
            expanded: z.array(z.string()),
            selected: z.string().nullable(),
        }))
        .mutation(async (opts) => {
            const projectDir = await getStoredProjectPath();
            if (!projectDir) {
                throw new Error("Project not initialized");
            }
            const dir = await resolveInProject(projectDir, ".open-director");
            if (dir instanceof Error) throw dir;
            await Deno.mkdir(dir, { recursive: true });
            await Deno.writeTextFile(
                join(dir, "file-explorer.json"),
                JSON.stringify(opts.input),
            );
        }),

    backend_events: publicProcedure.subscription(async function* () {
        while (true) {
            const event = await global_event_bus.pop();
            if (event === closed) {
                throw new Error("global_event_bus closed, should not happen");
            }
            yield event;
        }
    }),

    // Open APIs are available for both agents and the GUI.
    open: {
        // Create a Seedance generation task and log it — the single round trip the
        // composer makes. Attachments arrive as data URLs (the browser inlines its
        // blob: bytes); the API call + key live server-side. task_checker later
        // polls + downloads the result, keyed by the same task id.
        generate: publicProcedure
            .input(z.object({
                model: z.enum([
                    "doubao-seedance-2-0-260128",
                    "doubao-seedance-2-0-fast-260128",
                    "doubao-seedance-2-0-mini-260615",
                ]),
                prompt: z.string(),
                attachments: z.array(z.object({
                    kind: z.enum(["image", "video", "audio"]),
                    dataUrl: z.string(),
                })),
                ratio: z.enum([
                    "16:9",
                    "9:16",
                    "1:1",
                    "4:3",
                    "3:4",
                    "21:9",
                    "adaptive",
                ]),
                resolution: z.enum(["1080p", "720p", "480p"]),
                durationMode: z.enum(["seconds", "smart"]),
                duration: z.number(),
                audio: z.boolean(),
            }))
            .mutation(async (opts) => {
                if (!db) {
                    throw new Error("Database not initialized");
                }
                const {
                    prompt,
                    attachments,
                    ratio,
                    durationMode,
                    duration,
                    audio,
                    resolution,
                    model,
                } = opts.input;

                // Assemble the multimodal content: optional text, then each
                // attachment as a typed reference.
                const content: ContentItem[] = [];
                if (prompt) content.push({ type: "text", text: prompt });
                for (const att of attachments) {
                    if (att.kind === "image") {
                        content.push({
                            type: "image_url",
                            image_url: { url: att.dataUrl },
                            role: "reference_image",
                        });
                    } else if (att.kind === "video") {
                        content.push({
                            type: "video_url",
                            video_url: { url: att.dataUrl },
                            role: "reference_video",
                        });
                    } else {
                        content.push({
                            type: "audio_url",
                            audio_url: { url: att.dataUrl },
                            role: "reference_audio",
                        });
                    }
                }

                // The outbound request keeps attachments inline as data URLs —
                // Seedance can't reach our local `/project-file` server. The stored
                // request swaps each data URL for a content-addressed file reference
                // so the DB row stays small (see uploads.ts).
                const request: CreateTaskRequest = {
                    model,
                    content,
                    generate_audio: audio,
                    resolution,
                    ratio,
                    ...(durationMode === "seconds" ? { duration } : {}),
                };
                const projectRoot = await getStoredProjectPath();
                if (!projectRoot) {
                    throw new Error("Project not initialized");
                }
                const storedRequest: CreateTaskRequest = {
                    ...request,
                    content: await externalizeAttachments(projectRoot, content),
                };

                const generation = createGeneration(db, storedRequest);
                if (generation instanceof Error) {
                    throw generation;
                }
                console.log("generation_created");
                await global_event_bus.put({
                    type: "generation_created",
                    gen: generation,
                });

                const created = await seedance_client.generate(request);
                if (created instanceof Error) {
                    console.error(created);
                    const err = updateGeneration(db, {
                        id: generation.id,
                        failed_reason: created.message,
                        status: "failed",
                    });
                    if (err instanceof Error) {
                        throw err;
                    }
                    const gen = getGenerationById(db, generation.id);
                    if (gen instanceof Error) {
                        throw gen;
                    }

                    return gen;
                }

                console.log("task created", created);
                const err = updateGeneration(db, {
                    id: generation.id,
                    task_id: created.id,
                });
                if (err instanceof Error) {
                    throw err;
                }

                const task = await seedance_client.getTask(created.id);
                if (task instanceof Error) {
                    throw task;
                }
                const err2 = updateGeneration(db, {
                    id: generation.id,
                    task_json: task,
                });
                if (err2 instanceof Error) {
                    throw err2;
                }

                console.log("task", task);

                // Logging failure shouldn't fail the request — the task is created.
                const recordErr = recordGeneration(db, {
                    taskId: created.id,
                    requestJson: JSON.stringify(storedRequest),
                    createdAt: new Date().toISOString(),
                    status: task.status,
                    task,
                });
                if (recordErr) {
                    console.error(recordErr);
                }
                const gen = getGenerationById(db, generation.id);
                if (gen instanceof Error) {
                    throw gen;
                }
                return gen;
            }),

        // Read the generation log by ULID id (e.g. to show a video's prompt/metadata).
        getGenerationById: publicProcedure
            .input(z.string())
            .query((opts) => {
                if (!db) {
                    throw new Error("Database not initialized");
                }
                const gen = getGenerationById(db, opts.input);
                if (gen instanceof Error) {
                    throw gen;
                }
                return gen;
            }),

        // Read the generation log by Seedance task id.
        getGenerationByTaskId: publicProcedure
            .input(z.string())
            .query((opts) => {
                if (!db) {
                    throw new Error("Database not initialized");
                }
                return getGenerationByTaskId(db, opts.input);
            }),

        // Full generation row (request + polled task) by ULID id or task id,
        // fetched on demand when the user opens a generation's details modal.
        getGenerationDetail: publicProcedure
            .input(z.string())
            .query((opts) => {
                if (!db) {
                    throw new Error("Database not initialized");
                }
                const result = getGenerationDetail(db, opts.input);
                if (result instanceof Error) {
                    throw result;
                }
                return result;
            }),

        // The create request for a generation (by ULID id or task id), fetched on
        // demand when the user clicks "reuse prompt" — kept out of the list payload.
        getGenerationRequest: publicProcedure
            .input(z.string())
            .query((opts) => {
                if (!db) {
                    throw new Error("Database not initialized");
                }
                const result = getGenerationRequest(db, opts.input);
                if (result instanceof Error) {
                    throw result;
                }
                return result;
            }),

        // A generation's like/dislike (and reason), by ULID id or task id. Used
        // by callers that show a generation's details outside the grid (so they
        // don't already have it from a list query).
        getGenerationReaction: publicProcedure
            .input(z.object({ project_root: z.string(), id: z.string() }))
            .query((opts) => {
                if (!db) {
                    throw new Error("Database not initialized");
                }
                const gen = getGenerationDetail(db, opts.input.id);
                if (gen instanceof Error) {
                    throw gen;
                }
                if (!gen) return null;
                return getGenerationReaction(db, gen.id);
            }),
        listGenerations: publicProcedure.query(() => {
            if (!db) {
                throw new Error("Database not initialized");
            }
            const generations = listGenerations(db);
            return generations;
        }),

        // Liked/disliked generations for the same project, in the same shape —
        // shown in the grid's "Liked & disliked" tab.
        listReactedGenerations: publicProcedure.input(z.object({
            project_root: z.string(),
        })).query(({ input }) => buildVideoList(input.project_root, "reacted")),

        // List generated videos in `<project>/.project/generations` as Task-like
        // objects. Creates the directory if it doesn't exist yet.
        listGeneratedVideos: publicProcedure.input(z.object({
            project_root: z.string(),
        })).query(({ input }) => buildVideoList(input.project_root, "active")),

        // The active project folder (absolute path).
        getProjectDir: publicProcedure.query(async () => {
            const projectDir = await getStoredProjectPath();
            if (!projectDir) {
                return null;
            }
            return projectDir;
        }),
        // Like or dislike a generation (by ULID id or task id), with an optional
        // reason. Reacting again — even with the opposite reaction — replaces
        // whatever reaction was stored before.
        setGenerationReaction: publicProcedure
            .input(z.object({
                project_root: z.string(),
                id: z.string(),
                reaction: z.enum(["liked", "disliked"]),
                reason: z.string().optional(),
            }))
            .mutation(async (opts) => {
                if (!db) {
                    throw new Error("Database not initialized");
                }
                const activeRoot = await getStoredProjectPath();
                if (activeRoot !== opts.input.project_root) {
                    throw new Error(
                        "project_root is not the active project",
                    );
                }

                const gen = getGenerationDetail(db, opts.input.id);
                if (gen instanceof Error) {
                    throw gen;
                }
                if (!gen) {
                    throw new Error(`No generation with id ${opts.input.id}`);
                }
                const err = setGenerationReaction(
                    db,
                    gen.id,
                    opts.input.reaction,
                    opts.input.reason,
                );
                if (err instanceof Error) {
                    throw err;
                }
                return { ok: true };
            }),

        // Remove a generation's like/dislike (by ULID id or task id).
        clearGenerationReaction: publicProcedure
            .input(z.object({ project_root: z.string(), id: z.string() }))
            .mutation(async (opts) => {
                if (!db) {
                    throw new Error("Database not initialized");
                }
                const activeRoot = await getStoredProjectPath();
                if (activeRoot !== opts.input.project_root) {
                    throw new Error(
                        "project_root is not the active project",
                    );
                }

                const gen = getGenerationDetail(db, opts.input.id);
                if (gen instanceof Error) {
                    throw gen;
                }
                if (!gen) {
                    throw new Error(`No generation with id ${opts.input.id}`);
                }
                const err = clearGenerationReaction(db, gen.id);
                if (err instanceof Error) {
                    throw err;
                }
                return { ok: true };
            }),
        // Everything the GUI's MCP info modal shows: server identity, protocol
        // version, and the tool catalog exactly as advertised over `tools/list`.
        // The endpoint URL itself is derived client-side from `location.origin`
        // since the server doesn't know which host/port the browser used.
        getMcpServerInfo: publicProcedure.query(async () => {
            // Dynamic import avoids a router -> MCP server -> router module cycle.
            // The MCP catalog itself is generated from this router at runtime.
            const {
                listMcpTools,
                MCP_PROTOCOL_VERSION,
                MCP_SERVER_INFO,
            } = await import("../mcp/server.ts");
            return {
                name: MCP_SERVER_INFO.name,
                version: MCP_SERVER_INFO.version,
                protocolVersion: MCP_PROTOCOL_VERSION,
                endpointPath: "/mcp",
                tools: listMcpTools(),
            };
        }),
    },
});

// Export type only — never import the router implementation into the client.
export type AppRouter = typeof appRouter;

import { delay } from "@std/async";
import {
    getStoredApiKey,
    getStoredProjectPath,
    setStoredApiKey,
    setStoredProjectPath,
} from "../kv.ts";
(async () => {
    let i = 0;
    for (;;) {
        await global_event_bus.put({ type: "tick", n: i++ });
        await delay(10000);
    }
})();
