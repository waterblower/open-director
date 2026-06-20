import { type Signal, useSignal } from "@preact/signals";
import type { CreateTaskRequest } from "../seedance/seedance.ts";
import { PROJECT_FILE_MIME } from "./dnd.ts";
import { get_text, language, trpc } from "../trpc/client.ts";
import {
    type GenerationDetail,
    GenerationDetailModal,
} from "./GenerationDetailModal.tsx";

export type GeneratedVideo = {
    id: string;
    status: string;
    created_at: string;
    /** Whether a reusable create request is stored for this generation. The
     * request itself is fetched on demand when reuse is clicked. */
    has_request: boolean;
    url?: string;
    failed_reason?: string;
};

export function GenerationCard(
    props: {
        generation: GeneratedVideo;
        /** Set to this generation's request when its reuse button is clicked. */
        reusePrompt: Signal<CreateTaskRequest | null>;
        /** Whether this card is shown in the archived tab — swaps the
         * archive button for a restore button. */
        archived: boolean;
        /** Archives or restores this generation (mutation + list bookkeeping
         * both live in the owning grid — this component holds no list state
         * and knows nothing of the backend call). */
        onArchiveToggle: (generation: GeneratedVideo) => Promise<void>;
    },
) {
    const { generation, reusePrompt, archived, onArchiveToggle } = props;
    const url = generation.url;
    const isPending = generation.status === "running" ||
        generation.status === "queued";
    const isFailed = generation.status === "failed";

    // Details modal: null = closed. Fetched on demand when the info button is
    // clicked so the grid payload stays light.
    const detail = useSignal<GenerationDetail | null>(null);
    const detailOpen = useSignal(false);
    const detailLoading = useSignal(false);
    const archiveBusy = useSignal(false);

    const toggleArchive = async () => {
        if (archiveBusy.value) return;
        archiveBusy.value = true;
        try {
            await onArchiveToggle(generation);
        } catch (err) {
            console.error(err);
        } finally {
            archiveBusy.value = false;
        }
    };

    const openDetail = async () => {
        detailOpen.value = true;
        if (detail.value || detailLoading.value) return;
        detailLoading.value = true;
        try {
            detail.value = await trpc.getGenerationDetail.query(generation.id);
        } catch (err) {
            console.error(err);
        } finally {
            detailLoading.value = false;
        }
    };
    // Project-relative path, e.g. ".open-director/vid1.mp4"
    const rel = url
        ? decodeURIComponent(url.replace(/^\/project-file\//, ""))
        : "";

    return (
        <div
            draggable={!!url}
            onDragStart={(e) => {
                if (!url || !e.dataTransfer) return;
                e.dataTransfer.setData(PROJECT_FILE_MIME, rel);
                e.dataTransfer.effectAllowed = "copy";

                // Use a small (~pointer-sized) drag image instead
                // of the browser's full-card snapshot.
                const SIZE = 40;
                const ghost = document.createElement("canvas");
                ghost.width = SIZE;
                ghost.height = SIZE;
                ghost.style.cssText =
                    `position:fixed;top:-9999px;left:-9999px;` +
                    `width:${SIZE}px;height:${SIZE}px;border-radius:8px`;
                const ctx = ghost.getContext("2d");
                const video = (e.currentTarget as HTMLElement)
                    .querySelector("video");
                if (ctx) {
                    ctx.fillStyle = "#111827";
                    ctx.fillRect(0, 0, SIZE, SIZE);
                    if (video && video.readyState >= 2) {
                        // Center-crop the frame into the square.
                        const s = Math.min(
                            video.videoWidth,
                            video.videoHeight,
                        );
                        try {
                            ctx.drawImage(
                                video,
                                (video.videoWidth - s) / 2,
                                (video.videoHeight - s) / 2,
                                s,
                                s,
                                0,
                                0,
                                SIZE,
                                SIZE,
                            );
                        } catch {
                            /* tainted/undecoded — keep bg */
                        }
                    }
                }
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(
                    ghost,
                    SIZE / 2,
                    SIZE / 2,
                );
                // Remove once the browser has snapshotted it.
                setTimeout(() => ghost.remove(), 0);
            }}
            class="relative group rounded-xl overflow-hidden bg-gray-900 cursor-pointer"
        >
            {isPending
                ? (
                    <div class="w-full aspect-video flex items-center justify-center">
                        <span class="size-7 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
                    </div>
                )
                : isFailed
                ? (
                    // Scrollable so the whole reason is readable; pb clears the
                    // bottom id caption. break-anywhere wraps long error codes /
                    // request ids instead of clipping them.
                    <div class="w-full aspect-video overflow-y-auto p-3 pb-7 text-center [overflow-wrap:anywhere]">
                        <div class="text-red-400 text-[11px] font-medium mb-1">
                            {get_text("generation_failed", language.value)}
                        </div>
                        <div class="text-gray-400 text-[11px] leading-snug">
                            {generation.failed_reason ||
                                get_text("unknown_reason", language.value)}
                        </div>
                    </div>
                )
                : url
                ? (
                    <video
                        src={url}
                        preload="metadata"
                        playsInline
                        controls
                        // Let the card own the drag, not the native video drag
                        draggable={false}
                        // cover fills the thumbnail; contain fits the whole frame in fullscreen
                        class="w-full aspect-video object-contain [&:fullscreen]:object-contain"
                        onClick={(e) => {
                            const v = e
                                .currentTarget as HTMLVideoElement;
                            if (v.paused) v.play();
                            else v.pause();
                        }}
                    />
                )
                : (
                    <div class="w-full aspect-video flex items-center justify-center text-gray-600">
                        <VideoIcon class="size-8" />
                    </div>
                )}
            {
                /* Reuse prompt — only when this generation has a
                request (prompt + settings) attached. Custom
                tooltip (vs native `title`) so it appears without
                the browser's ~1s hover delay. */
            }
            {generation.has_request && (
                <div class="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        type="button"
                        aria-label={get_text("reuse_prompt", language.value)}
                        draggable={false}
                        onClick={async (e) => {
                            e.stopPropagation();
                            // Fetch the (potentially large) request only now,
                            // not when the grid loads.
                            try {
                                const req = await trpc.getGenerationRequest
                                    .query(generation.id);
                                if (req) {
                                    reusePrompt.value = req;
                                }
                            } catch (err) {
                                console.error(err);
                            }
                        }}
                        class="peer size-8 rounded-full bg-black/55 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-sm"
                    >
                        <ReuseIcon class="size-4" />
                    </button>
                    <span class="pointer-events-none absolute right-0 top-full mt-1.5 whitespace-nowrap rounded-md bg-gray-900/90 px-2 py-1 text-[11px] text-white opacity-0 peer-hover:opacity-100 transition-opacity">
                        {get_text("reuse_prompt", language.value)}
                    </span>
                </div>
            )}
            {
                /* Top-left group: details (hidden while pending) + archive
                (always available, including stuck/failed generations). */
            }
            <div class="absolute top-2 left-2 z-10 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {!isPending && (
                    <div class="relative">
                        <button
                            type="button"
                            aria-label={get_text(
                                "view_details",
                                language.value,
                            )}
                            draggable={false}
                            onClick={(e) => {
                                e.stopPropagation();
                                // Drop focus so the keyboard focus ring doesn't
                                // reappear on this button when the modal is closed
                                // with Escape.
                                e.currentTarget.blur();
                                openDetail();
                            }}
                            class="peer size-8 rounded-full bg-black/55 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-sm"
                        >
                            <InfoIcon class="size-4" />
                        </button>
                        <span class="pointer-events-none absolute left-0 top-full mt-1.5 whitespace-nowrap rounded-md bg-gray-900/90 px-2 py-1 text-[11px] text-white opacity-0 peer-hover:opacity-100 transition-opacity">
                            {get_text("view_details", language.value)}
                        </span>
                    </div>
                )}
                <div class="relative">
                    <button
                        type="button"
                        aria-label={get_text(
                            archived ? "restore" : "archive",
                            language.value,
                        )}
                        draggable={false}
                        disabled={archiveBusy.value}
                        onClick={(e) => {
                            e.stopPropagation();
                            e.currentTarget.blur();
                            toggleArchive();
                        }}
                        class="peer size-8 rounded-full bg-black/55 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-sm disabled:opacity-50"
                    >
                        {archived
                            ? <RestoreIcon class="size-4" />
                            : <ArchiveIcon class="size-4" />}
                    </button>
                    <span class="pointer-events-none absolute left-0 top-full mt-1.5 whitespace-nowrap rounded-md bg-gray-900/90 px-2 py-1 text-[11px] text-white opacity-0 peer-hover:opacity-100 transition-opacity">
                        {get_text(
                            archived ? "restore" : "archive",
                            language.value,
                        )}
                    </span>
                </div>
            </div>
            <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pt-6 pb-2 flex items-center gap-1.5 pointer-events-none">
                <VideoIcon class="size-3.5 text-white/60 shrink-0" />
                <span class="text-white/90 text-[11px] leading-tight truncate">
                    {generation.id}
                </span>
            </div>
            {detailOpen.value && (
                <GenerationDetailModal
                    generation={generation}
                    detail={detail.value}
                    loading={detailLoading.value}
                    onClose={() => detailOpen.value = false}
                />
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

function ReuseIcon(props: { class?: string }) {
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
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
        </svg>
    );
}

function ArchiveIcon(props: { class?: string }) {
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
            <rect x="3" y="3" width="18" height="5" rx="1" />
            <path d="M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
            <path d="M10 13h4" />
        </svg>
    );
}

function RestoreIcon(props: { class?: string }) {
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
            <path d="M3 3v6h6" />
            <path d="M3.51 12.5a9 9 0 1 0 2.13-9.36L3 9" />
        </svg>
    );
}

function InfoIcon(props: { class?: string }) {
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
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
        </svg>
    );
}
