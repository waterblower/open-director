/**
 * tRPC initialization — https://trpc.io/docs/quickstart
 *
 * Keep this file separate from the router so procedures can import the
 * `router`/`publicProcedure` helpers without circular imports.
 */
import { initTRPC } from "@trpc/server";

const t = initTRPC.create();

// Base router and procedure helpers, re-exported for use in router.ts.
export const router = t.router;
export const publicProcedure = t.procedure;
