import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";

interface Upload {
    id: number;
    label: string;
    state: "pending" | "ok" | "error";
    progress: number;
    message: string;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Interactive uploader: pick or drag files and POST them to `/filedrop`, which
 * streams each into the host machine's Downloads folder. Shows per-batch
 * progress and result.
 */
export default function FileDrop() {
    const files = useSignal<File[]>([]);
    const dragging = useSignal(false);
    const uploads = useSignal<Upload[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    function patch(id: number, fields: Partial<Upload>) {
        uploads.value = uploads.value.map((u) =>
            u.id === id ? { ...u, ...fields } : u
        );
    }

    function upload() {
        const selected = files.value;
        if (selected.length === 0) return;

        const data = new FormData();
        for (const file of selected) data.append("files", file, file.name);
        const total = selected.reduce((sum, f) => sum + f.size, 0);
        const id = Date.now();
        const count = `${selected.length} file${
            selected.length > 1 ? "s" : ""
        }`;
        uploads.value = [
            {
                id,
                label: `${count} (${formatSize(total)})`,
                state: "pending",
                progress: 0,
                message: "",
            },
            ...uploads.value,
        ];

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/filedrop");
        xhr.upload.addEventListener("progress", (ev) => {
            if (ev.lengthComputable) {
                patch(id, {
                    progress: Math.round((ev.loaded / ev.total) * 100),
                });
            }
        });
        xhr.addEventListener("load", () => {
            let res: { ok?: boolean; error?: string } | null = null;
            try {
                res = JSON.parse(xhr.responseText);
            } catch { /* non-JSON response */ }
            if (res?.ok) {
                patch(id, { state: "ok", progress: 100 });
            } else {
                patch(id, {
                    state: "error",
                    message: res?.error ?? `Failed (${xhr.status})`,
                });
            }
            files.value = [];
            if (inputRef.current) inputRef.current.value = "";
        });
        xhr.addEventListener("error", () => {
            patch(id, { state: "error", message: "Network error" });
        });
        xhr.send(data);
    }

    const label = files.value.length > 0
        ? `${files.value.length} file${
            files.value.length > 1 ? "s" : ""
        } selected`
        : "Tap to choose files";

    return (
        <div>
            <label
                class={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
                    dragging.value
                        ? "border-sky-400 bg-sky-950"
                        : "border-slate-600"
                }`}
                onDragOver={(e) => {
                    e.preventDefault();
                    dragging.value = true;
                }}
                onDragLeave={() => (dragging.value = false)}
                onDrop={(e) => {
                    e.preventDefault();
                    dragging.value = false;
                    if (e.dataTransfer?.files.length) {
                        files.value = Array.from(e.dataTransfer.files);
                    }
                }}
            >
                <span class="text-lg font-semibold text-slate-100">
                    {label}
                </span>
                <span class="text-sm text-slate-400">
                    or drag &amp; drop here
                </span>
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                        files.value = Array.from(e.currentTarget.files ?? []);
                    }}
                />
            </label>

            <button
                type="button"
                class="mt-3 w-full cursor-pointer rounded-xl bg-teal-400 py-3 text-base font-semibold text-teal-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
                disabled={files.value.length === 0}
                onClick={upload}
            >
                Upload
            </button>

            <ul class="mt-3 list-none text-sm">
                {uploads.value.map((u) => (
                    <li
                        key={u.id}
                        class="flex justify-between gap-2 border-b border-slate-700 py-2"
                    >
                        <span class="truncate text-slate-300">{u.label}</span>
                        <span
                            class={u.state === "ok"
                                ? "text-emerald-400"
                                : u.state === "error"
                                ? "text-red-400"
                                : "text-slate-400"}
                        >
                            {u.state === "ok"
                                ? "Saved ✓"
                                : u.state === "error"
                                ? u.message
                                : `${u.progress}%`}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
