/**
 * Deno KV — machine-level persistent config (not project-scoped).
 *
 * Project records are ordered by their last-opened timestamp so a
 * refresh/relaunch reopens the most recently used project.
 * https://docs.deno.com/deploy/reference/deno_kv/
 *
 * Stored under `~/.open-director/kv.sqlite3` (`%USERPROFILE%` on Windows) so it
 * survives independent of any single project folder.
 */
import { homedir } from "node:os";
import { join } from "@std/path";
const KV_DIR = join(homedir(), ".open-director");
Deno.mkdirSync(KV_DIR, { recursive: true });
export const kv = await Deno.openKv(join(KV_DIR, "kv.sqlite3"));

export type ApiProvider = "seedance" | "zzdh" | "minimax";

const API_KEY_BY_PROVIDER = {
    seedance: ["config", "seedance_api_key"],
    zzdh: ["config", "zzdh_api_key"],
    minimax: ["config", "minimax_api_key"],
} as const satisfies Record<ApiProvider, Deno.KvKey>;
const SHOW_OPEN_DIRECTORY_KEY = ["config", "show_open_directory"] as const;

/** The configured provider API key, or null if one was never set. */
export async function getStoredApiKey(
    provider: ApiProvider,
): Promise<string | null> {
    const res = await kv.get<string>(API_KEY_BY_PROVIDER[provider]);
    return res.value;
}

/** The configured provider API key, or null if one was never set. */
export async function getStoredApiKeyFromModel(
    model: string,
): Promise<string | null> {
    type ApiProvider = "seedance" | "zzdh" | "minimax";
    let provider: ApiProvider = "seedance";
    if (model.includes("zzdh")) {
        provider = "zzdh";
    } else if (model.includes("minimax")) {
        provider = "minimax";
    }
    return await getStoredApiKey(provider);
}

/** Persist a provider API key (machine-level, shared across projects). */
export async function setStoredApiKey(
    provider: ApiProvider,
    key: string,
): Promise<void> {
    await kv.set(API_KEY_BY_PROVIDER[provider], key);
}

/**
 * Whether the file explorer should show the project's `.open-director` folder
 * (Open Director's own data dir). Hidden by default.
 */
export async function getShowOpenDirectorDir(): Promise<boolean> {
    const res = await kv.get<boolean>(SHOW_OPEN_DIRECTORY_KEY);
    return res.value ?? false;
}

/** Persist whether to show the `.open-director` folder in the explorer. */
export async function setShowOpenDirectorDir(value: boolean): Promise<void> {
    await kv.set(SHOW_OPEN_DIRECTORY_KEY, value);
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
