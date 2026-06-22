/**
 * MCP server exposed over HTTP from the same Fresh backend process.
 *
 * The tool catalog is derived from `appRouter`, so every tRPC procedure is
 * automatically available to MCP clients without maintaining a second API
 * registry. The HTTP plumbing lives in `routes/mcp.ts`; this module is
 * transport-agnostic and handles parsed JSON-RPC payloads.
 */
import { z } from "zod";
import { appRouter } from "../trpc/router.ts";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "open-director", version: "0.1.0" } as const;

/** The protocol version this server advertises in `initialize`. */
export const MCP_PROTOCOL_VERSION = PROTOCOL_VERSION;
/** The `serverInfo` this server advertises in `initialize`. */
export const MCP_SERVER_INFO = SERVER_INFO;

type ProcedureType = "query" | "mutation" | "subscription";
type JsonSchema = Record<string, unknown>;

interface RuntimeProcedure {
    _def: {
        type: ProcedureType;
        inputs: readonly unknown[];
        meta?: unknown;
    };
}

interface Tool {
    name: string;
    description: string;
    /** JSON Schema advertised via tools/list. */
    inputSchema: JsonSchema;
    /** Converts the MCP argument object to the tRPC procedure's input. */
    inputOf: (args: unknown) => unknown;
    type: ProcedureType;
}

function withoutDialect(schema: JsonSchema): JsonSchema {
    const { $schema: _dialect, ...rest } = schema;
    return rest;
}

function zodInputSchema(input: unknown): JsonSchema | null {
    try {
        return withoutDialect(
            z.toJSONSchema(input as z.ZodType, { io: "input" }) as JsonSchema,
        );
    } catch {
        // tRPC accepts parsers other than Zod. Such a parser can still be
        // called through MCP, but there is no generic way to infer its JSON
        // Schema, so advertise an open argument object.
        return null;
    }
}

function inputContract(inputs: readonly unknown[]): Pick<
    Tool,
    "inputSchema" | "inputOf"
> {
    if (inputs.length === 0) {
        return {
            inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
            },
            inputOf: () => undefined,
        };
    }

    const schemas = inputs.map(zodInputSchema);
    if (schemas.some((schema) => schema == null)) {
        return {
            inputSchema: { type: "object", additionalProperties: true },
            inputOf: (args) => args,
        };
    }

    const knownSchemas = schemas as JsonSchema[];
    const allObjects = knownSchemas.every((schema) => schema.type === "object");

    if (allObjects) {
        return {
            inputSchema: knownSchemas.length === 1
                ? knownSchemas[0]
                : { type: "object", allOf: knownSchemas },
            inputOf: (args) => args,
        };
    }

    // MCP tool arguments must be an object, while tRPC procedures may accept
    // scalar inputs. Wrap those values under `input` at the protocol boundary.
    const valueSchema = knownSchemas.length === 1
        ? knownSchemas[0]
        : { allOf: knownSchemas };
    return {
        inputSchema: {
            type: "object",
            properties: { input: valueSchema },
            required: ["input"],
            additionalProperties: false,
        },
        inputOf: (args) =>
            args && typeof args === "object" && "input" in args
                ? (args as { input: unknown }).input
                : undefined,
    };
}

function procedureDescription(
    path: string,
    type: ProcedureType,
    meta: unknown,
): string {
    if (
        meta && typeof meta === "object" && "description" in meta &&
        typeof (meta as { description?: unknown }).description === "string"
    ) {
        return (meta as { description: string }).description;
    }

    const readableName = path
        .replaceAll(".", " ")
        .replaceAll("_", " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase();

    if (type === "subscription") {
        return `Wait for and return the next ${readableName} event from the tRPC subscription.`;
    }
    if (type === "mutation") {
        return `Run the ${readableName} tRPC mutation. This operation may change backend state.`;
    }
    return `Run the ${readableName} tRPC query.`;
}

function buildTools(): Tool[] {
    const procedures = appRouter._def.procedures as Record<
        string,
        RuntimeProcedure
    >;
    return Object.entries(procedures).map(([path, procedure]) => ({
        name: path,
        description: procedureDescription(
            path,
            procedure._def.type,
            procedure._def.meta,
        ),
        ...inputContract(procedure._def.inputs),
        type: procedure._def.type,
    }));
}

const TOOLS = buildTools();
const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** Tool metadata exactly as advertised over `tools/list`. */
export function listMcpTools() {
    return TOOLS.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
    }));
}

async function callTrpcProcedure(tool: Tool, args: unknown): Promise<unknown> {
    const caller = appRouter.createCaller({});
    let target: unknown = caller;
    for (const segment of tool.name.split(".")) {
        target = (target as Record<string, unknown>)[segment];
    }
    if (typeof target !== "function") {
        throw new Error(`Unable to resolve tRPC procedure: ${tool.name}`);
    }

    const result = await (target as (input?: unknown) => Promise<unknown>)(
        tool.inputOf(args),
    );

    if (tool.type !== "subscription") return result;
    if (!isAsyncIterable(result)) {
        throw new Error(
            `tRPC subscription "${tool.name}" did not return an async iterable.`,
        );
    }

    // MCP tools are request/response, so one call consumes one subscription
    // item. Agents can call the tool again to wait for the following event.
    const iterator = result[Symbol.asyncIterator]();
    try {
        const next = await iterator.next();
        return next.done ? null : next.value;
    } finally {
        await iterator.return?.();
    }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return value != null &&
        typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
            "function";
}

function resultText(result: unknown): string {
    const json = JSON.stringify(result, null, 2);
    return json ?? "null";
}

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
            const response = await handleSingle(msg);
            if (response) out.push(response);
        }
        return out.length ? out : null;
    }
    return handleSingle(payload);
}

async function handleSingle(msg: unknown): Promise<JsonRpcResponse | null> {
    if (!msg || typeof msg !== "object") {
        return rpcError(null, -32600, "Invalid Request");
    }

    const request = msg as {
        jsonrpc?: unknown;
        id?: unknown;
        method?: unknown;
        params?: {
            protocolVersion?: unknown;
            name?: unknown;
            arguments?: unknown;
        };
    };
    const isNotification = request.id === undefined;
    const id: JsonRpcId = typeof request.id === "string" ||
            typeof request.id === "number" || request.id === null
        ? request.id
        : null;

    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
        return isNotification ? null : rpcError(id, -32600, "Invalid Request");
    }

    switch (request.method) {
        case "initialize":
            return rpcResult(id, {
                protocolVersion:
                    typeof request.params?.protocolVersion === "string"
                        ? request.params.protocolVersion
                        : PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false } },
                serverInfo: SERVER_INFO,
            });

        case "notifications/initialized":
        case "notifications/cancelled":
            return null;

        case "ping":
            return rpcResult(id, {});

        case "tools/list":
            return rpcResult(id, { tools: listMcpTools() });

        case "tools/call": {
            const name = request.params?.name;
            const tool = typeof name === "string"
                ? TOOL_BY_NAME.get(name)
                : undefined;
            if (!tool) {
                return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
            }
            try {
                const result = await callTrpcProcedure(
                    tool,
                    request.params?.arguments ?? {},
                );
                return rpcResult(id, {
                    content: [{ type: "text", text: resultText(result) }],
                    isError: false,
                });
            } catch (err) {
                // Tool failures are a tool result (not a protocol-level
                // error), so the model can read and react to the message.
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
                : rpcError(id, -32601, `Method not found: ${request.method}`);
    }
}
