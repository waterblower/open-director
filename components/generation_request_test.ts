import { assert, assertEquals } from "@std/assert";
import { buildGenerationRequest } from "./generation_request.ts";
import { GenerateInputSchema } from "../apigen/mod.ts";

const controls = {
    prompt: "A person waves",
    attachments: [{
        kind: "image" as const,
        dataUrlOrFilePath: "data:image/png;base64,AA==",
    }],
    ratio: "16:9",
    resolution: "480p",
    duration: 5,
    durationMode: "seconds" as const,
    mode: "reference" as const,
    audio: true,
};

Deno.test("composer builds native requests for every provider", () => {
    for (
        const model of [
            "doubao-seedance-2-0-260128",
            "MiniMax-H3-Max",
            "fal/minimax/h3/reference-to-video",
            "autodl/minimax_h3_lightx2v_v5",
        ]
    ) {
        const request = buildGenerationRequest({ ...controls, model });
        assert(!(request instanceof Error), String(request));
        assert(GenerateInputSchema.safeParse(request).success);
        assert(!("attachments" in request));
    }
});

Deno.test("native conversion preserves model-specific settings", () => {
    const autodl = buildGenerationRequest({
        ...controls,
        model: "autodl/minimax_h3_lightx2v_v5",
        resolution: "768p",
        ratio: "9:16",
    });
    assert(
        !(autodl instanceof Error) &&
            autodl.model === "autodl/minimax_h3_lightx2v_v5",
    );
    assertEquals(autodl.input.resolution, "768p竖");
    const minimax = buildGenerationRequest({
        ...controls,
        model: "MiniMax-H3-Max",
        mode: "frames",
    });
    assert(!(minimax instanceof Error) && "content" in minimax);
    assertEquals(minimax.content[1].type, "image_url");
    assertEquals(
        "role" in minimax.content[1] && minimax.content[1].role,
        "first_frame",
    );
    const seedance = buildGenerationRequest({
        ...controls,
        model: "doubao-seedance-2-0-260128",
        durationMode: "smart",
    });
    assert(!(seedance instanceof Error));
    assert(!("duration" in seedance));
    assert(
        buildGenerationRequest({
            ...controls,
            model: "autodl/minimax_h3_lightx2v_v5",
            resolution: "720p",
        }) instanceof Error,
    );
    assert(
        !GenerateInputSchema.safeParse({
            ...controls,
            model: "autodl/minimax_h3_lightx2v_v5",
        }).success,
    );
});
