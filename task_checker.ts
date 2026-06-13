/**
 * Reconciles the Seedance server's tasks with the local `<project>/.project`
 * dir: any succeeded task whose video isn't on disk yet gets downloaded.
 *
 * Video files are named `<task.id>.mp4`, so a task is considered "already
 * downloaded" when a file with a stem equal to its id exists.
 */
import { resolveInProject } from "./project.ts";
import { seedance_client } from "./seedance_client.ts";
import { delay } from "@std/async";

const VIDEOS_DIR = ".project";

export async function check_and_download(): Promise<void | Error> {
    for (;;) {
        // 1. List all tasks from the Seedance server.
        const seedance_task_list = await seedance_client.listTasks();
        if (seedance_task_list instanceof Error) {
            return seedance_task_list;
        }
        const seedance_tasks = seedance_task_list.items;

        // 2. List all videos already in the .project dir (by filename stem == id).
        const dirAbs = await resolveInProject(VIDEOS_DIR);
        await Deno.mkdir(dirAbs, { recursive: true });
        const existing = new Set<string>();
        for await (const entry of Deno.readDir(dirAbs)) {
            if (!entry.isFile) continue;
            const dot = entry.name.lastIndexOf(".");
            existing.add(dot > 0 ? entry.name.slice(0, dot) : entry.name);
        }

        // 3 + 4. Download any succeeded task that isn't on disk yet.
        for (const task of seedance_tasks) {
            const url = task.content?.video_url;
            if (task.status !== "succeeded" || !url) {
                continue;
            }
            if (existing.has(task.id)) {
                continue;
            }

            const err = await downloadVideo(url, `${dirAbs}/${task.id}.mp4`);
            if (err instanceof Error) {
                console.error(`download ${task.id} failed:`, err);
            } else {
                console.log(`downloaded ${task.id}.mp4`);
            }
        }

        await delay(1000); // every 1s
    }
}

/** Stream `url` to `dest`, overwriting any partial file. */
async function downloadVideo(url: string, dest: string) {
    const res = await fetch(url);
    if (!res.ok) {
        return new Error(`${await res.text()}`);
    }
    const file = await Deno.open(dest, {
        write: true,
        create: true,
        truncate: true,
    });
    await res.body.pipeTo(file.writable);
}
