/**
 * tRPC app router — https://trpc.io/docs/quickstart
 *
 * The exported `AppRouter` type is consumed by the client for end-to-end
 * type safety. Never import the router implementation into the client.
 */
import { z } from "zod";
import { publicProcedure, router } from "./init.ts";

/** Resolve the project directory from the `project` entry in .env. */
async function projectDir(): Promise<string> {
    // Prefer an already-loaded env var; fall back to reading .env directly
    // (the Vite dev server doesn't populate Deno.env from .env).
    const fromEnv = Deno.env.get("project");
    if (fromEnv) return fromEnv;

    const text = await Deno.readTextFile(".env");
    for (const line of text.split("\n")) {
        const match = line.match(/^\s*project\s*=\s*(.*)$/);
        if (match) return match[1].trim();
    }
    throw new Error("`project` is not set in .env");
}

interface DirEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymlink: boolean;
}

export const appRouter = router({
    // List the first-layer files/dirs of `<project>/<path>` (path relative to
    // the project root from .env; omit or "" for the project root itself).
    listProjectFiles: publicProcedure
        .input(z.string().optional())
        .query(async (opts): Promise<DirEntry[]> => {
            const root = await projectDir();
            const sub = opts.input ?? "";
            if (sub.includes("..")) {
                throw new Error("Path may not contain '..'");
            }
            const target = sub ? `${root}/${sub}` : root;

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
});

// Export type only — never import the router implementation into the client.
export type AppRouter = typeof appRouter;
