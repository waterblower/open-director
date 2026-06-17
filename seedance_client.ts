import { SeedanceClient } from "./seedance/seedance.ts";
import { getStoredApiKey } from "./kv.ts";

// Shared, configured Seedance client used across islands/components. The API key
// is loaded from Deno KV (set via the in-app settings modal); `let` + live ESM
// bindings let `setSeedanceApiKey` swap in a new client that importers pick up.
export let seedance_client = new SeedanceClient({
    apiKey: (await getStoredApiKey()) ?? "",
});

/** Rebuild the shared client with a new API key (after the user saves one). */
export function setSeedanceApiKey(apiKey: string): void {
    seedance_client = new SeedanceClient({ apiKey });
}
