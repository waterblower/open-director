import { Head } from "fresh/runtime";
import { FalClient, type RequestHistoryItem } from "../../apigen/fal.ts";
import { define } from "../../utils.ts";

const HISTORY_START = "1970-01-01T00:00:00Z";
const STATUS_ORDER = ["success", "user_error", "error", "unknown"] as const;
type DisplayStatus = typeof STATUS_ORDER[number];

interface PageData {
    tasks?: RequestHistoryItem[];
    error?: string;
}

/** Fetch every retained H3 Max request, following fal cursor pagination. */
async function fetchAllTasks(
    apiKey: string,
): Promise<RequestHistoryItem[] | Error> {
    const client = new FalClient({ apiKey });
    const tasks: RequestHistoryItem[] = [];
    let cursor: string | undefined;

    // Cap pagination defensively in case the API repeats a cursor.
    for (let page = 1; page <= 100; page++) {
        const result = await client.listRequests({
            limit: 100,
            cursor,
            start: HISTORY_START,
            expandPayloads: true,
        });
        if (result instanceof Error) return result;
        tasks.push(...result.items);
        if (!result.has_more || !result.next_cursor) return tasks;
        if (result.next_cursor === cursor) {
            return new Error("fal repeated its request-history cursor");
        }
        cursor = result.next_cursor;
    }
    return new Error("fal request history exceeded the 100-page safety limit");
}

export const handler = define.handlers({
    GET() {
        return { data: {} as PageData };
    },
    async POST(ctx) {
        const form = await ctx.req.formData();
        const apiKey = form.get("api_key");
        if (typeof apiKey !== "string" || !apiKey.trim()) {
            return { data: { error: "fal API key is required" } as PageData };
        }

        const result = await fetchAllTasks(apiKey.trim());
        return {
            data: result instanceof Error
                ? { error: result.message }
                : { tasks: result },
        } satisfies { data: PageData };
    },
});

function displayStatus(task: RequestHistoryItem): DisplayStatus {
    const code = task.status_code;
    if (code === null || code === undefined) return "unknown";
    if (code >= 200 && code < 300) return "success";
    if (code >= 400 && code < 500) return "user_error";
    return "error";
}

function fmtTime(value: string | null | undefined): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
        ? value
        : date.toISOString().replace("T", " ").slice(0, 19);
}

function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null
        ? value as Record<string, unknown>
        : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
    const field = record(value)?.[key];
    return typeof field === "string" ? field : undefined;
}

function videoUrl(task: RequestHistoryItem): string | undefined {
    return stringField(record(task.json_output)?.video, "url");
}

function errorText(task: RequestHistoryItem): string {
    if (displayStatus(task) === "success") return "";
    const output = record(task.json_output);
    const message = output?.detail ?? output?.error ?? output?.message;
    if (typeof message === "string") return message;
    return output ? JSON.stringify(output) : "";
}

export default define.page<typeof handler>(function FalDebug({ data }) {
    return (
        <>
            <Head>
                <title>Debug · fal MiniMax H3 Max tasks</title>
                <style>
                    {`
                    body { font: 13px/1.5 ui-monospace, monospace; margin: 24px; color: #1f2937; }
                    h1 { font-size: 18px; margin: 0 0 4px; }
                    h2 { font-size: 15px; margin: 28px 0 8px; }
                    form { display: flex; align-items: end; gap: 8px; margin: 12px 0 24px; }
                    label { display: grid; gap: 3px; color: #4b5563; }
                    input { box-sizing: border-box; width: 360px; border: 1px solid #d1d5db; border-radius: 4px; padding: 5px 8px; font: inherit; }
                    button { border: 1px solid #9ca3af; border-radius: 4px; background: #f9fafb; padding: 5px 12px; font: inherit; cursor: pointer; }
                    button:hover { background: #f3f4f6; }
                    .note { color: #6b7280; margin: 4px 0; }
                    .err { color: #b91c1c; white-space: pre-wrap; overflow-wrap: anywhere; }
                    .summary { margin: 12px 0 24px; }
                    .summary span { display: inline-block; margin-right: 16px; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
                    th, td { border: 1px solid #e5e7eb; padding: 4px 8px; text-align: left; vertical-align: top; }
                    th { background: #f9fafb; }
                    td.id { max-width: 240px; overflow-wrap: anywhere; }
                    td.prompt { min-width: 260px; max-width: 480px; white-space: pre-wrap; }
                    td.url { max-width: 360px; overflow-wrap: anywhere; }
                    .muted { color: #9ca3af; }
                    `}
                </style>
            </Head>

            <h1>fal MiniMax H3 Max tasks</h1>
            <p class="note">
                Lists all retained requests for minimax/h3-max/image-to-video.
                The API key is used for this request only and is not stored.
            </p>
            <form method="post">
                <label>
                    fal API key
                    <input
                        type="password"
                        name="api_key"
                        autocomplete="off"
                        required
                        autofocus
                    />
                </label>
                <button type="submit">List tasks</button>
            </form>

            {data.error && (
                <p class="err">Failed to list tasks: {data.error}</p>
            )}
            {data.tasks && <TaskGroups tasks={data.tasks} />}
        </>
    );
});

function TaskGroups({ tasks }: { tasks: RequestHistoryItem[] }) {
    const groups = new Map<DisplayStatus, RequestHistoryItem[]>();
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

            {tasks.length === 0 && <p class="muted">No tasks.</p>}

            {statuses.map((status) => {
                const list = groups.get(status)!;
                return (
                    <section key={status}>
                        <h2>{status} ({list.length})</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>request ID</th>
                                    <th>sent</th>
                                    <th>started</th>
                                    <th>ended</th>
                                    <th>duration</th>
                                    <th>HTTP</th>
                                    <th>prompt</th>
                                    <th>input image</th>
                                    <th>video URL</th>
                                    <th>error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.map((task) => {
                                    const inputUrl = stringField(
                                        task.json_input,
                                        "image_url",
                                    );
                                    const outputUrl = videoUrl(task);
                                    return (
                                        <tr key={task.request_id}>
                                            <td class="id">
                                                {task.request_id}
                                            </td>
                                            <td>{fmtTime(task.sent_at)}</td>
                                            <td>{fmtTime(task.started_at)}</td>
                                            <td>{fmtTime(task.ended_at)}</td>
                                            <td>
                                                {task.duration == null
                                                    ? "—"
                                                    : `${
                                                        task.duration.toFixed(2)
                                                    }s`}
                                            </td>
                                            <td>{task.status_code ?? "—"}</td>
                                            <td class="prompt">
                                                {stringField(
                                                    task.json_input,
                                                    "prompt",
                                                ) ?? "—"}
                                            </td>
                                            <td class="url">
                                                {inputUrl
                                                    ? (
                                                        <a href={inputUrl}>
                                                            {inputUrl}
                                                        </a>
                                                    )
                                                    : (
                                                        <span class="muted">
                                                            —
                                                        </span>
                                                    )}
                                            </td>
                                            <td class="url">
                                                {outputUrl
                                                    ? (
                                                        <a href={outputUrl}>
                                                            {outputUrl}
                                                        </a>
                                                    )
                                                    : (
                                                        <span class="muted">
                                                            —
                                                        </span>
                                                    )}
                                            </td>
                                            <td class="err">
                                                {errorText(task)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </section>
                );
            })}
        </>
    );
}
