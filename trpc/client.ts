/**
 * tRPC browser client — https://trpc.io/docs/quickstart
 *
 * Import this in islands to call procedures with full type safety, e.g.
 *   import { trpc } from "../trpc/client.ts";
 *   const users = await trpc.userList.query();
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "./router.ts";

export const trpc = createTRPCClient<AppRouter>({
    links: [
        httpBatchLink({ url: "/trpc" }),
    ],
});
