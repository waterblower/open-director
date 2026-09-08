import { basename } from "@std/path";
import { sleep } from "@blowater/csp";

export interface ProjectWatcher {
    /** Wait for a change indicator; return an Error if closed or unavailable. */
    next(): Promise<void | Error>;
    /** Stop watching and wait for the native reader to finish. Safe to repeat. */
    close(): Promise<void | Error>;
}

/** Batch filesystem changes into indicators, ignoring .DS_Store files. */
export function watchProjectFiles(projectRoot: string | null): ProjectWatcher {
    let native: Deno.FsWatcher | null = null;
    let failure: Error | undefined;
    let closed = false;
    let ended = projectRoot === null;
    let pending = false;
    let batch: Promise<void> | undefined;
    let changed = Promise.withResolvers<void>();
    let closing: Promise<void | Error> | undefined;

    if (projectRoot !== null) {
        try {
            native = Deno.watchFs(projectRoot, { recursive: true });
        }
        catch (error) {
            failure = error instanceof Error ? error : new Error(String(error));
            ended = true;
        }
    }

    const reader = native ? readChanges(native) : Promise.resolve();
    return { next, close };

    function notify() {
        changed.resolve();
        changed = Promise.withResolvers<void>();
    }

    async function flushBatch(): Promise<void> {
        await sleep(10);
        batch = undefined;
        if (closed || ended) {
            return;
        }
        pending = true;
        notify();
    }

    function closeNative(): void | Error {
        const watcher = native;
        native = null;
        if (!watcher) {
            return;
        }
        try {
            watcher.close();
        }
        catch (error) {
            return error instanceof Error ? error : new Error(String(error));
        }
    }

    function close(): Promise<void | Error> {
        if (closing) {
            return closing;
        }
        closed = true;
        pending = false;
        notify();
        const error = closeNative();
        closing = Promise.all([reader, batch]).then(() => error);
        return closing;
    }

    async function readChanges(watcher: Deno.FsWatcher): Promise<void> {
        const events = watcher[Symbol.asyncIterator]();
        try {
            for (;;) {
                let event: IteratorResult<Deno.FsEvent>;
                try {
                    event = await events.next();
                }
                catch (error) {
                    if (!closed) {
                        failure = error instanceof Error
                            ? error
                            : new Error(String(error));
                    }
                    return;
                }
                if (closed || event.done) {
                    break;
                }
                if (
                    event.value.paths.length > 0 &&
                    event.value.paths.every((path) =>
                        basename(path) === ".DS_Store"
                    )
                ) {
                    continue;
                }
                // A fixed window from the first event, not a sliding debounce.
                if (batch === undefined && !pending) {
                    batch = flushBatch();
                }
            }
        }
        finally {
            if (!closed && batch !== undefined) {
                pending = true;
            }
            const error = closeNative();
            failure ??= error instanceof Error ? error : undefined;
            ended = true;
            notify();
        }
    }

    async function next(): Promise<void | Error> {
        for (;;) {
            const nextChange = changed.promise;
            if (closed) {
                return new Error("Project watcher is closed");
            }
            if (failure) {
                return failure;
            }
            if (pending) {
                pending = false;
                return;
            }
            if (ended) {
                return new Error(
                    projectRoot === null
                        ? "No project is being watched"
                        : "Project watcher has stopped",
                );
            }
            await nextChange;
        }
    }
}
