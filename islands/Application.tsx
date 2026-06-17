import { Signal, useSignal, useSignalEffect } from "@preact/signals";

import { useEffect, useRef } from "preact/hooks";
import type { CreateTaskRequest } from "../seedance/seedance.ts";
import { loadProjectData, readDir, trpc } from "../trpc/client.ts";
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
                        createdAt: gen.created_at,
                        url: get_video_url(gen.task_id!),
                        hasRequest: gen.request_json != null,
                    });
                    generated_videos.value = next;
                } else if (event.type == "generation_created") {
                    const { gen } = event;
                    addGenerations(generated_videos, {
                        id: gen.id,
                        status: "running",
                        createdAt: gen.created_at,
                        hasRequest: gen.request_json != null,
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

            {/* Bottom bar */}
            <div class="flex-none flex items-center gap-1 px-3 py-1.5 border-t border-gray-200 bg-white/80 backdrop-blur-sm select-none">
                <a
                    href="/image"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Image Grid Editor"
                    class="group flex items-center gap-1.5 px-2 py-1 rounded-md text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors text-xs font-medium"
                >
                    <GridIcon />
                    <span class="whitespace-nowrap">
                        图片加网格
                    </span>
                </a>
            </div>
        </div>
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
