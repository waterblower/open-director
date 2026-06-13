import { type Signal, useSignal } from "@preact/signals";

/** Mirrors the `DirEntry` returned by the `listProjectFiles` tRPC query. */
export interface FileEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymlink: boolean;
    /** Child entries, present for expandable directories. */
    children?: FileEntry[];
}

const dir = (name: string, children: FileEntry[] = []): FileEntry => ({
    name,
    isDirectory: true,
    isFile: false,
    isSymlink: false,
    children,
});

const file = (name: string): FileEntry => ({
    name,
    isDirectory: false,
    isFile: true,
    isSymlink: false,
});

// Placeholder data until wired to trpc.listProjectFiles.query().
export const DUMMY_ENTRIES: FileEntry[] = [
    dir("美术", [
        dir("角色", [
            file("莉莉丝_立绘.png"),
            file("莉莉丝_表情.png"),
            file("露米娅_立绘.png"),
        ]),
        dir("场景", [
            file("庇护所_内景.png"),
            file("废土_全景.png"),
        ]),
        file("美术风格参考.png"),
    ]),
    dir("分镜", [
        dir("第一集", [
            file("S01_镜头表.xlsx"),
            file("S01_storyboard.pdf"),
        ]),
        file("第二集_草稿.pdf"),
    ]),
    dir("配音", [
        dir("莉莉丝", [
            file("line_001.wav"),
            file("line_002.wav"),
        ]),
        file("配音脚本.docx"),
    ]),
    dir("成片", [
        file("EP01_v1.mp4"),
        file("EP01_v2.mp4"),
    ]),
    dir("素材", [
        dir("BGM", [
            file("opening.mp3"),
            file("battle.mp3"),
        ]),
        dir("音效", [
            file("explosion.wav"),
        ]),
        file("LUT.cube"),
    ]),
    file("设定圣经.md"),
    file("剧本_v3.docx"),
    file("角色表.xlsx"),
    file("封面.png"),
    file("README.txt"),
];

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

function Node(props: {
    entry: FileEntry;
    path: string;
    depth: number;
    expanded: Signal<Set<string>>;
    selected?: Signal<string | null>;
    onSelect?: (entry: FileEntry, path: string) => void;
}) {
    const { entry, path, depth, expanded, selected, onSelect } = props;
    const isOpen = expanded.value.has(path);
    const isActive = selected?.value === path;

    const onClick = () => {
        if (selected) selected.value = path;
        onSelect?.(entry, path);
        if (entry.isDirectory) {
            // Toggle expansion (new Set so the signal notifies subscribers)
            const next = new Set(expanded.value);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            expanded.value = next;
        }
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
            {entry.isDirectory && isOpen && entry.children?.map((child) => (
                <Node
                    key={child.name}
                    entry={child}
                    path={`${path}/${child.name}`}
                    depth={depth + 1}
                    expanded={expanded}
                    selected={selected}
                    onSelect={onSelect}
                />
            ))}
        </>
    );
}

export function FileExplorer(props: {
    entries: FileEntry[];
    selected?: Signal<string | null>;
    onSelect?: (entry: FileEntry, path: string) => void;
}) {
    const { entries, selected, onSelect } = props;
    const expanded = useSignal<Set<string>>(new Set());

    return (
        <aside class="fixed left-0 top-0 bottom-0 z-30 w-60 flex flex-col bg-white/95 backdrop-blur border-r border-gray-200">
            <div class="px-4 h-12 flex items-center border-b border-gray-100 shrink-0">
                <span class="text-sm font-semibold text-gray-800">项目文件</span>
            </div>
            <div class="flex-1 overflow-y-auto py-1.5">
                {entries.length === 0
                    ? (
                        <div class="px-4 py-3 text-xs text-gray-400">
                            暂无文件
                        </div>
                    )
                    : entries.map((entry) => (
                        <Node
                            key={entry.name}
                            entry={entry}
                            path={entry.name}
                            depth={0}
                            expanded={expanded}
                            selected={selected}
                            onSelect={onSelect}
                        />
                    ))}
            </div>
        </aside>
    );
}
