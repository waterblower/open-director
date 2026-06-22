import { appRouter } from "../trpc/router.ts";
import { handleMcpPayload, listMcpTools } from "./server.ts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

Deno.test("MCP catalog contains only open tRPC procedures", () => {
    const expected = Object.keys(appRouter._def.procedures).filter((path) =>
        path.startsWith("open.")
    );
    const actual = listMcpTools().map((tool) => tool.name);
    assert(
        JSON.stringify(actual) === JSON.stringify(expected),
        `Expected ${expected.length} tools, got ${actual.length}`,
    );
    assert(
        actual.every((path) => path.startsWith("open.")),
        "A procedure outside trpc.open leaked into MCP",
    );
});

Deno.test("MCP schemas preserve object inputs and wrap scalar inputs", () => {
    const tools = listMcpTools();
    const objectSchema = tools.find((tool) => tool.name === "open.generate")
        ?.inputSchema;
    const scalarSchema = tools.find((tool) =>
        tool.name === "open.getGenerationDetail"
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

Deno.test("MCP rejects tRPC procedures outside the open namespace", async () => {
    const response = await handleMcpPayload({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "setApiKey", arguments: { apiKey: "secret" } },
    });
    const error = (response as { error?: { code?: number; message?: string } })
        ?.error;
    assert(
        error?.code === -32602 && error.message?.includes("Unknown tool"),
        "Expected a private tRPC procedure to be rejected",
    );
});
