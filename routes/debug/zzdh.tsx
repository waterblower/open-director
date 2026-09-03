import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { db, listGenerations } from "../../db.ts";
import { isZzdhInput } from "../../apigen/mod.ts";
import {
    type CreateTaskRequest,
    type Task,
    type TaskStatus,
    ZzdhClient,
} from "../../apigen/zzdh/zzdh_client.ts";
import { getStoredApiKey } from "../../kv.ts";

const STATUS_ORDER: (TaskStatus | "unknown")[] = [
    "queued",
    "in_progress",
    "completed",
    "failed",
    "unknown",
];

type DebugTask = {
    generationId: string;
    taskId?: string;
    request: CreateTaskRequest;
    localStatus: string;
    createdAt: string;
    task?: Task;
    queryError?: string;
};

async function fetchKnownTasks(): Promise<DebugTask[] | Error> {
    if (!db) return new Error("Project database is not initialized");

    let generations;
    try {
        generations = listGenerations(db);
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }

    const known: DebugTask[] = generations.flatMap((generation) => {
        if (!isZzdhInput(generation.request_json)) return [];
        return [{
            generationId: generation.id,
            taskId: generation.task_id ?? undefined,
            request: generation.request_json,
            localStatus: generation.status,
            createdAt: generation.created_at,
        }];
    });

    const apiKey = await getStoredApiKey("zzdh");
    if (!apiKey) {
        return known.map((task) => ({
            ...task,
            queryError: "ZZDH API key is not configured",
        }));
    }

    const client = new ZzdhClient({ apiKey });
    for (const item of known) {
        if (!item.taskId) {
            item.queryError = "Generation has no provider task ID";
            continue;
        }
        const result = await client.getTask(item.taskId);
        if (result instanceof Error) item.queryError = result.message;
        else item.task = result;
    }
    return known;
}

function displayStatus(task: DebugTask): TaskStatus | "unknown" {
    return task.task?.status ?? "unknown";
}

function fmtTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
        ? value
        : date.toISOString().replace("T", " ").slice(0, 19);
}

export default define.page(async function ZzdhDebug() {
    const result = await fetchKnownTasks();

    return (
        <>
            <Head>
                <title>Debug · ZZDH tasks</title>
                <style>
                    {`
                    body { font: 13px/1.5 ui-monospace, monospace; margin: 24px; color: #1f2937; }
                    h1 { font-size: 18px; margin: 0 0 4px; }
                    h2 { font-size: 15px; margin: 28px 0 8px; }
                    .note { color: #6b7280; margin: 4px 0 16px; }
                    .err { color: #b91c1c; white-space: pre-wrap; overflow-wrap: anywhere; }
                    .summary { margin: 12px 0 24px; }
                    .summary span { display: inline-block; margin-right: 16px; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
                    th, td { border: 1px solid #e5e7eb; padding: 4px 8px; text-align: left; vertical-align: top; }
                    th { background: #f9fafb; }
                    td.id { max-width: 260px; overflow-wrap: anywhere; }
                    td.prompt { min-width: 280px; max-width: 480px; white-space: pre-wrap; }
                    pre { max-width: 440px; max-height: 180px; overflow: auto; margin: 0; white-space: pre-wrap; }
                    .muted { color: #9ca3af; }
                    `}
                </style>
            </Head>

            <h1>ZZDH tasks</h1>
            <p class="note">
                ZZDH has no documented list endpoint. This page shows tasks
                recorded by the current Open Director project and refreshes each
                task through its documented task-ID query endpoint.
            </p>

            {result instanceof Error
                ? <p class="err">Failed to load tasks: {result.message}</p>
                : <TaskGroups tasks={result} />}
        </>
    );
});

function TaskGroups({ tasks }: { tasks: DebugTask[] }) {
    const groups = new Map<TaskStatus | "unknown", DebugTask[]>();
    for (const task of tasks) {
        const status = displayStatus(task);
        const list = groups.get(status) ?? [];
        list.push(task);
        groups.set(status, list);
    }
    const statuses = STATUS_ORDER.filter((status) => groups.has(status));

    return (
        <>
            <p class="summary">
                <span>
                    <b>total:</b> {tasks.length}
                </span>
                {statuses.map((status) => (
                    <span key={status}>
                        <b>{status}:</b> {groups.get(status)!.length}
                    </span>
                ))}
            </p>

            {tasks.length === 0 && <p class="muted">No ZZDH tasks.</p>}

            {statuses.map((status) => {
                const list = groups.get(status)!;
                return (
                    <section key={status}>
                        <h2>{status} ({list.length})</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>generation ID</th>
                                    <th>task ID</th>
                                    <th>model</th>
                                    <th>created</th>
                                    <th>local status</th>
                                    <th>duration</th>
                                    <th>ratio</th>
                                    <th>references</th>
                                    <th>prompt</th>
                                    <th>remote task</th>
                                    <th>query error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.map((item) => (
                                    <tr key={item.generationId}>
                                        <td class="id">{item.generationId}</td>
                                        <td class="id">{item.taskId ?? "—"}</td>
                                        <td>{item.request.model}</td>
                                        <td>{fmtTime(item.createdAt)}</td>
                                        <td>{item.localStatus}</td>
                                        <td>{item.request.duration ?? 5}</td>
                                        <td>
                                            {item.request.aspect_ratio ??
                                                "vertical"}
                                        </td>
                                        <td>
                                            {"reference_images" in item.request
                                                ? item.request.reference_images
                                                    .length
                                                : 0}
                                        </td>
                                        <td class="prompt">
                                            {item.request.prompt}
                                        </td>
                                        <td>
                                            {item.task
                                                ? (
                                                    <pre>
                                                        {JSON.stringify(
                                                            item.task,
                                                            null,
                                                            2,
                                                        )}
                                                    </pre>
                                                )
                                                : <span class="muted">—</span>}
                                        </td>
                                        <td class="err">
                                            {item.queryError ?? ""}
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
