import type { Signal } from "@preact/signals";
import type { Task } from "../seedance.ts";

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
                    return (
                        <div
                            key={task.id}
                            class="relative group rounded-xl overflow-hidden bg-gray-900 cursor-pointer"
                        >
                            {url
                                ? (
                                    <video
                                        // #t=0.1 forces browsers to paint the first frame as a thumbnail
                                        src={`${url}#t=0.1`}
                                        preload="metadata"
                                        playsInline
                                        controls
                                        class="w-full aspect-video object-cover"
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
