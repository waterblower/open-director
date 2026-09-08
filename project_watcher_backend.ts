import { global_event_bus } from "./trpc/events.ts";
import { type ProjectWatcher, watchProjectFiles } from "./project_watcher.ts";

/** Switch the backend's active watcher; notify the frontend when files change. */
export function watchActiveProject(projectRoot: string | null): Promise<void> {
    switching = switching.then(() => switchProject(projectRoot));
    return switching;
}

let active: ProjectWatcher | null = null;
let switching = Promise.resolve();

async function switchProject(projectRoot: string | null): Promise<void> {
    const previous = active;
    active = null;
    if (previous) {
        const error = await previous.close();
        if (error instanceof Error) {
            console.error("[project-watcher] failed to close:", error);
            return;
        }
    }
    if (projectRoot === null) {
        return;
    }
    const watcher = watchProjectFiles(projectRoot);
    active = watcher;
    publishChanges(watcher, projectRoot);
}

async function publishChanges(watcher: ProjectWatcher, projectRoot: string) {
    for (;;) {
        const event = await watcher.next();
        if (active !== watcher) {
            return;
        }
        if (event instanceof Error) {
            console.error("[project-watcher] failed:", projectRoot, event);
            return;
        }
        await global_event_bus.put({ type: "fs_changed" });
    }
}
