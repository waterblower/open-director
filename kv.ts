/**
 * Deno KV — machine-level persistent config (not project-scoped).
 *
 * Used to remember the last-chosen project folder so a refresh/relaunch reopens
 * the same project. https://docs.deno.com/deploy/reference/deno_kv/
 */
const kv = await Deno.openKv();

const PROJECT_PATH_KEY = ["config", "project_path"] as const;
const SEEDANCE_API_KEY = ["config", "seedance_api_key"] as const;

/** The previously-chosen project folder, or null if one was never picked. */
export async function getStoredProjectPath(): Promise<string | null> {
    const res = await kv.get<string>(PROJECT_PATH_KEY);
    return res.value;
}

/** Persist the chosen project folder so the next launch reopens it. */
export async function setStoredProjectPath(path: string): Promise<void> {
    await kv.set(PROJECT_PATH_KEY, path);
}

/** The configured Seedance API key, or null if one was never set. */
export async function getStoredApiKey(): Promise<string | null> {
    const res = await kv.get<string>(SEEDANCE_API_KEY);
    return res.value;
}

/** Persist the Seedance API key (machine-level, shared across projects). */
export async function setStoredApiKey(key: string): Promise<void> {
    await kv.set(SEEDANCE_API_KEY, key);
}

/** A single KV entry, flattened for display. */
export interface KvEntry {
    key: Deno.KvKey;
    value: unknown;
    versionstamp: string;
}

/** Every entry currently stored in Deno KV, in key order. */
export async function listAllEntries(): Promise<KvEntry[]> {
    const entries: KvEntry[] = [];
    for await (const entry of kv.list({ prefix: [] })) {
        entries.push({
            key: entry.key,
            value: entry.value,
            versionstamp: entry.versionstamp,
        });
    }
    return entries;
}

/** Delete an entry by its exact KV key. */
export async function deleteEntry(key: Deno.KvKey): Promise<void> {
    await kv.delete(key);
}
