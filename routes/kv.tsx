import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { deleteEntry, type KvEntry, listAllEntries } from "../kv.ts";

type EncodedKeyPart =
    | { type: "string"; value: string }
    | { type: "number"; value: number }
    | { type: "boolean"; value: boolean }
    | { type: "bigint"; value: string }
    | { type: "bytes"; value: string };

function encodeBytes(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function decodeBytes(encoded: string): Uint8Array {
    return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}

function encodeKeyPart(part: Deno.KvKeyPart): EncodedKeyPart {
    if (part instanceof Uint8Array) {
        return { type: "bytes", value: encodeBytes(part) };
    }
    if (typeof part === "bigint") {
        return { type: "bigint", value: part.toString() };
    }
    if (typeof part === "string") {
        return { type: "string", value: part };
    }
    if (typeof part === "number") {
        return { type: "number", value: part };
    }
    if (typeof part === "boolean") {
        return { type: "boolean", value: part };
    }
    throw new TypeError("Unsupported Deno KV key part");
}

function decodeKeyPart(part: unknown): Deno.KvKeyPart | null {
    if (part === null || typeof part !== "object") return null;
    const encoded = part as Partial<EncodedKeyPart>;
    switch (encoded.type) {
        case "string":
            return typeof encoded.value === "string" ? encoded.value : null;
        case "number":
            return typeof encoded.value === "number" ? encoded.value : null;
        case "boolean":
            return typeof encoded.value === "boolean" ? encoded.value : null;
        case "bigint":
            return typeof encoded.value === "string"
                ? BigInt(encoded.value)
                : null;
        case "bytes":
            return typeof encoded.value === "string"
                ? decodeBytes(encoded.value)
                : null;
        default:
            return null;
    }
}

function encodeKey(key: Deno.KvKey): string {
    return JSON.stringify(key.map(encodeKeyPart));
}

function decodeKey(value: FormDataEntryValue | null): Deno.KvKey | null {
    if (typeof value !== "string") return null;
    try {
        const parts = JSON.parse(value) as unknown[];
        if (!Array.isArray(parts)) return null;
        const key: Deno.KvKeyPart[] = [];
        for (const part of parts) {
            const decoded = decodeKeyPart(part);
            if (decoded === null) return null;
            key.push(decoded);
        }
        return key;
    } catch {
        return null;
    }
}

/** Render a KV key array as a readable, JSON-ish path. */
function fmtKey(key: Deno.KvKey): string {
    return key
        .map((part) => typeof part === "string" ? part : JSON.stringify(part))
        .join(" / ");
}

/** Pretty-print any KV value for display. */
function fmtValue(value: unknown): string {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export const handler = define.handlers({
    async POST(ctx) {
        const form = await ctx.req.formData();
        const action = form.get("action");
        const key = decodeKey(form.get("key"));
        if (action !== "delete" || key === null) {
            return new Response("Bad request", { status: 400 });
        }

        await deleteEntry(key);

        return new Response(null, {
            status: 303,
            headers: { location: new URL(ctx.req.url).pathname },
        });
    },
});

export default define.page(async function KvDebug() {
    const entries = await listAllEntries();

    return (
        <>
            <Head>
                <title>Debug · Deno KV</title>
                <style>
                    {`
                    body { font: 13px/1.5 ui-monospace, monospace; margin: 24px; color: #1f2937; }
                    h1 { font-size: 18px; margin: 0 0 4px; }
                    .summary { margin: 12px 0 24px; }
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid #e5e7eb; padding: 4px 8px; text-align: left; vertical-align: top; }
                    th { background: #f9fafb; }
                    td.key { white-space: nowrap; font-weight: 600; }
                    td.value pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
                    td.stamp { white-space: nowrap; color: #9ca3af; }
                    td.actions { width: 1%; white-space: nowrap; }
                    .delete-form { margin: 0; }
                    .delete-button {
                        border: 1px solid #fecaca;
                        border-radius: 4px;
                        background: #fff;
                        color: #dc2626;
                        cursor: pointer;
                        font: inherit;
                        padding: 2px 8px;
                    }
                    .delete-button:hover { background: #fef2f2; border-color: #fca5a5; }
                    .muted { color: #9ca3af; }
                    `}
                </style>
            </Head>
            <h1>Deno KV</h1>
            <p class="summary">
                <b>entries:</b> {entries.length}
            </p>

            {entries.length === 0
                ? <p class="muted">No entries.</p>
                : <KvTable entries={entries} />}
        </>
    );
});

function KvTable({ entries }: { entries: KvEntry[] }) {
    return (
        <table>
            <thead>
                <tr>
                    <th>key</th>
                    <th>value</th>
                    <th>versionstamp</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                {entries.map((entry) => (
                    <tr key={entry.versionstamp + fmtKey(entry.key)}>
                        <td class="key">{fmtKey(entry.key)}</td>
                        <td class="value">
                            <pre>{fmtValue(entry.value)}</pre>
                        </td>
                        <td class="stamp">{entry.versionstamp}</td>
                        <td class="actions">
                            <form method="post" class="delete-form">
                                <input
                                    type="hidden"
                                    name="action"
                                    value="delete"
                                />
                                <input
                                    type="hidden"
                                    name="key"
                                    value={encodeKey(entry.key)}
                                />
                                <button type="submit" class="delete-button">
                                    Delete
                                </button>
                            </form>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
