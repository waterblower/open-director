import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import {
    type MiniMaxFile,
    MiniMaxClient,
    type VideoTask,
    type VideoTaskStatus,
} from "../../apigen/minimax.ts";
import { getStoredApiKey } from "../../kv.ts";

const STATUS_ORDER: VideoTaskStatus[] = [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
];

async function client(): Promise<MiniMaxClient | Error> {
    const apiKey = await getStoredApiKey("minimax");
    return apiKey
        ? new MiniMaxClient({ apiKey })
        : new Error("MiniMax API key is not configured");
}

/** Fetch all H3 tasks in MiniMax's seven-day query window. */
async function fetchAllTasks(): Promise<VideoTask[] | Error> {
    const api = await client();
    if (api instanceof Error) return api;

    const tasks: VideoTask[] = [];
    for (let page = 1; page <= 50; page++) {
        const result = await api.listVideoTasks({
            page_num: page,
            page_size: 100,
        });
        if (result instanceof Error) return result;
        tasks.push(...result.items);
        if (result.items.length === 0 || tasks.length >= result.total) {
            return tasks;
        }
    }
    return new Error("MiniMax task list exceeded the 50-page safety limit");
}

async function fetchFiles(): Promise<MiniMaxFile[] | Error> {
    const api = await client();
    if (api instanceof Error) return api;
    const result = await api.listVideoGenerationFiles();
    return result instanceof Error ? result : result.files;
}

function fmtTime(unixSeconds: number): string {
    if (!unixSeconds) return "—";
    return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(
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

export default define.page(async function H3Debug() {
    const [taskResult, fileResult] = await Promise.all([
        fetchAllTasks(),
        fetchFiles(),
    ]);

    return (
        <>
            <Head>
                <title>Debug · MiniMax H3 tasks and files</title>
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

            <h1>MiniMax H3 tasks</h1>
            {taskResult instanceof Error
                ? <p class="err">Failed to list tasks: {taskResult.message}</p>
                : <TaskGroups tasks={taskResult} />}

            <h1>MiniMax video-generation files</h1>
            {fileResult instanceof Error
                ? <p class="err">Failed to list files: {fileResult.message}</p>
                : <FileTable files={fileResult} />}
        </>
    );
});

function TaskGroups({ tasks }: { tasks: VideoTask[] }) {
    const groups = new Map<VideoTaskStatus, VideoTask[]>();
    for (const task of tasks) {
        const list = groups.get(task.status) ?? [];
        list.push(task);
        groups.set(task.status, list);
    }
    const statuses = STATUS_ORDER.filter((status) => groups.has(status));

    return (
        <>
            <p class="summary">
                <span><b>total:</b> {tasks.length}</span>
                {statuses.map((status) => (
                    <span key={status}>
                        <b>{status}:</b> {groups.get(status)!.length}
                    </span>
                ))}
            </p>

            {tasks.length === 0 && <p class="muted">No tasks.</p>}

            {statuses.map((status) => {
                const list = groups.get(status)!;
                return (
                    <section key={status}>
                        <h2>{status} ({list.length})</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>id</th>
                                    <th>type</th>
                                    <th>model</th>
                                    <th>created</th>
                                    <th>updated</th>
                                    <th>dur</th>
                                    <th>ratio</th>
                                    <th>res</th>
                                    <th>video URL</th>
                                    <th>usage</th>
                                    <th>error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.map((task) => (
                                    <tr key={task.id}>
                                        <td>{task.id}</td>
                                        <td>{task.task_type}</td>
                                        <td>{task.model}</td>
                                        <td>{fmtTime(task.created_at)}</td>
                                        <td>{fmtTime(task.updated_at)}</td>
                                        <td>{task.duration ?? "—"}</td>
                                        <td>{task.ratio || "—"}</td>
                                        <td>{task.resolution ?? "—"}</td>
                                        <td class="url">
                                            {task.content?.url
                                                ? (
                                                    <a href={task.content.url}>
                                                        {task.content.url}
                                                    </a>
                                                )
                                                : <span class="muted">—</span>}
                                        </td>
                                        <td>{formatUsage(task)}</td>
                                        <td class="err">
                                            {task.error
                                                ? `${task.error.code}: ${task.error.message}`
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

function formatUsage(task: VideoTask): string {
    const usage = task.usage;
    if (!usage) return "—";
    const values = [
        usage.total_seconds === undefined
            ? null
            : `${usage.total_seconds}s total`,
        usage.input_image_count === undefined
            ? null
            : `${usage.input_image_count} image(s)`,
        usage.input_audio_seconds === undefined
            ? null
            : `${usage.input_audio_seconds}s audio`,
        usage.total_tokens === undefined
            ? null
            : `${usage.total_tokens} tokens`,
    ].filter((value): value is string => value !== null);
    return values.join(", ") || "—";
}

function FileTable({ files }: { files: MiniMaxFile[] }) {
    return (
        <>
            <p class="summary"><span><b>total:</b> {files.length}</span></p>
            {files.length === 0 && <p class="muted">No files.</p>}
            {files.length > 0 && (
                <table>
                    <thead>
                        <tr>
                            <th>file_id</th>
                            <th>filename</th>
                            <th>size</th>
                            <th>purpose</th>
                            <th>created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {files.map((file) => (
                            <tr key={String(file.file_id)}>
                                <td>{file.file_id}</td>
                                <td>{file.filename}</td>
                                <td title={`${file.bytes} bytes`}>
                                    {fmtBytes(file.bytes)}
                                </td>
                                <td>{file.purpose}</td>
                                <td>{fmtTime(file.created_at)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </>
    );
}
