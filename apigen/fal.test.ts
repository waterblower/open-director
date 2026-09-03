import { generate } from "./mod.ts";

Deno.test("generate", async () => {
    await generate({ model: "fal/minimax/h3/reference-to-video" }, "");
});
