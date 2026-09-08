import { basename } from "@std/path";
import { sleep } from "@blowater/csp";

export interface ProjectWatcher {
    /** Wait for a change indicator; return an Error if closed or unavailable. */
    next(): Promise<void | Error>;
    /** Stop watching and wait for the native reader to finish. Safe to repeat. */
    close(): Promise<void | Error>;
}

/** Batch filesystem changes into indicators, ignoring .DS_Store files. */
export function watchProjectFiles(
    projectRoot: string,
): ProjectWatcher | Error {
    let native: Deno.FsWatcher | null;
    try {
        native = Deno.watchFs(projectRoot, { recursive: true });
    }
    catch (error) {
        return toError(error);
    }

    // `failure` is reported before a buffered change, `ended` after it.
    let failure: Error | undefined;
    let ended = false;
    let closed = false;
    // At most one change is buffered: consumers only need "something changed".
    let pending = false;
    let batch: Promise<void> | undefined;
    let changed = Promise.withResolvers<void>();
    let closing: Promise<void | Error> | undefined;

    const reader = readChanges(native);
    return { next, close };

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
                return new Error("Project watcher has stopped");
            }
            await nextChange;
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

    function notify() {
        changed.resolve();
        changed = Promise.withResolvers<void>();
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
            return toError(error);
        }
    }

    /** A fixed window from the first event, not a sliding debounce. */
    async function flushBatch(): Promise<void> {
        await sleep(10);
        batch = undefined;
        if (closed || ended) {
            return;
        }
        pending = true;
        notify();
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
                        failure = toError(error);
                    }
                    return;
                }
                if (closed || event.done) {
                    return;
                }
                // Once a window is open the batch already covers this event, so
                // skip the per-path work entirely.
                if (batch !== undefined || pending) {
                    continue;
                }
                if (isMetadataOnly(event.value.paths)) {
                    continue;
                }
                batch = flushBatch();
            }
        }
        finally {
            // A window that will never fire still represents a real change.
            if (!closed && batch !== undefined) {
                pending = true;
            }
            const error = closeNative();
            if (error) {
                failure ??= error;
            }
            ended = true;
            notify();
        }
    }
}

function isMetadataOnly(paths: string[]): boolean {
    return paths.length > 0 &&
        paths.every((path) => basename(path) === ".DS_Store");
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
