/**
 * tRPC app router — https://trpc.io/docs/quickstart
 *
 * The exported `AppRouter` type is consumed by the client for end-to-end
 * type safety. Never import the router implementation into the client.
 */
import { z } from "zod";
import { publicProcedure, router } from "./init.ts";
import { projectDir, resolveInProject } from "../project.ts";
import type { Task } from "../seedance.ts";

/** Directory under the project root where generated videos are stored. */
const VIDEOS_DIR = ".project";
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
    // List generated videos in `<project>/.project` as Task-like objects.
    // Creates the .project dir if it doesn't exist yet.
    listProjectVideos: publicProcedure.query(async (): Promise<Task[]> => {
        const root = await projectDir();
        const dir = `${root}/${VIDEOS_DIR}`;
        // Creates the dir if missing; a no-op (no throw) when it already exists.
        await Deno.mkdir(dir, { recursive: true });

        const videos: { task: Task; mtime: number }[] = [];
        for await (const entry of Deno.readDir(dir)) {
            if (!entry.isFile || !VIDEO_EXT.test(entry.name)) continue;
            const rel = `${VIDEOS_DIR}/${entry.name}`;
            const stat = await Deno.stat(`${root}/${rel}`);
            videos.push({
                mtime: stat.mtime?.getTime() ?? 0,
                task: {
                    id: entry.name,
                    model: "",
                    status: "succeeded",
                    created_at: Math.floor((stat.mtime?.getTime() ?? 0) / 1000),
                    content: {
                        video_url: `/project-file/${
                            encodeURIComponent(VIDEOS_DIR)
                        }/${encodeURIComponent(entry.name)}`,
                    },
                },
            });
        }
        // Newest first
        videos.sort((a, b) => b.mtime - a.mtime);
        return videos.map((v) => v.task);
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
});

// Export type only — never import the router implementation into the client.
export type AppRouter = typeof appRouter;
