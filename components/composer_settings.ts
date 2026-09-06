import type {
    AspectRatio,
    SeedanceModel,
} from "../apigen/seedance/seedance.ts";

export type Attachment = {
    id: number;
    kind: "image" | "video" | "audio";
    name: string;
    url: string;
};
type ImageAttachment = Attachment & { kind: "image" };
type SeedanceSettings =
    & {
        attachments: Attachment[];
        mode: "reference" | "frames";
        ratio: AspectRatio;
        duration: { mode: "smart" } | { mode: "seconds"; seconds: number };
        audio: boolean;
    }
    & ({
        model: "doubao-seedance-2-0-260128";
        resolution: "480p" | "720p" | "1080p";
    } | {
        model:
            | "doubao-seedance-2-0-fast-260128"
            | "doubao-seedance-2-0-mini-260615";
        resolution: "480p" | "720p";
    });
type MiniMaxSettings =
    & { ratio: AspectRatio; durationSeconds: number }
    & (
        { model: "MiniMax-H3"; resolution: "768p" }
            & (
                { mode: "reference"; attachments: Attachment[] } | {
                    mode: "frames";
                    attachments: ImageAttachment[];
                }
            ) | {
            model: "MiniMax-H3-Max";
            resolution: "480p" | "768p";
            mode: "frames";
            attachments: ImageAttachment[];
        }
    );
export type ComposerSettings = SeedanceSettings | MiniMaxSettings | {
    model: "fal/minimax/h3/reference-to-video";
    attachments: ImageAttachment[];
    ratio: AspectRatio;
    resolution: "480p" | "768p";
    durationSeconds: number;
} | {
    model: "autodl/minimax_h3_lightx2v_v5";
    attachments: ImageAttachment[];
    ratio: "16:9" | "9:16" | "1:1";
    resolution: "480p" | "768p" | "1080p";
    durationSeconds: number;
};
export type SettingsAction =
    | { type: "model"; value: ComposerSettings["model"] }
    | { type: "attachments"; value: Attachment[] }
    | { type: "mode"; value: "reference" | "frames" }
    | { type: "ratio"; value: AspectRatio }
    | { type: "resolution"; value: ComposerSettings["resolution"] }
    | { type: "durationMode"; value: "smart" | "seconds" }
    | { type: "duration"; value: number }
    | { type: "audio"; value: boolean };

export function settingsControls(settings: ComposerSettings) {
    return {
        model: settings.model,
        attachments: settings.attachments,
        mode: "mode" in settings ? settings.mode : "reference" as const,
        ratio: settings.ratio,
        resolution: settings.resolution,
        durationMode: "duration" in settings
            ? settings.duration.mode
            : "seconds" as const,
        duration: "duration" in settings
            ? settings.duration.mode === "seconds"
                ? settings.duration.seconds
                : 4
            : settings.durationSeconds,
        audio: "audio" in settings ? settings.audio : false,
    };
}

/** Decode persisted controls or construct a complete, valid model transition. */
export function restoreSettings(
    value: unknown,
    attachments: Attachment[] = [],
): ComposerSettings {
    const saved = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {};
    const model = saved.model;
    const rawResolution =
        saved.resolution && typeof saved.resolution === "object"
            ? (saved.resolution as { value?: unknown }).value
            : saved.resolution;
    const resolution = typeof rawResolution === "string"
        ? rawResolution.toLowerCase()
        : "480p";
    const ratio =
        ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"].includes(
                String(saved.ratio),
            )
            ? saved.ratio as AspectRatio
            : "21:9";
    const rawDuration =
        typeof saved.duration === "object" && saved.duration !== null
            ? saved.duration as { mode?: unknown; seconds?: unknown }
            : null;
    const seconds = saved.durationSeconds ?? rawDuration?.seconds ??
        saved.duration;
    const duration = typeof seconds === "number" && Number.isFinite(seconds)
        ? Math.round(seconds)
        : 4;
    const smart = rawDuration?.mode === "smart" ||
        saved.durationMode === "smart";
    const mode: "frames" | "reference" = saved.mode === "frames"
        ? "frames"
        : "reference";
    const images = attachments.filter((item): item is ImageAttachment =>
        item.kind === "image"
    );
    if (model === "autodl/minimax_h3_lightx2v_v5") {
        return {
            model,
            attachments: images.slice(0, 9),
            ratio: ratio === "9:16" || ratio === "1:1" ? ratio : "16:9",
            resolution: resolution === "480p" || resolution === "1080p"
                ? resolution
                : "768p",
            durationSeconds: Math.max(1, Math.min(10, duration)),
        };
    }
    if (model === "fal/minimax/h3/reference-to-video") {
        return {
            model,
            attachments: images,
            ratio,
            resolution: resolution === "480p" ? "480p" : "768p",
            durationSeconds: Math.max(1, Math.min(15, duration)),
        };
    }
    if (model === "MiniMax-H3" || model === "MiniMax-H3-Max") {
        const common = {
            ratio: attachments.length === 0 && ratio === "adaptive"
                ? "16:9" as const
                : ratio,
            resolution: resolution === "480p"
                ? "480p" as const
                : "768p" as const,
            durationSeconds: Math.max(
                model === "MiniMax-H3-Max" ? 5 : 4,
                Math.min(15, duration),
            ),
        };
        if (model === "MiniMax-H3-Max") {
            return {
                ...common,
                model,
                mode: "frames",
                attachments: images.slice(0, 2),
            };
        }
        if (mode === "frames") {
            return {
                ...common,
                model,
                resolution: "768p",
                mode,
                attachments: images.slice(0, 2),
            };
        }
        return {
            ...common,
            model,
            resolution: "768p",
            mode: "reference",
            attachments,
        };
    }
    const common = {
        attachments,
        mode,
        ratio,
        audio: typeof saved.audio === "boolean" ? saved.audio : true,
        duration: smart ? { mode: "smart" as const } : {
            mode: "seconds" as const,
            seconds: Math.max(4, Math.min(15, duration)),
        },
    };
    if (
        model === "doubao-seedance-2-0-fast-260128" ||
        model === "doubao-seedance-2-0-mini-260615"
    ) {
        return {
            ...common,
            model,
            resolution: resolution === "480p" ? "480p" : "720p",
        };
    }
    return {
        ...common,
        model: "doubao-seedance-2-0-260128",
        resolution: resolution === "1080p" || resolution === "720p"
            ? resolution
            : "480p",
    };
}

export function transitionSettings(
    settings: ComposerSettings,
    action: SettingsAction,
): ComposerSettings {
    const controls = settingsControls(settings);
    switch (action.type) {
        case "model":
            return restoreSettings(
                { ...controls, model: action.value },
                settings.attachments,
            );
        case "attachments":
            return restoreSettings(controls, action.value);
        case "mode":
            return restoreSettings(
                { ...controls, mode: action.value },
                settings.attachments,
            );
        case "ratio":
            return restoreSettings(
                { ...controls, ratio: action.value },
                settings.attachments,
            );
        case "resolution":
            return restoreSettings(
                { ...controls, resolution: action.value },
                settings.attachments,
            );
        case "durationMode":
            return restoreSettings(
                { ...controls, durationMode: action.value },
                settings.attachments,
            );
        case "duration":
            return restoreSettings(
                { ...controls, duration: action.value },
                settings.attachments,
            );
        case "audio":
            return restoreSettings(
                { ...controls, audio: action.value },
                settings.attachments,
            );
    }
}
