/**
 * Reconciles the Seedance server's tasks with the local
 * `<project>/.project/generations` dir: any succeeded task whose video isn't on
 * disk yet gets downloaded.
 *
 * Video files are named `<task.id>.mp4`, so a task is considered "already
 * downloaded" when a file with a stem equal to its id exists.
 */
import type { DatabaseSync } from "node:sqlite";
import { seedance_client } from "./seedance_client.ts";
import { delay } from "@std/async";
import { join } from "@std/path";
import { VIDEOS_DIR } from "./trpc/router.ts";
import {
    db,
    getContentHashByGenerationId,
    getGenerationById,
    listDownloadedGenerations,
    listPendingGenerations,
    listQueuedWithoutTask,
    markDownloaded,
    recordContentHash,
    recordTaskStatus,
    updateGeneration,
} from "./db.ts";
import { SeedanceError, type Task } from "./seedance/seedance.ts";

/**
 * How long a generation may sit "queued" with no Seedance task id before we
 * treat it as a failed creation. Long enough not to race a submission still in
 * flight (the create's network call holds the row in this state briefly).
 */
const QUEUED_GRACE_MS = 5 * 60 * 1000;
import { global_event_bus } from "./trpc/router.ts";
import { kv } from "./kv.ts";
import { getLastOpenedProject } from "./project_registry.ts";
import { sha256Hex } from "./utils.ts";

export async function check_and_download(): Promise<void | Error> {
    for (;;) {
        const project_path = (await getLastOpenedProject(kv))?.path;
        if (!db || !project_path) {
            console.log("no project openned, waiting...");
            await delay(5000);
            continue;
        }
        // 1. Generations still worth polling: logged locally, not yet
        //    downloaded, and not already known to have failed.
        const pending = listPendingGenerations(db);

        // 2. Poll each from Seedance; download the ones that have succeeded.
        //    Each row is handled in its own try/catch so one bad row (e.g. an
        //    unparseable request_json) can't crash the whole polling loop.
        for (const gen of pending) {
            try {
                const task = await seedance_client.getTask(gen.task_id);
                if (task instanceof Error) {
                    // 404 → Seedance has no such task (never persisted / purged):
                    // terminal, so mark failed and stop polling it. Other errors
                    // (network, 5xx) are transient — log and retry next pass.
                    if (task instanceof SeedanceError && task.status === 404) {
                        const e = updateGeneration(db, {
                            id: gen.id,
                            status: "failed",
                            failed_reason:
                                `Seedance 未找到任务 ${gen.task_id}（任务不存在）`,
                        });
                        if (e instanceof Error) console.error(e);
                    } else {
                        console.error(`get task ${gen.task_id} failed:`, task);
                    }
                    continue;
                }

                // Record terminal failures (with the reason) so they drop out
                // of `pending` and we stop polling them.
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

                await downloadAndRecord(db, project_path, gen.id, task);
            } catch (err) {
                console.error(`polling generation ${gen.task_id} failed:`, err);
            }
        }

        // 3. Heal dirty data: rows we believe are downloaded but whose file is
        //    gone from disk (e.g. the user deleted it). Re-fetch the task for a
        //    fresh (24h) video URL and download again.
        const downloaded = listDownloadedGenerations(db);
        for (const gen of downloaded) {
            try {
                const dest = join(
                    project_path,
                    VIDEOS_DIR,
                    `${gen.task_id}.mp4`,
                );
                if (!(await fileExists(dest))) {
                    console.log(
                        `missing on disk, re-downloading ${gen.task_id}.mp4`,
                    );
                    const task = await seedance_client.getTask(gen.task_id);
                    if (task instanceof Error) {
                        console.error(
                            `re-fetch task ${gen.task_id} failed:`,
                            task,
                        );
                        continue;
                    }
                    if (task.status !== "succeeded") {
                        console.error(
                            `cannot re-download ${gen.task_id}: status ${task.status}`,
                        );
                        continue;
                    }
                    await downloadAndRecord(db, project_path, gen.id, task);
                    continue;
                }

                // Backfill the content hash for videos downloaded before
                // hashing existed — only ever computed once per generation.
                if (getContentHashByGenerationId(db, gen.id) == null) {
                    await hashAndRecord(db, gen.id, dest);
                }
            } catch (err) {
                console.error(`healing generation ${gen.task_id} failed:`, err);
            }
        }

        // 4. Fail stuck "queued" rows that never got a Seedance task id — the
        //    create call failed (or the process died) before submission. Past
        //    the grace period there's no task to query, so they can never make
        //    progress; mark them failed so they leave the active list.
        const stuck = listQueuedWithoutTask(db);
        for (const gen of stuck) {
            try {
                const ageMs = Date.now() - Date.parse(gen.created_at);
                if (ageMs <= QUEUED_GRACE_MS) continue; // still being submitted

                console.log(
                    `failing stuck queued generation ${gen.id} (never submitted)`,
                );
                const err = updateGeneration(db, {
                    id: gen.id,
                    status: "failed",
                    failed_reason:
                        "创建任务失败：未提交到 Seedance（无 task id）",
                });
                if (err instanceof Error) {
                    console.error(`fail stuck generation ${gen.id}:`, err);
                }
            } catch (err) {
                console.error(
                    `healing queued generation ${gen.id} failed:`,
                    err,
                );
            }
        }

        // 5. Re-run the loop every 5 seconds.
        await delay(5000);
    }
}

/**
 * Download a succeeded task's video to the project's generations dir, persist
 * the download (sets downloaded_at), and emit a "finished" event. Used by both
 * the initial poll and the disk-reconciliation pass.
 */
async function downloadAndRecord(
    db: DatabaseSync,
    projectPath: string,
    genId: string,
    task: Task,
): Promise<void> {
    const url = task.content?.video_url;
    if (!url) {
        console.error(
            `task ${task.id} succeeded but has no video url; skipping`,
        );
        return;
    }

    const dest = join(projectPath, VIDEOS_DIR, `${task.id}.mp4`);
    const err = await downloadVideo(url, dest);
    if (err instanceof Error) {
        console.error(`download ${task.id} failed:`, err);
        return;
    }
    console.log("downloaded", `${task.id}.mp4`);
    await hashAndRecord(db, genId, dest);

    markDownloaded(db, {
        taskId: task.id,
        status: task.status,
        taskJson: JSON.stringify(task),
        downloadedAt: new Date().toISOString(),
    });

    const generation = getGenerationById(db, genId);
    if (generation instanceof Error) {
        // The video is downloaded and recorded; only the live "finished" event
        // is lost (the GUI still sees it on its next listing), so don't throw.
        console.error(`load generation ${genId} failed:`, generation);
        return;
    }
    await global_event_bus.put({
        type: "generation_finished",
        gen: generation,
    });
}

/**
 * Hash a downloaded video and record it against its generation, so any later
 * copy or rename of that file can be traced back to the prompt that produced
 * it (see `getGenerationIdByContentHash`).
 */
async function hashAndRecord(
    db: DatabaseSync,
    genId: string,
    dest: string,
): Promise<void> {
    try {
        const hash = await sha256Hex(await Deno.readFile(dest));
        const err = recordContentHash(db, genId, hash);
        if (err instanceof Error) {
            console.error(`record content hash for ${genId} failed:`, err);
        }
    } catch (err) {
        console.error(`hash ${dest} failed:`, err);
    }
}

/** Whether a file exists at `path`. */
async function fileExists(path: string): Promise<boolean> {
    try {
        await Deno.stat(path);
        return true;
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) return false;
        throw err;
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
