import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { trpc } from "../trpc/client.ts";
import { PROJECT_FILE_MIME } from "./dnd.ts";

/** Mirrors the `DirEntry` returned by the `listProjectFiles` tRPC query. */
export interface FileEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymlink: boolean;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

function isImageFile(entry: FileEntry): boolean {
    return entry.isFile && IMAGE_EXT.test(entry.name);
}

/** Order entries like the server does: directories first, then alphabetical. */
function sortEntries(entries: FileEntry[]): FileEntry[] {
    return [...entries].sort((a, b) =>
        a.isDirectory === b.isDirectory
            ? a.name.localeCompare(b.name)
            : a.isDirectory
            ? -1
            : 1
    );
}

/** Build the URL that serves a project-relative file. */
function projectFileUrl(rel: string): string {
    return "/project-file/" + rel.split("/").map(encodeURIComponent).join("/");
}

/** localStorage key for the explorer's expanded folders + selection. */
const EXPLORER_STATE_KEY = "fileExplorer.state.v1";

interface ExplorerState {
    expanded: string[];
    selected: string | null;
}

/** Read persisted explorer state (client only); null if absent/unreadable. */
function loadExplorerState(): ExplorerState | null {
    try {
        const raw = localStorage.getItem(EXPLORER_STATE_KEY);
        return raw ? JSON.parse(raw) as ExplorerState : null;
    } catch {
        return null;
    }
}

function saveExplorerState(state: ExplorerState): void {
    try {
        localStorage.setItem(EXPLORER_STATE_KEY, JSON.stringify(state));
    } catch { /* storage unavailable or full — non-fatal */ }
}

/** Re-encode a blob as PNG (clipboard image writes are most portable as PNG). */
function toPngBlob(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) return reject(new Error("no 2d context"));
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(
                (b) => b ? resolve(b) : reject(new Error("toBlob failed")),
                "image/png",
            );
            URL.revokeObjectURL(img.src);
        };
        img.onerror = () => reject(new Error("image load failed"));
        img.src = URL.createObjectURL(blob);
    });
}

/** Fetch an image and return it as a PNG blob, for clipboard writes. */
async function fetchAsPng(url: string): Promise<Blob> {
    const blob = await (await fetch(url)).blob();
    return blob.type === "image/png" ? blob : await toPngBlob(blob);
}

function ChevronIcon(props: { open: boolean }) {
    return (
        <svg
            class={`size-3.5 shrink-0 text-gray-400 transition-transform ${
                props.open ? "rotate-90" : ""
            }`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="m9 6 6 6-6 6" />
        </svg>
    );
}

function FolderIcon() {
    return (
        <svg
            class="size-4 shrink-0 text-amber-500"
            viewBox="0 0 24 24"
            fill="currentColor"
        >
            <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
        </svg>
    );
}

function FileIcon() {
    return (
        <svg
            class="size-4 shrink-0 text-gray-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    );
}

// Shared per-explorer reactive state, threaded down the tree.
interface TreeState {
    /** Loaded children keyed by directory path (relative to project root). */
    childrenByPath: Signal<Record<string, FileEntry[]>>;
    /** Currently expanded directory paths. */
    expanded: Signal<Set<string>>;
    /** Directory paths whose children are being fetched. */
    loading: Signal<Set<string>>;
    selected?: Signal<string | null>;
    /** Directory path currently hovered during a drag (for highlight). */
    dragOver: Signal<string | null>;
    /** Path of the entry being renamed inline, or null. */
    renaming: Signal<string | null>;
}

// Per-explorer callbacks, kept off the reactive `TreeState` data model and
// threaded down the tree alongside it.
interface TreeCallbacks {
    onSelect?: (entry: FileEntry, path: string) => void;
    /** Lazily fetch + cache a directory's children, returning the result. */
    loadChildren: (path: string) => Promise<FileEntry[]>;
    /** Open the right-click context menu for an entry at the cursor. */
    openMenu: (entry: FileEntry, path: string, x: number, y: number) => void;
    /** Copy a dragged project file into the given directory path. */
    dropFile: (src: string, destDir: string) => void;
    /** Commit an inline rename; `name` is the new base name (no slashes). */
    commitRename: (path: string, name: string) => void;
    /** Show (path set) or hide (path null) the image hover preview at x,y. */
    previewImage: (path: string | null, x: number, y: number) => void;
}

/**
 * Inline rename input, shown in place of an entry's row. Focuses on mount and
 * pre-selects the file stem (the name minus its extension) like VS Code does.
 */
function RenameInput(
    props: {
        entry: FileEntry;
        depth: number;
        onCommit: (name: string) => void;
        onCancel: () => void;
    },
) {
    const { entry, depth } = props;
    return (
        <div
            style={{ paddingLeft: `${depth * 14 + 12}px` }}
            class="w-full flex items-center gap-1.5 pr-3 py-1 text-sm"
        >
            <span class="w-3.5 shrink-0" />
            {entry.isDirectory ? <FolderIcon /> : <FileIcon />}
            <input
                type="text"
                value={entry.name}
                ref={(el) => {
                    if (!el) return;
                    el.focus();
                    // Select the stem (before the last dot) for files; for a
                    // dotfile or directory, select the whole name.
                    const dot = entry.isFile ? entry.name.lastIndexOf(".") : -1;
                    el.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        props.onCommit((e.currentTarget as HTMLInputElement)
                            .value.trim());
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        props.onCancel();
                    }
                }}
                onBlur={(e) =>
                    props.onCommit(
                        (e.currentTarget as HTMLInputElement).value.trim(),
                    )}
                class="flex-1 min-w-0 px-1 py-0 text-sm text-gray-800 bg-white border border-indigo-400 rounded outline-none focus:ring-1 focus:ring-indigo-300"
            />
        </div>
    );
}

function Node(
    props: {
        entry: FileEntry;
        path: string;
        depth: number;
        tree: TreeState;
        callbacks: TreeCallbacks;
    },
) {
    const { entry, path, depth, tree, callbacks } = props;
    const isOpen = tree.expanded.value.has(path);
    const isActive = tree.selected?.value === path;
    const isRenaming = tree.renaming.value === path;
    const kids = tree.childrenByPath.value[path];

    const onClick = () => {
        if (tree.selected) tree.selected.value = path;
        callbacks.onSelect?.(entry, path);
        if (!entry.isDirectory) return;

        // Toggle the open state immediately (the chevron rotates either way).
        // The children list only renders once loaded, so an empty dir simply
        // shows nothing under it — no "loading" row that flashes in and out.
        const next = new Set(tree.expanded.value);
        if (next.has(path)) {
            next.delete(path);
        } else {
            next.add(path);
            callbacks.loadChildren(path);
        }
        tree.expanded.value = next;
    };

    return (
        <>
            {isRenaming
                ? (
                    <RenameInput
                        entry={entry}
                        depth={depth}
                        onCommit={(name) => callbacks.commitRename(path, name)}
                        onCancel={() => tree.renaming.value = null}
                    />
                )
                : (
                    <button
                        type="button"
                        onClick={onClick}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            callbacks.openMenu(
                                entry,
                                path,
                                e.clientX,
                                e.clientY,
                            );
                        }}
                        // Image files can be dragged into the composer as a
                        // reference attachment (carries the project path).
                        draggable={isImageFile(entry)}
                        onDragStart={(e) => {
                            e.dataTransfer?.setData(PROJECT_FILE_MIME, path);
                            if (e.dataTransfer) {
                                e.dataTransfer.effectAllowed = "copy";
                            }
                            callbacks.previewImage(null, 0, 0); // hide on drag
                        }}
                        // Image files show a floating thumbnail near the cursor.
                        onMouseMove={isImageFile(entry)
                            ? (e) =>
                                callbacks.previewImage(
                                    path,
                                    e.clientX,
                                    e.clientY,
                                )
                            : undefined}
                        onMouseLeave={isImageFile(entry)
                            ? () => callbacks.previewImage(null, 0, 0)
                            : undefined}
                        // Directories accept dropped videos from the grid.
                        onDragOver={entry.isDirectory
                            ? (e) => {
                                if (
                                    !e.dataTransfer?.types.includes(
                                        PROJECT_FILE_MIME,
                                    )
                                ) {
                                    return;
                                }
                                e.preventDefault();
                                e.stopPropagation(); // don't fall to the root
                                e.dataTransfer.dropEffect = "copy";
                                if (tree.dragOver.value !== path) {
                                    tree.dragOver.value = path;
                                }
                            }
                            : undefined}
                        onDragLeave={entry.isDirectory
                            ? () => {
                                if (tree.dragOver.value === path) {
                                    tree.dragOver.value = null;
                                }
                            }
                            : undefined}
                        onDrop={entry.isDirectory
                            ? (e) => {
                                const src = e.dataTransfer?.getData(
                                    PROJECT_FILE_MIME,
                                );
                                tree.dragOver.value = null;
                                if (!src) return;
                                e.preventDefault();
                                e.stopPropagation(); // handled here, not root
                                callbacks.dropFile(src, path);
                            }
                            : undefined}
                        style={{ paddingLeft: `${depth * 14 + 12}px` }}
                        class={`w-full flex items-center gap-1.5 pr-3 py-1.5 text-left text-sm hover:bg-gray-100 ${
                            tree.dragOver.value === path
                                ? "bg-indigo-100 ring-1 ring-inset ring-indigo-300"
                                : isActive
                                ? "bg-indigo-50 text-indigo-600"
                                : "text-gray-700"
                        }`}
                    >
                        {entry.isDirectory
                            ? <ChevronIcon open={isOpen} />
                            : <span class="w-3.5 shrink-0" />}
                        {entry.isDirectory ? <FolderIcon /> : <FileIcon />}
                        <span class="truncate">{entry.name}</span>
                    </button>
                )}
            {entry.isDirectory && isOpen &&
                kids?.map((child) => (
                    <Node
                        key={child.name}
                        entry={child}
                        path={`${path}/${child.name}`}
                        depth={depth + 1}
                        tree={tree}
                        callbacks={callbacks}
                    />
                ))}
        </>
    );
}

/** Sidebar width bounds, in px. */
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;

/**
 * Build the inline-rename commit handler, closing over the explorer's rename
 * signal, selection signal, and directory-refresh callback.
 */
function commitRename(
    renaming: Signal<string | null>,
    selected: Signal<string | null> | undefined,
    refreshDir: (dir: string) => Promise<void>,
) {
    return async (path: string, name: string) => {
        renaming.value = null;
        const oldName = path.split("/").pop() ?? "";
        // No change (or cleared) — nothing to do.
        if (!name || name === oldName) return;

        const { path: dest } = await trpc.renameFile.mutate({ path, name });
        const slash = path.lastIndexOf("/");
        const parent = slash === -1 ? "" : path.slice(0, slash);
        // Keep the selection on the renamed entry.
        if (selected?.value === path) {
            selected.value = dest;
        }
        await refreshDir(parent);
    };
}

export function FileExplorer(props: {
    /** Sidebar width in px; mutated while dragging the divider. */
    width: Signal<number>;
    selected?: Signal<string | null>;
    onSelect?: (entry: FileEntry, path: string) => void;
}) {
    const { width } = props;
    const root = useSignal<FileEntry[] | null>(null);
    const error = useSignal<string | null>(null);
    const childrenByPath = useSignal<Record<string, FileEntry[]>>({});
    const expanded = useSignal<Set<string>>(new Set());
    const loading = useSignal<Set<string>>(new Set());
    const menu = useSignal<
        { entry: FileEntry; path: string; x: number; y: number } | null
    >(null);
    const preview = useSignal<{ path: string; x: number; y: number } | null>(
        null,
    );
    const dragOver = useSignal<string | null>(null);
    const rootDragOver = useSignal(false);
    const renaming = useSignal<string | null>(null);

    // Fetch the first level when the explorer loads.
    useEffect(() => {
        listProjectFiles().then((res) => {
            if (res instanceof Error) {
                console.error(res);
                error.value = String(res);
                return;
            }
            root.value = res;
        });
    }, []);

    useEffect(() => {
        const sub = trpc.ticker.subscribe(undefined, {
            onData: (n) => {
                console.log("tick", n);
                if (n.type == "fs_changed") {
                    listProjectFiles().then((res) => {
                        if (!(res instanceof Error)) root.value = res;
                    });
                    for (const p of expanded.value) loadChildren(p);
                }
            },
            onError: (err) => console.error("ticker error", err),
        });
        return () => {
            console.log("unsubscribing");
            sub.unsubscribe();
        };
    }, []);

    const loadChildren = async (path: string): Promise<FileEntry[]> => {
        // Re-fetch even when cached so reopening shows the latest state — the
        // stale cache stays rendered until fresh data arrives.
        loading.value = new Set(loading.value).add(path);

        const next = new Set(loading.value);
        next.delete(path);
        loading.value = next;

        const res = await listProjectFiles(path);
        if (res instanceof Error) {
            console.error(res);
            return childrenByPath.value[path] ?? [];
        }
        childrenByPath.value = { ...childrenByPath.value, [path]: res };
        return res;
    };

    // Restore the expanded folders + selection saved last session, then start
    // persisting changes. The `hydrated` gate stops the persist effect from
    // overwriting storage with empty state before the restore runs.
    const hydrated = useRef(false);
    useEffect(() => {
        const saved = loadExplorerState();
        if (saved) {
            if (Array.isArray(saved.expanded)) {
                expanded.value = new Set(saved.expanded);
                // Load each open dir's children so the tree renders expanded.
                for (const p of saved.expanded) loadChildren(p);
            }
            if (saved.selected && props.selected) {
                props.selected.value = saved.selected;
            }
        }
        hydrated.current = true;
    }, []);

    useSignalEffect(() => {
        const state: ExplorerState = {
            expanded: [...expanded.value],
            selected: props.selected?.value ?? null,
        };
        if (hydrated.current) saveExplorerState(state);
    });

    const openInDefault = (path: string) => {
        menu.value = null;
        trpc.openInDefaultApp.mutate(path).catch((err) => console.error(err));
    };

    const copyImage = (path: string) => {
        menu.value = null;
        // Write synchronously within the click gesture (Safari requires this);
        // ClipboardItem accepts a Promise<Blob> so the fetch can resolve later.
        navigator.clipboard.write([
            new ClipboardItem({
                "image/png": fetchAsPng(projectFileUrl(path)),
            }),
        ]).catch((err) => console.error(err));
    };

    /** Look up a loaded entry by its full path. */
    const findEntry = (path: string): FileEntry | undefined => {
        const slash = path.lastIndexOf("/");
        const parent = slash === -1 ? "" : path.slice(0, slash);
        const name = slash === -1 ? path : path.slice(slash + 1);
        const list = parent === ""
            ? root.value ?? []
            : childrenByPath.value[parent] ?? [];
        return list.find((e) => e.name === name);
    };

    // Cmd/Ctrl+C copies the selected image (unless the user is copying text).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "c") {
                return;
            }
            const path = props.selected?.value;
            if (!path) return;

            // Don't hijack copying from inputs or a real text selection.
            const ae = document.activeElement as HTMLElement | null;
            if (
                ae &&
                (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" ||
                    ae.isContentEditable)
            ) return;
            const sel = globalThis.getSelection?.();
            if (sel && !sel.isCollapsed && sel.toString()) return;

            const entry = findEntry(path);
            if (!entry || !isImageFile(entry)) return;
            e.preventDefault();
            copyImage(path);
        };
        globalThis.addEventListener("keydown", onKey);
        return () => globalThis.removeEventListener("keydown", onKey);
    }, []);

    const dropFile = (src: string, destDir: string) => {
        trpc.copyIntoDir.mutate({ src, destDir })
            .then(async ({ dest }) => {
                // The actual (possibly de-duplicated) name the server wrote.
                const name = dest.split("/").pop() ?? "";
                if (destDir === "") {
                    // Root listing is driven by `root`, not childrenByPath.
                    const fresh = await listProjectFiles();
                    if (fresh instanceof Error) {
                        return console.error(fresh);
                    }
                    // Guarantee the new file is visible even if the refresh
                    // didn't pick it up yet.
                    root.value = fresh.some((e) => e.name === name)
                        ? fresh
                        : sortEntries([...fresh, {
                            name,
                            isDirectory: false,
                            isFile: true,
                            isSymlink: false,
                        }]);
                    return;
                }
                // Reveal the copy: expand the target dir and refresh its list.
                expanded.value = new Set(expanded.value).add(destDir);
                loadChildren(destDir);
            })
            .catch((err) => console.error(err));
    };

    /** Refresh a directory's listing (root listing lives in `root`). */
    const refreshDir = async (dir: string) => {
        if (dir === "") {
            const files = await listProjectFiles();
            if (files instanceof Error) {
                return console.error(files);
            }
            root.value = files;
        } else {
            await loadChildren(dir);
        }
    };

    const tree: TreeState = {
        childrenByPath,
        expanded,
        loading,
        selected: props.selected,
        dragOver,
        renaming,
    };

    const callbacks: TreeCallbacks = {
        onSelect: props.onSelect,
        loadChildren,
        openMenu: (entry, path, x, y) => menu.value = { entry, path, x, y },
        dropFile,
        commitRename: commitRename(renaming, props.selected, refreshDir),
        previewImage: (path, x, y) =>
            preview.value = path ? { path, x, y } : null,
    };

    // Drag the right edge to resize; the sidebar starts at x=0 so width = x.
    const onResizeStart = (e: PointerEvent) => {
        e.preventDefault();
        const onMove = (ev: PointerEvent) => {
            width.value = Math.max(
                SIDEBAR_MIN_WIDTH,
                Math.min(ev.clientX, SIDEBAR_MAX_WIDTH),
            );
        };
        const onUp = () => {
            globalThis.removeEventListener("pointermove", onMove);
            globalThis.removeEventListener("pointerup", onUp);
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        };
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
        globalThis.addEventListener("pointermove", onMove);
        globalThis.addEventListener("pointerup", onUp);
    };

    return (
        <>
            <aside
                style={{ width: `${width.value}px` }}
                class="fixed left-0 top-0 bottom-0 z-30 flex flex-col bg-white/95 backdrop-blur border-r border-gray-200"
            >
                <div class="px-4 h-12 flex items-center justify-between gap-2 border-b border-gray-100 shrink-0">
                    <span class="text-sm font-semibold text-gray-800">
                        项目文件
                    </span>
                    <button
                        type="button"
                        title="打开项目根目录"
                        aria-label="打开项目根目录"
                        onClick={() => openInDefault("")}
                        class="-mr-1 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                    >
                        <svg
                            class="size-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
                        </svg>
                    </button>
                </div>
                <div
                    // Dropping on empty space copies into the project root.
                    onDragOver={(e) => {
                        if (
                            !e.dataTransfer?.types.includes(PROJECT_FILE_MIME)
                        ) {
                            return;
                        }
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                        rootDragOver.value = true;
                    }}
                    onDragLeave={(e) => {
                        // Clear only when the pointer actually leaves the
                        // container — not when it moves onto a child row
                        // (whose dragleave bubbles up here with the child as
                        // the event target).
                        const next = e.relatedTarget as Node | null;
                        if (
                            !next ||
                            !(e.currentTarget as HTMLElement).contains(next)
                        ) {
                            rootDragOver.value = false;
                        }
                    }}
                    onDrop={(e) => {
                        rootDragOver.value = false;
                        const src = e.dataTransfer?.getData(PROJECT_FILE_MIME);
                        if (!src) return;
                        e.preventDefault();
                        dropFile(src, ""); // "" = project root
                    }}
                    class={`flex-1 overflow-y-auto py-1.5 ${
                        rootDragOver.value
                            ? "ring-1 ring-inset ring-indigo-300 bg-indigo-50/40"
                            : ""
                    }`}
                >
                    {error.value
                        ? (
                            <div class="px-4 py-3 text-xs text-red-500 break-all">
                                加载失败：{error.value}
                            </div>
                        )
                        : root.value === null
                        ? (
                            <div class="px-4 py-3 text-xs text-gray-400">
                                加载中…
                            </div>
                        )
                        : root.value.length === 0
                        ? (
                            <div class="px-4 py-3 text-xs text-gray-400">
                                暂无文件
                            </div>
                        )
                        : root.value.map((entry) => (
                            <Node
                                key={entry.name}
                                entry={entry}
                                path={entry.name}
                                depth={0}
                                tree={tree}
                                callbacks={callbacks}
                            />
                        ))}
                </div>

                {/* Resize divider */}
                <div
                    onPointerDown={onResizeStart}
                    class="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-indigo-300 active:bg-indigo-400"
                />
            </aside>

            {
                /* Floating image hover preview, offset from the cursor and
                clamped to stay within the viewport. */
            }
            {preview.value && (
                <div
                    class="fixed z-50 pointer-events-none rounded-lg shadow-xl border border-gray-200 bg-white p-1"
                    style={{
                        left: `${
                            Math.min(
                                preview.value.x + 16,
                                globalThis.innerWidth - 208,
                            )
                        }px`,
                        top: `${
                            Math.max(
                                8,
                                Math.min(
                                    preview.value.y + 16,
                                    globalThis.innerHeight - 208,
                                ),
                            )
                        }px`,
                    }}
                >
                    <img
                        src={projectFileUrl(preview.value.path)}
                        alt=""
                        class="block max-w-48 max-h-48 object-contain rounded"
                    />
                </div>
            )}

            {/* Right-click context menu */}
            {menu.value && (
                <>
                    <div
                        class="fixed inset-0 z-40"
                        onClick={() => menu.value = null}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            menu.value = null;
                        }}
                    />
                    <div
                        class="fixed z-50 min-w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1 text-sm"
                        style={{
                            left: `${menu.value.x}px`,
                            top: `${menu.value.y}px`,
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => openInDefault(menu.value!.path)}
                            class="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-100"
                        >
                            用默认程序打开
                        </button>
                        {isImageFile(menu.value.entry) && (
                            <button
                                type="button"
                                onClick={() => copyImage(menu.value!.path)}
                                class="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-100"
                            >
                                复制
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => {
                                renaming.value = menu.value!.path;
                                menu.value = null;
                            }}
                            class="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-100"
                        >
                            重命名
                        </button>
                    </div>
                </>
            )}
        </>
    );
}

async function listProjectFiles(path?: string) {
    /** OS junk files that should never be shown in the explorer. */
    const HIDDEN_NAMES = new Set([".DS_Store"]);

    try {
        const res = await trpc.listProjectFiles.query(path);
        return res.filter((e) => !HIDDEN_NAMES.has(e.name));
    } catch (err) {
        return err as Error;
    }
}
