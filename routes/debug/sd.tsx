import { Head } from "fresh/runtime";
import { z } from "zod";
import { define } from "../../utils.ts";
import { seedance_client } from "../../apigen/seedance/seedance_client.ts";
import type {
    ArkFile,
    FileStatus,
    Task,
    TaskStatus,
} from "../../apigen/seedance/seedance.ts";

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

/** Fetch every file from Seedance, following cursor pagination. */
async function fetchAllFiles(): Promise<ArkFile[] | Error> {
    const all: ArkFile[] = [];
    let after: string | undefined;
    // Cap the page count defensively in case the API repeats a cursor.
    for (let page = 1; page <= 50; page++) {
        const res = await seedance_client.listFiles({
            limit: 100,
            after,
            order: "desc",
        });
        if (res instanceof Error) {
            // Ark currently returns the JSON literal `null`, rather than an
            // empty list object, when this account has no File API records.
            if (
                page === 1 && res instanceof z.ZodError &&
                res.issues.length === 1 &&
                res.issues[0].code === "invalid_type" &&
                res.issues[0].path.length === 0 &&
                res.issues[0].message.includes("received null")
            ) return [];
            return res;
        }
        all.push(...res.data);
        if (!res.has_more) return all;
        if (res.data.length === 0 || !res.last_id) {
            return new Error(
                "Seedance Files API reported more files without a cursor",
            );
        }
        if (res.last_id === after) {
            return new Error(
                "Seedance Files API repeated its pagination cursor",
            );
        }
        after = res.last_id;
    }
    return new Error("Seedance Files API exceeded the 50-page safety limit");
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

const FILE_STATUS_ORDER: FileStatus[] = ["uploaded", "processed", "error"];

function fmtTime(unixSec: number): string {
    if (!unixSec) return "—";
    return new Date(unixSec * 1000).toISOString().replace("T", " ").slice(
        0,
        19,
    );
}

function fmtBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
    if (bytes < 1024 ** 3) {
        return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    }
    return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

export default define.page(async function Debug() {
    const [taskResult, fileResult] = await Promise.all([
        fetchAllTasks(),
        fetchAllFiles(),
    ]);

    return (
        <>
            <Head>
                <title>Debug · Seedance tasks and files</title>
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

            {taskResult instanceof Error
                ? <p class="err">Failed to list tasks: {taskResult.message}</p>
                : <TaskGroups tasks={taskResult} />}

            <h1>Seedance files</h1>
            {fileResult instanceof Error
                ? <p class="err">Failed to list files: {fileResult.message}</p>
                : <FileGroups files={fileResult} />}
        </>
    );
});

function TaskGroups({ tasks }: { tasks: Task[] }) {
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

function FileGroups({ files }: { files: ArkFile[] }) {
    const groups = new Map<FileStatus, ArkFile[]>();
    for (const file of files) {
        const list = groups.get(file.status) ?? [];
        list.push(file);
        groups.set(file.status, list);
    }

    const statuses = FILE_STATUS_ORDER.filter((status) => groups.has(status));

    return (
        <>
            <p class="summary">
                <span>
                    <b>total:</b> {files.length}
                </span>
                {statuses.map((status) => (
                    <span key={status}>
                        <b>{status}:</b> {groups.get(status)!.length}
                    </span>
                ))}
            </p>

            {files.length === 0 && <p class="muted">No files.</p>}

            {statuses.map((status) => {
                const list = groups.get(status)!;
                return (
                    <section key={status}>
                        <h2>{status} ({list.length})</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>id</th>
                                    <th>filename</th>
                                    <th>MIME type</th>
                                    <th>size</th>
                                    <th>purpose</th>
                                    <th>created</th>
                                    <th>expires</th>
                                    <th>details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.map((file) => (
                                    <tr key={file.id}>
                                        <td>{file.id}</td>
                                        <td>{file.filename}</td>
                                        <td>{file.mime_type ?? "—"}</td>
                                        <td title={`${file.bytes} bytes`}>
                                            {fmtBytes(file.bytes)}
                                        </td>
                                        <td>{file.purpose}</td>
                                        <td>{fmtTime(file.created_at)}</td>
                                        <td>
                                            {file.expire_at
                                                ? fmtTime(file.expire_at)
                                                : "—"}
                                        </td>
                                        <td class="err">
                                            {file.status_details ?? ""}
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
