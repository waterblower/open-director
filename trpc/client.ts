/**
 * tRPC browser client — https://trpc.io/docs/quickstart
 *
 * Import this in islands to call procedures with full type safety, e.g.
 *   import { trpc } from "../trpc/client.ts";
 *   const users = await trpc.userList.query();
 */
import {
    createTRPCClient,
    httpBatchLink,
    splitLink,
    unstable_httpSubscriptionLink,
} from "@trpc/client";
import type { AppRouter } from "./router.ts";
import type { ProjectData } from "../components/FileExplorer.tsx";

export const trpc = createTRPCClient<AppRouter>({
    links: [
        splitLink({
            condition: (op) => op.type === "subscription",
            true: unstable_httpSubscriptionLink({ url: "/trpc" }),
            false: httpBatchLink({ url: "/trpc" }),
        }),
    ],
});

/** OS junk files that should never be shown in the explorer. */
const HIDDEN_NAMES = new Set([".DS_Store"]);

function notHidden(entry: { name: string }): boolean {
    return !HIDDEN_NAMES.has(entry.name);
}

/** Read the (non-recursive) entries of `path` within the given project root. */
export async function readDir(projectRoot: string, path: string) {
    try {
        const res = await trpc.readDir.query({ projectRoot, path });
        return res.filter(notHidden);
    } catch (err) {
        return err as Error;
    }
}

/**
 * Load the whole project state in one round trip: root path, root entries, the
 * restored-expanded directories (children pre-loaded) and the saved selection.
 * Returns null when no project is open, or an Error on failure.
 */
export async function loadProjectData(): Promise<ProjectData | null | Error> {
    try {
        const data = await trpc.loadProjectData.query();
        if (!data) return null;
        const childrenByPath: Record<string, ProjectData["rootEntries"]> = {};
        for (const [dir, entries] of Object.entries(data.childrenByPath)) {
            childrenByPath[dir] = entries.filter(notHidden);
        }
        return {
            rootPath: data.rootPath,
            rootEntries: data.rootEntries.filter(notHidden),
            childrenByPath,
            expanded: new Set(data.expanded),
            selected: data.selected,
        };
    } catch (err) {
        return err as Error;
    }
}
