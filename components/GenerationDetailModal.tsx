import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { CreateTaskRequest } from "../seedance/seedance.ts";
import { estimateCost } from "../seedance/pricing.ts";
import { get_text, Language, language, trpc } from "../trpc/client.ts";
import {
    DislikeIcon,
    type GeneratedVideo,
    LikeIcon,
    type Reaction,
} from "./GenerationCard.tsx";

/** The full generation row returned by the details endpoint. */
export type GenerationDetail = Awaited<
    ReturnType<typeof trpc.open.getGenerationDetail.query>
>;

/** Human-readable elapsed time, e.g. "1m 23s" or "12s". */
function formatDuration(seconds: number, lang: Language): string {
    const s = Math.max(0, Math.round(seconds));
    const sUnit = get_text("s_unit", lang);
    if (s < 60) return `${s}${sUnit}`;
    const m = Math.floor(s / 60);
    return `${m}${get_text("m_unit", lang)}${s % 60}${sUnit}`;
}

/** Concatenated text of the prompt's text content items. */
function promptText(req: CreateTaskRequest | null | undefined): string {
    if (!req) return "";
    return req.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
}

export function GenerationDetailModal(props: {
    projectRoot: string;
    generation: GeneratedVideo;
    detail: GenerationDetail | null;
    loading: boolean;
    onClose: () => void;
}) {
    const { generation, detail, loading, onClose, projectRoot } = props;

    const savedReaction = useSignal<Reaction | null>(
        generation.reaction ?? null,
    );
    const savedReason = useSignal(generation.reason ?? "");
    // Reason editor: set when the user picks a new (or switched) reaction.
    const pendingReaction = useSignal<Reaction | null>(null);
    const reasonText = useSignal("");
    const reactionBusy = useSignal(false);
    const reactionRevision = useRef(0);

    // The file-explorer entry point does not carry reaction data in its grid
    // item, so fetch the persisted value while using the prop as an immediate
    // initial value. The revision prevents a late fetch from overwriting a
    // reaction the user just submitted in this modal.
    useEffect(() => {
        const revision = ++reactionRevision.current;
        savedReaction.value = generation.reaction ?? null;
        savedReason.value = generation.reason ?? "";
        trpc.open.getGenerationReaction.query({
            project_root: projectRoot,
            id: generation.id,
        }).then((stored) => {
            if (reactionRevision.current !== revision) return;
            savedReaction.value = stored?.reaction ?? null;
            savedReason.value = stored?.reason ?? "";
        }).catch((err) => console.error(err));
        return () => {
            reactionRevision.current++;
        };
    }, [generation.id, generation.reaction, generation.reason, projectRoot]);

    const onReact = async (
        gen: GeneratedVideo,
        nextReaction: Reaction,
        nextReason: string,
        projectRoot: string,
    ) => {
        await trpc.open.setGenerationReaction.mutate({
            project_root: projectRoot,
            id: gen.id,
            reaction: nextReaction,
            reason: nextReason,
        });
        reactionRevision.current++;
        savedReaction.value = nextReaction;
        savedReason.value = nextReason;
        return { reaction: nextReaction, reason: nextReason };
    };
    const onClearReaction = async (
        gen: GeneratedVideo,
        projectRoot: string,
    ) => {
        await trpc.open.clearGenerationReaction.mutate({
            project_root: projectRoot,
            id: gen.id,
        });
        reactionRevision.current++;
        savedReaction.value = null;
        savedReason.value = "";
    };

    // Close on Escape, like a native dialog.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        globalThis.addEventListener("keydown", onKeyDown);
        return () => globalThis.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const pickReaction = (reaction: Reaction) => {
        if (savedReaction.value === reaction) {
            if (reactionBusy.value) return;
            reactionBusy.value = true;
            onClearReaction(generation, projectRoot)
                .catch((err) => console.error(err))
                .finally(() => reactionBusy.value = false);
            return;
        }
        reasonText.value = "";
        pendingReaction.value = reaction;
    };

    const confirmReaction = async () => {
        if (!pendingReaction.value || reactionBusy.value) return;
        reactionBusy.value = true;
        try {
            await onReact(
                generation,
                pendingReaction.value,
                reasonText.value.trim(),
                projectRoot,
            );
            pendingReaction.value = null;
        } catch (err) {
            console.error(err);
        } finally {
            reactionBusy.value = false;
        }
    };

    const url = generation.url;
    const req = detail?.request_json ?? null;
    const task = detail?.task_json ?? null;

    // created_at / updated_at are unix seconds; their gap is the time spent
    // queued + running on the server.
    const elapsed = task?.created_at != null && task.updated_at != null
        ? task.updated_at - task.created_at
        : null;

    const totalTokens = task?.usage?.total_tokens ?? null;
    const completionTokens = task?.usage?.completion_tokens ?? null;
    const cost = totalTokens != null && req
        ? estimateCost(totalTokens, req)
        : null;

    const prompt = promptText(req);

    // Reference inputs attached to the request, with their (servable
    // /project-file or data:) URLs, in prompt order.
    type Reference = { kind: "image" | "video" | "audio"; url: string };
    const references = (req?.content ?? []).flatMap((c): Reference[] => {
        if (c.type === "image_url") {
            return [{ kind: "image", url: c.image_url.url }];
        }
        if (c.type === "video_url") {
            return [{ kind: "video", url: c.video_url.url }];
        }
        if (c.type === "audio_url") {
            return [{ kind: "audio", url: c.audio_url.url }];
        }
        return [];
    });

    return (
        <div
            // Sits above the grid; click the backdrop (but not the card body)
            // to dismiss. Stop drag/click bubbling back to the draggable card.
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 cursor-default"
            draggable={false}
            onClick={(e) => {
                e.stopPropagation();
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                class="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-gray-900 text-gray-100 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    aria-label={get_text("close", language.value)}
                    onClick={onClose}
                    class="absolute top-3 right-3 z-10 size-8 rounded-full bg-black/50 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur-sm hover:cursor-pointer transition-colors"
                >
                    <CloseIcon class="size-4" />
                </button>

                {/* Bigger video player */}
                {url
                    ? (
                        <video
                            src={url}
                            controls
                            playsInline
                            class="w-full max-h-[55vh] bg-black rounded-t-2xl object-contain"
                        />
                    )
                    : (
                        <div class="w-full aspect-video flex items-center justify-center bg-black rounded-t-2xl text-gray-600">
                            <VideoIcon class="size-10" />
                        </div>
                    )}

                <div class="p-5 space-y-5">
                    <div class="space-y-1">
                        {
                            /* `generation.id` (from the grid/file-explorer caller)
                        is whichever id that caller had on hand — often the
                        Seedance task id, not the generation's own ULID — so
                        it's only safe to label precisely once `detail` (the
                        actual DB row) has loaded. */
                        }
                        {detail
                            ? (
                                <>
                                    <IdRow
                                        icon
                                        label={get_text(
                                            "generation_id",
                                            language.value,
                                        )}
                                        value={detail.id}
                                    />
                                    {detail.task_id && (
                                        <IdRow
                                            label={get_text(
                                                "task_id",
                                                language.value,
                                            )}
                                            value={detail.task_id}
                                        />
                                    )}
                                </>
                            )
                            : (
                                <IdRow
                                    icon
                                    label={get_text("id", language.value)}
                                    value={generation.id}
                                />
                            )}
                    </div>

                    {generation.failed_reason && (
                        <div class="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300 [overflow-wrap:anywhere]">
                            {generation.failed_reason}
                        </div>
                    )}

                    {loading
                        ? (
                            <div class="flex items-center gap-2 text-sm text-gray-400">
                                <span class="size-4 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
                                {get_text("loading_details", language.value)}
                            </div>
                        )
                        : !detail
                        ? (
                            <div class="text-sm text-gray-500">
                                {get_text("no_saved_details", language.value)}
                            </div>
                        )
                        : (
                            <>
                                {/* Stats: time spent + token / cost usage */}
                                <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    <Stat
                                        label={get_text(
                                            "elapsed",
                                            language.value,
                                        )}
                                        value={elapsed != null
                                            ? formatDuration(
                                                elapsed,
                                                language.value,
                                            )
                                            : "—"}
                                    />
                                    <Stat
                                        label="Tokens"
                                        value={totalTokens != null
                                            ? totalTokens.toLocaleString()
                                            : "—"}
                                        hint={completionTokens != null
                                            ? `${
                                                get_text(
                                                    "generated",
                                                    language.value,
                                                )
                                            } ${completionTokens.toLocaleString()}`
                                            : undefined}
                                    />
                                    <Stat
                                        label={get_text(
                                            "estimated_cost",
                                            language.value,
                                        )}
                                        value={cost != null
                                            ? `¥${cost.rmb.toFixed(2)}`
                                            : "—"}
                                        hint={cost != null
                                            ? `≈ $${cost.usd.toFixed(2)}`
                                            : undefined}
                                    />
                                </div>

                                {/* Prompt */}
                                <div>
                                    <div class="flex items-center gap-1.5 mb-1.5">
                                        <div class="text-xs font-medium text-gray-400">
                                            {get_text(
                                                "prompt",
                                                language.value,
                                            )}
                                        </div>
                                        {prompt && (
                                            <CopyButton
                                                value={prompt}
                                            />
                                        )}
                                    </div>
                                    {prompt
                                        ? (
                                            <div class="rounded-lg bg-gray-800/70 p-3 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                                                {prompt}
                                            </div>
                                        )
                                        : (
                                            <div class="text-sm text-gray-500">
                                                {get_text(
                                                    "no_text_prompt",
                                                    language.value,
                                                )}
                                            </div>
                                        )}
                                    {references.length > 0 && (
                                        <div class="mt-3">
                                            <div class="text-xs font-medium text-gray-400 mb-1.5">
                                                {get_text(
                                                    "reference_inputs",
                                                    language.value,
                                                )}
                                            </div>
                                            <div class="flex flex-wrap gap-2">
                                                {references.map((ref, i) =>
                                                    ref.kind === "audio"
                                                        ? (
                                                            <audio
                                                                key={i}
                                                                src={ref.url}
                                                                controls
                                                                class="h-9 w-56 max-w-full"
                                                            />
                                                        )
                                                        : (
                                                            <a
                                                                key={i}
                                                                href={ref.url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                class="block size-24 rounded-lg overflow-hidden bg-black/40 ring-1 ring-white/10 hover:ring-indigo-400 hover:cursor-pointer transition"
                                                            >
                                                                {ref.kind ===
                                                                        "video"
                                                                    ? (
                                                                        <video
                                                                            src={ref
                                                                                .url}
                                                                            muted
                                                                            playsInline
                                                                            preload="metadata"
                                                                            class="size-full object-cover"
                                                                        />
                                                                    )
                                                                    : (
                                                                        <img
                                                                            src={ref
                                                                                .url}
                                                                            alt={get_text(
                                                                                "reference_image",
                                                                                language
                                                                                    .value,
                                                                            )}
                                                                            loading="lazy"
                                                                            class="size-full object-cover"
                                                                        />
                                                                    )}
                                                            </a>
                                                        )
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Settings */}
                                {req && (
                                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <Stat
                                            label={get_text(
                                                "model",
                                                language.value,
                                            )}
                                            value={req.model}
                                        />
                                        {req.resolution && (
                                            <Stat
                                                label={get_text(
                                                    "resolution",
                                                    language.value,
                                                )}
                                                value={req.resolution}
                                            />
                                        )}
                                        {req.ratio && (
                                            <Stat
                                                label={get_text(
                                                    "aspect_ratio",
                                                    language.value,
                                                )}
                                                value={req.ratio}
                                            />
                                        )}
                                        {req.duration != null && (
                                            <Stat
                                                label={get_text(
                                                    "duration",
                                                    language.value,
                                                )}
                                                value={`${req.duration}${
                                                    get_text(
                                                        "s_unit",
                                                        language.value,
                                                    )
                                                }`}
                                            />
                                        )}
                                        {req.generate_audio != null && (
                                            <Stat
                                                label={get_text(
                                                    "audio",
                                                    language.value,
                                                )}
                                                value={req.generate_audio
                                                    ? get_text(
                                                        "on",
                                                        language.value,
                                                    )
                                                    : get_text(
                                                        "off",
                                                        language.value,
                                                    )}
                                            />
                                        )}
                                        {req.seed != null && req.seed >= 0 && (
                                            <Stat
                                                label={get_text(
                                                    "seed",
                                                    language.value,
                                                )}
                                                value={String(req.seed)}
                                            />
                                        )}
                                    </div>
                                )}

                                <p class="text-[11px] text-gray-500">
                                    {get_text(
                                        "cost_disclaimer",
                                        language.value,
                                    )}
                                </p>
                            </>
                        )}

                    {/* Reaction: like/dislike + an always-visible reason. */}
                    <div>
                        <div class="flex items-center gap-2 mb-1.5">
                            <button
                                type="button"
                                disabled={reactionBusy.value}
                                onClick={() => pickReaction("liked")}
                                class={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50 ${
                                    savedReaction.value === "liked"
                                        ? "bg-indigo-500 text-white"
                                        : "bg-gray-800/70 text-gray-300 hover:bg-gray-800"
                                }`}
                            >
                                <LikeIcon
                                    class="size-4"
                                    filled={savedReaction.value === "liked"}
                                />
                                {get_text(
                                    savedReaction.value === "liked"
                                        ? "remove_like"
                                        : "like",
                                    language.value,
                                )}
                            </button>
                            <button
                                type="button"
                                disabled={reactionBusy.value}
                                onClick={() => pickReaction("disliked")}
                                class={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50 ${
                                    savedReaction.value === "disliked"
                                        ? "bg-indigo-500 text-white"
                                        : "bg-gray-800/70 text-gray-300 hover:bg-gray-800"
                                }`}
                            >
                                <DislikeIcon
                                    class="size-4"
                                    filled={savedReaction.value === "disliked"}
                                />
                                {get_text(
                                    savedReaction.value === "disliked"
                                        ? "remove_dislike"
                                        : "dislike",
                                    language.value,
                                )}
                            </button>
                        </div>
                        <div class="text-[11px] text-gray-400 mb-1.5">
                            {get_text("reaction_reason", language.value)}
                        </div>
                        <div class="min-h-11 whitespace-pre-wrap rounded-lg bg-gray-800/70 p-3 text-sm text-gray-300 [overflow-wrap:anywhere]">
                            {savedReason.value}
                        </div>
                    </div>
                </div>
            </div>
            {pendingReaction.value && (
                <div
                    class="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (e.target === e.currentTarget) {
                            pendingReaction.value = null;
                        }
                    }}
                >
                    <div
                        class="w-full max-w-sm rounded-xl bg-white p-4 space-y-3"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div class="text-sm font-medium text-gray-800">
                            {get_text(
                                pendingReaction.value === "liked"
                                    ? "why_do_you_like_it"
                                    : "why_do_you_dislike_it",
                                language.value,
                            )}
                        </div>
                        <textarea
                            value={reasonText.value}
                            onInput={(e) =>
                                reasonText.value = e.currentTarget.value}
                            rows={3}
                            class="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                        <div class="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => pendingReaction.value = null}
                                class="px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                            >
                                {get_text("cancel", language.value)}
                            </button>
                            <button
                                type="button"
                                disabled={reactionBusy.value}
                                onClick={confirmReaction}
                                class="px-3 py-1.5 rounded-lg text-sm text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50"
                            >
                                {get_text(
                                    pendingReaction.value === "liked"
                                        ? "like"
                                        : "dislike",
                                    language.value,
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** A labeled, monospaced id value with a copy button. `icon` shows the video
 * glyph in place of the leading spacer, for the first row of a group. */
function IdRow(props: { label: string; value: string; icon?: boolean }) {
    return (
        <div class="flex items-center gap-2 text-sm text-gray-400 [overflow-wrap:anywhere]">
            {props.icon
                ? <VideoIcon class="size-4 shrink-0" />
                : <span class="size-4 shrink-0" />}
            <span>{props.label}:</span>
            <span class="font-mono text-gray-200">{props.value}</span>
            <CopyButton value={props.value} />
        </div>
    );
}

/** Small icon button that copies `value` to the clipboard, with a brief
 * "copied" confirmation in place of the copy icon. */
function CopyButton(props: { value: string }) {
    const copied = useSignal(false);

    const copy = async (e: MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(props.value);
            copied.value = true;
            setTimeout(() => copied.value = false, 1500);
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <button
            type="button"
            onClick={copy}
            aria-label={get_text("copy", language.value)}
            title={copied.value
                ? get_text("copied", language.value)
                : get_text("copy", language.value)}
            class="shrink-0 size-5 rounded flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 hover:cursor-pointer transition-colors"
        >
            {copied.value
                ? <CheckIcon class="size-3.5 text-emerald-400" />
                : <CopyIcon class="size-3.5" />}
        </button>
    );
}

function Stat(props: { label: string; value: string; hint?: string }) {
    return (
        <div class="rounded-lg bg-gray-800/70 px-3 py-2">
            <div class="text-[11px] text-gray-400">{props.label}</div>
            <div class="text-sm font-medium [overflow-wrap:anywhere]">
                {props.value}
            </div>
            {props.hint && (
                <div class="text-[11px] text-gray-500 mt-0.5">{props.hint}</div>
            )}
        </div>
    );
}

function VideoIcon(props: { class?: string }) {
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
            <rect x="2" y="4" width="20" height="16" rx="3" />
            <path d="m10 9 5 3-5 3z" />
        </svg>
    );
}

function CopyIcon(props: { class?: string }) {
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
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}

function CheckIcon(props: { class?: string }) {
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
            <path d="M20 6 9 17l-5-5" />
        </svg>
    );
}

function CloseIcon(props: { class?: string }) {
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
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    );
}
