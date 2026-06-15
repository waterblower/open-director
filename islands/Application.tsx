import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { CreateTaskRequest, Task } from "../seedance.ts";
import { trpc } from "../trpc/client.ts";
import { GenerationsGrid } from "../components/GenerationsGrid.tsx";
import {
    FileExplorer,
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
    const generated_videos = useSignal<
        Awaited<ReturnType<typeof trpc.listGeneratedVideos.query>>
    >([]);
    const selectedFile = useSignal<string | null>(null);
    // A past generation's request (prompt + settings) the grid asks the
    // composer to reuse. The composer consumes (and clears) it.
    const reusePrompt = useSignal<CreateTaskRequest | null>(null);
    // Composer reports its measured height here to pad the results grid.
    const composerInset = useSignal(0);
    const sidebarWidth = useSignal(DEFAULT_SIDEBAR_WIDTH);

    // Ticker subscription — log an auto-incrementing number each second
    useEffect(() => {
        const sub = trpc.ticker.subscribe(undefined, {
            onData: (n) => {
                console.log("tick", n);
                if (n.type == "video_generated") {
                    const { gen } = n;
                    generated_videos.value = [
                        {
                            id: gen.id,
                            status: gen.status,
                            createdAt: gen.created_at,
                            url: get_video_url(gen.task_id!),
                            request: gen.request_json ?? undefined,
                        },
                        ...generated_videos.value,
                    ];
                } else if (n.type == "generation_created") {
                    const { gen } = n;
                    generated_videos.value = [
                        {
                            id: gen.id,
                            status: "running",
                            createdAt: gen.created_at,
                            request: gen.request_json,
                        },
                        ...generated_videos.value,
                    ];
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
            generated_videos.value = vids;
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
        <div class="relative min-h-screen bg-[#f7f8fa]">
            {/* File explorer sidebar */}
            <FileExplorer
                width={sidebarWidth}
                selected={selectedFile}
            />

            {/* Content panel — fills the area to the right of the sidebar */}
            <div
                class="fixed top-0 right-0 bottom-0"
                style={{ left: `${sidebarWidth.value}px` }}
            >
                {/* Background grid of generated videos */}
                <GenerationsGrid
                    generating={generating}
                    results={generated_videos}
                    bottomInset={composerInset}
                    reusePrompt={reusePrompt}
                />

                {/* Floating composer */}
                <Composer
                    genError={genError}
                    composerInset={composerInset}
                    reusePrompt={reusePrompt}
                />
            </div>
        </div>
    );
}
