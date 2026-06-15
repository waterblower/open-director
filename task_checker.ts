/**
 * Reconciles the Seedance server's tasks with the local
 * `<project>/.project/generations` dir: any succeeded task whose video isn't on
 * disk yet gets downloaded.
 *
 * Video files are named `<task.id>.mp4`, so a task is considered "already
 * downloaded" when a file with a stem equal to its id exists.
 */
import { seedance_client } from "./seedance_client.ts";
import { delay } from "@std/async";
import { join } from "@std/path";
import { VIDEOS_DIR } from "./trpc/router.ts";
import {
    db,
    getGenerationById,
    listPendingGenerations,
    markDownloaded,
    recordTaskStatus,
} from "./db.ts";
import { global_event_bus } from "./trpc/router.ts";
import { projectDir } from "./project.ts";

export async function check_and_download(): Promise<void | Error> {
    for (;;) {
        // 1. Generations still worth polling: logged locally, not yet
        //    downloaded, and not already known to have failed.
        const pending = listPendingGenerations(db);

        // 2. Poll each from Seedance; download the ones that have succeeded.
        for (const gen of pending) {
            const task = await seedance_client.getTask(gen.task_id);
            if (task instanceof Error) {
                console.error(`get task ${task} failed:`, task);
                continue;
            }

            // Record terminal failures (with the reason) so they drop out of
            // `pending` and we stop polling them.
            if (task.status === "failed") {
                const reason = task.error
                    ? `${task.error.code}: ${task.error.message}`
                    : undefined;
                console.log(task, "failed", reason ?? "");
                recordTaskStatus(db, {
                    taskId: task.id,
                    status: task.status,
                    taskJson: JSON.stringify(task),
                    failedReason: reason,
                });
                continue;
            }

            // Not ready yet (queued/running/…) — try again next pass.
            if (task.status !== "succeeded") continue;

            const url = task.content?.video_url;
            if (!url) {
                throw new Error("succeeded but no video (shouldn't happen)");
            }

            const err = await downloadVideo(
                url,
                join(await projectDir(), VIDEOS_DIR, `${task.id}.mp4`),
            );
            if (err instanceof Error) {
                console.error(`download ${task.id} failed:`, err);
                continue;
            }
            console.log(`downloaded ${task.id}.mp4`);
            // Record the download + full task; this sets downloaded_at, so the
            // task drops out of `pending`.
            markDownloaded(db, {
                taskId: task.id,
                status: task.status,
                taskJson: JSON.stringify(task),
                downloadedAt: new Date().toISOString(),
            });

            const generation = getGenerationById(db, gen.id);
            if (generation instanceof Error) {
                throw generation;
            }
            await global_event_bus.put({
                type: "video_generated",
                gen: generation,
            });
        }

        // 3. Re-run the loop every 5 seconds.
        await delay(5000);
    }
}

/** Stream `url` to `dest`, overwriting any partial file. */
async function downloadVideo(url: string, dest: string) {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
        return new Error(`${await res.text()}`);
    }
    const file = await Deno.open(dest, {
        write: true,
        create: true,
        truncate: true,
    });
    try {
        await res.body.pipeTo(file.writable);
    } catch (err) {
        return err as Error;
    }
}

// Watch the project directory for filesystem changes and emit fs_changed events,
// debounced so burst writes produce a single notification.
(async () => {
    const root = await projectDir();
    const watcher = Deno.watchFs(root);
    for await (const event of watcher) {
        console.log(event);
        await global_event_bus.put({ type: "fs_changed" });
    }
})();
