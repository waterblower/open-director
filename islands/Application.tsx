import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { Task } from "../seedance.ts";
import { trpc } from "../trpc/client.ts";
import { GenerationsGrid } from "../components/GenerationsGrid.tsx";
import {
    FileExplorer,
    SIDEBAR_MAX_WIDTH,
    SIDEBAR_MIN_WIDTH,
} from "../components/FileExplorer.tsx";
import { Composer } from "../components/Composer.tsx";
import { seedance_client } from "../seedance_client.ts";

const SIDEBAR_WIDTH_KEY = "sidebarWidth";
const DEFAULT_SIDEBAR_WIDTH = 240;

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------

export default function Application() {
    const generating = useSignal(false);
    const genError = useSignal<string | null>(null);
    const generated_videos = useSignal<Task[]>([]);
    const selectedFile = useSignal<string | null>(null);
    // Composer reports its measured height here to pad the results grid.
    const composerInset = useSignal(0);
    const sidebarWidth = useSignal(DEFAULT_SIDEBAR_WIDTH);

    // Load videos from the project's .project dir on mount
    useEffect(() => {
        (async () => {
            const vids = await trpc.listProjectVideos.query();
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
            <FileExplorer width={sidebarWidth} selected={selectedFile} />

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
                />

                {/* Floating composer */}
                <Composer
                    generating={generating}
                    genError={genError}
                    generatedVideos={generated_videos}
                    composerInset={composerInset}
                />
            </div>
        </div>
    );
}
