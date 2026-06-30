import { Signal, signal, useSignal, useSignalEffect } from "@preact/signals";

import { useEffect, useRef } from "preact/hooks";
import type { CreateTaskRequest } from "../seedance/seedance.ts";
import {
    loadConfig,
    loadProjectData,
    readDir,
    ShowOpenDirectorDir,
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
import { Footbar } from "../components/Footbar.tsx";
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

    // Load machine-level config (e.g. whether to show `.open-director`) once on
    // mount, so the first project listing is filtered with the saved choice.
    useEffect(() => {
        loadConfig();
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

    // Re-fetch the project listing when the `.open-director` visibility toggles
    // (the filter is applied at fetch time). The ref guard skips the initial
    // run so we don't reload before a project is even open.
    const showOpenDirInit = useRef(false);
    useSignalEffect(() => {
        const _show = ShowOpenDirectorDir.value; // subscribe to changes
        if (!showOpenDirInit.current) {
            showOpenDirInit.current = true;
            return;
        }
        (async () => {
            // `.peek()` reads without subscribing: this effect must depend on
            // `ShowOpenDirectorDir` ONLY. Reading `projectData.value` here would
            // subscribe it to `projectData`, and since it also *writes*
            // `projectData.value` below, that would self-trigger an infinite
            // reload loop (loadProjectData firing "like crazy").
            if (!projectData.peek()) return;
            const data = await loadProjectData();
            if (data instanceof Error) {
                console.error(data);
                return;
            }
            if (data) projectData.value = data;
        })();
    });

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
            const vids = await trpc.open.listGeneratedVideos.query({
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
                        projectRoot={projectData.value?.rootPath ?? null}
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
