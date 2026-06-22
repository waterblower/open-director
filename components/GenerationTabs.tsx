import { type Signal } from "@preact/signals";
import type { Tab } from "./GenerationsGrid.tsx";
import { get_text, language } from "@/trpc/client.ts";

const TABS = [
    ["active", "active_generations"],
    ["archived", "archived_generations"],
    ["liked", "liked_generations"],
    ["disliked", "disliked_generations"],
] as const;

export function GenerationTabs(props: { tab: Signal<Tab> }) {
    const { tab } = props;
    return (
        <div class="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-sm">
            {TABS.map(([value, textId]) => (
                <button
                    key={value}
                    type="button"
                    onClick={() => tab.value = value}
                    class={`px-3 py-1.5 ${
                        tab.value === value
                            ? "bg-indigo-500 text-white"
                            : "text-gray-600 hover:bg-gray-50"
                    }`}
                >
                    {get_text(textId, language.value)}
                </button>
            ))}
        </div>
    );
}
