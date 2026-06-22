import { appRouter } from "../trpc/router.ts";
import { handleMcpPayload, listMcpTools } from "./server.ts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

Deno.test("MCP catalog contains every tRPC procedure", () => {
    const expected = Object.keys(appRouter._def.procedures);
    const actual = listMcpTools().map((tool) => tool.name);
    assert(
        JSON.stringify(actual) === JSON.stringify(expected),
        `Expected ${expected.length} tools, got ${actual.length}`,
    );
});

Deno.test("MCP schemas preserve object inputs and wrap scalar inputs", () => {
    const tools = listMcpTools();
    const objectSchema = tools.find((tool) => tool.name === "generate")
        ?.inputSchema;
    const scalarSchema = tools.find((tool) =>
        tool.name === "getGenerationDetail"
    )?.inputSchema;

    assert(objectSchema?.type === "object", "generate must accept an object");
    assert(
        (objectSchema.properties as Record<string, unknown>)?.prompt != null,
        "generate.prompt is missing",
    );
    assert(
        (scalarSchema?.properties as Record<string, unknown>)?.input != null,
        "scalar tRPC input must be wrapped as input",
    );
});

Deno.test("MCP dispatch consumes one item from a tRPC subscription", async () => {
    const response = await handleMcpPayload({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "backend_events", arguments: {} },
    });
    const text = (response as {
        result?: { content?: Array<{ text?: string }> };
    })?.result?.content?.[0]?.text;
    const event = typeof text === "string" ? JSON.parse(text) : null;
    assert(
        event?.type === "tick",
        "Expected the next backend event",
    );
});
