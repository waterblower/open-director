import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { define } from "../../utils.ts";
import { appRouter } from "../../trpc/router.ts";

// Serve all tRPC procedures under /trpc/* via the Fetch adapter.
function handle(req: Request): Response | Promise<Response> {
    return fetchRequestHandler({
        endpoint: "/trpc",
        req,
        router: appRouter,
        createContext: () => ({}),
    });
}

export const handler = define.handlers({
    GET: (ctx) => handle(ctx.req),
    POST: (ctx) => handle(ctx.req),
});
