import {
    type Signal,
    useComputed,
    useSignal,
    useSignalEffect,
} from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { CreateTaskRequest } from "../apigen/seedance/seedance.ts";
import type { CreateVideoTaskRequest } from "../apigen/minimax.ts";
import type { FalInput } from "../apigen/fal.ts";
import { PROJECT_FILE_MIME } from "@/constants.ts";
import type {
    AspectRatio,
    SeedanceModel,
} from "../apigen/seedance/seedance.ts";
import type { generate_Input as AutoDLGenerateInput } from "../apigen/autodl.ts";
import {
    type GenerateInput,
    isAutoDLInput,
    isAutoDLModel,
    isMiniMaxInput,
} from "../apigen/mod.ts";

import type { VideoModel as MiniMaxVideoModel } from "../apigen/minimax.ts";
import { trpc } from "../trpc/client.ts";
import { get_text, Language, language } from "@/i18n.ts";
import { sleep } from "@blowater/csp";
import { GeneratedVideo } from "@/components/GenerationCard.tsx";
import { updateGenerations } from "@/islands/Application.tsx";

export function Composer(props: {
    genError: Signal<string | null>;
    /** Composer reports its measured height here (used to pad the results grid). */
    composerInset: Signal<number>;
    /** A past generation's request to load in; consumed (cleared) when applied. */
    reusePrompt: Signal<GenerateInput | null>;
    generated_videos: Signal<Map<string, GeneratedVideo>>;
}) {
    const { genError, composerInset, reusePrompt } = props;

    const prompt = useSignal("");
    const model = useSignal<GenerationModel>("doubao-seedance-2-0-260128");
    const provider_input_seedance = useSignal<SeedanceInput>({
        content: [],
        ratio: "21:9",
        resolution: "480p",
        duration: 4,
        generate_audio: true,
    });
    const provider_input_minimax = useSignal<MiniMaxInput>({
        content: [],
        ratio: "16:9",
        resolution: "768P",
        duration: 5,
    });
    const provider_input_fal = useSignal<FalDraft>({
        reference_image_urls: [],
        aspect_ratio: "16:9",
        resolution: "768P",
        duration: 5,
        enable_safety_checker: false,
        prompt_expansion_mode: "fast",
    });
    const provider_input_autodl = useSignal<AutoDLDraft>({
        ref_image_0: "",
        resolution: "768p横",
        duration: 5,
    });
    // Frame/reference selection is editor state; native requests encode it in media roles.
    const minimaxMode = useSignal<"reference" | "frames">("reference");
    const mediaLabels = useRef(new Map<string, Attachment>());
    const attachments = useComputed(() => {
        let media: { kind: AttachmentKind; url: string }[];
        if (isSeedanceModel(model.value)) {
            media = contentMedia(provider_input_seedance.value.content);
        }
        else if (isMiniMaxModel(model.value)) {
            media = contentMedia(provider_input_minimax.value.content);
        }
        else if (isFalModel(model.value)) {
            media = provider_input_fal.value.reference_image_urls.map((
                url,
            ) => ({ kind: "image", url }));
        }
        else {
            media = autoDLMedia(provider_input_autodl.value);
        }
        return media.map((item, index) =>
            mediaLabels.current.get(item.url) ??
                {
                    ...item,
                    id: index,
                    name: kindLabel(item.kind, language.value),
                }
        );
    });
    const getMode = () =>
        isSeedanceModel(model.value)
            ? "reference"
            : isMiniMaxModel(model.value)
            ? model.value === "MiniMax-H3-Max" ? "frames" : minimaxMode.value
            : "reference";
    const getRatio = (): AspectRatio => {
        if (isSeedanceModel(model.value)) {
            return provider_input_seedance.value.ratio ?? "adaptive";
        }
        if (isMiniMaxModel(model.value)) {
            return provider_input_minimax.value.ratio ?? "adaptive";
        }
        if (isFalModel(model.value)) {
            return provider_input_fal.value.aspect_ratio;
        }
        return provider_input_autodl.value.resolution.endsWith("竖")
            ? "9:16"
            : provider_input_autodl.value.resolution.endsWith("(1:1)")
            ? "1:1"
            : "16:9";
    };
    const getResolution = (): Resolution => {
        if (isSeedanceModel(model.value)) {
            return {
                provider: "seedance",
                value: provider_input_seedance.value.resolution ?? "480p",
            };
        }
        if (isMiniMaxModel(model.value)) {
            return {
                provider: "minimax",
                value: provider_input_minimax.value.resolution === "480P"
                    ? "480p"
                    : "768p",
            };
        }
        if (isFalModel(model.value)) {
            return {
                provider: "fal",
                value: provider_input_fal.value.resolution === "480P"
                    ? "480p"
                    : "768p",
            };
        }
        const value = provider_input_autodl.value.resolution;
        return {
            provider: "autodl",
            value: value.startsWith("480")
                ? "480p"
                : value.startsWith("1080")
                ? "1080p"
                : "768p",
        };
    };
    const getDurationMode = () =>
        isSeedanceModel(model.value) &&
            provider_input_seedance.value.duration === undefined
            ? "smart"
            : "seconds";
    const getDuration = () =>
        isSeedanceModel(model.value)
            ? provider_input_seedance.value.duration ?? 4
            : isMiniMaxModel(model.value)
            ? provider_input_minimax.value.duration
            : isFalModel(model.value)
            ? provider_input_fal.value.duration
            : provider_input_autodl.value.duration;
    const setAttachments = (items: Attachment[]) => {
        for (const item of attachments.value) {
            if (!items.some((kept) => kept.url === item.url)) {
                URL.revokeObjectURL(item.url);
                mediaLabels.current.delete(item.url);
            }
        }
        for (const item of items) {
            mediaLabels.current.set(item.url, item);
        }
        if (isSeedanceModel(model.value)) {
            provider_input_seedance.value = {
                ...provider_input_seedance.value,
                content: seedanceMedia(items),
            };
        }
        else if (isMiniMaxModel(model.value)) {
            provider_input_minimax.value = {
                ...provider_input_minimax.value,
                content: miniMaxMedia(items, getMode()),
            };
        }
        else if (isFalModel(model.value)) {
            provider_input_fal.value = {
                ...provider_input_fal.value,
                reference_image_urls: items.map((item) => item.url),
            };
        }
        else {
            const input = { ...provider_input_autodl.value };
            for (const key of AUTODL_IMAGE_KEYS) {
                delete input[key];
            }
            input.ref_image_0 = "";
            for (const [index, item] of items.entries()) {
                input[AUTODL_IMAGE_KEYS[index]] = item.url;
            }
            provider_input_autodl.value = input;
        }
    };
    const setMode = (value: "reference" | "frames") => {
        if (isSeedanceModel(model.value)) {
            return;
        }
        else {
            minimaxMode.value = value;
        }
        setAttachments(attachments.value);
    };
    const setRatio = (value: AspectRatio) => {
        if (isSeedanceModel(model.value)) {
            provider_input_seedance.value = {
                ...provider_input_seedance.value,
                ratio: value,
            };
        }
        else if (isMiniMaxModel(model.value)) {
            provider_input_minimax.value = {
                ...provider_input_minimax.value,
                ratio: value,
            };
        }
        else if (isFalModel(model.value)) {
            provider_input_fal.value = {
                ...provider_input_fal.value,
                aspect_ratio: value,
            };
        }
        else {
            const size = getResolution().value as "480p" | "768p" | "1080p";
            provider_input_autodl.value = {
                ...provider_input_autodl.value,
                resolution: `${size}${
                    value === "9:16" ? "竖" : value === "1:1" ? "(1:1)" : "横"
                }`,
            };
        }
    };
    const setResolution = (value: Resolution) => {
        if (value.provider === "seedance") {
            provider_input_seedance.value = {
                ...provider_input_seedance.value,
                resolution: value.value,
            };
        }
        else if (value.provider === "minimax") {
            provider_input_minimax.value = {
                ...provider_input_minimax.value,
                resolution: value.value === "480p" ? "480P" : "768P",
            };
        }
        else if (value.provider === "fal") {
            provider_input_fal.value = {
                ...provider_input_fal.value,
                resolution: value.value === "480p" ? "480P" : "768P",
            };
        }
        else {
            const ratio = getRatio();
            provider_input_autodl.value = {
                ...provider_input_autodl.value,
                resolution: `${value.value}${
                    ratio === "9:16" ? "竖" : ratio === "1:1" ? "(1:1)" : "横"
                }`,
            };
        }
    };
    const setDuration = (duration: number) => {
        if (isSeedanceModel(model.value)) {
            provider_input_seedance.value = {
                ...provider_input_seedance.value,
                duration,
            };
        }
        else if (isMiniMaxModel(model.value)) {
            provider_input_minimax.value = {
                ...provider_input_minimax.value,
                duration,
            };
        }
        else if (isFalModel(model.value)) {
            provider_input_fal.value = {
                ...provider_input_fal.value,
                duration,
            };
        }
        else {
            provider_input_autodl.value = {
                ...provider_input_autodl.value,
                duration,
            };
        }
    };
    const setDurationMode = (value: "seconds" | "smart") => {
        provider_input_seedance.value = {
            ...provider_input_seedance.value,
            duration: value === "smart" ? undefined : 4,
        };
    };
    const popover = useSignal<Popover>(null);
    const mention = useSignal<Mention | null>(null);
    const mentionActive = useSignal(0);
    const dropActive = useSignal(false);

    const fileInput = useRef<HTMLInputElement>(null);
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const composerRef = useRef<HTMLDivElement>(null);
    const nextId = useRef(1);

    // Keep the grid's bottom padding in sync with the floating composer's
    // height so the last row can always scroll clear of it.
    useEffect(() => {
        const el = composerRef.current;
        if (!el) {
            return;
        }
        const update = () => composerInset.value = el.offsetHeight + 48;
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Restore the prompt + settings saved from a previous session. Guard the
    // save effect with `hydrated` so the initial render doesn't clobber storage
    // with defaults before this restore runs.
    const hydrated = useRef(false);
    useEffect(() => {
        const saved = loadComposerState();
        if (saved) {
            if (typeof saved.prompt === "string") {
                prompt.value = saved.prompt;
                // Grow the textarea to fit the restored (possibly multi-line)
                // text; onInput won't fire for a programmatic value. Set the
                // DOM value imperatively so scrollHeight reflects it now.
                const ta = promptRef.current;
                if (ta) {
                    ta.value = saved.prompt;
                    autoGrow(ta);
                }
            }
            if (saved.providers) {
                minimaxMode.value = saved.minimaxMode ?? "reference";
                model.value = saved.model ?? model.value;
                provider_input_seedance.value = {
                    ...saved.providers.seedance,
                    content: [],
                };
                provider_input_minimax.value = {
                    ...saved.providers.minimax,
                    content: [],
                };
                provider_input_fal.value = {
                    ...saved.providers.fal,
                    reference_image_urls: [],
                };
                provider_input_autodl.value = {
                    ...saved.providers.autodl,
                    ref_image_0: "",
                };
            }
        }
        hydrated.current = true;
    }, []);

    useSignalEffect(() => {
        const autodl = { ...provider_input_autodl.value };
        for (const key of AUTODL_IMAGE_KEYS) {
            delete autodl[key];
        }
        autodl.ref_image_0 = "";
        const state: ComposerState = {
            prompt: prompt.value,
            model: model.value,
            minimaxMode: minimaxMode.value,
            providers: {
                seedance: { ...provider_input_seedance.value, content: [] },
                minimax: { ...provider_input_minimax.value, content: [] },
                fal: { ...provider_input_fal.value, reference_image_urls: [] },
                autodl,
            },
        };
        if (hydrated.current) {
            saveComposerState(state);
        }
    });

    // Replace the composer's content (prompt text + reference media) and
    // generation settings with a past generation's request, as requested by
    // the results grid's reuse button.
    const applyReuse = async (req: GenerateInput) => {
        let text: string;
        let media: { kind: AttachmentKind; url: string }[];
        if (isAutoDLInput(req)) {
            text = req.input.prompt;

            media = Object.entries(req.input).filter(([key, value]) =>
                key.startsWith("ref_image_") && typeof value === "string"
            ).sort(([a], [b]) => a.localeCompare(b)).map(([, url]) => ({
                kind: "image",
                url: url as string,
            }));
        }
        else if (req.model === "fal/minimax/h3/reference-to-video") {
            text = req.input.prompt;

            media = req.input.reference_image_urls.map((url) => ({
                kind: "image",
                url,
            }));
        }
        else {
            text = req.content.filter((item) => item.type === "text").map((
                item,
            ) => item.text).join("\n");

            media = req.content.flatMap(
                (item): { kind: AttachmentKind; url: string }[] => {
                    if (item.type === "image_url") {
                        return [{ kind: "image", url: item.image_url.url }];
                    }
                    if (item.type === "video_url") {
                        return [{ kind: "video", url: item.video_url.url }];
                    }
                    if (item.type === "audio_url") {
                        return [{ kind: "audio", url: item.audio_url.url }];
                    }
                    return [];
                },
            );
        }
        const loaded: Attachment[] = [];
        for (const item of media) {
            let blob: Blob;
            try {
                const response = await fetch(item.url);
                if (!response.ok) {
                    for (const attachment of loaded) {
                        URL.revokeObjectURL(attachment.url);
                    }
                    return new Error(
                        `Cannot load reference: ${response.status}`,
                    );
                }
                blob = await response.blob();
            }
            catch (error) {
                for (const attachment of loaded) {
                    URL.revokeObjectURL(attachment.url);
                }
                return error instanceof Error
                    ? error
                    : new Error(String(error));
            }
            loaded.push({
                id: nextId.current++,
                kind: item.kind,
                name: kindLabel(item.kind, language.value),
                url: URL.createObjectURL(blob),
            });
        }
        model.value = req.model;
        setAttachments([]);
        if (isAutoDLInput(req)) {
            const { prompt: _prompt, ...input } = req.input;
            provider_input_autodl.value = input;
        }
        else if (req.model === "fal/minimax/h3/reference-to-video") {
            const { prompt: _prompt, ...input } = req.input;
            provider_input_fal.value = input;
        }
        else if (isMiniMaxInput(req)) {
            const { model: _model, ...input } = req;
            provider_input_minimax.value = input;
            minimaxMode.value = req.content.some((item) =>
                    item.type === "image_url" &&
                    (item.role === "first_frame" || item.role === "last_frame")
                )
                ? "frames"
                : "reference";
        }
        else {
            const { model: _model, ...input } = req;
            provider_input_seedance.value = input;
        }
        setAttachments(loaded);
        prompt.value = text;
        if (promptRef.current) {
            promptRef.current.value = text;
            autoGrow(promptRef.current);
        }
    };

    useSignalEffect(() => {
        const req = reusePrompt.value;
        if (!req) {
            return;
        }
        reusePrompt.value = null;
        void (async () => {
            const result = await applyReuse(req);
            if (result instanceof Error) {
                console.error("[Composer] failed to reuse request:", result);
                genError.value = result.message;
            }
        })();
    });

    // Attachments with their display labels: Image1, Image2, Video1, …
    const labeled = useComputed(() => {
        const counters: Record<AttachmentKind, number> = {
            image: 0,
            video: 0,
            audio: 0,
        };
        return attachments.value.map((a) => ({
            ...a,
            label: `${kindLabel(a.kind, language.value)}${++counters[a.kind]}`,
        }));
    });

    const durationLabel = useComputed(() =>
        getDurationMode() === "smart"
            ? get_text("smart", language.value)
            : `${getDuration()}${get_text("s_unit", language.value)}`
    );

    const selectedModel = useComputed(() => getModelOption(model.value));

    // Display the resolutions allowed by the current settings branch.
    const resolutions = useComputed(() => {
        if (isSeedanceModel(model.value)) {
            return MODEL_RESOLUTIONS[model.value];
        }
        else if (isMiniMaxModel(model.value)) {
            return MINIMAX_MODEL_RESOLUTIONS[model.value];
        }
        else if (isFalModel(model.value)) {
            return FAL_MODEL_RESOLUTIONS[model.value];
        }
        else if (isAutoDLModel(model.value)) {
            return AUTODL_RESOLUTIONS;
        }
        else {
            throw new Error(`unsupported model: ${model.value}`);
        }
    });
    const togglePopover = (which: Exclude<Popover, null>) => {
        popover.value = popover.value === which ? null : which;
    };

    const addFiles = (files: FileList | File[] | null) => {
        if (!files) {
            return;
        }
        const miniMaxFrames = isMiniMaxModel(model.value) &&
            (getMode() === "frames" || model.value === "MiniMax-H3-Max");
        const accepted = isAutoDLModel(model.value)
            ? Array.from(files).filter((file) => file.type.startsWith("image/"))
                .slice(0, Math.max(0, 9 - attachments.value.length))
            : miniMaxFrames || isFalModel(model.value)
            ? Array.from(files).filter((file) => file.type.startsWith("image/"))
            : Array.from(files);
        const added = accepted.map((file) => ({
            id: nextId.current++,
            kind: kindOf(file),
            name: file.name,
            url: URL.createObjectURL(file),
        }));
        setAttachments([...attachments.value, ...added]);
    };

    // Attach an image dragged from the file explorer. The path is project-
    // relative and served at /project-file/<path>; fetch its bytes into a blob:
    // object URL so it behaves like a file attachment (revocable, and the bytes
    // are held client-side for sending on to remote servers).
    const addProjectImage = async (path: string) => {
        // AutoDL has exactly nine named image fields in its input shape.
        if (
            isAutoDLModel(model.value) &&
            attachments.value.length === AUTODL_IMAGE_KEYS.length
        ) {
            return;
        }
        const url = "/project-file/" +
            path.split("/").map(encodeURIComponent).join("/");
        let blob: Blob;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                return new Error(`Cannot load reference: ${response.status}`);
            }
            blob = await response.blob();
        }
        catch (error) {
            return error instanceof Error ? error : new Error(String(error));
        }

        setAttachments([...attachments.value, {
            id: nextId.current++,
            kind: "image",
            name: path.split("/").pop() ?? path,
            url: URL.createObjectURL(blob),
        }]);
    };

    // Accept pasted media (e.g. an image copied from the file explorer).
    const onPaste = (e: ClipboardEvent) => {
        const files = e.clipboardData?.files;
        if (!files || files.length === 0) {
            return; // let text paste through
        }
        const media = Array.from(files).filter((f) =>
            /^(image|video|audio)\//.test(f.type)
        );
        if (media.length === 0) {
            return;
        }
        e.preventDefault();
        addFiles(media);
    };

    // Accept media dragged from the OS (e.g. an image from Finder) or an image
    // dragged from the project file explorer.
    const onDragOver = (e: DragEvent) => {
        const types = e.dataTransfer?.types;
        if (!types) {
            return;
        }
        if (!types.includes("Files") && !types.includes(PROJECT_FILE_MIME)) {
            return; // ignore unrelated internal element drags
        }
        e.preventDefault();
        e.dataTransfer!.dropEffect = "copy";
        dropActive.value = true;
    };

    const onDragLeave = (e: DragEvent) => {
        // Ignore leaves into descendants; only clear when exiting the card.
        if (e.currentTarget === e.target) {
            dropActive.value = false;
        }
    };

    const onDrop = (e: DragEvent) => {
        dropActive.value = false;

        // Image dragged from the file explorer (carries a project path).
        const projectPath = e.dataTransfer?.getData(PROJECT_FILE_MIME);
        if (projectPath) {
            e.preventDefault();
            void (async () => {
                const result = await addProjectImage(projectPath);
                if (result instanceof Error) {
                    console.error("[Composer] failed to attach image:", result);
                    genError.value = result.message;
                }
            })();
            return;
        }

        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) {
            return;
        }
        const media = Array.from(files).filter((f) =>
            /^(image|video|audio)\//.test(f.type)
        );
        if (media.length === 0) {
            return;
        }
        e.preventDefault();
        addFiles(media);
    };

    const removeAttachment = (id: number) => {
        setAttachments(attachments.value.filter((a) => a.id !== id));
    };

    const clearAll = () => {
        setAttachments([]);
        prompt.value = "";
        const ta = promptRef.current;
        if (ta) {
            ta.value = "";
            ta.scrollTop = 0;
            ta.style.height = "";
        }
        mention.value = null;
    };

    const openMention = (ta: HTMLTextAreaElement, atIndex: number) => {
        const { x, y } = caretCoords(ta, atIndex);
        // 176px = popup width; keep it inside the editor
        mention.value = {
            index: atIndex,
            x: Math.max(0, Math.min(x, ta.clientWidth - 176)),
            y,
        };
        mentionActive.value = 0;
    };

    const selectMention = (label: string) => {
        const m = mention.value;
        const ta = promptRef.current;
        if (!m || !ta) {
            return;
        }
        const text = prompt.value;
        const insert = `@${label} `;
        prompt.value = text.slice(0, m.index) + insert +
            text.slice(m.index + 1);
        mention.value = null;
        const caret = m.index + insert.length;
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(caret, caret);
        });
    };

    // Resize the textarea to fit its content (auto-grow up to the CSS max).
    const autoGrow = (ta: HTMLTextAreaElement) => {
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight}px`;
    };

    const onPromptInput = (ta: HTMLTextAreaElement) => {
        prompt.value = ta.value;
        autoGrow(ta);
        const caret = ta.selectionStart ?? 0;
        if (caret > 0 && ta.value[caret - 1] === "@") {
            openMention(ta, caret - 1);
        }
        else {
            mention.value = null;
        }
    };

    const onPromptKeyDown = (e: KeyboardEvent) => {
        if (!mention.value) {
            return;
        }
        const items = labeled.value;
        if (e.key === "Escape") {
            e.preventDefault();
            mention.value = null;
        }
        else if (e.key === "ArrowDown" && items.length > 0) {
            e.preventDefault();
            mentionActive.value = (mentionActive.value + 1) % items.length;
        }
        else if (e.key === "ArrowUp" && items.length > 0) {
            e.preventDefault();
            mentionActive.value = (mentionActive.value + items.length - 1) %
                items.length;
        }
        else if (e.key === "Enter" && items.length > 0) {
            e.preventDefault();
            selectMention(items[mentionActive.value].label);
        }
    };

    return (
        <>
            {/* Floating composer — centered within the content panel */}
            <div
                ref={composerRef}
                class="absolute bottom-6 left-0 right-0 mx-auto z-20 w-full max-w-3xl px-4"
            >
                {genError.value && (
                    <div class="mb-3 text-sm text-red-500 break-all bg-white/90 backdrop-blur rounded-lg px-3 py-2 shadow">
                        {get_text("generation_failed_prefix", language.value)}
                        {" "}
                        {genError.value}
                    </div>
                )}
                <div
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    class={`w-full bg-white/95 backdrop-blur rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.16)] border p-5 select-none ${
                        dropActive.value
                            ? "border-indigo-400 ring-2 ring-indigo-300"
                            : "border-gray-200"
                    }`}
                >
                    {/* Attachments */}
                    <div class="flex flex-wrap gap-3 mb-4">
                        <button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            class="w-[72px] h-[72px] rounded-lg border border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 flex flex-col items-center justify-center gap-1 text-gray-400 transition-colors"
                        >
                            <span class="text-lg leading-none">+</span>
                            <span class="text-[10px]">
                                {get_text(
                                    isAutoDLModel(model.value) ||
                                        isMiniMaxModel(model.value) &&
                                            (getMode() === "frames" ||
                                                model.value ===
                                                    "MiniMax-H3-Max")
                                        ? "reference_images"
                                        : "image_video_audio",
                                    language.value,
                                )}
                            </span>
                        </button>
                        <input
                            ref={fileInput}
                            type="file"
                            multiple
                            accept={isAutoDLModel(model.value) ||
                                    isMiniMaxModel(model.value) &&
                                        (getMode() === "frames" ||
                                            model.value === "MiniMax-H3-Max")
                                ? "image/*"
                                : "image/*,video/*,audio/*"}
                            class="hidden"
                            onChange={(e) => {
                                addFiles(e.currentTarget.files);
                                e.currentTarget.value = "";
                            }}
                        />

                        {attachments.value.map((att) => {
                            return (
                                <div
                                    key={att.id}
                                    class="relative group w-[72px] h-[72px] rounded-lg overflow-hidden border border-gray-200 bg-gray-100"
                                    title={att.name}
                                >
                                    {att.kind === "image" && (
                                        <img
                                            src={att.url}
                                            alt={att.name}
                                            class="w-full h-full object-cover"
                                        />
                                    )}
                                    {att.kind === "video" && (
                                        <>
                                            {/* #t=0.001 forces browsers (Safari) to paint the first frame */}
                                            <video
                                                src={`${att.url}#t=0.001`}
                                                preload="metadata"
                                                muted
                                                playsInline
                                                class="w-full h-full object-cover pointer-events-none"
                                            />
                                            <span class="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                <span class="size-5 rounded-full bg-black/45 text-white flex items-center justify-center">
                                                    <svg
                                                        class="size-2.5"
                                                        viewBox="0 0 24 24"
                                                        fill="currentColor"
                                                    >
                                                        <path d="M8 5v14l11-7z" />
                                                    </svg>
                                                </span>
                                            </span>
                                        </>
                                    )}
                                    {att.kind === "audio" && (
                                        <div class="w-full h-full flex items-center justify-center text-gray-400">
                                            <MusicIcon class="size-6" />
                                        </div>
                                    )}
                                    <span class="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] text-center py-0.5">
                                        {att.name}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => removeAttachment(att.id)}
                                        class="absolute top-0.5 right-0.5 size-4 rounded-full bg-black/60 text-white text-[10px] leading-none items-center justify-center hidden group-hover:flex"
                                        aria-label={get_text(
                                            "remove",
                                            language.value,
                                        )}
                                    >
                                        ×
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {/* Prompt */}
                    <div class="relative mb-3">
                        <textarea
                            ref={promptRef}
                            value={prompt.value}
                            onInput={(e) => onPromptInput(e.currentTarget)}
                            onKeyDown={onPromptKeyDown}
                            onPaste={onPaste}
                            onBlur={() => mention.value = null}
                            placeholder={get_text(
                                "describe_prompt_placeholder",
                                language.value,
                            )}
                            rows={1}
                            // Auto-grows up to 2/3 of the viewport, then scrolls.
                            class="w-full resize-none border-0 outline-none text-[15px] text-gray-800 placeholder:text-gray-400 block max-h-[66vh] overflow-y-auto select-text"
                        />

                        {/* Mention picker */}
                        {mention.value && (
                            <div
                                class="absolute z-30 w-44 bg-white rounded-xl shadow-xl border border-gray-100 p-1.5"
                                style={{
                                    left: `${mention.value.x}px`,
                                    top: `${mention.value.y}px`,
                                    transform: "translateY(calc(-100% - 6px))",
                                }}
                            >
                                {labeled.value.length === 0
                                    ? (
                                        <div class="px-3 py-2 text-sm text-gray-400">
                                            {get_text(
                                                "no_assets_yet",
                                                language.value,
                                            )}
                                        </div>
                                    )
                                    : labeled.value.map((att, i) => (
                                        <button
                                            key={att.id}
                                            type="button"
                                            onMouseDown={(e) =>
                                                e.preventDefault()}
                                            onClick={() =>
                                                selectMention(att.label)}
                                            onMouseEnter={() =>
                                                mentionActive.value = i}
                                            class={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-gray-800 ${
                                                i === mentionActive.value
                                                    ? "bg-indigo-50"
                                                    : ""
                                            }`}
                                        >
                                            <span class="size-8 rounded-md overflow-hidden bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">
                                                {att.kind === "image" && (
                                                    <img
                                                        src={att.url}
                                                        alt={att.label}
                                                        class="w-full h-full object-cover"
                                                    />
                                                )}
                                                {att.kind === "video" && (
                                                    <video
                                                        src={`${att.url}#t=0.001`}
                                                        preload="metadata"
                                                        muted
                                                        playsInline
                                                        class="w-full h-full object-cover pointer-events-none"
                                                    />
                                                )}
                                                {att.kind === "audio" && (
                                                    <MusicIcon class="size-4" />
                                                )}
                                            </span>
                                            {att.label}
                                        </button>
                                    ))}
                            </div>
                        )}
                    </div>

                    {/* Toolbar */}
                    <div class="flex items-center gap-2">
                        {/* Model selector */}
                        <div class="relative">
                            <button
                                type="button"
                                onClick={() => togglePopover("model")}
                                class="flex items-center gap-1.5 px-3 h-9 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                                title={selectedModel.value.value}
                            >
                                <SparklesIcon class="size-4" />
                                {selectedModel.value.shortLabel}
                                <ChevronIcon up={popover.value === "model"} />
                            </button>

                            {popover.value === "model" && (
                                <div class="absolute left-0 bottom-full mb-2 z-20 w-72 bg-white rounded-xl shadow-xl border border-gray-100 p-2">
                                    <div class="px-3 py-2 text-sm text-gray-400">
                                        {get_text(
                                            "select_model",
                                            language.value,
                                        )}
                                    </div>
                                    {GENERATION_MODELS.map((item) => (
                                        <button
                                            key={item.value}
                                            type="button"
                                            onClick={() => {
                                                model.value = item.value;
                                                if (
                                                    isMiniMaxModel(item.value)
                                                ) {
                                                    setAttachments(
                                                        attachments.value,
                                                    );
                                                }
                                                popover.value = null;
                                            }}
                                            class={`w-full flex items-start gap-2 px-3 py-2.5 rounded-lg text-left hover:bg-gray-50 ${
                                                model.value === item.value
                                                    ? "bg-indigo-50 hover:bg-indigo-50"
                                                    : ""
                                            }`}
                                        >
                                            <SparklesIcon class="size-4 mt-0.5 text-gray-500" />
                                            <span class="min-w-0">
                                                <span class="block text-sm text-gray-800">
                                                    {item.label}
                                                </span>
                                                <span class="block text-[11px] text-gray-400 truncate">
                                                    {item.value}
                                                </span>
                                            </span>
                                            {model.value === item.value && (
                                                <span class="ml-auto mt-0.5">
                                                    <CheckIcon />
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Mode selector */}
                        {model.value === "MiniMax-H3" && (
                            <div class="relative">
                                <button
                                    type="button"
                                    onClick={() => togglePopover("mode")}
                                    class="flex items-center gap-1.5 px-3 h-9 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                    <VideoIcon class="size-4" />
                                    {getMode() === "reference"
                                        ? get_text("reference", language.value)
                                        : get_text(
                                            "first_last_frame",
                                            language.value,
                                        )}
                                    <ChevronIcon
                                        up={popover.value === "mode"}
                                    />
                                </button>

                                {popover.value === "mode" && (
                                    <div class="absolute left-0 bottom-full mb-2 z-20 w-56 bg-white rounded-xl shadow-xl border border-gray-100 p-2">
                                        <div class="px-3 py-2 text-sm text-gray-400">
                                            {get_text(
                                                "select_mode",
                                                language.value,
                                            )}
                                        </div>
                                        {(
                                            [
                                                {
                                                    value: "reference",
                                                    textId: "reference",
                                                    icon: (
                                                        <VideoIcon class="size-4" />
                                                    ),
                                                },
                                                {
                                                    value: "frames",
                                                    textId: "first_last_frame",
                                                    icon: (
                                                        <FramesIcon class="size-4" />
                                                    ),
                                                },
                                            ] as const
                                        ).map((item) => (
                                            <button
                                                key={item.value}
                                                type="button"
                                                onClick={() => {
                                                    setMode(item.value);
                                                    popover.value = null;
                                                }}
                                                class={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-gray-800 hover:bg-gray-50 ${
                                                    getMode() === item.value
                                                        ? "bg-indigo-50 hover:bg-indigo-50"
                                                        : ""
                                                }`}
                                            >
                                                {item.icon}
                                                {get_text(
                                                    item.textId,
                                                    language.value,
                                                )}
                                                {getMode() === item.value && (
                                                    <span class="ml-auto">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Output settings */}
                        <div class="relative">
                            <button
                                type="button"
                                onClick={() => togglePopover("settings")}
                                class="flex items-center h-9 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 divide-x divide-gray-200"
                            >
                                <span class="px-2.5 flex items-center gap-1.5">
                                    {getRatio()}
                                </span>
                                <span class="px-2.5">
                                    {getResolution().value}
                                </span>
                                <span class="px-2.5">
                                    {durationLabel.value}
                                </span>
                            </button>

                            {popover.value === "settings" && (
                                <div class="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-20 w-[min(560px,calc(100vw-2rem))] max-h-[80vh] overflow-y-auto bg-white rounded-xl shadow-xl border border-gray-100 p-5">
                                    <div class="text-sm text-gray-500 mb-2">
                                        {get_text(
                                            "aspect_ratio",
                                            language.value,
                                        )}
                                    </div>
                                    <div class="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-5">
                                        {RATIOS.filter((r) =>
                                            !isAutoDLModel(
                                                model.value,
                                            ) ||
                                            ["16:9", "9:16", "1:1"]
                                                .includes(
                                                    r.value,
                                                )
                                        ).map((r) => (
                                            <button
                                                key={r.value}
                                                type="button"
                                                onClick={() =>
                                                    setRatio(r.value)}
                                                class={`flex flex-col items-center justify-end gap-2 h-16 rounded-lg border text-xs pb-2 ${
                                                    getRatio() ===
                                                            r.value
                                                        ? "border-gray-800 text-gray-900 bg-white"
                                                        : "border-transparent bg-gray-50 text-gray-600 hover:bg-gray-100"
                                                }`}
                                            >
                                                <span
                                                    class={`block rounded-[3px] border-[1.5px] border-current ${
                                                        r.value ===
                                                                "adaptive"
                                                            ? "border-dashed"
                                                            : ""
                                                    }`}
                                                    style={{
                                                        width: `${r.w}px`,
                                                        height: `${r.h}px`,
                                                    }}
                                                />
                                                {r.value}
                                            </button>
                                        ))}
                                    </div>
                                    <div class="text-sm text-gray-500 mb-2">
                                        {get_text(
                                            "resolution",
                                            language.value,
                                        )}
                                    </div>
                                    <div
                                        class="grid bg-gray-100 rounded-lg p-1 mb-5"
                                        style={{
                                            gridTemplateColumns: `repeat(${
                                                Math.min(
                                                    3,
                                                    resolutions.value.length,
                                                )
                                            }, minmax(0, 1fr))`,
                                        }}
                                    >
                                        {resolutions.value.map((
                                            res,
                                        ) => (
                                            <button
                                                key={`${res.provider}:${res.value}`}
                                                type="button"
                                                onClick={() =>
                                                    setResolution(res)}
                                                class={`h-9 rounded-md text-sm ${
                                                    getResolution()
                                                                .provider ===
                                                            res.provider &&
                                                        getResolution()
                                                                .value ===
                                                            res.value
                                                        ? "bg-white shadow text-gray-900 font-medium"
                                                        : "text-gray-500 hover:text-gray-700"
                                                }`}
                                            >
                                                {res.value}
                                            </button>
                                        ))}
                                    </div>

                                    <div class="text-sm text-gray-500 mb-2">
                                        {get_text("duration", language.value)}
                                    </div>
                                    {isSeedanceModel(model.value) && (
                                        <div class="grid grid-cols-2 bg-gray-100 rounded-lg p-1 mb-3">
                                            {(
                                                [
                                                    {
                                                        value: "seconds",
                                                        textId: "by_seconds",
                                                    },
                                                    {
                                                        value: "smart",
                                                        textId:
                                                            "smart_duration",
                                                    },
                                                ] as const
                                            ).map((dm) => (
                                                <button
                                                    key={dm.value}
                                                    type="button"
                                                    onClick={() =>
                                                        setDurationMode(
                                                            dm.value,
                                                        )}
                                                    class={`h-9 rounded-md text-sm ${
                                                        getDurationMode() ===
                                                                dm.value
                                                            ? "bg-white shadow text-gray-900 font-medium"
                                                            : "text-gray-500 hover:text-gray-700"
                                                    }`}
                                                >
                                                    {get_text(
                                                        dm.textId,
                                                        language.value,
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {getDurationMode() === "seconds" && (
                                        <div class="flex items-center gap-4 mb-5">
                                            <input
                                                type="range"
                                                min={isAutoDLModel(
                                                        model.value,
                                                    ) || isFalModel(model.value)
                                                    ? 1
                                                    : model.value ===
                                                            "MiniMax-H3-Max"
                                                    ? 5
                                                    : 4}
                                                max={model.value ===
                                                        "autodl/minimax_h3_lightx2v_v5"
                                                    ? 10
                                                    : 15}
                                                step={1}
                                                value={getDuration()}
                                                onInput={(e) =>
                                                    setDuration(Number(
                                                        e.currentTarget
                                                            .value,
                                                    ))}
                                                class="flex-1 accent-indigo-500"
                                            />
                                            <span class="w-16 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-sm text-gray-700 gap-1">
                                                {getDuration()}
                                                <span class="text-gray-400">
                                                    {get_text(
                                                        "s_unit",
                                                        language.value,
                                                    )}
                                                </span>
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Audio toggle */}
                        {isSeedanceModel(model.value) && (
                            <button
                                type="button"
                                onClick={() =>
                                    provider_input_seedance.value = {
                                        ...provider_input_seedance.value,
                                        generate_audio: !provider_input_seedance
                                            .value.generate_audio,
                                    }}
                                class={`flex items-center gap-1.5 px-3 h-9 rounded-lg border text-sm ${
                                    provider_input_seedance.value.generate_audio
                                        ? "border-indigo-300 bg-indigo-50 text-indigo-600"
                                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                                }`}
                            >
                                <SpeakerIcon />
                            </button>
                        )}

                        <div class="flex-1" />

                        <button
                            type="button"
                            onClick={clearAll}
                            class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
                        >
                            <ResetIcon />
                            {get_text("clear_all", language.value)}
                        </button>

                        {/* Submit */}
                        <button
                            type="button"
                            class="size-9 rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white flex items-center justify-center ml-1"
                            aria-label={get_text("generate", language.value)}
                            onClick={async () => {
                                genError.value = null;
                                const submittedModel = model.value;
                                const submittedPrompt = prompt.value;
                                const submittedInput =
                                    isSeedanceModel(submittedModel)
                                        ? provider_input_seedance.value
                                        : isMiniMaxModel(submittedModel)
                                        ? provider_input_minimax.value
                                        : isFalModel(submittedModel)
                                        ? provider_input_fal.value
                                        : provider_input_autodl.value;
                                let request: GenerateInput;
                                if (isSeedanceModel(submittedModel)) {
                                    request = {
                                        ...provider_input_seedance.value,
                                        model: submittedModel,
                                        content: [
                                            {
                                                type: "text",
                                                text: submittedPrompt,
                                            },
                                            ...provider_input_seedance.value
                                                .content.filter((item) =>
                                                    item.type !== "text"
                                                ),
                                        ],
                                    };
                                }
                                else if (isMiniMaxModel(submittedModel)) {
                                    request = {
                                        ...provider_input_minimax.value,
                                        model: submittedModel,
                                        content: [
                                            {
                                                type: "text",
                                                text: submittedPrompt,
                                            },
                                            ...provider_input_minimax.value
                                                .content.filter((item) =>
                                                    item.type !== "text"
                                                ),
                                        ],
                                    };
                                }
                                else if (
                                    submittedModel ===
                                        "fal/minimax/h3/reference-to-video"
                                ) {
                                    request = {
                                        model: submittedModel,
                                        input: {
                                            ...provider_input_fal.value,
                                            prompt: submittedPrompt,
                                        },
                                    };
                                }
                                else {
                                    request = {
                                        model: submittedModel,
                                        input: {
                                            ...provider_input_autodl.value,
                                            prompt: submittedPrompt,
                                        },
                                    };
                                }
                                request = structuredClone(request);
                                // Inline browser object URLs for the backend to forward.
                                if ("content" in request) {
                                    for (const item of request.content) {
                                        const media = item.type === "image_url"
                                            ? item.image_url
                                            : item.type === "video_url"
                                            ? item.video_url
                                            : item.type === "audio_url"
                                            ? item.audio_url
                                            : null;
                                        if (media?.url.startsWith("blob:")) {
                                            media.url = await toDataUrl(
                                                media.url,
                                            );
                                        }
                                    }
                                }
                                else if (
                                    request.model ===
                                        "fal/minimax/h3/reference-to-video"
                                ) {
                                    for (
                                        const [index, url] of request.input
                                            .reference_image_urls.entries()
                                    ) {
                                        if (url.startsWith("blob:")) {
                                            request.input
                                                .reference_image_urls[index] =
                                                    await toDataUrl(url);
                                        }
                                    }
                                }
                                else {
                                    for (const key of AUTODL_IMAGE_KEYS) {
                                        const url = request.input[key];
                                        if (url?.startsWith("blob:")) {
                                            request.input[key] =
                                                await toDataUrl(url);
                                        }
                                    }
                                }
                                const gen = await trpc.open.generate.mutate(
                                    request,
                                );
                                if ("error" in gen) {
                                    genError.value = gen.message;
                                    return;
                                }
                                if (
                                    model.value === submittedModel &&
                                    prompt.value === submittedPrompt &&
                                    submittedInput ===
                                        (isSeedanceModel(submittedModel)
                                            ? provider_input_seedance.value
                                            : isMiniMaxModel(submittedModel)
                                            ? provider_input_minimax.value
                                            : isFalModel(submittedModel)
                                            ? provider_input_fal.value
                                            : provider_input_autodl.value)
                                ) {
                                    clearAll();
                                }
                                console.log("generating", gen);
                                if (gen.status == "failed") {
                                    genError.value = gen.failed_reason!;

                                    updateGenerations(
                                        props.generated_videos,
                                        {
                                            id: gen.id,
                                            status: gen.status,
                                            created_at: gen.created_at,
                                            has_request:
                                                gen.request_json != null,
                                            failed_reason: gen.failed_reason ??
                                                undefined,
                                        },
                                    );
                                    await sleep(3000);
                                    genError.value = null;
                                }
                            }}
                        >
                            <ArrowUpIcon />
                        </button>
                    </div>
                </div>
            </div>

            {/* Click-away for popovers */}
            {popover.value && (
                <div
                    class="fixed inset-0 z-10"
                    onClick={() => popover.value = null}
                />
            )}
        </>
    );
}

type SeedanceInput = Omit<CreateTaskRequest, "model">;
type MiniMaxInput = Omit<CreateVideoTaskRequest, "model">;
type FalDraft = Omit<FalInput, "prompt">;
type AutoDLDraft = Omit<AutoDLGenerateInput["input"], "prompt">;
type Attachment = {
    id: number;
    kind: AttachmentKind;
    name: string;
    url: string;
};
const AUTODL_IMAGE_KEYS = [
    "ref_image_0",
    "ref_image_1",
    "ref_image_2",
    "ref_image_3",
    "ref_image_4",
    "ref_image_5",
    "ref_image_6",
    "ref_image_7",
    "ref_image_8",
] as const;

function contentMedia(
    content: SeedanceInput["content"] | MiniMaxInput["content"],
): { kind: AttachmentKind; url: string }[] {
    return content.flatMap((item): { kind: AttachmentKind; url: string }[] => {
        if (item.type === "image_url") {
            return [{ kind: "image", url: item.image_url.url }];
        }
        if (item.type === "video_url") {
            return [{ kind: "video", url: item.video_url.url }];
        }
        if (item.type === "audio_url") {
            return [{ kind: "audio", url: item.audio_url.url }];
        }
        return [];
    });
}
function autoDLMedia(
    input: AutoDLDraft,
): { kind: AttachmentKind; url: string }[] {
    const media: { kind: AttachmentKind; url: string }[] = [];
    for (const key of AUTODL_IMAGE_KEYS) {
        const url = input[key];
        if (url) {
            media.push({ kind: "image", url });
        }
    }
    return media;
}
function seedanceMedia(items: Attachment[]): SeedanceInput["content"] {
    return items.map((item) => {
        if (item.kind === "image") {
            return {
                type: "image_url",
                image_url: { url: item.url },
                role: "reference_image",
            };
        }
        if (item.kind === "video") {
            return {
                type: "video_url",
                video_url: { url: item.url },
                role: "reference_video",
            };
        }
        return {
            type: "audio_url",
            audio_url: { url: item.url },
            role: "reference_audio",
        };
    });
}
function miniMaxMedia(
    items: Attachment[],
    mode: "reference" | "frames",
): MiniMaxInput["content"] {
    return items.map((item, index) => {
        if (item.kind === "image") {
            return {
                type: "image_url",
                image_url: { url: item.url },
                role: mode === "frames"
                    ? index === 0 ? "first_frame" : "last_frame"
                    : "reference_image",
            };
        }
        if (item.kind === "video") {
            return {
                type: "video_url",
                video_url: { url: item.url },
                role: "reference_video",
            };
        }
        return {
            type: "audio_url",
            audio_url: { url: item.url },
            role: "reference_audio",
        };
    });
}
type AttachmentKind = "image" | "video" | "audio";

type Resolution = {
    provider: "seedance";
    value: "480p" | "720p" | "1080p";
} | {
    provider: "fal" | "minimax";
    value: "480p" | "768p";
} | {
    provider: "autodl";
    value: "480p" | "768p" | "1080p";
};
type Popover = "model" | "mode" | "settings" | null;

const SEEDANCE_MODELS = [
    {
        value: "doubao-seedance-2-0-260128",
        label: "Seedance 2.0",
        shortLabel: "2.0",
    },
    {
        value: "doubao-seedance-2-0-fast-260128",
        label: "Seedance 2.0 Fast",
        shortLabel: "2.0 Fast",
    },
    {
        value: "doubao-seedance-2-0-mini-260615",
        label: "Seedance 2.0 Mini",
        shortLabel: "2.0 Mini",
    },
] as const satisfies readonly {
    value: SeedanceModel;
    label: string;
    shortLabel: string;
}[];

const MINIMAX_MODEL_OPTIONS = [
    {
        value: "MiniMax-H3",
        label: "MiniMax H3",
        shortLabel: "H3",
    },
    {
        value: "MiniMax-H3-Max",
        label: "MiniMax H3 Max",
        shortLabel: "H3 Max",
    },
] as const satisfies readonly {
    value: MiniMaxVideoModel;
    label: string;
    shortLabel: string;
}[];

/** Models routed through fal.ai's queue API (see apigen/fal.ts). */
const FAL_MODEL_OPTIONS = [
    {
        value: "fal/minimax/h3/reference-to-video",
        label: "Fal · MiniMax H3 Reference",
        shortLabel: "Fal H3",
    },
] as const satisfies readonly {
    value: FalModel;
    label: string;
    shortLabel: string;
}[];

type FalModel = "fal/minimax/h3/reference-to-video";

type AutoDLModel = AutoDLGenerateInput["model"];
const AUTODL_MODEL_OPTIONS = [{
    value: "autodl/minimax_h3_lightx2v_v5",
    label: "AutoDL · MiniMax H3 10s",
    shortLabel: "AutoDL H3 10s",
}, {
    value: "autodl/minimax_h3_image_audio_to_video_v2_15s",
    label: "AutoDL · MiniMax H3 15s",
    shortLabel: "AutoDL H3 15s",
}] as const;

const GENERATION_MODELS = [
    ...SEEDANCE_MODELS,
    ...MINIMAX_MODEL_OPTIONS,
    ...FAL_MODEL_OPTIONS,
    ...AUTODL_MODEL_OPTIONS,
];
type GenerationModel =
    | SeedanceModel
    | MiniMaxVideoModel
    | FalModel
    | AutoDLModel;

const RATIOS = [
    { value: "21:9", w: 18, h: 8 },
    { value: "16:9", w: 16, h: 9 },
    { value: "4:3", w: 13, h: 10 },
    { value: "1:1", w: 11, h: 11 },
    { value: "3:4", w: 10, h: 13 },
    { value: "9:16", w: 9, h: 16 },
    { value: "adaptive", w: 13, h: 10 },
] as const;

// Resolutions each model supports. Seedance 2.0 Fast can't output 1080p (see
// the `resolution` docs in seedance.ts); the others support all three.
const MODEL_RESOLUTIONS: Record<SeedanceModel, Resolution[]> = {
    "doubao-seedance-2-0-260128": [
        { provider: "seedance", value: "480p" },
        { provider: "seedance", value: "720p" },
        { provider: "seedance", value: "1080p" },
    ],
    "doubao-seedance-2-0-fast-260128": [
        { provider: "seedance", value: "480p" },
        { provider: "seedance", value: "720p" },
    ],
    "doubao-seedance-2-0-mini-260615": [
        { provider: "seedance", value: "480p" },
        { provider: "seedance", value: "720p" },
    ],
};

const MINIMAX_MODEL_RESOLUTIONS: Record<MiniMaxVideoModel, Resolution[]> = {
    "MiniMax-H3": [{ provider: "minimax", value: "768p" }],
    "MiniMax-H3-Max": [{ provider: "minimax", value: "480p" }, {
        provider: "minimax",
        value: "768p",
    }],
};

const FAL_MODEL_RESOLUTIONS: Record<FalModel, Resolution[]> = {
    "fal/minimax/h3/reference-to-video": [
        { provider: "fal", value: "480p" },
        { provider: "fal", value: "768p" },
    ],
};

const AUTODL_RESOLUTIONS: Resolution[] = [
    { provider: "autodl", value: "480p" },
    { provider: "autodl", value: "768p" },
    { provider: "autodl", value: "1080p" },
];

/** Display label for an attachment kind, in the given language. */
function kindLabel(kind: AttachmentKind, lang: Language): string {
    return get_text(
        kind === "image" ? "image" : kind === "video" ? "video" : "audio",
        lang,
    );
}

type Mention = {
    /** Index of the "@" character in the prompt */
    index: number;
    x: number;
    y: number;
};

/** localStorage key for the composer's prompt + generation settings. */
const COMPOSER_STATE_KEY = "composer.state.v1";

/** Persisted composer fields (attachments are intentionally excluded). */
interface ComposerState {
    prompt: string;
    model: GenerationModel;
    minimaxMode: "reference" | "frames";
    providers: {
        seedance: SeedanceInput;
        minimax: MiniMaxInput;
        fal: FalDraft;
        autodl: AutoDLDraft;
    };
}

/** Read persisted composer state (client only); null if absent/unreadable. */
function loadComposerState():
    | (Partial<ComposerState> & Record<string, unknown>)
    | null {
    try {
        const raw = localStorage.getItem(COMPOSER_STATE_KEY);
        return raw
            ? JSON.parse(raw) as
                & Partial<ComposerState>
                & Record<string, unknown>
            : null;
    }
    catch {
        return null;
    }
}

function saveComposerState(state: ComposerState): void {
    try {
        localStorage.setItem(COMPOSER_STATE_KEY, JSON.stringify(state));
    }
    catch { /* storage unavailable or full — non-fatal */ }
}

function kindOf(file: File): AttachmentKind {
    if (file.type.startsWith("video/")) {
        return "video";
    }
    if (file.type.startsWith("audio/")) {
        return "audio";
    }
    return "image";
}

function isSeedanceModel(value: unknown): value is SeedanceModel {
    return SEEDANCE_MODELS.some((model) => model.value === value);
}

function isMiniMaxModel(value: unknown): value is MiniMaxVideoModel {
    return value === "MiniMax-H3" || value === "MiniMax-H3-Max";
}

function isFalModel(value: unknown): value is FalModel {
    return FAL_MODEL_OPTIONS.some((model) => model.value === value);
}

function getModelOption(value: GenerationModel) {
    return GENERATION_MODELS.find((model) => model.value === value) ??
        GENERATION_MODELS[0];
}

// The API can't fetch blob: object URLs, so inline the bytes as a data URL
async function toDataUrl(objectUrl: string): Promise<string> {
    const blob = await (await fetch(objectUrl)).blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// Mirror-div trick: a textarea exposes no caret geometry, so render the text
// up to `pos` in an identically-styled hidden div and measure a marker span.
function caretCoords(
    ta: HTMLTextAreaElement,
    pos: number,
): { x: number; y: number } {
    const style = getComputedStyle(ta);
    const div = document.createElement("div");
    for (
        const prop of [
            "font-family",
            "font-size",
            "font-weight",
            "line-height",
            "letter-spacing",
            "padding",
            "border",
            "box-sizing",
        ]
    ) {
        div.style.setProperty(prop, style.getPropertyValue(prop));
    }
    div.style.position = "absolute";
    div.style.top = "0";
    div.style.left = "0";
    div.style.visibility = "hidden";
    div.style.whiteSpace = "pre-wrap";
    div.style.overflowWrap = "break-word";
    div.style.width = `${ta.clientWidth}px`;
    div.textContent = ta.value.slice(0, pos);
    const marker = document.createElement("span");
    marker.textContent = "|";
    div.appendChild(marker);
    (ta.parentElement ?? document.body).appendChild(div);
    const x = marker.offsetLeft;
    const y = marker.offsetTop - ta.scrollTop;
    div.remove();
    return { x, y };
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function IconBase(
    props: { children: ComponentChildren; class?: string },
) {
    return (
        <svg
            class={props.class ?? "size-4"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            {props.children}
        </svg>
    );
}

function VideoIcon(props: { class?: string }) {
    return (
        <IconBase class={props.class}>
            <rect x="2" y="4" width="20" height="16" rx="3" />
            <path d="m10 9 5 3-5 3z" />
        </IconBase>
    );
}

function FramesIcon(props: { class?: string }) {
    return (
        <IconBase class={props.class}>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M7 4v16M17 4v16" />
        </IconBase>
    );
}

function SparklesIcon(props: { class?: string }) {
    return (
        <IconBase class={props.class}>
            <path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
            <path d="m5 14 .9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9z" />
            <path d="m19 14 .7 1.6 1.6.7-1.6.7L19 19l-.7-1.6-1.6-.7 1.6-.7z" />
        </IconBase>
    );
}

function ChevronIcon(props: { up: boolean }) {
    return (
        <IconBase class="size-3.5">
            {props.up ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}
        </IconBase>
    );
}

function SpeakerIcon() {
    return (
        <IconBase>
            <path d="M11 5 6 9H2v6h4l5 4z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
        </IconBase>
    );
}

function ResetIcon() {
    return (
        <IconBase class="size-3.5">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
        </IconBase>
    );
}

function ArrowUpIcon() {
    return (
        <IconBase class="size-5">
            <path d="M12 19V5m-7 7 7-7 7 7" />
        </IconBase>
    );
}

function CheckIcon() {
    return (
        <IconBase class="size-4 text-indigo-500">
            <path d="M20 6 9 17l-5-5" />
        </IconBase>
    );
}

function MusicIcon(props: { class?: string }) {
    return (
        <IconBase class={props.class}>
            <circle cx="8" cy="18" r="3" />
            <path d="M11 18V5l8-2v12" />
            <circle cx="16" cy="15" r="3" />
        </IconBase>
    );
}
