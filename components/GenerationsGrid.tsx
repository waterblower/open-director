import type { Signal } from "@preact/signals";
import type { CreateTaskRequest } from "../seedance.ts";
import { trpc } from "../trpc/client.ts";
import { GenerationCard } from "./GenerationCard.tsx";

export function GenerationsGrid(
    props: {
        generating: Signal<boolean>;
        results: Signal<
            Awaited<ReturnType<typeof trpc.listGeneratedVideos.query>>
        >;
        bottomInset: Signal<number>;
        /** Set to a generation's request when its reuse button is clicked. */
        reusePrompt: Signal<CreateTaskRequest | null>;
    },
) {
    const { generating, results, bottomInset, reusePrompt } = props;
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
                {results.value.map((video) => (
                    <GenerationCard
                        key={video.id}
                        video={video}
                        reusePrompt={reusePrompt}
                    />
                ))}
            </div>
        </div>
    );
}
