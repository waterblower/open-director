import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { Task } from "../seedance.ts";
import { trpc } from "../trpc/client.ts";
import { ResultsGrid } from "../components/ResultsGrid.tsx";
import { FileExplorer } from "../components/FileExplorer.tsx";
import { Composer } from "../components/Composer.tsx";

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------

export default function Seedance() {
    const generating = useSignal(false);
    const genError = useSignal<string | null>(null);
    const generated_videos = useSignal<Task[]>([]);
    const selectedFile = useSignal<string | null>(null);
    // Composer reports its measured height here to pad the results grid.
    const composerInset = useSignal(0);

    // Load videos from the project's .project dir on mount
    useEffect(() => {
        trpc.listProjectVideos.query()
            .then((vids) => generated_videos.value = vids)
            .catch((err) => console.error(err));
    }, []);

    return (
        <div class="relative min-h-screen bg-[#f7f8fa]">
            {/* File explorer sidebar */}
            <FileExplorer selected={selectedFile} />

            {/* Content panel — fills the area to the right of the sidebar */}
            <div class="fixed top-0 right-0 bottom-0 left-60">
                {/* Background grid of generated videos */}
                <ResultsGrid
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
