import type { Signal } from "@preact/signals";
import type { Task } from "../seedance.ts";
import { PROJECT_FILE_MIME } from "./dnd.ts";

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

export function ResultsGrid(
    props: {
        generating: Signal<boolean>;
        results: Signal<Task[]>;
        bottomInset: Signal<number>;
    },
) {
    const { generating, results, bottomInset } = props;
    if (!generating.value && results.value.length === 0) return null;

    return (
        <div
            class="absolute inset-0 overflow-y-auto p-3"
            style={{ paddingBottom: `${bottomInset.value}px` }}
        >
            {/* auto-fill keeps items ≥240px wide, collapsing to a single column on narrow screens */}
            <div class="grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-1.5">
                {generating.value && (
                    <div class="relative rounded-xl overflow-hidden bg-gray-900 aspect-video">
                        <div class="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 animate-pulse" />
                        <div class="absolute inset-0 flex items-center justify-center">
                            <span class="size-7 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
                        </div>
                    </div>
                )}
                {results.value.map((task) => {
                    const url = task.content?.video_url;
                    const isPending = task.status === "running" ||
                        task.status === "queued";
                    // Project-relative path, e.g. ".project/vid1.mp4"
                    const rel = url
                        ? decodeURIComponent(
                            url.replace(/^\/project-file\//, ""),
                        )
                        : "";
                    return (
                        <div
                            key={task.id}
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
                                : url
                                ? (
                                    <video
                                        // #t=0.1 forces browsers to paint the first frame as a thumbnail
                                        src={`${url}#t=0.1`}
                                        preload="metadata"
                                        playsInline
                                        controls
                                        // Let the card own the drag, not the native video drag
                                        draggable={false}
                                        // cover fills the thumbnail; contain fits the whole frame in fullscreen
                                        class="w-full aspect-video object-cover [&:fullscreen]:object-contain"
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
                            <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pt-6 pb-2 flex items-center gap-1.5 pointer-events-none">
                                <VideoIcon class="size-3.5 text-white/60 shrink-0" />
                                <span class="text-white/90 text-[11px] leading-tight truncate">
                                    {task.id}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
