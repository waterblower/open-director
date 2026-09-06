import { assert, assertEquals } from "@std/assert";
import {
    type Attachment,
    restoreSettings,
    settingsControls,
    transitionSettings,
} from "./composer_settings.ts";
import { buildGenerationRequest } from "./generation_request.ts";

const attachments: Attachment[] = [
    { id: 1, kind: "image", name: "image", url: "data:image/png;base64,AA==" },
    { id: 2, kind: "video", name: "video", url: "data:video/mp4;base64,AA==" },
];

Deno.test("model transitions remove incompatible settings and references", () => {
    const seedance = restoreSettings({
        resolution: "1080p",
        durationMode: "smart",
        ratio: "21:9",
    }, attachments);
    const fast = transitionSettings(seedance, {
        type: "model",
        value: "doubao-seedance-2-0-fast-260128",
    });
    assertEquals(fast.resolution, "720p");
    const autodl = transitionSettings(seedance, {
        type: "model",
        value: "autodl/minimax_h3_lightx2v_v5",
    });
    assertEquals(autodl.ratio, "16:9");
    assertEquals(autodl.attachments, [attachments[0]]);
    assert(!("audio" in autodl));
    assert(!("mode" in autodl));
    assert(!("duration" in autodl));
    assert(!("prompt" in autodl));
    assertEquals(seedance.attachments, attachments);
    const max = transitionSettings(seedance, {
        type: "model",
        value: "MiniMax-H3-Max",
    });
    assert("mode" in max && max.mode === "frames");
    assertEquals(max.attachments, [attachments[0]]);
    assertEquals(settingsControls(max).duration, 5);
});

Deno.test("restore handles old resolution objects and serialized union branches", () => {
    const old = restoreSettings({
        model: "autodl/minimax_h3_lightx2v_v5",
        resolution: { provider: "autodl", value: "768p" },
        duration: 99,
        mode: "frames",
        ratio: "adaptive",
    });
    assertEquals(old.resolution, "768p");
    assertEquals(settingsControls(old).duration, 10);
    assertEquals(restoreSettings(JSON.parse(JSON.stringify(old))), old);
    const smart = restoreSettings({ duration: { mode: "smart" } });
    assertEquals(settingsControls(smart).durationMode, "smart");
    assertEquals(
        restoreSettings({ duration: NaN }).model,
        "doubao-seedance-2-0-260128",
    );
});

Deno.test("all model transitions produce submit-ready controls with a reference", () => {
    for (
        const model of [
            "doubao-seedance-2-0-260128",
            "doubao-seedance-2-0-fast-260128",
            "doubao-seedance-2-0-mini-260615",
            "MiniMax-H3",
            "MiniMax-H3-Max",
            "fal/minimax/h3/reference-to-video",
            "autodl/minimax_h3_lightx2v_v5",
        ] as const
    ) {
        const settings = transitionSettings(
            restoreSettings(null, [attachments[0]]),
            { type: "model", value: model },
        );
        const request = buildGenerationRequest({
            ...settingsControls(settings),
            prompt: "A person waves",
            attachments: settings.attachments.map((item) => ({
                kind: item.kind,
                dataUrlOrFilePath: item.url,
            })),
        });
        assert(!(request instanceof Error), `${model}: ${String(request)}`);
    }
});
