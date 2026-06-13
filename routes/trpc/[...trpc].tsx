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
        // Log every server-side procedure error centrally (the client only
        // sees a sanitized message, so without this they're invisible).
        onError: ({ error, type, path }) => {
            console.error(
                `[tRPC] ${type} ${path ?? "<no-path>"} failed:`,
                error,
            );
        },
    });
}

export const handler = define.handlers({
    GET: (ctx) => handle(ctx.req),
    POST: (ctx) => handle(ctx.req),
});
