import { type Signal, useSignal } from "@preact/signals";
import type { CreateTaskRequest } from "../seedance/seedance.ts";
import { type GeneratedVideo, GenerationCard } from "./GenerationCard.tsx";
import { get_text, language } from "@/trpc/client.ts";

type SortOrder = "newest" | "oldest";

export function GenerationsGrid(
    props: {
        generating: Signal<boolean>;
        results: Signal<Map<string, GeneratedVideo>>;
        bottomInset: Signal<number>;
        /** Set to a generation's request when its reuse button is clicked. */
        reusePrompt: Signal<CreateTaskRequest | null>;
    },
) {
    const { generating, results, bottomInset, reusePrompt } = props;
    const order = useSignal<SortOrder>("newest");
    if (results.value.size === 0) return null;

    // created_at is an ISO-8601 UTC string, so it sorts lexicographically.
    // `dir` flips ascending (oldest first) ↔ descending (newest first).
    const dir = order.value === "newest" ? -1 : 1;
    const generations = [...results.value.values()].toSorted((a, b) =>
        dir * a.created_at.localeCompare(b.created_at)
    );

    return (
        <div
            class="absolute inset-0 overflow-y-auto p-3"
            style={{ paddingBottom: `${bottomInset.value}px` }}
        >
            <div class="sticky top-0 z-10 flex justify-end pb-2">
                <div class="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-sm">
                    {(
                        [["newest", "newest_first"], [
                            "oldest",
                            "oldest_first",
                        ]] as const
                    )
                        .map(([value, textId]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => order.value = value}
                                class={`px-3 py-1.5 ${
                                    order.value === value
                                        ? "bg-indigo-500 text-white"
                                        : "text-gray-600 hover:bg-gray-50"
                                }`}
                            >
                                {get_text(textId, language.value)}
                            </button>
                        ))}
                </div>
            </div>

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
                {generations.map((generation) => (
                    <GenerationCard
                        key={generation.id}
                        generation={generation}
                        reusePrompt={reusePrompt}
                    />
                ))}
            </div>
        </div>
    );
}
