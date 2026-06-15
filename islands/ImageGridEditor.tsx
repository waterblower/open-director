import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";

export default function ImageGridEditor() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageSrc = useSignal<string | null>(null);
    const cols = useSignal(5);
    const rows = useSignal(6);
    const lineColor = useSignal("#000000");
    const lineWidth = useSignal(2);
    const fileName = useSignal("image");
    const isDragging = useSignal(false);

    function drawGrid(img: HTMLImageElement) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);

        ctx.strokeStyle = lineColor.value;
        ctx.lineWidth = lineWidth.value;

        const cellW = img.naturalWidth / cols.value;
        const cellH = img.naturalHeight / rows.value;

        // vertical lines
        for (let c = 1; c < cols.value; c++) {
            const x = Math.round(c * cellW);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, img.naturalHeight);
            ctx.stroke();
        }

        // horizontal lines
        for (let r = 1; r < rows.value; r++) {
            const y = Math.round(r * cellH);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(img.naturalWidth, y);
            ctx.stroke();
        }
    }

    function redraw() {
        if (!imageSrc.value) return;
        const img = new Image();
        img.onload = () => drawGrid(img);
        img.src = imageSrc.value;
    }

    function loadFile(file: File) {
        if (!file.type.startsWith("image/")) return;
        fileName.value = file.name.replace(/\.[^.]+$/, "");
        const reader = new FileReader();
        reader.onload = (ev) => {
            imageSrc.value = ev.target?.result as string;
            const img = new Image();
            img.onload = () => drawGrid(img);
            img.src = imageSrc.value!;
        };
        reader.readAsDataURL(file);
    }

    function onFileChange(e: Event) {
        const file = (e.currentTarget as HTMLInputElement).files?.[0];
        if (file) loadFile(file);
    }

    function download() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `${fileName.value}_grid.png`;
        a.click();
    }

    return (
        <div
            class={`min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 transition-colors ${
                isDragging.value ? "bg-indigo-50" : ""
            }`}
            onDragOver={(e) => {
                e.preventDefault();
                isDragging.value = true;
            }}
            onDragLeave={(e) => {
                // only clear when leaving the container entirely
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    isDragging.value = false;
                }
            }}
            onDrop={(e) => {
                e.preventDefault();
                isDragging.value = false;
                const file = e.dataTransfer?.files[0];
                if (file) loadFile(file);
            }}
        >
            <h1 class="text-2xl font-semibold text-gray-800 mb-6">
                Image Grid Editor
            </h1>

            {/* Controls */}
            <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex flex-wrap gap-4 items-end mb-6 w-full max-w-2xl">
                {/* File picker */}
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Image
                    </label>
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
                    >
                        Choose file
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        class="hidden"
                        onChange={onFileChange}
                    />
                </div>

                {/* Columns */}
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Columns
                    </label>
                    <input
                        type="number"
                        min={1}
                        max={50}
                        value={cols.value}
                        onInput={(e) => {
                            cols.value = Number(
                                (e.currentTarget as HTMLInputElement).value,
                            ) || 1;
                            redraw();
                        }}
                        class="w-20 px-3 py-2 rounded-lg border border-gray-300 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                </div>

                {/* Rows */}
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Rows
                    </label>
                    <input
                        type="number"
                        min={1}
                        max={50}
                        value={rows.value}
                        onInput={(e) => {
                            rows.value = Number(
                                (e.currentTarget as HTMLInputElement).value,
                            ) || 1;
                            redraw();
                        }}
                        class="w-20 px-3 py-2 rounded-lg border border-gray-300 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                </div>

                {/* Line colour */}
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Line color
                    </label>
                    <input
                        type="color"
                        value={lineColor.value}
                        onInput={(e) => {
                            lineColor.value =
                                (e.currentTarget as HTMLInputElement).value;
                            redraw();
                        }}
                        class="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer p-0.5"
                    />
                </div>

                {/* Line width */}
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Line width
                    </label>
                    <input
                        type="number"
                        min={1}
                        max={20}
                        value={lineWidth.value}
                        onInput={(e) => {
                            lineWidth.value = Number(
                                (e.currentTarget as HTMLInputElement).value,
                            ) || 1;
                            redraw();
                        }}
                        class="w-20 px-3 py-2 rounded-lg border border-gray-300 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                </div>

                {/* Download */}
                <button
                    type="button"
                    onClick={download}
                    disabled={!imageSrc.value}
                    class="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors ml-auto"
                >
                    Download
                </button>
            </div>

            {/* Canvas preview */}
            {imageSrc.value
                ? (
                    <div class="w-full max-w-4xl rounded-2xl overflow-hidden shadow border border-gray-200">
                        <canvas
                            ref={canvasRef}
                            class="w-full h-auto block"
                        />
                    </div>
                )
                : (
                    <div
                        class="w-full max-w-4xl rounded-2xl border-2 border-dashed border-gray-300 bg-white flex flex-col items-center justify-center gap-3 py-24 cursor-pointer hover:border-indigo-400 transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <svg
                            class="size-10 text-gray-400"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                        >
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="m21 15-5-5L5 21" />
                        </svg>
                        <span class="text-sm text-gray-500">
                            Click to select an image, or drag one here
                        </span>
                    </div>
                )}
        </div>
    );
}
