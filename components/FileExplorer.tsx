import { type Signal, signal, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
    get_text,
    language,
    loadProjectData,
    readDir,
    trpc,
} from "../trpc/client.ts";
import { GENERATION_VIDEO_MIME, PROJECT_FILE_MIME } from "@/constants.ts";
import type { GeneratedVideo } from "./GenerationCard.tsx";
import {
    type GenerationDetail,
    GenerationDetailModal,
} from "./GenerationDetailModal.tsx";

/**
 * All file-explorer state that only makes sense once a project is open. When no
 * project is open the whole object is `null`, so entries, expansion and
 * selection can never exist without a root path.
 */
export interface ProjectData {
    /** Absolute path of the project root (display + server calls). */
    rootPath: string;
    /** Entries at the project root. */
    rootEntries: FileEntry[];
    /** Loaded children keyed by directory path (relative to the root). */
    childrenByPath: Record<string, FileEntry[]>;
    /** Currently expanded directory paths. */
    expanded: Set<string>;
    /** Path of the selected entry, or null. */
    selected: string | null;
}

export function FileExplorer(props: {
    /** The open project's data, or null when no project is open. */
    projectData: Signal<ProjectData | null>;
    /** Sidebar width in px; mutated while dragging the divider. */
    width: Signal<number>;
    onSelect?: (entry: FileEntry, path: string) => void;
}) {
    const { width, projectData } = props;
    const error = useSignal<string | null>(null);

    const preview = useSignal<{ path: string; x: number; y: number } | null>(
        null,
    );
    /** Path of the video currently playing in the double-click modal, or null. */
    const videoModal = useSignal<string | null>(null);
    const dragOver = useSignal<string | null>(null);
    const rootDragOver = useSignal(false);

    const menu = useSignal<
        {
            entry: FileEntry;
            path: string;
            x: number;
            y: number;
            /** Generation id matched (by content hash) for this file, or
             * null while unchecked / no match. A nested signal so the lookup
             * can resolve in place without replacing the whole menu object. */
            promptGenerationId: Signal<string | null>;
        } | null
    >(null);
    const promptModal = useSignal<
        { generationId: string; path: string } | null
    >(
        null,
    );
    // Prompt for a name before saving a video dragged in from the grid; the
    // copy only happens once the user confirms it (see `FileNameModal`).
    const nameModal = useSignal<{ src: string; destDir: string } | null>(null);
    // Rename an entry from the right-click menu (modal, not in-place).
    const renameModal = useSignal<{ entry: FileEntry; path: string } | null>(
        null,
    );
    // Confirm before deleting a file/dir from the right-click menu.
    const deleteModal = useSignal<{ entry: FileEntry; path: string } | null>(
        null,
    );

    let projectName: string | undefined = get_text(
        "open_a_project",
        language.value,
    );
    if (projectData.value) {
        projectName = projectData.value.rootPath.replace(/[/\\]+$/, "").split(
            /[/\\]/,
        ).pop();
    }

    // The project root rendered as the tree's top-level folder ("" = root),
    // so it gets the same chevron/context-menu/drop handling as any other
    // folder — no separate "open root in default app" button needed.
    const rootEntry: FileEntry = {
        name: projectName ?? "",
        isDirectory: true,
        isFile: false,
        isSymlink: false,
    };

    const loadChildren = makeLoadChildren(projectData);

    // Persist expanded dirs + selection whenever they change.
    //
    // `persistKey` is a derived signal of just the persisted slice. `useComputed`
    // memoizes by value, so it only takes a new identity on a real expand/select
    // change — not on every `projectData` mutation (children loads, fs refreshes,
    // reloads). The key is order-independent (sorted) so a reloaded `expanded`
    // Set that iterates in a different order doesn't look like a change.
    const persistKey = useComputed(() => {
        const pd = projectData.value;
        if (!pd) return null;
        const state: ExplorerState = {
            expanded: [...pd.expanded].sort(),
            selected: pd.selected,
        };
        return JSON.stringify(state);
    });
    // The save itself is a side effect, so it lives in a plain `useEffect` keyed
    // on the computed value: the component re-renders on every `projectData`
    // change (it reads `projectData.value` in render), but this only fires when
    // `persistKey` actually changes. The `hydrated` gate skips the initial load
    // (set by the parent / by picking a project) so we don't re-write the state
    // we just read back.
    const hydrated = useRef(false);
    useEffect(() => {
        const key = persistKey.value;
        if (key === null) return;
        if (!hydrated.current) {
            hydrated.current = true;
            return;
        }
        trpc.saveExplorerState.mutate(JSON.parse(key) as ExplorerState)
            .catch(console.error);
    }, [persistKey.value]);

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
        const pd = projectData.value;
        if (!pd) return undefined;
        const slash = path.lastIndexOf("/");
        const parent = slash === -1 ? "" : path.slice(0, slash);
        const name = slash === -1 ? path : path.slice(slash + 1);
        const list = parent === ""
            ? pd.rootEntries
            : pd.childrenByPath[parent] ?? [];
        return list.find((e) => e.name === name);
    };

    // Cmd/Ctrl+C copies the selected image (unless the user is copying text).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "c") {
                return;
            }
            const path = projectData.value?.selected;
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

    // Reveal a freshly written file at project-relative path `dest` inside
    // `destDir` ("" = project root): refresh the target listing and, for the
    // root, guarantee the new row shows even if the refresh hasn't caught it.
    const revealCopy = async (dest: string, destDir: string) => {
        const name = dest.split("/").pop() ?? "";
        const pd = projectData.value;
        if (!pd) return;
        if (destDir === "") {
            // Root listing lives in `rootEntries` ("" = project root).
            const fresh = await readDir(pd.rootPath, "");
            if (fresh instanceof Error) {
                return console.error(fresh);
            }
            const rootEntries = fresh.some((e) => e.name === name)
                ? fresh
                : sortEntries([...fresh, {
                    name,
                    isDirectory: false,
                    isFile: true,
                    isSymlink: false,
                }]);
            projectData.value = { ...projectData.value!, rootEntries };
            return;
        }
        // Expand the target dir and refresh its list.
        projectData.value = {
            ...projectData.value!,
            expanded: new Set(projectData.value!.expanded).add(destDir),
        };
        loadChildren(destDir);
    };

    const dropFile = (src: string, destDir: string, name?: string) => {
        trpc.copyIntoDir.mutate({ src, destDir, name })
            .then(({ dest }) => revealCopy(dest, destDir))
            .catch((err) => console.error(err));
    };

    /** Save files dragged in from the OS into `destDir`, then reveal them. */
    const importFiles = async (files: FileList, destDir: string) => {
        for (const file of Array.from(files)) {
            try {
                const dataUrl = await fileToDataUrl(file);
                const { dest } = await trpc.importFile.mutate({
                    destDir,
                    name: file.name,
                    dataUrl,
                });
                await revealCopy(dest, destDir);
            } catch (err) {
                console.error(err);
            }
        }
    };

    // Routes a drop onto a directory (path "" = project root): a grid video
    // asks for a name first, an explorer file copies straight away, and OS
    // files are uploaded as bytes.
    const handleDrop = (e: DragEvent, destDir: string) => {
        const dt = e.dataTransfer;
        if (!dt) return;
        const gridVideo = dt.getData(GENERATION_VIDEO_MIME);
        if (gridVideo) {
            e.preventDefault();
            nameModal.value = { src: gridVideo, destDir };
            return;
        }
        const projectFile = dt.getData(PROJECT_FILE_MIME);
        if (projectFile) {
            e.preventDefault();
            dropFile(projectFile, destDir);
            return;
        }
        if (dt.files && dt.files.length > 0) {
            e.preventDefault();
            importFiles(dt.files, destDir);
        }
    };

    // Rename `path` to base name `name`, keeping the selection on the entry and
    // refreshing its parent listing. A no-op if the name is unchanged or empty.
    const renameEntry = async (path: string, name: string) => {
        const oldName = path.split("/").pop() ?? "";
        if (!name || name === oldName) return;
        const { path: dest } = await trpc.renameFile.mutate({ path, name });
        const slash = path.lastIndexOf("/");
        const parent = slash === -1 ? "" : path.slice(0, slash);
        if (projectData.value?.selected === path) {
            projectData.value = { ...projectData.value, selected: dest };
        }
        await refreshDir(parent);
    };

    const confirmDelete = async () => {
        const target = deleteModal.value;
        deleteModal.value = null;
        if (!target) return;
        try {
            await trpc.deleteFile.mutate({ path: target.path });
        } catch (err) {
            console.error(err);
            return;
        }
        // Drop the selection if it pointed at the deleted entry, then refresh
        // the parent listing so the row disappears.
        const slash = target.path.lastIndexOf("/");
        const parent = slash === -1 ? "" : target.path.slice(0, slash);
        if (projectData.value?.selected === target.path) {
            projectData.value = { ...projectData.value, selected: null };
        }
        await refreshDir(parent);
    };

    /** Refresh a directory's listing (root listing lives in `root`). */
    const refreshDir = async (dir: string) => {
        if (dir === "") {
            const root = projectData.value?.rootPath;
            if (!root) return;
            const files = await readDir(root, ""); // "" = project root
            if (files instanceof Error) {
                return console.error(files);
            }
            if (!projectData.value) return;
            projectData.value = { ...projectData.value, rootEntries: files };
        } else {
            await loadChildren(dir);
        }
    };

    const tree: TreeState = {
        projectData,
        dragOver,
    };

    // Opens the context menu and, for files, checks whether their content
    // matches a recorded generation — the "Prompt details" item only shows up
    // once (if) that check resolves with a match.
    const openMenu = async (
        entry: FileEntry,
        path: string,
        x: number,
        y: number,
    ) => {
        const promptGenerationId = signal<string | null>(null);
        menu.value = { entry, path, x, y, promptGenerationId };
        const root = projectData.value?.rootPath;
        if (!entry.isFile || !root) return;
        try {
            const id = await trpc.getGenerationIdForFile.query({
                project_root: root,
                path,
            });
            // Ignore if the menu has moved on to a different entry by now.
            if (menu.value?.promptGenerationId === promptGenerationId) {
                promptGenerationId.value = id;
            }
        } catch (err) {
            console.error(err);
        }
    };

    const callbacks: TreeCallbacks = {
        onSelect: props.onSelect,
        loadChildren,
        openMenu,
        handleDrop,
        previewImage: (path, x, y) =>
            preview.value = path ? { path, x, y } : null,
        openInDefault,
        playVideo: (path) => videoModal.value = path,
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
                class="h-full z-30 flex flex-col bg-white/95 backdrop-blur border-r border-gray-200 flex-none select-none"
            >
                <div class="px-4 h-12 flex items-center justify-between gap-2 border-b border-gray-100 shrink-0">
                    <span
                        class="text-sm font-semibold text-gray-800 truncate"
                        title={projectName}
                    >
                        {projectName}
                    </span>
                    <div class="flex items-center gap-0.5 -mr-1">
                        <button
                            type="button"
                            title={get_text(
                                "select_project_folder",
                                language.value,
                            )}
                            aria-label={get_text(
                                "select_project_folder",
                                language.value,
                            )}
                            onClick={async () => {
                                const res = await trpc.pickProject.mutate();
                                if (!res) return;
                                error.value = null;
                                // Load the full state for the new folder.
                                hydrated.current = false;
                                const data = await loadProjectData();
                                if (data instanceof Error) {
                                    console.error(data);
                                    error.value = data.message;
                                    return;
                                }
                                projectData.value = data;
                            }}
                            class="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
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
                                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                                <path d="M12 11v6M9 14h6" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div
                    // Dropping on empty space saves into the project root —
                    // a project file, a grid video, or files from the OS.
                    onDragOver={(e) => {
                        const types = e.dataTransfer?.types;
                        if (
                            !types ||
                            (!types.includes(PROJECT_FILE_MIME) &&
                                !types.includes("Files"))
                        ) {
                            return;
                        }
                        e.preventDefault();
                        e.dataTransfer!.dropEffect = "copy";
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
                        handleDrop(e, ""); // "" = project root
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
                                {get_text("failed_to_load", language.value)}
                                {" "}
                                {error.value}
                            </div>
                        )
                        : !projectData.value
                        ? (
                            <div class="px-4 py-3 text-xs text-gray-400">
                                {get_text(
                                    "select_a_project_folder",
                                    language.value,
                                )}
                            </div>
                        )
                        : (
                            <Node
                                entry={rootEntry}
                                path=""
                                depth={0}
                                tree={tree}
                                callbacks={callbacks}
                            />
                        )}
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
                    {VIDEO_EXT.test(preview.value.path)
                        ? (
                            <video
                                // `#t=0.1` seeks to the first frame so a poster
                                // image shows without playing the video.
                                src={projectFileUrl(preview.value.path) +
                                    "#t=0.1"}
                                preload="metadata"
                                muted
                                playsInline
                                class="block max-w-48 max-h-48 object-contain rounded"
                            />
                        )
                        : (
                            <img
                                src={projectFileUrl(preview.value.path)}
                                alt=""
                                class="block max-w-48 max-h-48 object-contain rounded"
                            />
                        )}
                </div>
            )}

            {menu.value && (
                <ContextMenu
                    menu={menu.value}
                    onClose={() => menu.value = null}
                    onOpenInDefault={openInDefault}
                    onCopy={copyImage}
                    onRename={(entry, path) => {
                        renameModal.value = { entry, path };
                        menu.value = null;
                    }}
                    onPromptDetails={(generationId, path) => {
                        promptModal.value = { generationId, path };
                        menu.value = null;
                    }}
                    onDelete={(entry, path) => {
                        deleteModal.value = { entry, path };
                        menu.value = null;
                    }}
                />
            )}

            {promptModal.value && projectData.value && (
                <FilePromptDetailsModal
                    generationId={promptModal.value.generationId}
                    path={promptModal.value.path}
                    projectRoot={projectData.value.rootPath}
                    onClose={() => promptModal.value = null}
                />
            )}

            {/* Name a grid video before saving it (cancel = don't save). */}
            {nameModal.value && (
                <FileNameModal
                    title={get_text("name_this_video", language.value)}
                    initialName={nameModal.value.src.split("/").pop() ?? ""}
                    onSave={(name) => {
                        dropFile(
                            nameModal.value!.src,
                            nameModal.value!.destDir,
                            name,
                        );
                        nameModal.value = null;
                    }}
                    onCancel={() => nameModal.value = null}
                />
            )}

            {/* Rename an entry (cancel = leave it unchanged). */}
            {renameModal.value && (
                <FileNameModal
                    title={get_text("rename", language.value)}
                    initialName={renameModal.value.entry.name}
                    onSave={(name) => {
                        renameEntry(renameModal.value!.path, name);
                        renameModal.value = null;
                    }}
                    onCancel={() => renameModal.value = null}
                />
            )}

            {deleteModal.value && (
                <DeleteConfirmModal
                    entry={deleteModal.value.entry}
                    onConfirm={confirmDelete}
                    onCancel={() => deleteModal.value = null}
                />
            )}

            {/* Double-click on a video opens it here, autoplaying. */}
            {videoModal.value && (
                <VideoModal
                    path={videoModal.value}
                    onClose={() => videoModal.value = null}
                />
            )}
        </>
    );
}

/** Mirrors the `DirEntry` returned by the `readDir` tRPC query. */
export interface FileEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymlink: boolean;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i;

function isImageFile(entry: FileEntry): boolean {
    return entry.isFile && IMAGE_EXT.test(entry.name);
}

function isVideoFile(entry: FileEntry): boolean {
    return entry.isFile && VIDEO_EXT.test(entry.name);
}

/** Files that show a floating hover thumbnail (images + video first frame). */
function isPreviewable(entry: FileEntry): boolean {
    return isImageFile(entry) || isVideoFile(entry);
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

/**
 * The generation detail modal for a file matched by content hash. Fetches
 * the generation's stored detail on mount; the video preview plays the
 * file actually clicked (which may be a renamed copy), not the original.
 */
function FilePromptDetailsModal(
    props: {
        generationId: string;
        path: string;
        projectRoot: string;
        onClose: () => void;
    },
) {
    const { generationId, path, projectRoot, onClose } = props;
    const detail = useSignal<GenerationDetail | null>(null);
    const loading = useSignal(true);

    useEffect(() => {
        (async () => {
            try {
                detail.value = await trpc.open.getGenerationDetail.query(
                    generationId,
                );
            } catch (err) {
                console.error(err);
            } finally {
                loading.value = false;
            }
        })();
    }, [generationId]);

    const generation: GeneratedVideo = {
        id: generationId,
        status: detail.value?.status ?? "succeeded",
        created_at: detail.value?.created_at ?? "",
        has_request: detail.value?.request_json != null,
        url: projectFileUrl(path),
        failed_reason: detail.value?.failed_reason ?? undefined,
    };

    return (
        <GenerationDetailModal
            projectRoot={projectRoot}
            generation={generation}
            detail={detail.value}
            loading={loading.value}
            onClose={onClose}
        />
    );
}

/**
 * Prompt for a file name, used both to name a video dragged in from the grid
 * and to rename an existing entry (the `title` differs). Owns its own input
 * state so typing never re-runs the parent's render; focuses and pre-selects
 * the name stem once on mount (like VS Code). `onSave` fires only on confirm —
 * cancelling changes nothing.
 */
function FileNameModal(
    props: {
        title: string;
        initialName: string;
        onSave: (name: string) => void;
        onCancel: () => void;
    },
) {
    const value = useSignal(props.initialName);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        // Select the stem (before the last dot) so the extension is preserved.
        const dot = props.initialName.lastIndexOf(".");
        el.setSelectionRange(0, dot > 0 ? dot : props.initialName.length);
    }, []);

    const save = () => {
        const name = value.value.trim();
        if (name) props.onSave(name);
    };

    return (
        <div
            class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) props.onCancel();
            }}
        >
            <div class="w-full max-w-sm rounded-xl bg-white p-4 space-y-3">
                <div class="text-sm font-medium text-gray-800">
                    {props.title}
                </div>
                <input
                    ref={inputRef}
                    type="text"
                    value={value.value}
                    onInput={(e) => value.value = e.currentTarget.value}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            save();
                        } else if (e.key === "Escape") {
                            e.preventDefault();
                            props.onCancel();
                        }
                    }}
                    placeholder={get_text("file_name", language.value)}
                    class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <div class="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={props.onCancel}
                        class="px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                    >
                        {get_text("cancel", language.value)}
                    </button>
                    <button
                        type="button"
                        disabled={!value.value.trim()}
                        onClick={save}
                        class="px-3 py-1.5 rounded-lg text-sm text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50"
                    >
                        {get_text("save", language.value)}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Right-click context menu for a tree entry, positioned at the cursor. A
 * full-screen backdrop closes it on any outside click. Which items show
 * depends on the entry: copy for images, rename/delete for anything but the
 * root, and prompt details once a matching generation has resolved.
 */
function ContextMenu(
    props: {
        menu: {
            entry: FileEntry;
            path: string;
            x: number;
            y: number;
            promptGenerationId: Signal<string | null>;
        };
        onClose: () => void;
        onOpenInDefault: (path: string) => void;
        onCopy: (path: string) => void;
        onRename: (entry: FileEntry, path: string) => void;
        onPromptDetails: (generationId: string, path: string) => void;
        onDelete: (entry: FileEntry, path: string) => void;
    },
) {
    const { entry, path, x, y, promptGenerationId } = props.menu;
    return (
        <>
            <div
                class="fixed inset-0 z-40"
                onClick={props.onClose}
                onContextMenu={(e) => {
                    e.preventDefault();
                    props.onClose();
                }}
            />
            <div
                class="fixed z-50 min-w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1 text-sm"
                style={{ left: `${x}px`, top: `${y}px` }}
            >
                <button
                    type="button"
                    onClick={() => props.onOpenInDefault(path)}
                    class="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-100"
                >
                    {get_text("open_with_default_app", language.value)}
                </button>
                {isImageFile(entry) && (
                    <button
                        type="button"
                        onClick={() => props.onCopy(path)}
                        class="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-100"
                    >
                        {get_text("copy", language.value)}
                    </button>
                )}
                {path !== "" && (
                    <button
                        type="button"
                        onClick={() => props.onRename(entry, path)}
                        class="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-100"
                    >
                        {get_text("rename", language.value)}
                    </button>
                )}
                {promptGenerationId.value && (
                    <button
                        type="button"
                        onClick={() =>
                            props.onPromptDetails(
                                promptGenerationId.value!,
                                path,
                            )}
                        class="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-100"
                    >
                        {get_text("prompt_details", language.value)}
                    </button>
                )}
                {path !== "" && (
                    <button
                        type="button"
                        onClick={() => props.onDelete(entry, path)}
                        class="w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50"
                    >
                        {get_text("delete", language.value)}
                    </button>
                )}
            </div>
        </>
    );
}

/**
 * Play a project video full-size in an overlay, autoplaying. Opened by
 * double-clicking a video in the tree; closed by the ✕, Escape (via the
 * backdrop), or clicking outside the player.
 */
function VideoModal(props: { path: string; onClose: () => void }) {
    return (
        <div
            class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
            onClick={(e) => {
                if (e.target === e.currentTarget) props.onClose();
            }}
        >
            <div class="relative w-full max-w-3xl">
                <button
                    type="button"
                    aria-label={get_text("close", language.value)}
                    onClick={props.onClose}
                    class="absolute -top-9 right-0 size-8 rounded-full bg-black/50 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur-sm hover:cursor-pointer transition-colors"
                >
                    ✕
                </button>
                <video
                    src={projectFileUrl(props.path)}
                    autoPlay
                    controls
                    playsInline
                    class="w-full max-h-[85vh] bg-black rounded-2xl object-contain"
                />
            </div>
        </div>
    );
}

/**
 * Confirm a destructive delete of a file or directory. The message switches
 * between the file and folder wording based on the entry; `onConfirm` runs the
 * actual deletion, `onCancel` dismisses without touching anything.
 */
function DeleteConfirmModal(
    props: {
        entry: FileEntry;
        onConfirm: () => void;
        onCancel: () => void;
    },
) {
    return (
        <div
            class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) props.onCancel();
            }}
        >
            <div class="w-full max-w-sm rounded-xl bg-white p-4 space-y-3">
                <div class="text-sm font-medium text-gray-800">
                    {get_text(
                        props.entry.isDirectory
                            ? "delete_folder_confirm"
                            : "delete_confirm",
                        language.value,
                    )}
                </div>
                <div class="text-sm text-gray-500 break-all">
                    {props.entry.name}
                </div>
                <div class="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={props.onCancel}
                        class="px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                    >
                        {get_text("cancel", language.value)}
                    </button>
                    <button
                        type="button"
                        onClick={props.onConfirm}
                        class="px-3 py-1.5 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700"
                    >
                        {get_text("delete", language.value)}
                    </button>
                </div>
            </div>
        </div>
    );
}

interface ExplorerState {
    expanded: string[];
    selected: string | null;
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

/** Read a File (dragged in from the OS) as a base64 data URL for upload. */
function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(file);
    });
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
    /** The open project's data (entries, expansion, selection). */
    projectData: Signal<ProjectData | null>;
    /** Directory path currently hovered during a drag (for highlight). */
    dragOver: Signal<string | null>;
}

// Per-explorer callbacks, kept off the reactive `TreeState` data model and
// threaded down the tree alongside it.
interface TreeCallbacks {
    onSelect?: (entry: FileEntry, path: string) => void;
    /** Lazily fetch + cache a directory's children, returning the result. */
    loadChildren: (path: string) => Promise<FileEntry[] | Error>;
    /** Open the right-click context menu for an entry at the cursor. */
    openMenu: (entry: FileEntry, path: string, x: number, y: number) => void;
    /** Handle a drop onto the given directory path (grid video, explorer
     * file, or OS files) — see the explorer's `handleDrop`. */
    handleDrop: (e: DragEvent, destDir: string) => void;
    /** Show (path set) or hide (path null) the image hover preview at x,y. */
    previewImage: (path: string | null, x: number, y: number) => void;
    /** Open a file with the OS default application. */
    openInDefault: (path: string) => void;
    /** Open a video in the autoplay modal. */
    playVideo: (path: string) => void;
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
    const pd = tree.projectData.value;
    const isOpen = pd?.expanded.has(path) ?? false;
    const isActive = pd?.selected === path;
    // Root entries live in `rootEntries`, not `childrenByPath` (keyed "" = root).
    const kids = path === "" ? pd?.rootEntries : pd?.childrenByPath[path];

    const onClick = () => {
        const cur = tree.projectData.value;
        if (!cur) return;
        callbacks.onSelect?.(entry, path);
        if (!entry.isDirectory) {
            tree.projectData.value = { ...cur, selected: path };
            return;
        }

        // Toggle the open state immediately (the chevron rotates either way).
        // The children list only renders once loaded, so an empty dir simply
        // shows nothing under it — no "loading" row that flashes in and out.
        const next = new Set(cur.expanded);
        if (next.has(path)) {
            next.delete(path);
        } else {
            next.add(path);
            // Root's children are `rootEntries`, already loaded — no fetch.
            if (path !== "") callbacks.loadChildren(path);
        }
        tree.projectData.value = { ...cur, selected: path, expanded: next };
    };

    return (
        <>
            <button
                type="button"
                onClick={onClick}
                // Double-click opens files in the OS default app,
                // except videos which play inline in a modal
                // (directories just toggle via the single click).
                onDblClick={entry.isDirectory
                    ? undefined
                    : isVideoFile(entry)
                    ? () => callbacks.playVideo(path)
                    : () => callbacks.openInDefault(path)}
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
                // Images and videos show a floating thumbnail near the
                // cursor (videos render their first frame, not playing).
                onMouseMove={isPreviewable(entry)
                    ? (e) =>
                        callbacks.previewImage(
                            path,
                            e.clientX,
                            e.clientY,
                        )
                    : undefined}
                onMouseLeave={isPreviewable(entry)
                    ? () => callbacks.previewImage(null, 0, 0)
                    : undefined}
                // Directories accept dropped grid videos, explorer
                // files, and files from the OS.
                onDragOver={entry.isDirectory
                    ? (e) => {
                        const types = e.dataTransfer?.types;
                        if (
                            !types ||
                            (!types.includes(PROJECT_FILE_MIME) &&
                                !types.includes("Files"))
                        ) {
                            return;
                        }
                        e.preventDefault();
                        e.stopPropagation(); // don't fall to the root
                        e.dataTransfer!.dropEffect = "copy";
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
                        tree.dragOver.value = null;
                        e.stopPropagation(); // handled here, not root
                        callbacks.handleDrop(e, path);
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
            {entry.isDirectory && isOpen &&
                kids?.map((child) => (
                    <Node
                        key={child.name}
                        entry={child}
                        path={path ? `${path}/${child.name}` : child.name}
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

export function makeLoadChildren(projectData: Signal<ProjectData | null>) {
    return async (path: string) => {
        const root = projectData.value?.rootPath;
        if (!root) return new Error("no project open");
        // Re-fetch even when cached so reopening shows the latest state — the
        // stale cache stays rendered until fresh data arrives.
        const res = await readDir(root, path);
        if (res instanceof Error) {
            return res;
        }
        const pd = projectData.value;
        if (pd) {
            projectData.value = {
                ...pd,
                childrenByPath: { ...pd.childrenByPath, [path]: res },
            };
        }
        return res;
    };
}
