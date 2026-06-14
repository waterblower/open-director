/**
 * Reconciles the Seedance server's tasks with the local
 * `<project>/.project/generations` dir: any succeeded task whose video isn't on
 * disk yet gets downloaded.
 *
 * Video files are named `<task.id>.mp4`, so a task is considered "already
 * downloaded" when a file with a stem equal to its id exists.
 */
import { resolveInProject } from "./project.ts";
import { seedance_client } from "./seedance_client.ts";
import { delay } from "@std/async";
import { VIDEOS_DIR } from "./trpc/router.ts";
import {
    db,
    listPendingGenerations,
    markDownloaded,
    recordTaskStatus,
} from "./db.ts";

export async function check_and_download(): Promise<void | Error> {
    const dirAbs = await resolveInProject(VIDEOS_DIR);
    await Deno.mkdir(dirAbs, { recursive: true });

    for (;;) {
        // 1. Generations still worth polling: logged locally, not yet
        //    downloaded, and not already known to have failed.
        const pending = listPendingGenerations(db);

        // 2. Poll each from Seedance; download the ones that have succeeded.
        for (const taskId of pending) {
            const task = await seedance_client.getTask(taskId);
            if (task instanceof Error) {
                console.error(`get task ${taskId} failed:`, task);
                continue;
            }

            // Record terminal failures so they drop out of `pending` and we
            // stop polling them.
            if (task.status === "failed") {
                console.log(taskId, "failed");
                recordTaskStatus(db, {
                    taskId,
                    status: task.status,
                    taskJson: JSON.stringify(task),
                });
                continue;
            }

            // Not ready yet (queued/running/…) — try again next pass.
            if (task.status !== "succeeded") continue;

            const url = task.content?.video_url;
            if (!url) continue; // succeeded but no video (shouldn't happen)

            const err = await downloadVideo(url, `${dirAbs}/${taskId}.mp4`);
            if (err instanceof Error) {
                console.error(`download ${taskId} failed:`, err);
                continue;
            }
            console.log(`downloaded ${taskId}.mp4`);
            // Record the download + full task; this sets downloaded_at, so the
            // task drops out of `pending`.
            markDownloaded(db, {
                taskId,
                status: task.status,
                taskJson: JSON.stringify(task),
                downloadedAt: new Date().toISOString(),
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
