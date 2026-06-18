import { useEffect } from "preact/hooks";
import type { CreateTaskRequest } from "../seedance/seedance.ts";
import { estimateCost } from "../seedance/pricing.ts";
import type { trpc } from "../trpc/client.ts";
import type { GeneratedVideo } from "./GenerationCard.tsx";

/** The full generation row returned by the details endpoint. */
export type GenerationDetail = Awaited<
    ReturnType<typeof trpc.getGenerationDetail.query>
>;

/** Human-readable elapsed time, e.g. "1分23秒" or "12秒". */
function formatDuration(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s}秒`;
    const m = Math.floor(s / 60);
    return `${m}分${s % 60}秒`;
}

/** Concatenated text of the prompt's text content items. */
function promptText(req: CreateTaskRequest | null | undefined): string {
    if (!req) return "";
    return req.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
}

export function GenerationDetailModal(props: {
    generation: GeneratedVideo;
    detail: GenerationDetail | null;
    loading: boolean;
    onClose: () => void;
}) {
    const { generation, detail, loading, onClose } = props;

    // Close on Escape, like a native dialog.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        globalThis.addEventListener("keydown", onKeyDown);
        return () => globalThis.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const url = generation.url;
    const req = detail?.request_json ?? null;
    const task = detail?.task_json ?? null;

    // created_at / updated_at are unix seconds; their gap is the time spent
    // queued + running on the server.
    const elapsed = task?.created_at != null && task.updated_at != null
        ? task.updated_at - task.created_at
        : null;

    const totalTokens = task?.usage?.total_tokens ?? null;
    const completionTokens = task?.usage?.completion_tokens ?? null;
    const cost = totalTokens != null && req
        ? estimateCost(totalTokens, req.model)
        : null;

    const prompt = promptText(req);

    // Reference inputs attached to the request, with their (servable
    // /project-file or data:) URLs, in prompt order.
    type Reference = { kind: "image" | "video" | "audio"; url: string };
    const references = (req?.content ?? []).flatMap((c): Reference[] => {
        if (c.type === "image_url") {
            return [{ kind: "image", url: c.image_url.url }];
        }
        if (c.type === "video_url") {
            return [{ kind: "video", url: c.video_url.url }];
        }
        if (c.type === "audio_url") {
            return [{ kind: "audio", url: c.audio_url.url }];
        }
        return [];
    });

    return (
        <div
            // Sits above the grid; click the backdrop (but not the card body)
            // to dismiss. Stop drag/click bubbling back to the draggable card.
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 cursor-default"
            draggable={false}
            onClick={(e) => {
                e.stopPropagation();
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                class="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-gray-900 text-gray-100 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    aria-label="关闭"
                    onClick={onClose}
                    class="absolute top-3 right-3 z-10 size-8 rounded-full bg-black/50 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur-sm hover:cursor-pointer transition-colors"
                >
                    <CloseIcon class="size-4" />
                </button>

                {/* Bigger video player */}
                {url
                    ? (
                        <video
                            src={url}
                            controls
                            playsInline
                            class="w-full max-h-[55vh] bg-black rounded-t-2xl object-contain"
                        />
                    )
                    : (
                        <div class="w-full aspect-video flex items-center justify-center bg-black rounded-t-2xl text-gray-600">
                            <VideoIcon class="size-10" />
                        </div>
                    )}

                <div class="p-5 space-y-5">
                    <div class="flex items-center gap-2 text-sm text-gray-400 [overflow-wrap:anywhere]">
                        <VideoIcon class="size-4 shrink-0" />
                        <span class="font-mono">{generation.id}</span>
                    </div>

                    {generation.failed_reason && (
                        <div class="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300 [overflow-wrap:anywhere]">
                            {generation.failed_reason}
                        </div>
                    )}

                    {loading
                        ? (
                            <div class="flex items-center gap-2 text-sm text-gray-400">
                                <span class="size-4 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
                                加载详情中…
                            </div>
                        )
                        : !detail
                        ? (
                            <div class="text-sm text-gray-500">
                                没有为此生成保存的详细信息。
                            </div>
                        )
                        : (
                            <>
                                {/* Stats: time spent + token / cost usage */}
                                <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    <Stat
                                        label="耗时"
                                        value={elapsed != null
                                            ? formatDuration(elapsed)
                                            : "—"}
                                    />
                                    <Stat
                                        label="Tokens"
                                        value={totalTokens != null
                                            ? totalTokens.toLocaleString()
                                            : "—"}
                                        hint={completionTokens != null
                                            ? `生成 ${completionTokens.toLocaleString()}`
                                            : undefined}
                                    />
                                    <Stat
                                        label="预估费用"
                                        value={cost != null
                                            ? `¥${cost.rmb.toFixed(2)}`
                                            : "—"}
                                        hint={cost != null
                                            ? `≈ $${cost.usd.toFixed(2)}`
                                            : undefined}
                                    />
                                </div>

                                {/* Prompt */}
                                <div>
                                    <div class="text-xs font-medium text-gray-400 mb-1.5">
                                        提示词
                                    </div>
                                    {prompt
                                        ? (
                                            <div class="rounded-lg bg-gray-800/70 p-3 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                                                {prompt}
                                            </div>
                                        )
                                        : (
                                            <div class="text-sm text-gray-500">
                                                （无文本提示词）
                                            </div>
                                        )}
                                    {references.length > 0 && (
                                        <div class="mt-3">
                                            <div class="text-xs font-medium text-gray-400 mb-1.5">
                                                参考输入
                                            </div>
                                            <div class="flex flex-wrap gap-2">
                                                {references.map((ref, i) =>
                                                    ref.kind === "audio"
                                                        ? (
                                                            <audio
                                                                key={i}
                                                                src={ref.url}
                                                                controls
                                                                class="h-9 w-56 max-w-full"
                                                            />
                                                        )
                                                        : (
                                                            <a
                                                                key={i}
                                                                href={ref.url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                class="block size-24 rounded-lg overflow-hidden bg-black/40 ring-1 ring-white/10 hover:ring-indigo-400 hover:cursor-pointer transition"
                                                            >
                                                                {ref.kind ===
                                                                        "video"
                                                                    ? (
                                                                        <video
                                                                            src={ref
                                                                                .url}
                                                                            muted
                                                                            playsInline
                                                                            preload="metadata"
                                                                            class="size-full object-cover"
                                                                        />
                                                                    )
                                                                    : (
                                                                        <img
                                                                            src={ref
                                                                                .url}
                                                                            alt="参考图片"
                                                                            loading="lazy"
                                                                            class="size-full object-cover"
                                                                        />
                                                                    )}
                                                            </a>
                                                        )
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Settings */}
                                {req && (
                                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <Stat label="模型" value={req.model} />
                                        {req.resolution && (
                                            <Stat
                                                label="分辨率"
                                                value={req.resolution}
                                            />
                                        )}
                                        {req.ratio && (
                                            <Stat
                                                label="画幅"
                                                value={req.ratio}
                                            />
                                        )}
                                        {req.duration != null && (
                                            <Stat
                                                label="时长"
                                                value={`${req.duration}秒`}
                                            />
                                        )}
                                        {req.generate_audio != null && (
                                            <Stat
                                                label="音频"
                                                value={req.generate_audio
                                                    ? "开"
                                                    : "关"}
                                            />
                                        )}
                                        {req.seed != null && req.seed >= 0 && (
                                            <Stat
                                                label="种子"
                                                value={String(req.seed)}
                                            />
                                        )}
                                    </div>
                                )}

                                <p class="text-[11px] text-gray-500">
                                    费用为按 token
                                    用量的粗略估算，实际以火山引擎账单为准。
                                </p>
                            </>
                        )}
                </div>
            </div>
        </div>
    );
}

function Stat(props: { label: string; value: string; hint?: string }) {
    return (
        <div class="rounded-lg bg-gray-800/70 px-3 py-2">
            <div class="text-[11px] text-gray-400">{props.label}</div>
            <div class="text-sm font-medium [overflow-wrap:anywhere]">
                {props.value}
            </div>
            {props.hint && (
                <div class="text-[11px] text-gray-500 mt-0.5">{props.hint}</div>
            )}
        </div>
    );
}

function VideoIcon(props: { class?: string }) {
    return (
        <svg
            class={props.class ?? "size-4"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <rect x="2" y="4" width="20" height="16" rx="3" />
            <path d="m10 9 5 3-5 3z" />
        </svg>
    );
}

function CloseIcon(props: { class?: string }) {
    return (
        <svg
            class={props.class ?? "size-4"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    );
}
