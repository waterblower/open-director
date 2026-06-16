import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { seedance_client } from "../seedance_client.ts";
import { resolveInProject } from "../project.ts";
import { VIDEOS_DIR } from "../trpc/router.ts";
import type { Task, TaskStatus } from "../seedance.ts";

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i;

/**
 * Task ids that already have a downloaded video file in the generations folder
 * (filename stem == task id). Checks the filesystem only — not the DB.
 */
async function listDownloadedIds(dir: string): Promise<Set<string>> {
    const ids = new Set<string>();
    try {
        for await (const entry of Deno.readDir(dir)) {
            if (!entry.isFile || !VIDEO_EXT.test(entry.name)) continue;
            ids.add(entry.name.replace(VIDEO_EXT, ""));
        }
    } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    return ids;
}

/** Fetch every task from Seedance, following pagination. */
async function fetchAllTasks(): Promise<Task[] | Error> {
    const all: Task[] = [];
    // Cap the page count defensively so a bad `total` can't loop forever.
    for (let page = 1; page <= 50; page++) {
        const res = await seedance_client.listTasks({
            page_num: page,
            page_size: 500,
        });
        if (res instanceof Error) return res;
        all.push(...res.items);
        if (res.items.length === 0 || all.length >= res.total) break;
    }
    return all;
}

// Preferred display order; any other status is appended afterwards.
const STATUS_ORDER: (TaskStatus | "unknown")[] = [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "expired",
    "unknown",
];

function fmtTime(unixSec: number): string {
    if (!unixSec) return "—";
    return new Date(unixSec * 1000).toISOString().replace("T", " ").slice(
        0,
        19,
    );
}

export default define.page(async function Debug() {
    const projectDir = await resolveInProject(VIDEOS_DIR);
    if (!projectDir) {
        return (
            <div style="font: 14px/1.6 ui-sans-serif, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: #6b7280; gap: 8px;">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                <p style="margin: 0; font-size: 16px; font-weight: 600; color: #374151;">
                    No project open
                </p>
                <p style="margin: 0; font-size: 13px;">
                    Open a project to view Seedance debug info.
                </p>
            </div>
        );
    }
    const [result, downloaded] = await Promise.all([
        fetchAllTasks(),
        listDownloadedIds(projectDir),
    ]);

    return (
        <>
            <Head>
                <title>Debug · Seedance tasks</title>
                <style>
                    {`
                    body { font: 13px/1.5 ui-monospace, monospace; margin: 24px; color: #1f2937; }
                    h1 { font-size: 18px; margin: 0 0 4px; }
                    h2 { font-size: 15px; margin: 28px 0 8px; }
                    .err { color: #b91c1c; white-space: pre-wrap; }
                    .summary { margin: 12px 0 24px; }
                    .summary span { display: inline-block; margin-right: 16px; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
                    th, td { border: 1px solid #e5e7eb; padding: 4px 8px; text-align: left; vertical-align: top; }
                    th { background: #f9fafb; }
                    td.url { max-width: 360px; overflow-wrap: anywhere; }
                    .muted { color: #9ca3af; }
                    `}
                </style>
            </Head>
            <h1>Seedance tasks</h1>

            {result instanceof Error
                ? <p class="err">Failed to list tasks: {result.message}</p>
                : <TaskGroups tasks={result} downloaded={downloaded} />}
        </>
    );
});

function TaskGroups(
    { tasks, downloaded }: { tasks: Task[]; downloaded: Set<string> },
) {
    // Group by status.
    const groups = new Map<string, Task[]>();
    for (const t of tasks) {
        const key = t.status ?? "unknown";
        const list = groups.get(key) ?? [];
        list.push(t);
        groups.set(key, list);
    }

    // Ordered keys: known statuses first, then any extras alphabetically.
    const keys = [
        ...STATUS_ORDER.filter((s) => groups.has(s)),
        ...[...groups.keys()]
            .filter((k) => !STATUS_ORDER.includes(k as TaskStatus))
            .sort(),
    ];

    return (
        <>
            <p class="summary">
                <span>
                    <b>total:</b> {tasks.length}
                </span>
                {keys.map((k) => (
                    <span key={k}>
                        <b>{k}:</b> {groups.get(k)!.length}
                    </span>
                ))}
            </p>

            {tasks.length === 0 && <p class="muted">No tasks.</p>}

            {keys.map((k) => {
                const list = groups.get(k)!;
                return (
                    <section key={k}>
                        <h2>{k} ({list.length})</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>id</th>
                                    <th>model</th>
                                    <th>created</th>
                                    <th>dur</th>
                                    <th>ratio</th>
                                    <th>res</th>
                                    <th>downloaded</th>
                                    <th>video_url</th>
                                    <th>error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.map((t) => (
                                    <tr key={t.id}>
                                        <td>{t.id}</td>
                                        <td>{t.model || "—"}</td>
                                        <td>{fmtTime(t.created_at)}</td>
                                        <td>{t.duration ?? "—"}</td>
                                        <td>{t.ratio ?? "—"}</td>
                                        <td>{t.resolution ?? "—"}</td>
                                        <td>
                                            {downloaded.has(t.id)
                                                ? "yes"
                                                : <span class="muted">no</span>}
                                        </td>
                                        <td class="url">
                                            {t.content?.video_url
                                                ? (
                                                    <a
                                                        href={t.content
                                                            .video_url}
                                                    >
                                                        {t.content.video_url}
                                                    </a>
                                                )
                                                : <span class="muted">—</span>}
                                        </td>
                                        <td class="err">
                                            {t.error
                                                ? `${t.error.code}: ${t.error.message}`
                                                : ""}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                );
            })}
        </>
    );
}
