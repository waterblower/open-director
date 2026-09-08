import { global_event_bus } from "./trpc/events.ts";
import { type ProjectWatcher, watchProjectFiles } from "./project_watcher.ts";

/** Switch the backend's active watcher; notify the frontend when files change. */
export function watchActiveProject(
    projectRoot: string | null,
): Promise<void | Error> {
    switching = switching.then(() => switchProject(projectRoot));
    return switching;
}

let active: ProjectWatcher | null = null;
let switching: Promise<void | Error> = Promise.resolve();

async function switchProject(
    projectRoot: string | null,
): Promise<void | Error> {
    const previous = active;
    active = null;
    if (previous) {
        const error = await previous.close();
        if (error instanceof Error) {
            return error;
        }
    }
    if (projectRoot === null) {
        return;
    }
    const watcher = watchProjectFiles(projectRoot);
    if (watcher instanceof Error) {
        return watcher;
    }
    active = watcher;
    publishChanges(watcher, projectRoot);
}

// Runs detached for the lifetime of the watcher, so failures are logged here
// rather than returned: the switch that started it has already completed.
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
