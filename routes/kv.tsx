import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { type KvEntry, listAllEntries } from "../kv.ts";

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
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
