/**
 * tRPC app router — https://trpc.io/docs/quickstart
 *
 * The exported `AppRouter` type is consumed by the client for end-to-end
 * type safety. Never import the router implementation into the client.
 */
import { z } from "zod";
import { publicProcedure, router } from "./init.ts";
import { projectDir, resolveInProject } from "../project.ts";
import { db, getGeneration, listGenerations, recordGeneration } from "../db.ts";
import { seedance_client } from "../seedance_client.ts";
import type {
    ContentItem,
    CreateTaskRequest,
    Task,
    TaskStatus,
} from "../seedance.ts";

/** Directory under the project root where generated videos are stored. */
export const VIDEOS_DIR = ".project/generations";
/** Directory under the project root where uploaded attachments are stored. */
const UPLOADS_DIR = ".project/uploads";
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i;

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

export const appRouter = router({
    // List generated videos in `<project>/.project/generations` as Task-like
    // objects. Creates the directory if it doesn't exist yet.
    listGeneratedVideos: publicProcedure.query(async () => {
        const root = await projectDir();
        const dir = `${root}/${VIDEOS_DIR}`;
        // Creates the dir if missing; a no-op (no throw) when it already exists.
        await Deno.mkdir(dir, { recursive: true });

        // Index the SQLite log by task id (= the video filename stem) so each
        // file on disk can be enriched with the request/task metadata we stored
        // when it was generated.
        const rows = listGenerations(db);
        const rowById = new Map(rows.map((r) => [r.task_id, r]));
        const onDisk = new Set<string>();

        const videos: {
            id: string;
            url?: string;
            createdAt: string;
            status: TaskStatus;
            /** The original create request (prompt + settings), when logged. */
            request?: CreateTaskRequest;
        }[] = [];

        // 1. Video files on disk — these are the succeeded, downloaded outputs.
        //    Merge in any matching log row; if there's none, fall back to the
        //    file alone.
        for await (const entry of Deno.readDir(dir)) {
            if (!entry.isFile || !VIDEO_EXT.test(entry.name)) continue;
            const taskId = entry.name.replace(VIDEO_EXT, "");
            onDisk.add(taskId);
            const rel = `${VIDEOS_DIR}/${entry.name}`;
            const stat = await Deno.stat(`${root}/${rel}`);

            // Encode each path segment so the nested VIDEOS_DIR slash stays a
            // real path separator, not %2F.
            const localUrl = "/project-file/" +
                rel.split("/").map(encodeURIComponent).join("/");

            const row = rowById.get(taskId);
            if (!row) {
                videos.push({
                    status: "succeeded",
                    id: taskId,
                    url: localUrl,
                    createdAt: stat.ctime?.toISOString() || "unknown",
                });
            } else {
                videos.push({
                    status: "succeeded",
                    id: taskId,
                    url: localUrl,
                    createdAt: row.created_at,
                    request: row.request_json ?? undefined,
                });
            }
        }

        // 2. Log rows with no file on disk — the video either failed or is
        //    still queued/running on the seedance server. Surface them with
        //    whatever status we last recorded.
        for (const row of rows) {
            if (onDisk.has(row.task_id)) continue;
            videos.push({
                status: row.status,
                id: row.task_id,
                createdAt: row.created_at,
                request: row.request_json ?? undefined,
            });
        }

        return videos;
    }),

    // List the first-layer files/dirs of `<project>/<path>` (path relative to
    // the project root from .env; omit or "" for the project root itself).
    listProjectFiles: publicProcedure
        .input(z.string().optional())
        .query(async (opts): Promise<DirEntry[]> => {
            const target = await resolveInProject(opts.input ?? "");

            const entries: DirEntry[] = [];
            for await (const entry of Deno.readDir(target)) {
                entries.push({
                    name: entry.name,
                    isDirectory: entry.isDirectory,
                    isFile: entry.isFile,
                    isSymlink: entry.isSymlink,
                });
            }
            // Directories first, then alphabetical
            entries.sort((a, b) =>
                a.isDirectory === b.isDirectory
                    ? a.name.localeCompare(b.name)
                    : a.isDirectory
                    ? -1
                    : 1
            );
            return entries;
        }),

    // Open a project file/dir with the OS default program.
    openInDefaultApp: publicProcedure
        .input(z.string())
        .mutation(async (opts): Promise<{ ok: true }> => {
            const target = await resolveInProject(opts.input);

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
            const srcAbs = await resolveInProject(src);
            const destDirAbs = await resolveInProject(destDir);

            const base = src.split("/").pop();
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

            const srcAbs = await resolveInProject(path);
            const destAbs = await resolveInProject(dest);
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

    // Create a Seedance generation task and log it — the single round trip the
    // composer makes. Attachments arrive as data URLs (the browser inlines its
    // blob: bytes); the API call + key live server-side. task_checker later
    // polls + downloads the result, keyed by the same task id.
    generate: publicProcedure
        .input(z.object({
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
            durationMode: z.enum(["seconds", "smart"]),
            duration: z.number(),
            audio: z.boolean(),
        }))
        .mutation(async (opts): Promise<Task> => {
            const {
                prompt,
                attachments,
                ratio,
                durationMode,
                duration,
                audio,
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

            const request: CreateTaskRequest = {
                model: "doubao-seedance-2-0-260128",
                content,
                generate_audio: audio,
                ratio,
                ...(durationMode === "seconds" ? { duration } : {}),
            };

            const created = await seedance_client.generate(request);
            if (created instanceof Error) {
                throw created;
            }

            const task = await seedance_client.getTask(created.id);
            if (task instanceof Error) {
                throw task;
            }

            // Logging failure shouldn't fail the request — the task is created.
            const recordErr = recordGeneration(db, {
                taskId: created.id,
                requestJson: JSON.stringify(request),
                createdAt: new Date().toISOString(),
                status: task.status,
                task,
            });
            if (recordErr) {
                console.error(recordErr);
            }
            return task;
        }),

    // Read the generation log (e.g. to show a video's prompt/metadata).
    getGeneration: publicProcedure
        .input(z.string())
        .query((opts) => getGeneration(db, opts.input)),

    listGenerations: publicProcedure.query(() => listGenerations(db)),
});

// Export type only — never import the router implementation into the client.
export type AppRouter = typeof appRouter;
