/**
 * MCP server exposed over HTTP from the same Fresh backend process.
 *
 * Implements the Model Context Protocol as plain JSON-RPC 2.0 (stateless,
 * Streamable-HTTP compatible) so editors like Claude Code / Codex can drive
 * Open Director's video generation. The HTTP plumbing lives in
 * `routes/mcp.ts`; this module is transport-agnostic — feed it a parsed
 * JSON-RPC payload and it returns the response payload (or null for
 * notification-only messages).
 *
 * Tools reuse the existing app internals: the tRPC `generate` procedure (so a
 * generation created here shows up in the GUI and is polled/downloaded by the
 * same `check_and_download` loop), the generations DB, and the Seedance client.
 */
import { z } from "zod";
import { join } from "@std/path";
import { appRouter, VIDEOS_DIR } from "../trpc/router.ts";
import {
    db,
    getGenerationDetail,
    listGenerations,
    updateGeneration,
} from "../db.ts";
import { seedance_client } from "../seedance_client.ts";
import { getStoredProjectPath } from "../kv.ts";
import { estimateCost } from "../seedance/pricing.ts";
import type { CreateTaskRequest } from "../seedance/seedance.ts";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "open-director", version: "0.1.0" } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Require an open project (the generations DB is project-scoped). */
function requireDb(): NonNullable<typeof db> {
    if (!db) {
        throw new Error(
            "No project is open in Open Director. Open a project in the app first.",
        );
    }
    return db;
}

/** Concatenated text of a request's text content items. */
function promptOf(req: CreateTaskRequest): string {
    return req.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

interface Tool {
    name: string;
    description: string;
    /** JSON Schema advertised via tools/list. */
    inputSchema: Record<string, unknown>;
    /** Run the tool; the returned string becomes a text content block. */
    handler: (args: unknown) => Promise<string>;
}

const GenerateInput = z.object({
    prompt: z.string().min(1),
    model: z.enum([
        "doubao-seedance-2-0-260128",
        "doubao-seedance-2-0-fast-260128",
        "doubao-seedance-2-0-mini-260615",
    ]).default("doubao-seedance-2-0-260128"),
    resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
    ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"])
        .default("adaptive"),
    duration: z.number().int().positive().optional(),
    generate_audio: z.boolean().default(true),
});

const IdInput = z.object({ id: z.string().min(1) });
const ListInput = z.object({
    limit: z.number().int().min(1).max(100).default(20),
});

const TOOLS: Tool[] = [
    {
        name: "generate_video",
        description:
            "Generate a video with Seedance from a text prompt. Returns the " +
            "generation id and task id; the video is polled and downloaded " +
            "automatically — use get_generation to check status and get the " +
            "file path.",
        inputSchema: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Text prompt." },
                model: {
                    type: "string",
                    enum: [
                        "doubao-seedance-2-0-260128",
                        "doubao-seedance-2-0-fast-260128",
                        "doubao-seedance-2-0-mini-260615",
                    ],
                    description: "Seedance model id. Defaults to 2.0.",
                },
                resolution: {
                    type: "string",
                    enum: ["480p", "720p", "1080p"],
                    description: "Output resolution. Defaults to 720p.",
                },
                ratio: {
                    type: "string",
                    enum: [
                        "16:9",
                        "9:16",
                        "1:1",
                        "4:3",
                        "3:4",
                        "21:9",
                        "adaptive",
                    ],
                    description: "Aspect ratio. Defaults to adaptive.",
                },
                duration: {
                    type: "integer",
                    description:
                        "Duration in whole seconds. Omit to let the model decide.",
                },
                generate_audio: {
                    type: "boolean",
                    description:
                        "Generate a synced audio track. Defaults to true.",
                },
            },
            required: ["prompt"],
        },
        handler: async (raw) => {
            requireDb();
            const a = GenerateInput.parse(raw);
            const caller = appRouter.createCaller({});
            const gen = await caller.generate({
                model: a.model,
                prompt: a.prompt,
                attachments: [],
                ratio: a.ratio,
                resolution: a.resolution,
                durationMode: a.duration != null ? "seconds" : "smart",
                duration: a.duration ?? 0,
                audio: a.generate_audio,
            });
            return JSON.stringify(
                {
                    id: gen.id,
                    task_id: gen.task_id ?? null,
                    status: gen.status,
                    failed_reason: gen.failed_reason ?? null,
                },
                null,
                2,
            );
        },
    },
    {
        name: "list_generations",
        description:
            "List recent generations in the open project (newest first), with " +
            "their status and prompt.",
        inputSchema: {
            type: "object",
            properties: {
                limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    description: "Max rows to return. Defaults to 20.",
                },
            },
        },
        handler: (raw) => {
            const d = requireDb();
            const { limit } = ListInput.parse(raw);
            const rows = listGenerations(d).slice(0, limit);
            const generations = rows.map((r) => ({
                id: r.id,
                task_id: r.task_id ?? null,
                status: r.status,
                created_at: r.created_at,
                prompt: promptOf(r.request_json),
            }));
            return Promise.resolve(
                JSON.stringify(
                    { count: generations.length, generations },
                    null,
                    2,
                ),
            );
        },
    },
    {
        name: "get_generation",
        description:
            "Get the full status of one generation by its id or task id: live " +
            "status, downloaded video file path, token usage and rough cost.",
        inputSchema: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description:
                        "The generation id (ULID) or Seedance task id.",
                },
            },
            required: ["id"],
        },
        handler: async (raw) => {
            const d = requireDb();
            const { id } = IdInput.parse(raw);
            const row = getGenerationDetail(d, id);
            if (row instanceof Error) throw row;
            if (!row) throw new Error(`No generation found for "${id}".`);

            // Poll Seedance live when still in flight so the status is fresh.
            let task = row.task_json ?? null;
            let status: string = row.status;
            if ((status === "queued" || status === "running") && row.task_id) {
                const live = await seedance_client.getTask(row.task_id);
                if (!(live instanceof Error)) {
                    task = live;
                    status = live.status ?? status;
                }
            }

            // Local file path, if the result has been downloaded to the project.
            const projectRoot = await getStoredProjectPath();
            let videoPath: string | null = null;
            if (row.task_id && projectRoot) {
                const p = join(projectRoot, VIDEOS_DIR, `${row.task_id}.mp4`);
                try {
                    await Deno.stat(p);
                    videoPath = p;
                } catch {
                    // Not downloaded yet.
                }
            }

            const totalTokens = task?.usage?.total_tokens ?? null;
            const cost = totalTokens != null
                ? estimateCost(totalTokens, row.request_json)
                : null;
            const elapsed = task?.created_at != null && task.updated_at != null
                ? task.updated_at - task.created_at
                : null;

            return JSON.stringify(
                {
                    id: row.id,
                    task_id: row.task_id ?? null,
                    status,
                    prompt: promptOf(row.request_json),
                    failed_reason: row.failed_reason ?? null,
                    video_path: videoPath,
                    remote_video_url: task?.content?.video_url ?? null,
                    elapsed_seconds: elapsed,
                    total_tokens: totalTokens,
                    estimated_cost: cost
                        ? { rmb: round2(cost.rmb), usd: round2(cost.usd) }
                        : null,
                },
                null,
                2,
            );
        },
    },
    {
        name: "cancel_generation",
        description:
            "Cancel a queued or running generation by its id or task id.",
        inputSchema: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description:
                        "The generation id (ULID) or Seedance task id.",
                },
            },
            required: ["id"],
        },
        handler: async (raw) => {
            const d = requireDb();
            const { id } = IdInput.parse(raw);
            const row = getGenerationDetail(d, id);
            if (row instanceof Error) throw row;
            if (!row) throw new Error(`No generation found for "${id}".`);
            if (!row.task_id) {
                throw new Error(
                    "This generation was never submitted (no task id); nothing to cancel.",
                );
            }
            const res = await seedance_client.cancelTask(row.task_id);
            if (res instanceof Error) throw res;
            // Mark terminal so the poller stops and the GUI shows the reason.
            const upErr = updateGeneration(d, {
                id: row.id,
                status: "failed",
                failed_reason: "已取消 (cancelled via MCP)",
            });
            if (upErr instanceof Error) throw upErr;
            return JSON.stringify(
                {
                    id: row.id,
                    task_id: row.task_id,
                    status: res.status,
                    message: "Cancelled.",
                },
                null,
                2,
            );
        },
    },
];

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

type JsonRpcId = string | number | null;

interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: JsonRpcId;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

const rpcResult = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id,
    result,
});

const rpcError = (
    id: JsonRpcId,
    code: number,
    message: string,
): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

/**
 * Handle one parsed JSON-RPC payload (object or batch array). Returns the
 * response payload, or null when the input was notification-only (the caller
 * should then reply 202 with no body).
 */
export async function handleMcpPayload(
    payload: unknown,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(payload)) {
        const out: JsonRpcResponse[] = [];
        for (const msg of payload) {
            const r = await handleSingle(msg);
            if (r) out.push(r);
        }
        return out.length ? out : null;
    }
    return handleSingle(payload);
}

// deno-lint-ignore no-explicit-any
async function handleSingle(msg: any): Promise<JsonRpcResponse | null> {
    const isNotification = msg == null || msg.id === undefined;
    const id: JsonRpcId = isNotification ? null : msg.id;

    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
        return isNotification ? null : rpcError(id, -32600, "Invalid Request");
    }

    switch (msg.method) {
        case "initialize":
            return rpcResult(id, {
                protocolVersion: typeof msg.params?.protocolVersion === "string"
                    ? msg.params.protocolVersion
                    : PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false } },
                serverInfo: SERVER_INFO,
            });

        // Acknowledgement-only notifications — no response.
        case "notifications/initialized":
        case "notifications/cancelled":
            return null;

        case "ping":
            return rpcResult(id, {});

        case "tools/list":
            return rpcResult(id, {
                tools: TOOLS.map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema,
                })),
            });

        case "tools/call": {
            const name = msg.params?.name;
            const tool = TOOLS.find((t) => t.name === name);
            if (!tool) {
                return rpcError(id, -32602, `Unknown tool: ${name}`);
            }
            try {
                const text = await tool.handler(msg.params?.arguments ?? {});
                return rpcResult(id, {
                    content: [{ type: "text", text }],
                    isError: false,
                });
            } catch (err) {
                // Tool failures are reported as a tool result (isError), not a
                // protocol-level error, so the model can read the message.
                const message = err instanceof Error
                    ? err.message
                    : String(err);
                return rpcResult(id, {
                    content: [{ type: "text", text: `Error: ${message}` }],
                    isError: true,
                });
            }
        }

        default:
            return isNotification
                ? null
                : rpcError(id, -32601, `Method not found: ${msg.method}`);
    }
}
