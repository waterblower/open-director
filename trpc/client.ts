/**
 * tRPC browser client — https://trpc.io/docs/quickstart
 *
 * Import this in islands to call procedures with full type safety, e.g.
 *   import { trpc } from "../trpc/client.ts";
 *   const users = await trpc.userList.query();
 */
import {
    createTRPCClient,
    httpBatchLink,
    splitLink,
    unstable_httpSubscriptionLink,
} from "@trpc/client";
import type { AppRouter } from "./router.ts";
import type { ProjectData } from "../components/FileExplorer.tsx";
import { Signal, signal } from "@preact/signals";

export const trpc = createTRPCClient<AppRouter>({
    links: [
        splitLink({
            condition: (op) => op.type === "subscription",
            true: unstable_httpSubscriptionLink({ url: "/trpc" }),
            false: httpBatchLink({ url: "/trpc" }),
        }),
    ],
});

/** OS junk files that should never be shown in the explorer. */
const HIDDEN_NAMES = new Set([".DS_Store"]);

function notHidden(entry: { name: string }): boolean {
    return !HIDDEN_NAMES.has(entry.name);
}

/** Read the (non-recursive) entries of `path` within the given project root. */
export async function readDir(projectRoot: string, path: string) {
    try {
        const res = await trpc.readDir.query({ projectRoot, path });
        return res.filter(notHidden);
    } catch (err) {
        return err as Error;
    }
}

/**
 * Load the whole project state in one round trip: root path, root entries, the
 * restored-expanded directories (children pre-loaded) and the saved selection.
 * Returns null when no project is open, or an Error on failure.
 */
export async function loadProjectData(): Promise<ProjectData | null | Error> {
    try {
        const data = await trpc.loadProjectData.query();
        if (!data) return null;
        const childrenByPath: Record<string, ProjectData["rootEntries"]> = {};
        for (const [dir, entries] of Object.entries(data.childrenByPath)) {
            childrenByPath[dir] = entries.filter(notHidden);
        }
        return {
            rootPath: data.rootPath,
            rootEntries: data.rootEntries.filter(notHidden),
            childrenByPath,
            expanded: new Set(data.expanded),
            selected: data.selected,
        };
    } catch (err) {
        return err as Error;
    }
}

// ---------------------------------------------------------------------------
// i18n — a global language signal + a flat id->text lookup. Every UI string
// in the app is registered here under an id that's the snake_case of its
// English text; call `get_text(id, language.value)` wherever that string is
// rendered so it re-renders when the language changes.
// ---------------------------------------------------------------------------
const LANGUAGE_KEY = "language";

export type Language = "English" | "Chinese";

export const SUPPORTED_LANGUAGES: Language[] = ["English", "Chinese"];

/** Each language's own name for itself, used in the language menu. */
export const LANGUAGE_NAMES: Record<Language, string> = {
    English: "English",
    Chinese: "中文",
};

// Guard against SSR (no `localStorage` in Deno) — the island's initial
// render happens server-side before this module-level signal is hydrated.
export const language: Signal<Language> = signal<Language>(
    (typeof localStorage !== "undefined"
        ? localStorage.getItem(LANGUAGE_KEY) as Language | null
        : null) ?? "English",
);

/** Switch the UI language and persist the choice for the next visit. */
export function setLanguage(next: Language): void {
    language.value = next;
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(LANGUAGE_KEY, next);
    }
}

const TEXTS = {
    // FileExplorer
    open_a_project: { English: "Open a project", Chinese: "请打开项目" },
    select_project_folder: {
        English: "Select project folder",
        Chinese: "选择项目文件夹",
    },
    failed_to_load: { English: "Failed to load:", Chinese: "加载失败：" },
    select_a_project_folder: {
        English: "Select a project folder",
        Chinese: "请选择一个项目文件夹",
    },
    open_with_default_app: {
        English: "Open with default app",
        Chinese: "用默认程序打开",
    },
    copy: { English: "Copy", Chinese: "复制" },
    rename: { English: "Rename", Chinese: "重命名" },
    prompt_details: { English: "Prompt details", Chinese: "提示词详情" },

    // SettingsModal
    please_enter_an_api_key: {
        English: "Please enter an API key",
        Chinese: "请输入 API Key",
    },
    save_failed: { English: "Save failed", Chinese: "保存失败" },
    close: { English: "Close", Chinese: "关闭" },
    settings: { English: "Settings", Chinese: "设置" },
    configure_seedance_api_key: {
        English: "Configure your Seedance API key to generate videos.",
        Chinese: "配置 Seedance API Key 以生成视频。",
    },
    currently_saved: { English: "Currently saved:", Chinese: "当前已保存：" },
    enter_a_new_key_to_replace_it: {
        English: "Enter a new key to replace it",
        Chinese: "输入新的 Key 以替换",
    },
    cancel: { English: "Cancel", Chinese: "取消" },
    saving: { English: "Saving…", Chinese: "保存中…" },
    save: { English: "Save", Chinese: "保存" },
    language_label: { English: "Language", Chinese: "语言" },

    // McpInfoModal
    mcp_server: { English: "MCP Server", Chinese: "MCP 服务器" },
    mcp_server_subtitle: {
        English:
            "Let a local coding agent (Claude Code, Codex, …) drive Open Director.",
        Chinese: "让本地编码助手（Claude Code、Codex 等）操作 Open Director。",
    },
    connection: { English: "Connection", Chinese: "连接信息" },
    endpoint_url: { English: "Endpoint URL", Chinese: "服务地址" },
    protocol: { English: "Protocol", Chinese: "协议" },
    protocol_version: { English: "Protocol version", Chinese: "协议版本" },
    transport: { English: "Transport", Chinese: "传输方式" },
    server_name: { English: "Server name", Chinese: "服务器名称" },
    server_version: { English: "Server version", Chinese: "服务器版本" },
    quick_setup: { English: "Quick setup", Chinese: "快速配置" },
    available_tools: { English: "Available tools", Chinese: "可用工具" },
    parameters: { English: "Parameters", Chinese: "参数" },
    required: { English: "required", Chinese: "必填" },
    copied: { English: "Copied", Chinese: "已复制" },
    no_project_open_mcp_warning: {
        English:
            "No project is open — tools that touch generations will fail until one is.",
        Chinese: "尚未打开项目——涉及生成记录的工具在打开项目前会调用失败。",
    },

    // GenerationCard
    generation_failed: { English: "Generation failed", Chinese: "生成失败" },
    unknown_reason: { English: "Unknown reason", Chinese: "未知原因" },
    reuse_prompt: { English: "Reuse prompt", Chinese: "复用提示词" },
    view_details: { English: "View details", Chinese: "查看详情" },
    archive: { English: "Archive", Chinese: "归档" },
    restore: { English: "Restore", Chinese: "还原" },
    like: { English: "Like", Chinese: "点赞" },
    dislike: { English: "Dislike", Chinese: "点踩" },
    remove_like: { English: "Remove like", Chinese: "取消点赞" },
    remove_dislike: { English: "Remove dislike", Chinese: "取消点踩" },
    why_do_you_like_it: {
        English: "Why do you like it? (optional)",
        Chinese: "为什么喜欢它？（可选）",
    },
    why_do_you_dislike_it: {
        English: "Why do you dislike it? (optional)",
        Chinese: "为什么不喜欢它？（可选）",
    },

    // GenerationsGrid
    newest_first: { English: "Newest first", Chinese: "最新在前" },
    oldest_first: { English: "Oldest first", Chinese: "最早在前" },
    active_generations: { English: "Active", Chinese: "进行中" },
    archived_generations: { English: "Archived", Chinese: "已归档" },
    liked_generations: { English: "Liked", Chinese: "点赞" },
    disliked_generations: { English: "Disliked", Chinese: "点踩" },
    no_archived_generations: {
        English: "No archived generations",
        Chinese: "暂无归档",
    },
    no_liked_generations: {
        English: "No liked generations",
        Chinese: "暂无点赞的生成",
    },
    no_disliked_generations: {
        English: "No disliked generations",
        Chinese: "暂无点踩的生成",
    },

    // GenerationDetailModal
    id: { English: "ID", Chinese: "ID" },
    generation_id: { English: "Generation ID", Chinese: "生成 ID" },
    task_id: { English: "Task ID", Chinese: "任务 ID" },
    loading_details: { English: "Loading details…", Chinese: "加载详情中…" },
    no_saved_details: {
        English: "No saved details for this generation.",
        Chinese: "没有为此生成保存的详细信息。",
    },
    elapsed: { English: "Elapsed", Chinese: "耗时" },
    estimated_cost: { English: "Estimated cost", Chinese: "预估费用" },
    generated: { English: "Generated", Chinese: "生成" },
    prompt: { English: "Prompt", Chinese: "提示词" },
    no_text_prompt: {
        English: "(No text prompt)",
        Chinese: "（无文本提示词）",
    },
    reference_inputs: { English: "Reference inputs", Chinese: "参考输入" },
    reference_image: { English: "Reference image", Chinese: "参考图片" },
    model: { English: "Model", Chinese: "模型" },
    resolution: { English: "Resolution", Chinese: "分辨率" },
    aspect_ratio: { English: "Aspect ratio", Chinese: "画幅" },
    duration: { English: "Duration", Chinese: "时长" },
    audio: { English: "Audio", Chinese: "音频" },
    on: { English: "On", Chinese: "开" },
    off: { English: "Off", Chinese: "关" },
    seed: { English: "Seed", Chinese: "种子" },
    cost_disclaimer: {
        English:
            "Cost is a rough estimate based on token usage; refer to your Volcano Engine bill for the actual amount.",
        Chinese: "费用为按 token 用量的粗略估算，实际以火山引擎账单为准。",
    },

    // Composer
    image: { English: "Image", Chinese: "图片" },
    video: { English: "Video", Chinese: "视频" },
    describe_prompt_placeholder: {
        English:
            "Describe the video you want to generate. Use @ to reference an uploaded asset",
        Chinese: "描述你想生成的视频画面，可 @ 引用上传的素材",
    },
    image_video_audio: {
        English: "Image / Video / Audio",
        Chinese: "图片/视频/音频",
    },
    remove: { English: "Remove", Chinese: "移除" },
    no_assets_yet: {
        English: "No assets yet — upload one first",
        Chinese: "暂无素材，请先上传",
    },
    select_model: { English: "Select model", Chinese: "选择模型" },
    reference: { English: "Reference", Chinese: "参考生成" },
    first_last_frame: { English: "First & last frame", Chinese: "首尾帧" },
    select_mode: { English: "Select mode", Chinese: "选择模式" },
    by_seconds: { English: "By seconds", Chinese: "按秒数" },
    smart_duration: { English: "Smart duration", Chinese: "智能时长" },
    smart: { English: "Smart", Chinese: "智能" },
    clear_all: { English: "Clear all", Chinese: "全部清空" },
    generate: { English: "Generate", Chinese: "生成" },
    generation_failed_prefix: {
        English: "Generation failed:",
        Chinese: "生成失败：",
    },
    s_unit: { English: "s", Chinese: "秒" },
    m_unit: { English: "m", Chinese: "分" },

    // Application (bottom bar)
    image_grid_editor: {
        English: "Image Grid Editor",
        Chinese: "图片加网格",
    },
};

/** Look up `id`'s text in `lang`, falling back to the id itself if unknown. */
export function get_text(id: keyof typeof TEXTS, lang?: Language): string {
    return TEXTS[id]?.[lang || language.value] ?? id;
}
