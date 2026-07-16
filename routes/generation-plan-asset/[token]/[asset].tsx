import { getGenerationPlanAsset } from "../../../generation_plan.ts";
import { define } from "../../../utils.ts";

export const handler = define.handlers({
    async GET(ctx) {
        const asset = getGenerationPlanAsset(
            ctx.params.token,
            ctx.params.asset,
        );
        if (!asset) return new Response("Not found", { status: 404 });

        try {
            const stat = await Deno.stat(asset.path);
            const file = await Deno.open(asset.path, { read: true });
            return new Response(file.readable, {
                headers: {
                    "content-type": asset.contentType,
                    "content-length": String(stat.size),
                    "cache-control": "private, max-age=300",
                    "x-content-type-options": "nosniff",
                    "content-security-policy": "default-src 'none'; sandbox",
                },
            });
        } catch (err) {
            if (err instanceof Deno.errors.NotFound) {
                return new Response("Not found", { status: 404 });
            }
            throw err;
        }
    },
});
