import type { Signal } from "@preact/signals";
import type { Task, TextContent } from "../seedance.ts";

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
            class="fixed inset-0 overflow-y-auto p-3"
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
                    const caption = (task.content.find((c): c is TextContent =>
                        c.type === "text"
                    ))?.text ?? task.id;
                    return (
                        <div
                            key={task.id}
                            class="relative group rounded-xl overflow-hidden bg-gray-900 cursor-pointer"
                        >
                            <video
                                src={task.output!.video_url}
                                poster={task.output!.cover_image_url}
                                playsInline
                                preload="none"
                                class="w-full aspect-video object-cover"
                                onMouseEnter={(e) =>
                                    (e.currentTarget as HTMLVideoElement)
                                        .play()}
                                onMouseLeave={(e) => {
                                    const v = e
                                        .currentTarget as HTMLVideoElement;
                                    v.pause();
                                    v.currentTime = 0;
                                }}
                            />
                            <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pt-6 pb-2 flex items-center gap-1.5">
                                <VideoIcon class="size-3.5 text-white/60 shrink-0" />
                                <span class="text-white/90 text-[11px] leading-tight truncate">
                                    {caption}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
