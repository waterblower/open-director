/**
 * tRPC browser client — https://trpc.io/docs/quickstart
 *
 * Import this in islands to call procedures with full type safety, e.g.
 *   import { trpc } from "../trpc/client.ts";
 *   const users = await trpc.userList.query();
 */
import {
    createTRPCClient,
    httpBatchLink,
    splitLink,
    unstable_httpSubscriptionLink,
} from "@trpc/client";
import type { AppRouter } from "./router.ts";

export const trpc = createTRPCClient<AppRouter>({
    links: [
        splitLink({
            condition: (op) => op.type === "subscription",
            true: unstable_httpSubscriptionLink({ url: "/trpc" }),
            false: httpBatchLink({ url: "/trpc" }),
        }),
    ],
});

export async function listProjectFiles(path: string) {
    /** OS junk files that should never be shown in the explorer. */
    const HIDDEN_NAMES = new Set([".DS_Store"]);
    try {
        const res = await trpc.listProjectFiles.query(path);
        return res.filter((e) => !HIDDEN_NAMES.has(e.name));
    } catch (err) {
        return err as Error;
    }
}
