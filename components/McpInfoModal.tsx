import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { get_text, language, trpc } from "../trpc/client.ts";

/** The MCP server info returned by the `getMcpServerInfo` tRPC query. */
type McpServerInfo = Awaited<
    ReturnType<typeof trpc.open.getMcpServerInfo.query>
>;

export function McpInfoModal(props: { onClose: () => void }) {
    const { onClose } = props;

    const info = useSignal<McpServerInfo | null>(null);
    const loading = useSignal(true);
    const error = useSignal<string | null>(null);
    // null until checked; a non-null string is the open project's root path.
    const projectDir = useSignal<string | null>(null);

    // Close on Escape, like a native dialog.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        globalThis.addEventListener("keydown", onKeyDown);
        return () => globalThis.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    useEffect(() => {
        (async () => {
            try {
                const [serverInfo, dir] = await Promise.all([
                    trpc.open.getMcpServerInfo.query(),
                    trpc.open.getProjectDir.query(),
                ]);
                info.value = serverInfo;
                projectDir.value = dir;
            } catch (err) {
                console.error(err);
                error.value = err instanceof Error ? err.message : String(err);
            } finally {
                loading.value = false;
            }
        })();
    }, []);

    const endpointUrl = `${globalThis.location.origin}${
        info.value?.endpointPath ?? "/mcp"
    }`;
    const claudeCodeCmd =
        `claude mcp add --transport http open-director ${endpointUrl}`;
    const codexConfig = `[mcp_servers.open-director]\nurl = "${endpointUrl}"`;

    return (
        <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div class="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white text-gray-800 shadow-2xl">
                <button
                    type="button"
                    aria-label={get_text("close", language.value)}
                    onClick={onClose}
                    class="absolute top-3 right-3 size-8 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center hover:cursor-pointer transition-colors"
                >
                    <CloseIcon class="size-4" />
                </button>

                <div class="p-6 space-y-5">
                    <div>
                        <h2 class="text-lg font-semibold flex items-center gap-2">
                            <McpIcon class="size-5 text-indigo-500" />
                            {get_text("mcp_server", language.value)}
                        </h2>
                        <p class="text-sm text-gray-500 mt-0.5">
                            {get_text("mcp_server_subtitle", language.value)}
                        </p>
                    </div>

                    {loading.value
                        ? (
                            <div class="flex items-center gap-2 text-sm text-gray-400">
                                <span class="size-4 rounded-full border-2 border-gray-300 border-t-indigo-500 animate-spin" />
                                {get_text("loading_details", language.value)}
                            </div>
                        )
                        : error.value
                        ? (
                            <div class="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600 [overflow-wrap:anywhere]">
                                {error.value}
                            </div>
                        )
                        : info.value && (
                            <>
                                {!projectDir.value && (
                                    <div class="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700 [overflow-wrap:anywhere]">
                                        {get_text(
                                            "no_project_open_mcp_warning",
                                            language.value,
                                        )}
                                    </div>
                                )}

                                {/* Connection */}
                                <Section
                                    title={get_text(
                                        "connection",
                                        language.value,
                                    )}
                                >
                                    <CopyField
                                        label={get_text(
                                            "endpoint_url",
                                            language.value,
                                        )}
                                        value={endpointUrl}
                                    />
                                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <Stat
                                            label={get_text(
                                                "protocol",
                                                language.value,
                                            )}
                                            value="JSON-RPC 2.0"
                                        />
                                        <Stat
                                            label={get_text(
                                                "protocol_version",
                                                language.value,
                                            )}
                                            value={info.value.protocolVersion}
                                        />
                                        <Stat
                                            label={get_text(
                                                "transport",
                                                language.value,
                                            )}
                                            value="Streamable HTTP"
                                            hint="stateless · no SSE"
                                        />
                                        <Stat
                                            label={get_text(
                                                "server_name",
                                                language.value,
                                            )}
                                            value={info.value.name}
                                            hint={`v${info.value.version}`}
                                        />
                                    </div>
                                </Section>

                                {/* Quick setup */}
                                <Section
                                    title={get_text(
                                        "quick_setup",
                                        language.value,
                                    )}
                                >
                                    <CopyField
                                        label="Claude Code"
                                        value={claudeCodeCmd}
                                        mono
                                    />
                                    <CopyField
                                        label="Codex"
                                        value={codexConfig}
                                        mono
                                        multiline
                                    />
                                </Section>

                                {/* Tools */}
                                <Section
                                    title={`${
                                        get_text(
                                            "available_tools",
                                            language.value,
                                        )
                                    } (${info.value.tools.length})`}
                                >
                                    <div class="space-y-3">
                                        {info.value.tools.map((tool) => (
                                            <ToolCard
                                                key={tool.name}
                                                tool={tool}
                                            />
                                        ))}
                                    </div>
                                </Section>
                            </>
                        )}
                </div>
            </div>
        </div>
    );
}

function Section(props: { title: string; children: ComponentChildren }) {
    return (
        <div>
            <div class="text-xs font-medium text-gray-400 mb-1.5">
                {props.title}
            </div>
            <div class="space-y-2">{props.children}</div>
        </div>
    );
}

function Stat(props: { label: string; value: string; hint?: string }) {
    return (
        <div class="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
            <div class="text-[11px] text-gray-400">{props.label}</div>
            <div class="text-sm font-medium [overflow-wrap:anywhere]">
                {props.value}
            </div>
            {props.hint && (
                <div class="text-[11px] text-gray-400 mt-0.5">
                    {props.hint}
                </div>
            )}
        </div>
    );
}

/** A read-only value with a copy-to-clipboard button. */
function CopyField(
    props: {
        label: string;
        value: string;
        mono?: boolean;
        multiline?: boolean;
    },
) {
    const copied = useSignal(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(props.value);
            copied.value = true;
            setTimeout(() => copied.value = false, 1500);
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div class="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
            <div class="flex items-center justify-between gap-2">
                <span class="text-[11px] text-gray-400">{props.label}</span>
                <button
                    type="button"
                    onClick={copy}
                    class="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 hover:cursor-pointer transition-colors"
                >
                    <CopyIcon class="size-3" />
                    {copied.value
                        ? get_text("copied", language.value)
                        : get_text("copy", language.value)}
                </button>
            </div>
            <div
                class={`text-sm [overflow-wrap:anywhere] ${
                    props.mono ? "font-mono" : ""
                } ${props.multiline ? "whitespace-pre-wrap" : ""}`}
            >
                {props.value}
            </div>
        </div>
    );
}

/** One MCP tool: name, description, and its full JSON input schema. */
function ToolCard(
    props: {
        tool: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        };
    },
) {
    const { tool } = props;
    const schema = tool.inputSchema as {
        properties?: Record<string, { description?: string; type?: string }>;
        required?: string[];
    };
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const paramNames = Object.keys(properties);

    return (
        <div class="rounded-lg border border-gray-200 p-3">
            <div class="font-mono text-sm font-semibold text-indigo-600">
                {tool.name}
            </div>
            <p class="text-sm text-gray-600 mt-1">{tool.description}</p>

            {paramNames.length > 0 && (
                <div class="mt-2.5">
                    <div class="text-[11px] font-medium text-gray-400 mb-1">
                        {get_text("parameters", language.value)}
                    </div>
                    <div class="space-y-1">
                        {paramNames.map((name) => {
                            const p = properties[name];
                            return (
                                <div
                                    key={name}
                                    class="flex items-baseline gap-1.5 text-[12.5px]"
                                >
                                    <span class="font-mono text-gray-800">
                                        {name}
                                    </span>
                                    <span class="text-gray-400">
                                        {p?.type ?? "any"}
                                    </span>
                                    {required.has(name) && (
                                        <span class="text-[10px] font-medium text-amber-600 bg-amber-50 rounded px-1">
                                            {get_text(
                                                "required",
                                                language.value,
                                            )}
                                        </span>
                                    )}
                                    {p?.description && (
                                        <span class="text-gray-500">
                                            — {p.description}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <details class="mt-2.5 group">
                <summary class="text-[11px] text-gray-400 hover:text-gray-600 cursor-pointer select-none">
                    JSON schema
                </summary>
                <pre class="mt-1.5 rounded-md bg-gray-900 text-gray-100 text-[11px] p-2.5 overflow-x-auto [overflow-wrap:anywhere]">
{JSON.stringify(tool.inputSchema, null, 2)}
                </pre>
            </details>
        </div>
    );
}

function McpIcon(props: { class?: string }) {
    return (
        <svg
            class={props.class ?? "size-4"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <rect x="4" y="4" width="7" height="7" rx="1.5" />
            <rect x="13" y="13" width="7" height="7" rx="1.5" />
            <path d="M7.5 11v3a2 2 0 0 0 2 2H13" />
            <path d="M16.5 13v-3a2 2 0 0 0-2-2H11" />
        </svg>
    );
}

function CopyIcon(props: { class?: string }) {
    return (
        <svg
            class={props.class ?? "size-4"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}

function CloseIcon(props: { class?: string }) {
    return (
        <svg
            class={props.class ?? "size-4"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    );
}
