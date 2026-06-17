import {
    type Signal,
    useComputed,
    useSignal,
    useSignalEffect,
} from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { PROJECT_FILE_MIME } from "./dnd.ts";
import type {
    AspectRatio,
    ContentItem,
    CreateTaskRequest,
    SeedanceModel,
} from "../seedance/seedance.ts";
import { trpc } from "../trpc/client.ts";

type AttachmentKind = "image" | "video" | "audio";

type Attachment = {
    id: number;
    kind: AttachmentKind;
    name: string;
    url: string;
};

type Mode = "reference" | "frames";
type Resolution = "480p" | "720p" | "1080p";
type DurationMode = "seconds" | "smart";
type Popover = "model" | "mode" | "settings" | null;

const SEEDANCE_MODELS = [
    {
        value: "doubao-seedance-2-0-260128",
        label: "Seedance 2.0",
        shortLabel: "2.0",
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

const RATIOS = [
    { value: "21:9", w: 18, h: 8 },
    { value: "16:9", w: 16, h: 9 },
    { value: "4:3", w: 13, h: 10 },
    { value: "1:1", w: 11, h: 11 },
    { value: "3:4", w: 10, h: 13 },
    { value: "9:16", w: 9, h: 16 },
    { value: "adaptive", w: 13, h: 10 },
] as const;

const RESOLUTIONS: Resolution[] = ["480p", "720p", "1080p"];

const KIND_LABEL: Record<AttachmentKind, string> = {
    image: "图片",
    video: "视频",
    audio: "音频",
};

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
    model: SeedanceModel;
    mode: Mode;
    ratio: AspectRatio;
    resolution: Resolution;
    durationMode: DurationMode;
    duration: number;
    audio: boolean;
}

/** Read persisted composer state (client only); null if absent/unreadable. */
function loadComposerState(): Partial<ComposerState> | null {
    try {
        const raw = localStorage.getItem(COMPOSER_STATE_KEY);
        return raw ? JSON.parse(raw) as Partial<ComposerState> : null;
    } catch {
        return null;
    }
}

function saveComposerState(state: ComposerState): void {
    try {
        localStorage.setItem(COMPOSER_STATE_KEY, JSON.stringify(state));
    } catch { /* storage unavailable or full — non-fatal */ }
}

function kindOf(file: File): AttachmentKind {
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return "image";
}

function isSeedanceModel(value: unknown): value is SeedanceModel {
    return SEEDANCE_MODELS.some((model) => model.value === value);
}

function getModelOption(value: SeedanceModel) {
    return SEEDANCE_MODELS.find((model) => model.value === value) ??
        SEEDANCE_MODELS[0];
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

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export function Composer(props: {
    genError: Signal<string | null>;
    /** Composer reports its measured height here (used to pad the results grid). */
    composerInset: Signal<number>;
    /** A past generation's request to load in; consumed (cleared) when applied. */
    reusePrompt: Signal<CreateTaskRequest | null>;
}) {
    const { genError, composerInset, reusePrompt } = props;

    const prompt = useSignal("");
    const attachments = useSignal<Attachment[]>([]);
    const model = useSignal<SeedanceModel>("doubao-seedance-2-0-260128");
    const mode = useSignal<Mode>("reference");
    const ratio = useSignal<AspectRatio>("21:9");
    const resolution = useSignal<Resolution>("480p");
    const durationMode = useSignal<DurationMode>("seconds");
    const duration = useSignal(4);
    const audio = useSignal(true);
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
        if (!el) return;
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
            if (isSeedanceModel(saved.model)) model.value = saved.model;
            if (saved.mode) mode.value = saved.mode;
            if (saved.ratio) ratio.value = saved.ratio;
            if (saved.resolution) resolution.value = saved.resolution;
            if (saved.durationMode) durationMode.value = saved.durationMode;
            if (typeof saved.duration === "number") {
                duration.value = saved.duration;
            }
            if (typeof saved.audio === "boolean") audio.value = saved.audio;
        }
        hydrated.current = true;
    }, []);

    useSignalEffect(() => {
        const state: ComposerState = {
            prompt: prompt.value,
            model: model.value,
            mode: mode.value,
            ratio: ratio.value,
            resolution: resolution.value,
            durationMode: durationMode.value,
            duration: duration.value,
            audio: audio.value,
        };
        if (hydrated.current) saveComposerState(state);
    });

    // Replace the composer's content (prompt text + reference media) and
    // generation settings with a past generation's request, as requested by
    // the results grid's reuse button.
    const applyReuse = async (req: CreateTaskRequest) => {
        const content = req.content;
        const text = content
            .filter((c): c is Extract<ContentItem, { type: "text" }> =>
                c.type === "text"
            )
            .map((c) => c.text)
            .join("\n");
        prompt.value = text;
        const ta = promptRef.current;
        if (ta) {
            ta.value = text;
            autoGrow(ta);
        }

        // Settings — mirror how the request was assembled on submit: `duration`
        // is only present in "seconds" mode, omitted in "smart" mode.
        model.value = req.model;
        if (req.ratio) ratio.value = req.ratio;
        if (req.resolution) resolution.value = req.resolution;
        if (typeof req.duration === "number") {
            durationMode.value = "seconds";
            duration.value = req.duration;
        } else {
            durationMode.value = "smart";
        }
        if (typeof req.generate_audio === "boolean") {
            audio.value = req.generate_audio;
        }

        // Reference media is stored as data URLs; rebuild each into a revocable
        // object URL so it behaves like a normally-attached file.
        const media = content
            .map((c) => {
                if (c.type === "image_url") {
                    return { kind: "image" as const, url: c.image_url.url };
                }
                if (c.type === "video_url") {
                    return { kind: "video" as const, url: c.video_url.url };
                }
                if (c.type === "audio_url") {
                    return { kind: "audio" as const, url: c.audio_url.url };
                }
                return null;
            })
            .filter((m): m is { kind: AttachmentKind; url: string } =>
                m !== null
            );

        attachments.value.forEach((a) => URL.revokeObjectURL(a.url));
        attachments.value = await Promise.all(media.map(async (m) => ({
            id: nextId.current++,
            kind: m.kind,
            name: KIND_LABEL[m.kind],
            url: URL.createObjectURL(await (await fetch(m.url)).blob()),
        })));
    };

    useSignalEffect(() => {
        const req = reusePrompt.value;
        if (!req) return;
        reusePrompt.value = null; // consume once
        applyReuse(req).catch((err) => console.error(err));
    });

    // Attachments with their display labels: 图片1, 图片2, 视频1, …
    const labeled = useComputed(() => {
        const counters: Record<AttachmentKind, number> = {
            image: 0,
            video: 0,
            audio: 0,
        };
        return attachments.value.map((a) => ({
            ...a,
            label: `${KIND_LABEL[a.kind]}${++counters[a.kind]}`,
        }));
    });

    const durationLabel = useComputed(() =>
        durationMode.value === "smart" ? "智能" : `${duration.value}秒`
    );

    const selectedModel = useComputed(() => getModelOption(model.value));

    const canSubmit = useComputed(() =>
        prompt.value.trim().length > 0 || attachments.value.length > 0
    );

    const togglePopover = (which: Exclude<Popover, null>) => {
        popover.value = popover.value === which ? null : which;
    };

    const addFiles = (files: FileList | File[] | null) => {
        if (!files) return;
        const added = Array.from(files).map((file) => ({
            id: nextId.current++,
            kind: kindOf(file),
            name: file.name,
            url: URL.createObjectURL(file),
        }));
        attachments.value = [...attachments.value, ...added];
    };

    // Attach an image dragged from the file explorer. The path is project-
    // relative and served at /project-file/<path>; fetch its bytes into a blob:
    // object URL so it behaves like a file attachment (revocable, and the bytes
    // are held client-side for sending on to remote servers).
    const addProjectImage = async (path: string) => {
        const url = "/project-file/" +
            path.split("/").map(encodeURIComponent).join("/");
        const blob = await (await fetch(url)).blob();
        attachments.value = [...attachments.value, {
            id: nextId.current++,
            kind: "image",
            name: path.split("/").pop() ?? path,
            url: URL.createObjectURL(blob),
        }];
    };

    // Accept pasted media (e.g. an image copied from the file explorer).
    const onPaste = (e: ClipboardEvent) => {
        const files = e.clipboardData?.files;
        if (!files || files.length === 0) return; // let text paste through
        const media = Array.from(files).filter((f) =>
            /^(image|video|audio)\//.test(f.type)
        );
        if (media.length === 0) return;
        e.preventDefault();
        addFiles(media);
    };

    // Accept media dragged from the OS (e.g. an image from Finder) or an image
    // dragged from the project file explorer.
    const onDragOver = (e: DragEvent) => {
        const types = e.dataTransfer?.types;
        if (!types) return;
        if (!types.includes("Files") && !types.includes(PROJECT_FILE_MIME)) {
            return; // ignore unrelated internal element drags
        }
        e.preventDefault();
        e.dataTransfer!.dropEffect = "copy";
        dropActive.value = true;
    };

    const onDragLeave = (e: DragEvent) => {
        // Ignore leaves into descendants; only clear when exiting the card.
        if (e.currentTarget === e.target) dropActive.value = false;
    };

    const onDrop = (e: DragEvent) => {
        dropActive.value = false;

        // Image dragged from the file explorer (carries a project path).
        const projectPath = e.dataTransfer?.getData(PROJECT_FILE_MIME);
        if (projectPath) {
            e.preventDefault();
            addProjectImage(projectPath).catch((err) => console.error(err));
            return;
        }

        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const media = Array.from(files).filter((f) =>
            /^(image|video|audio)\//.test(f.type)
        );
        if (media.length === 0) return;
        e.preventDefault();
        addFiles(media);
    };

    const removeAttachment = (id: number) => {
        const target = attachments.value.find((a) => a.id === id);
        if (target) URL.revokeObjectURL(target.url);
        attachments.value = attachments.value.filter((a) => a.id !== id);
    };

    const clearAll = () => {
        attachments.value.forEach((a) => URL.revokeObjectURL(a.url));
        attachments.value = [];
        prompt.value = "";
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
        if (!m || !ta) return;
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
        } else {
            mention.value = null;
        }
    };

    const onPromptKeyDown = (e: KeyboardEvent) => {
        if (!mention.value) return;
        const items = labeled.value;
        if (e.key === "Escape") {
            e.preventDefault();
            mention.value = null;
        } else if (e.key === "ArrowDown" && items.length > 0) {
            e.preventDefault();
            mentionActive.value = (mentionActive.value + 1) % items.length;
        } else if (e.key === "ArrowUp" && items.length > 0) {
            e.preventDefault();
            mentionActive.value = (mentionActive.value + items.length - 1) %
                items.length;
        } else if (e.key === "Enter" && items.length > 0) {
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
                        生成失败：{genError.value}
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
                            <span class="text-[10px]">图片/视频/音频</span>
                        </button>
                        <input
                            ref={fileInput}
                            type="file"
                            multiple
                            accept="image/*,video/*,audio/*"
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
                                        aria-label="移除"
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
                            placeholder="描述你想生成的视频画面，可 @ 引用上传的素材"
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
                                            暂无素材，请先上传
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
                                        选择模型
                                    </div>
                                    {SEEDANCE_MODELS.map((item) => (
                                        <button
                                            key={item.value}
                                            type="button"
                                            onClick={() => {
                                                model.value = item.value;
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
                        <div class="relative">
                            <button
                                type="button"
                                onClick={() => togglePopover("mode")}
                                class="flex items-center gap-1.5 px-3 h-9 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                            >
                                <VideoIcon class="size-4" />
                                {mode.value === "reference"
                                    ? "参考生成"
                                    : "首尾帧"}
                                <ChevronIcon up={popover.value === "mode"} />
                            </button>

                            {popover.value === "mode" && (
                                <div class="absolute left-0 bottom-full mb-2 z-20 w-56 bg-white rounded-xl shadow-xl border border-gray-100 p-2">
                                    <div class="px-3 py-2 text-sm text-gray-400">
                                        选择模式
                                    </div>
                                    {(
                                        [
                                            {
                                                value: "reference",
                                                label: "参考生成",
                                                icon: (
                                                    <VideoIcon class="size-4" />
                                                ),
                                            },
                                            {
                                                value: "frames",
                                                label: "首尾帧",
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
                                                mode.value = item.value;
                                                popover.value = null;
                                            }}
                                            class={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-gray-800 hover:bg-gray-50 ${
                                                mode.value === item.value
                                                    ? "bg-indigo-50 hover:bg-indigo-50"
                                                    : ""
                                            }`}
                                        >
                                            {item.icon}
                                            {item.label}
                                            {mode.value === item.value && (
                                                <span class="ml-auto">
                                                    <CheckIcon />
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Output settings */}
                        <div class="relative">
                            <button
                                type="button"
                                onClick={() => togglePopover("settings")}
                                class="flex items-center h-9 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 divide-x divide-gray-200"
                            >
                                <span class="px-2.5 flex items-center gap-1.5">
                                    {ratio.value}
                                </span>
                                <span class="px-2.5">{resolution.value}</span>
                                <span class="px-2.5">
                                    {durationLabel.value}
                                </span>
                            </button>

                            {popover.value === "settings" && (
                                <div class="absolute left-0 bottom-full mb-2 z-20 w-[560px] bg-white rounded-xl shadow-xl border border-gray-100 p-5">
                                    <div class="text-sm text-gray-500 mb-2">
                                        视频比例
                                    </div>
                                    <div class="grid grid-cols-7 gap-2 mb-5">
                                        {RATIOS.map((r) => (
                                            <button
                                                key={r.value}
                                                type="button"
                                                onClick={() =>
                                                    ratio.value = r.value}
                                                class={`flex flex-col items-center justify-end gap-2 h-16 rounded-lg border text-xs pb-2 ${
                                                    ratio.value === r.value
                                                        ? "border-gray-800 text-gray-900 bg-white"
                                                        : "border-transparent bg-gray-50 text-gray-600 hover:bg-gray-100"
                                                }`}
                                            >
                                                <span
                                                    class={`block rounded-[3px] border-[1.5px] border-current ${
                                                        r.value === "adaptive"
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
                                        分辨率
                                    </div>
                                    <div class="grid grid-cols-3 bg-gray-100 rounded-lg p-1 mb-5">
                                        {RESOLUTIONS.map((res) => (
                                            <button
                                                key={res}
                                                type="button"
                                                onClick={() =>
                                                    resolution.value = res}
                                                class={`h-9 rounded-md text-sm ${
                                                    resolution.value === res
                                                        ? "bg-white shadow text-gray-900 font-medium"
                                                        : "text-gray-500 hover:text-gray-700"
                                                }`}
                                            >
                                                {res}
                                            </button>
                                        ))}
                                    </div>

                                    <div class="text-sm text-gray-500 mb-2">
                                        视频时长
                                    </div>
                                    <div class="grid grid-cols-2 bg-gray-100 rounded-lg p-1 mb-3">
                                        {(
                                            [
                                                {
                                                    value: "seconds",
                                                    label: "按秒数",
                                                },
                                                {
                                                    value: "smart",
                                                    label: "智能时长",
                                                },
                                            ] as const
                                        ).map((dm) => (
                                            <button
                                                key={dm.value}
                                                type="button"
                                                onClick={() =>
                                                    durationMode.value =
                                                        dm.value}
                                                class={`h-9 rounded-md text-sm ${
                                                    durationMode.value ===
                                                            dm.value
                                                        ? "bg-white shadow text-gray-900 font-medium"
                                                        : "text-gray-500 hover:text-gray-700"
                                                }`}
                                            >
                                                {dm.label}
                                            </button>
                                        ))}
                                    </div>
                                    {durationMode.value === "seconds" && (
                                        <div class="flex items-center gap-4 mb-5">
                                            <input
                                                type="range"
                                                min={4}
                                                max={15}
                                                step={1}
                                                value={duration.value}
                                                onInput={(e) =>
                                                    duration.value = Number(
                                                        e.currentTarget.value,
                                                    )}
                                                class="flex-1 accent-indigo-500"
                                            />
                                            <span class="w-16 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-sm text-gray-700 gap-1">
                                                {duration.value}
                                                <span class="text-gray-400">
                                                    秒
                                                </span>
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Audio toggle */}
                        <button
                            type="button"
                            onClick={() => audio.value = !audio.value}
                            class={`flex items-center gap-1.5 px-3 h-9 rounded-lg border text-sm ${
                                audio.value
                                    ? "border-indigo-300 bg-indigo-50 text-indigo-600"
                                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                            }`}
                        >
                            <SpeakerIcon />
                        </button>

                        <div class="flex-1" />

                        <button
                            type="button"
                            onClick={clearAll}
                            class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
                        >
                            <ResetIcon />
                            全部清空
                        </button>

                        {/* Submit */}
                        <button
                            type="button"
                            disabled={!canSubmit.value}
                            class="size-9 rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white flex items-center justify-center ml-1"
                            aria-label="生成"
                            onClick={async () => {
                                genError.value = null;

                                // The server can't read blob: URLs, so
                                // inline each attachment's bytes as a data
                                // URL before sending.
                                const atts = await Promise.all(
                                    attachments.value.map(async (a) => ({
                                        kind: a.kind,
                                        dataUrl: await toDataUrl(a.url),
                                    })),
                                );
                                const gen_p = trpc.generate.mutate({
                                    model: model.value,
                                    prompt: prompt.value.trim(),
                                    attachments: atts,
                                    ratio: ratio.value,
                                    resolution: resolution.value,
                                    durationMode: durationMode.value,
                                    duration: duration.value,
                                    audio: audio.value,
                                });
                                clearAll();
                                const gen = await gen_p;
                                console.log("generating", gen);
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
