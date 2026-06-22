import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { CreateTaskRequest } from "../seedance/seedance.ts";
import { type GeneratedVideo, GenerationCard } from "./GenerationCard.tsx";
import { GenerationTabs } from "./GenerationTabs.tsx";
import { get_text, language, trpc } from "@/trpc/client.ts";

type SortOrder = "newest" | "oldest";
export type Tab = "active" | "archived" | "liked" | "disliked";

export function GenerationsGrid(
    props: {
        generating: Signal<boolean>;
        results: Signal<Map<string, GeneratedVideo>>;
        bottomInset: Signal<number>;
        /** Set to a generation's request when its reuse button is clicked. */
        reusePrompt: Signal<CreateTaskRequest | null>;
        /** Active project's root path — sent with project-scoped mutations. */
        projectRoot: string | null;
    },
) {
    const { generating, results, bottomInset, reusePrompt, projectRoot } =
        props;
    const order = useSignal<SortOrder>("newest");
    const tab = useSignal<Tab>("active");
    const archivedResults = useSignal<Map<string, GeneratedVideo>>(new Map());
    const archivedLoading = useSignal(false);
    const reactedResults = useSignal<Map<string, GeneratedVideo>>(new Map());
    const reactedLoading = useSignal(false);

    // Fetch the archived list on demand — only while that tab is open, and
    // again whenever the active project changes.
    useEffect(() => {
        if (tab.value !== "archived" || !projectRoot) return;
        let cancelled = false;
        archivedLoading.value = true;
        (async () => {
            try {
                const rows = await trpc.listArchivedGenerations.query({
                    project_root: projectRoot,
                });
                if (!cancelled) {
                    archivedResults.value = new Map(
                        rows.map((v) => [v.id, v]),
                    );
                }
            } catch (err) {
                console.error(err);
            } finally {
                if (!cancelled) archivedLoading.value = false;
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [tab.value, projectRoot]);

    // Same, for the liked/disliked tabs — both draw from the same fetch
    // (the query returns everything with a reaction) and split by `reaction`
    // client-side below.
    useEffect(() => {
        if (
            (tab.value !== "liked" && tab.value !== "disliked") ||
            !projectRoot
        ) {
            return;
        }
        let cancelled = false;
        reactedLoading.value = true;
        (async () => {
            try {
                const rows = await trpc.listReactedGenerations.query({
                    project_root: projectRoot,
                });
                if (!cancelled) {
                    reactedResults.value = new Map(
                        rows.map((v) => [v.id, v]),
                    );
                }
            } catch (err) {
                console.error(err);
            } finally {
                if (!cancelled) reactedLoading.value = false;
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [tab.value, projectRoot]);

    if (results.value.size === 0 && !projectRoot) return null;

    const isReactionTab = tab.value === "liked" || tab.value === "disliked";
    const currentResults = tab.value === "archived"
        ? archivedResults
        : isReactionTab
        ? reactedResults
        : results;

    // The liked/disliked tabs share one fetch (everything with a reaction)
    // and split by `reaction` here.
    const visible = isReactionTab
        ? [...currentResults.value.values()].filter((g) =>
            g.reaction === tab.value
        )
        : [...currentResults.value.values()];

    // created_at is an ISO-8601 UTC string, so it sorts lexicographically.
    // `dir` flips ascending (oldest first) ↔ descending (newest first).
    const dir = order.value === "newest" ? -1 : 1;
    const generations = visible.toSorted((a, b) =>
        dir * a.created_at.localeCompare(b.created_at)
    );

    // Archives or restores a generation: calls the project-scoped mutation,
    // then (only on success) updates the grid's result maps — archiving
    // removes a card from the active list, restoring removes it from the
    // archived list and adds it back to the active list. This is the only
    // place that calls these mutations or mutates the maps.
    const handleArchiveToggle = async (video: GeneratedVideo) => {
        if (!projectRoot) return;
        if (tab.value === "archived") {
            await trpc.unarchiveGeneration.mutate({
                project_root: projectRoot,
                id: video.id,
            });
            const nextArchived = new Map(archivedResults.value);
            nextArchived.delete(video.id);
            archivedResults.value = nextArchived;

            const next = new Map(results.value);
            next.set(video.id, video);
            results.value = next;
        } else {
            await trpc.archiveGeneration.mutate({
                project_root: projectRoot,
                id: video.id,
            });
            const next = new Map(results.value);
            next.delete(video.id);
            results.value = next;
        }
    };

    // Applies a generation update (new reaction, or reaction cleared) to
    // every map it's currently shown in, plus the reacted map (added to it
    // when reacting, removed from it when cleared) — keeping all three tabs
    // consistent without refetching.
    const applyReactionUpdate = (
        video: GeneratedVideo,
        updated: GeneratedVideo,
    ) => {
        for (const map of [results, archivedResults]) {
            if (!map.value.has(video.id)) continue;
            const next = new Map(map.value);
            next.set(video.id, updated);
            map.value = next;
        }
        const nextReacted = new Map(reactedResults.value);
        if (updated.reaction) {
            nextReacted.set(video.id, updated);
        } else {
            nextReacted.delete(video.id);
        }
        reactedResults.value = nextReacted;
    };

    const handleReact = async (
        video: GeneratedVideo,
        reaction: "liked" | "disliked",
        reason?: string,
    ) => {
        if (!projectRoot) return;
        await trpc.setGenerationReaction.mutate({
            project_root: projectRoot,
            id: video.id,
            reaction,
            reason,
        });
        applyReactionUpdate(video, {
            ...video,
            reaction,
            reason: reason ?? null,
        });
    };

    const handleClearReaction = async (video: GeneratedVideo) => {
        if (!projectRoot) return;
        await trpc.clearGenerationReaction.mutate({
            project_root: projectRoot,
            id: video.id,
        });
        applyReactionUpdate(video, {
            ...video,
            reaction: undefined,
            reason: undefined,
        });
    };

    return (
        <div
            class="absolute inset-0 overflow-y-auto p-3"
            style={{ paddingBottom: `${bottomInset.value}px` }}
        >
            <div class="sticky top-0 z-10 flex items-center justify-between gap-2 pb-2">
                <GenerationTabs tab={tab} />

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

            {tab.value === "archived" && !archivedLoading.value &&
                generations.length === 0 && (
                <div class="text-center text-sm text-gray-400 py-10">
                    {get_text("no_archived_generations", language.value)}
                </div>
            )}

            {isReactionTab && !reactedLoading.value &&
                generations.length === 0 && (
                <div class="text-center text-sm text-gray-400 py-10">
                    {get_text(
                        tab.value === "liked"
                            ? "no_liked_generations"
                            : "no_disliked_generations",
                        language.value,
                    )}
                </div>
            )}

            {/* auto-fill keeps items ≥240px wide, collapsing to a single column on narrow screens */}
            <div class="grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-1.5">
                {tab.value === "active" && generating.value && (
                    <div class="relative rounded-xl overflow-hidden bg-gray-900 aspect-video">
                        <div class="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 animate-pulse" />
                        <div class="absolute inset-0 flex items-center justify-center">
                            <span class="size-7 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
                        </div>
                    </div>
                )}
                {projectRoot && generations.map((generation) => (
                    <GenerationCard
                        projectRoot={projectRoot}
                        key={generation.id}
                        generation={generation}
                        reusePrompt={reusePrompt}
                        archived={tab.value === "archived"}
                        onArchiveToggle={handleArchiveToggle}
                        onReact={handleReact}
                        onClearReaction={handleClearReaction}
                    />
                ))}
            </div>
        </div>
    );
}
