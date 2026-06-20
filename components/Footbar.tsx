import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
    get_text,
    language,
    LANGUAGE_NAMES,
    setLanguage,
    SUPPORTED_LANGUAGES,
} from "../trpc/client.ts";
import { McpInfoModal } from "./McpInfoModal.tsx";

export function Footbar(props: { onOpenSettings: () => void }) {
    const languageMenuOpen = useSignal(false);
    const languageMenuRef = useRef<HTMLDivElement>(null);
    const mcpInfoOpen = useSignal(false);

    useEffect(() => {
        const onPointerDown = (e: PointerEvent) => {
            if (!languageMenuOpen.value) return;
            const target = e.target as Node | null;
            if (target && languageMenuRef.current?.contains(target)) return;
            languageMenuOpen.value = false;
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") languageMenuOpen.value = false;
        };
        globalThis.addEventListener("pointerdown", onPointerDown);
        globalThis.addEventListener("keydown", onKeyDown);
        return () => {
            globalThis.removeEventListener("pointerdown", onPointerDown);
            globalThis.removeEventListener("keydown", onKeyDown);
        };
    }, []);

    return (
        <>
            <div class="relative z-30 flex-none flex items-center gap-1 px-3 py-1.5 border-t border-gray-200 bg-white/80 backdrop-blur-sm select-none">
                <a
                    href="/image"
                    target="_blank"
                    rel="noopener noreferrer"
                    title={get_text("image_grid_editor", language.value)}
                    class="group flex items-center gap-1.5 px-2 py-1 rounded-md text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors text-xs font-medium"
                >
                    <GridIcon />
                    <span class="whitespace-nowrap">
                        {get_text("image_grid_editor", language.value)}
                    </span>
                </a>

                <div class="flex-1" />

                <button
                    type="button"
                    onClick={() => mcpInfoOpen.value = true}
                    title={get_text("mcp_server", language.value)}
                    class="group flex items-center gap-1.5 px-2 py-1 rounded-md text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 hover:cursor-pointer transition-colors text-xs font-medium"
                >
                    <McpIcon />
                    <span class="whitespace-nowrap">
                        {get_text("mcp_server", language.value)}
                    </span>
                </button>

                <div ref={languageMenuRef} class="relative">
                    <button
                        type="button"
                        title={get_text("language_label", language.value)}
                        aria-haspopup="menu"
                        aria-expanded={languageMenuOpen.value}
                        onClick={() =>
                            languageMenuOpen.value = !languageMenuOpen.value}
                        class="flex items-center gap-1.5 px-2 py-1 rounded-md text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 hover:cursor-pointer transition-colors text-xs font-medium"
                    >
                        <span class="whitespace-nowrap">
                            {LANGUAGE_NAMES[language.value]}
                        </span>
                        <ChevronIcon up={languageMenuOpen.value} />
                    </button>

                    {languageMenuOpen.value && (
                        <div
                            role="menu"
                            class="absolute right-0 bottom-full mb-2 z-50 w-40 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl"
                        >
                            <div class="px-3 py-2 text-xs text-gray-400">
                                {get_text("language_label", language.value)}
                            </div>
                            {SUPPORTED_LANGUAGES.map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={language.value === item}
                                    onClick={() => {
                                        setLanguage(item);
                                        languageMenuOpen.value = false;
                                    }}
                                    class={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-gray-700 hover:bg-gray-50 ${
                                        language.value === item
                                            ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-50"
                                            : ""
                                    }`}
                                >
                                    <span>{LANGUAGE_NAMES[item]}</span>
                                    {language.value === item && <CheckIcon />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={props.onOpenSettings}
                    title={get_text("settings", language.value)}
                    class="group flex items-center gap-1.5 px-2 py-1 rounded-md text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 hover:cursor-pointer transition-colors text-xs font-medium"
                >
                    <SettingsIcon />
                    <span class="whitespace-nowrap">
                        {get_text("settings", language.value)}
                    </span>
                </button>
            </div>

            {
                /* Rendered outside the bar above — that element's
                backdrop-blur-sm establishes the containing block for any
                `position: fixed` descendant, which would otherwise size and
                center this modal against the thin footer bar instead of the
                viewport. */
            }
            {mcpInfoOpen.value && (
                <McpInfoModal onClose={() => mcpInfoOpen.value = false} />
            )}
        </>
    );
}

function SettingsIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function McpIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <rect x="4" y="4" width="7" height="7" rx="1.5" />
            <rect x="13" y="13" width="7" height="7" rx="1.5" />
            <path d="M7.5 11v3a2 2 0 0 0 2 2H13" />
            <path d="M16.5 13v-3a2 2 0 0 0-2-2H11" />
        </svg>
    );
}

function GridIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
        </svg>
    );
}

function ChevronIcon(props: { up: boolean }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            {props.up ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            class="text-indigo-600"
        >
            <path d="M20 6 9 17l-5-5" />
        </svg>
    );
}
