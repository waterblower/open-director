// deno-lint-ignore-file no-explicit-any
import { generate } from "@/apigen/mod.ts";
import { data_url } from "@/apigen/tests/.base.test.ts";
import { get } from "@/apigen/autodl.ts";
import { assertEquals } from "@std/assert/unstable-equals";

const key = Deno.env.get("AUTODL_API_KEY") || "";

Deno.test("generate: RequestParameterIsWrong", async () => {
    const result = await generate({
        model: "autodl/minimax_h3_image_audio_to_video_v2_15s",
        input: {
            resolution: "768p横",
            seed: 1,
            prompt: "",
            duration: 1,
            ref_image_0: await data_url("./data/face.jpeg"),
        },
    }, key) as Error;

    assertEquals(result.cause, {
        code: "RequestParameterIsWrong",
        data: null,
        msg: "缺少必填参数：prompt",
        request_id: (result.cause as any).request_id,
    });
});

Deno.test("get", async () => {
    const result = await get(
        "60d73760-8106-4ae8-9f81-542e708607fd",
        key,
    );
    console.log("------\n", result);
});
