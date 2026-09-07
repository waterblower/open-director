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
    httpSubscriptionLink,
    splitLink,
} from "@trpc/client";
import type { AppRouter } from "./router.ts";
import type { ProjectData } from "../components/FileExplorer.tsx";
import { Signal, signal } from "@preact/signals";

export const trpc = createTRPCClient<AppRouter>({
    links: [
        splitLink({
            condition: (op) => op.type === "subscription",
            true: httpSubscriptionLink({ url: "/trpc" }),
            false: httpBatchLink({ url: "/trpc" }),
        }),
    ],
});

/** OS junk files that should never be shown in the explorer. */
const HIDDEN_NAMES = new Set([".DS_Store"]);

/** Open Director's own data folder, hidden in the explorer by default. */
const OPEN_DIRECTORY_NAME = ".open-director";

/**
 * Whether to show the `.open-director` data folder in the explorer. Loaded from
 * KV by `loadConfig()` on startup and toggled via `setShowOpenDirectorDir`; the
 * tree re-filters once the project listing is reloaded.
 */
export const ShowOpenDirectorDir: Signal<boolean> = signal<boolean>(false);

/** Load the current value from KV (machine-level config). */
export async function loadConfig(): Promise<void> {
    try {
        ShowOpenDirectorDir.value = await trpc.getShowOpenDirectorDir.query();
    }
    catch (err) {
        console.error("[client] failed to load config:", err);
    }
}

/** Toggle showing `.open-director`, persisting the choice to KV. */
export async function setShowOpenDirectorDir(next: boolean): Promise<void> {
    ShowOpenDirectorDir.value = next;
    try {
        await trpc.setShowOpenDirectorDir.mutate(next);
    }
    catch (err) {
        console.error(
            "[client] failed to persist show-open-director setting:",
            err,
        );
    }
}

function notHidden(entry: { name: string }): boolean {
    if (HIDDEN_NAMES.has(entry.name)) {
        return false;
    }
    if (entry.name === OPEN_DIRECTORY_NAME && !ShowOpenDirectorDir.value) {
        return false;
    }
    return true;
}

/** Read the (non-recursive) entries of `path` within the given project root. */
export async function readDir(projectRoot: string, path: string) {
    const res = await trpc.readDir.query({ projectRoot, path });
    if (res.error) {
        return new Error(res.message);
    }
    return res.dirs.filter(notHidden);
}

/**
 * Load the whole project state in one round trip: root path, root entries, the
 * restored-expanded directories (children pre-loaded) and the saved selection.
 * Returns null when no project is open, or an Error on failure.
 */
export async function loadProjectData() {
    const data = await trpc.loadProjectData.query();
    if (!data) {
        return null;
    }
    if (data.error) {
        console.error("loadProjectData failed:", data);
        return data;
    }
    const childrenByPath: Record<string, ProjectData["rootEntries"]> = {};
    for (const [dir, entries] of Object.entries(data.childrenByPath)) {
        childrenByPath[dir] = entries.filter(notHidden);
    }
    return {
        error: false as const,
        rootPath: data.rootPath,
        rootEntries: data.rootEntries.filter(notHidden),
        childrenByPath,
        expanded: new Set(data.expanded),
        selected: data.selected,
    };
}
