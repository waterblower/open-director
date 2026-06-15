import { type Signal, useSignal } from "@preact/signals";
import type { CreateTaskRequest } from "../seedance.ts";
import { GenerationCard } from "./GenerationCard.tsx";

type SortOrder = "newest" | "oldest";

export function GenerationsGrid(
    props: {
        generating: Signal<boolean>;
        results: Signal<{
            id: string;
            status: string;
            createdAt: string;
            request?: CreateTaskRequest;
            url?: string;
            failedReason?: string;
        }[]>;
        bottomInset: Signal<number>;
        /** Set to a generation's request when its reuse button is clicked. */
        reusePrompt: Signal<CreateTaskRequest | null>;
    },
) {
    const { generating, results, bottomInset, reusePrompt } = props;
    const order = useSignal<SortOrder>("newest");
    if (results.value.length === 0) return null;

    // createdAt is an ISO-8601 UTC string, so it sorts lexicographically.
    // `dir` flips ascending (oldest first) ↔ descending (newest first).
    const dir = order.value === "newest" ? -1 : 1;
    const generations = results.value.toSorted((a, b) =>
        dir * a.createdAt.localeCompare(b.createdAt)
    );

    return (
        <div
            class="absolute inset-0 overflow-y-auto p-3"
            style={{ paddingBottom: `${bottomInset.value}px` }}
        >
            <div class="sticky top-0 z-10 flex justify-end pb-2">
                <div class="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-sm">
                    {([["newest", "最新在前"], ["oldest", "最早在前"]] as const)
                        .map(([value, label]) => (
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
                                {label}
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
