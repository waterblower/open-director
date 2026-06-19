import { Signal, signal, useSignal, useSignalEffect } from "@preact/signals";

import { useEffect, useRef } from "preact/hooks";
import type { CreateTaskRequest } from "../seedance/seedance.ts";
import {
    get_text,
    language,
    LANGUAGE_NAMES,
    loadProjectData,
    readDir,
    setLanguage,
    SUPPORTED_LANGUAGES,
    trpc,
} from "../trpc/client.ts";
import { GenerationsGrid } from "../components/GenerationsGrid.tsx";
import type { GeneratedVideo } from "../components/GenerationCard.tsx";
import {
    FileExplorer,
    makeLoadChildren,
    type ProjectData,
    SIDEBAR_MAX_WIDTH,
    SIDEBAR_MIN_WIDTH,
} from "../components/FileExplorer.tsx";
import { Composer } from "../components/Composer.tsx";
import { SettingsModal } from "../components/SettingsModal.tsx";
import { get_video_url } from "../utils.ts";

const SIDEBAR_WIDTH_KEY = "sidebarWidth";
const DEFAULT_SIDEBAR_WIDTH = 240;

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------

export default function Application() {
    const generating = useSignal(false);
    const genError = useSignal<string | null>(null);
    const generated_videos = useSignal<Map<string, GeneratedVideo>>(new Map());
    // A past generation's request (prompt + settings) the grid asks the
    // composer to reuse. The composer consumes (and clears) it.
    const reusePrompt = useSignal<CreateTaskRequest | null>(null);
    // Composer reports its measured height here to pad the results grid.
    const composerInset = useSignal(0);
    const sidebarWidth = useSignal(DEFAULT_SIDEBAR_WIDTH);

    // File Explorer — all project-scoped state lives in a single object that is
    // null until a project is open.
    const projectData = useSignal<ProjectData | null>(null);

    // Settings modal (Seedance API key). Auto-opens on mount when no key is set.
    const settingsOpen = useSignal(false);

    // Ticker subscription — log an auto-incrementing number each second
    useEffect(() => {
        const sub = trpc.backend_events.subscribe(undefined, {
            onData: async (event) => {
                console.log("event", event);
                if (event.type == "generation_finished") {
                    const { gen } = event;
                    const next = new Map(generated_videos.value);
                    next.set(gen.id, {
                        id: gen.id,
                        status: gen.status,
                        created_at: gen.created_at,
                        url: get_video_url(gen.task_id!),
                        has_request: gen.request_json != null,
                    });
                    generated_videos.value = next;
                } else if (event.type == "generation_created") {
                    const { gen } = event;
                    addGenerations(generated_videos, {
                        id: gen.id,
                        status: "running",
                        created_at: gen.created_at,
                        has_request: gen.request_json != null,
                    });
                } else if (event.type == "fs_changed") {
                    const pd = projectData.value;
                    if (!pd) return;
                    // "" = project root (paths are relative to the root).
                    const res = await readDir(pd.rootPath, "");
                    if (res instanceof Error) {
                        console.error(res);
                        return;
                    }
                    projectData.value = {
                        ...projectData.value!,
                        rootEntries: res,
                    };
                    const loadChildren = makeLoadChildren(projectData);
                    for (const p of pd.expanded) {
                        const err = await loadChildren(p);
                        if (err instanceof Error) {
                            console.error(err);
                        }
                    }
                }
            },
            onError: (err) => console.error("ticker error", err),
        });
        return () => {
            console.log("unsubscribing");
            sub.unsubscribe();
        };
    }, []);

    // Prompt for the Seedance API key on mount when none is configured yet.
    useEffect(() => {
        (async () => {
            try {
                const status = await trpc.getApiKeyStatus.query();
                if (!status.hasKey) settingsOpen.value = true;
            } catch (err) {
                console.error(err);
            }
        })();
    }, []);

    // Load the current project (if any) once on mount.
    useEffect(() => {
        (async () => {
            const data = await loadProjectData();
            if (data instanceof Error) {
                console.error(data);
                return;
            }
            if (!data) {
                console.log("no project opened");
                return;
            }
            projectData.value = data;
        })();
    }, []);

    // Reload the generations grid whenever the active project changes: on the
    // initial load and when the user picks a different folder in the file
    // explorer. The ref guard skips other `projectData` mutations (expanding a
    // folder, fs refreshes, …) so we only re-fetch when the root path changes.
    const loadedRoot = useRef<string | null | undefined>(undefined);
    useSignalEffect(() => {
        const root = projectData.value?.rootPath ?? null;
        if (root === loadedRoot.current) return;
        loadedRoot.current = root;
        (async () => {
            if (!root) {
                generated_videos.value = new Map();
                return;
            }
            const vids = await trpc.listGeneratedVideos.query({
                project_root: root,
            });
            generated_videos.value = new Map(vids.map((v) => [v.id, v]));
        })();
    });

    // Restore the saved sidebar width on mount.
    useEffect(() => {
        const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
        if (saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) {
            sidebarWidth.value = saved;
        }
    }, []);

    // Persist the sidebar width whenever it changes.
    useEffect(() => {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value));
    }, [sidebarWidth.value]);

    return (
        <div class="h-screen flex flex-col bg-[#f7f8fa] overflow-hidden">
            {/* Main area: sidebar + content, fills all space above the bottom bar */}
            <div class="flex flex-1 min-h-0 overflow-hidden">
                {/* Left: file explorer sidebar */}
                <FileExplorer
                    width={sidebarWidth}
                    projectData={projectData}
                />

                {/* Right: video grid + floating composer */}
                <div class="flex-1 relative overflow-hidden">
                    <GenerationsGrid
                        generating={generating}
                        results={generated_videos}
                        bottomInset={composerInset}
                        reusePrompt={reusePrompt}
                    />
                    <Composer
                        genError={genError}
                        composerInset={composerInset}
                        reusePrompt={reusePrompt}
                        generated_videos={generated_videos}
                    />
                </div>
            </div>

            <Footbar onOpenSettings={() => settingsOpen.value = true} />

            {settingsOpen.value && (
                <SettingsModal onClose={() => settingsOpen.value = false} />
            )}
        </div>
    );
}

function Footbar(props: { onOpenSettings: () => void }) {
    const languageMenuOpen = useSignal(false);
    const languageMenuRef = useRef<HTMLDivElement>(null);

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
        <div class="flex-none flex items-center gap-1 px-3 py-1.5 border-t border-gray-200 bg-white/80 backdrop-blur-sm select-none">
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

export function updateGenerations(
    generations: Signal<Map<string, GeneratedVideo>>,
    gen: { id: string } & Partial<GeneratedVideo>,
) {
    console.log("updateGenerations", gen);
    const new_generations = new Map(generations.value);
    const existing_gen = new_generations.get(gen.id);
    if (existing_gen) {
        new_generations.set(gen.id, { ...existing_gen, ...gen });
    } else {
        throw new Error(`Generation ${gen.id} not found`);
    }
    generations.value = new_generations;
}

export function addGenerations(
    generations: Signal<Map<string, GeneratedVideo>>,
    gen: GeneratedVideo,
) {
    const new_generations = new Map(generations.value);
    new_generations.set(gen.id, gen);

    generations.value = new_generations;
}
