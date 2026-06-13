import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { trpc } from "../trpc/client.ts";

/** Mirrors the `DirEntry` returned by the `listProjectFiles` tRPC query. */
export interface FileEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymlink: boolean;
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

// Shared per-explorer state, threaded down the tree.
interface TreeState {
    /** Loaded children keyed by directory path (relative to project root). */
    childrenByPath: Signal<Record<string, FileEntry[]>>;
    /** Currently expanded directory paths. */
    expanded: Signal<Set<string>>;
    /** Directory paths whose children are being fetched. */
    loading: Signal<Set<string>>;
    selected?: Signal<string | null>;
    onSelect?: (entry: FileEntry, path: string) => void;
    /** Lazily fetch + cache a directory's children. */
    loadChildren: (path: string) => void;
}

function Node(props: { entry: FileEntry; path: string; depth: number; tree: TreeState }) {
    const { entry, path, depth, tree } = props;
    const isOpen = tree.expanded.value.has(path);
    const isActive = tree.selected?.value === path;
    const kids = tree.childrenByPath.value[path];
    const isLoading = tree.loading.value.has(path);

    const onClick = () => {
        if (tree.selected) tree.selected.value = path;
        tree.onSelect?.(entry, path);
        if (!entry.isDirectory) return;

        const next = new Set(tree.expanded.value);
        if (next.has(path)) {
            next.delete(path);
        } else {
            next.add(path);
            tree.loadChildren(path);
        }
        tree.expanded.value = next;
    };

    return (
        <>
            <button
                type="button"
                onClick={onClick}
                style={{ paddingLeft: `${depth * 14 + 12}px` }}
                class={`w-full flex items-center gap-1.5 pr-3 py-1.5 text-left text-sm hover:bg-gray-100 ${
                    isActive ? "bg-indigo-50 text-indigo-600" : "text-gray-700"
                }`}
            >
                {entry.isDirectory
                    ? <ChevronIcon open={isOpen} />
                    : <span class="w-3.5 shrink-0" />}
                {entry.isDirectory ? <FolderIcon /> : <FileIcon />}
                <span class="truncate">{entry.name}</span>
            </button>
            {entry.isDirectory && isOpen && (
                isLoading && !kids
                    ? (
                        <div
                            style={{ paddingLeft: `${(depth + 1) * 14 + 12}px` }}
                            class="py-1.5 text-xs text-gray-400"
                        >
                            加载中…
                        </div>
                    )
                    : kids?.map((child) => (
                        <Node
                            key={child.name}
                            entry={child}
                            path={`${path}/${child.name}`}
                            depth={depth + 1}
                            tree={tree}
                        />
                    ))
            )}
        </>
    );
}

export function FileExplorer(props: {
    selected?: Signal<string | null>;
    onSelect?: (entry: FileEntry, path: string) => void;
}) {
    const root = useSignal<FileEntry[] | null>(null);
    const error = useSignal<string | null>(null);
    const childrenByPath = useSignal<Record<string, FileEntry[]>>({});
    const expanded = useSignal<Set<string>>(new Set());
    const loading = useSignal<Set<string>>(new Set());

    // Fetch the first level when the explorer loads.
    useEffect(() => {
        trpc.listProjectFiles.query()
            .then((res) => root.value = res)
            .catch((err) => {
                console.error(err);
                error.value = String(err);
            });
    }, []);

    const loadChildren = (path: string) => {
        // Re-fetch even when cached so reopening shows the latest state — the
        // stale cache stays rendered until fresh data arrives. Only skip if a
        // request for this path is already in flight.
        if (loading.value.has(path)) return;
        loading.value = new Set(loading.value).add(path);
        trpc.listProjectFiles.query(path)
            .then((res) => {
                childrenByPath.value = { ...childrenByPath.value, [path]: res };
            })
            .catch((err) => console.error(err))
            .finally(() => {
                const next = new Set(loading.value);
                next.delete(path);
                loading.value = next;
            });
    };

    const tree: TreeState = {
        childrenByPath,
        expanded,
        loading,
        selected: props.selected,
        onSelect: props.onSelect,
        loadChildren,
    };

    return (
        <aside class="fixed left-0 top-0 bottom-0 z-30 w-60 flex flex-col bg-white/95 backdrop-blur border-r border-gray-200">
            <div class="px-4 h-12 flex items-center border-b border-gray-100 shrink-0">
                <span class="text-sm font-semibold text-gray-800">项目文件</span>
            </div>
            <div class="flex-1 overflow-y-auto py-1.5">
                {error.value
                    ? (
                        <div class="px-4 py-3 text-xs text-red-500 break-all">
                            加载失败：{error.value}
                        </div>
                    )
                    : root.value === null
                    ? <div class="px-4 py-3 text-xs text-gray-400">加载中…</div>
                    : root.value.length === 0
                    ? <div class="px-4 py-3 text-xs text-gray-400">暂无文件</div>
                    : root.value.map((entry) => (
                        <Node
                            key={entry.name}
                            entry={entry}
                            path={entry.name}
                            depth={0}
                            tree={tree}
                        />
                    ))}
            </div>
        </aside>
    );
}
