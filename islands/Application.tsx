import { useSignal } from "@preact/signals";

import { useEffect } from "preact/hooks";
import type { CreateTaskRequest, Task } from "../seedance.ts";
import { listProjectFiles, trpc } from "../trpc/client.ts";
import { GenerationsGrid } from "../components/GenerationsGrid.tsx";
import type { GeneratedVideo } from "../components/GenerationCard.tsx";
import {
    FileEntry,
    FileExplorer,
    makeLoadChildren,
    SIDEBAR_MAX_WIDTH,
    SIDEBAR_MIN_WIDTH,
} from "../components/FileExplorer.tsx";
import { Composer } from "../components/Composer.tsx";
import { delay } from "@std/async";
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
    const selectedFile = useSignal<string | null>(null);
    // A past generation's request (prompt + settings) the grid asks the
    // composer to reuse. The composer consumes (and clears) it.
    const reusePrompt = useSignal<CreateTaskRequest | null>(null);
    // Composer reports its measured height here to pad the results grid.
    const composerInset = useSignal(0);
    const sidebarWidth = useSignal(DEFAULT_SIDEBAR_WIDTH);

    // File Explorer
    const projectRootDir = useSignal<FileEntry[] | null>(null);
    const expanded_paths = useSignal<Set<string>>(new Set());
    const childrenByPath = useSignal<Record<string, FileEntry[]>>({});

    // Ticker subscription — log an auto-incrementing number each second
    useEffect(() => {
        const sub = trpc.backend_events.subscribe(undefined, {
            onData: async (n) => {
                console.log("tick", n);
                if (n.type == "video_generated") {
                    const { gen } = n;
                    const next = new Map(generated_videos.value);
                    next.set(gen.id, {
                        id: gen.id,
                        status: gen.status,
                        createdAt: gen.created_at,
                        url: get_video_url(gen.task_id!),
                        request: gen.request_json,
                    });
                    generated_videos.value = next;
                } else if (n.type == "generation_created") {
                    const { gen } = n;
                    const next = new Map(generated_videos.value);
                    next.set(gen.id, {
                        id: gen.id,
                        status: "running",
                        createdAt: gen.created_at,
                        request: gen.request_json,
                    });
                    generated_videos.value = next;
                } else if (n.type == "fs_changed") {
                    const res = await listProjectFiles();
                    if (res instanceof Error) {
                        console.error(res);
                        return;
                    }
                    projectRootDir.value = res;
                    for (const p of expanded_paths.value) {
                        const err = await makeLoadChildren(childrenByPath)(p);
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

    // Load videos from the project's .project dir on mount
    useEffect(() => {
        (async () => {
            const vids = await trpc.listGeneratedVideos.query();
            generated_videos.value = new Map(vids.map((v) => [v.id, v]));
            console.log("generated_videos", vids);
        })();
    }, []);

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
                    selected={selectedFile}
                    root={projectRootDir}
                    expanded={expanded_paths}
                    childrenByPath={childrenByPath}
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
