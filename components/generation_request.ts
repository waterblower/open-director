import {
    type GenerateInput,
    GenerateInputSchema,
    isAutoDLModel,
    isFalModel,
    isMiniMaxModel,
} from "../apigen/mod.ts";

/** Translate composer controls to the provider's native request before RPC. */
export function buildGenerationRequest(options: {
    model: string;
    prompt: string;
    attachments: {
        kind: "image" | "video" | "audio";
        dataUrlOrFilePath: string;
    }[];
    ratio: string;
    resolution: string;
    durationMode: "seconds" | "smart";
    duration: number;
    audio: boolean;
    mode: "reference" | "frames";
}): GenerateInput | Error {
    const { model, attachments, ratio, resolution, duration } = options;
    const prompt = options.prompt.trim();
    let request: unknown;
    if (isAutoDLModel(model)) {
        if (
            !prompt || attachments.length < 1 || attachments.length > 9 ||
            attachments.some((item) => item.kind !== "image")
        ) {
            return new Error(
                "AutoDL requires a prompt and 1–9 reference images",
            );
        }
        if (!["16:9", "9:16", "1:1"].includes(ratio)) {
            return new Error("Unsupported AutoDL aspect ratio");
        }
        const suffix = ratio === "9:16"
            ? "竖"
            : ratio === "1:1"
            ? "(1:1)"
            : "横";
        request = {
            model,
            input: {
                prompt,
                duration,
                resolution: `${resolution}${suffix}`,
                ...Object.fromEntries(
                    attachments.map((
                        item,
                        index,
                    ) => [`ref_image_${index}`, item.dataUrlOrFilePath]),
                ),
            },
        };
    }
    else if (isFalModel(model)) {
        if (!prompt || attachments.some((item) => item.kind !== "image")) {
            return new Error("Fal requires a prompt and image references only");
        }
        request = {
            model,
            input: {
                prompt,
                duration,
                resolution: resolution.toUpperCase(),
                aspect_ratio: ratio,
                enable_safety_checker: false,
                prompt_expansion_mode: "fast",
                reference_image_urls: attachments.map((item) =>
                    item.dataUrlOrFilePath
                ),
            },
        };
    }
    else if (isMiniMaxModel(model)) {
        const frames = options.mode === "frames" || model === "MiniMax-H3-Max";
        if (
            !prompt ||
            (frames &&
                (attachments.length > 2 ||
                    attachments.some((item) => item.kind !== "image")))
        ) {
            return new Error(
                "MiniMax requires a prompt and at most two images in frame mode",
            );
        }
        request = {
            model,
            resolution: resolution.toUpperCase(),
            duration,
            ratio: frames && attachments.length ? "adaptive" : ratio,
            content: [
                { type: "text", text: prompt },
                ...attachments.map((item, index) => ({
                    type: `${item.kind}_url`,
                    [`${item.kind}_url`]: {
                        url: item.dataUrlOrFilePath.replace(
                            /^data:audio\/mpeg;base64,/,
                            "data:audio/mp3;base64,",
                        ).replace(
                            /^data:audio\/(?:x-wav|wave);base64,/,
                            "data:audio/wav;base64,",
                        ),
                    },
                    role: frames
                        ? index === 0 ? "first_frame" : "last_frame"
                        : `reference_${item.kind}`,
                })),
            ],
        };
    }
    else {
        request = {
            model,
            resolution,
            ratio,
            generate_audio: options.audio,
            ...(options.durationMode === "seconds" ? { duration } : {}),
            content: [
                ...(prompt ? [{ type: "text", text: prompt }] : []),
                ...attachments.map((item) => ({
                    type: `${item.kind}_url`,
                    [`${item.kind}_url`]: { url: item.dataUrlOrFilePath },
                    role: `reference_${item.kind}`,
                })),
            ],
        };
    }
    const parsed = GenerateInputSchema.safeParse(request);
    if (!parsed.success) {
        return parsed.error;
    }
    return parsed.data;
}
