import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type {
    GenerationPlanAsset,
    GenerationPlanTask,
    LoadedGenerationPlan,
} from "../generation_plan.ts";
import { trpc } from "../trpc/client.ts";

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileIcon({ class: className = "" }: { class?: string }) {
    return (
        <svg
            class={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M8 13h8M8 17h6" />
        </svg>
    );
}

function UploadIcon({ class: className = "" }: { class?: string }) {
    return (
        <svg
            class={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
        </svg>
    );
}

function ImageIcon({ class: className = "" }: { class?: string }) {
    return (
        <svg
            class={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
        </svg>
    );
}

function ReferencePreview(
    { path, asset }: {
        path: string;
        asset: GenerationPlanAsset | undefined;
    },
) {
    const url = asset?.url;
    const broken = useSignal(false);

    useEffect(() => {
        broken.value = false;
    }, [url]);

    const state = !asset
        ? "missing"
        : asset.status !== "ready"
        ? asset.status
        : !url || broken.value
        ? "failed"
        : "ready";

    return (
        <figure class="w-72 max-w-[85vw] shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {state === "ready"
                ? (
                    <div class="flex h-56 items-center justify-center bg-[linear-gradient(45deg,#f8fafc_25%,transparent_25%),linear-gradient(-45deg,#f8fafc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f8fafc_75%),linear-gradient(-45deg,transparent_75%,#f8fafc_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-2">
                        <img
                            src={url}
                            alt={`Reference image: ${path}`}
                            loading="lazy"
                            class="size-full object-contain"
                            onError={() => broken.value = true}
                        />
                    </div>
                )
                : (
                    <div class="flex h-56 flex-col items-center justify-center px-5 py-6 text-center">
                        <span
                            class={`mb-3 flex size-11 items-center justify-center rounded-xl ${
                                state === "missing" || state === "failed"
                                    ? "bg-amber-50 text-amber-500"
                                    : "bg-slate-100 text-slate-400"
                            }`}
                        >
                            <ImageIcon class="size-5" />
                        </span>
                        <p class="text-sm font-semibold text-slate-700">
                            {state === "missing"
                                ? "Image not found"
                                : state === "unsupported"
                                ? "Preview unavailable"
                                : state === "blocked"
                                ? "Reference path blocked"
                                : "Unable to display image"}
                        </p>
                        <p class="mt-1 max-w-sm text-xs leading-5 text-slate-400">
                            {state === "missing"
                                ? "The referenced file does not exist."
                                : state === "unsupported"
                                ? "This reference is not a supported image file."
                                : state === "blocked"
                                ? "The resolved path is outside the selected plan's project directory."
                                : "The file exists, but the browser could not decode it."}
                        </p>
                    </div>
                )}
            <figcaption class="break-all border-t border-slate-100 bg-slate-50/70 px-3 py-2.5 font-mono text-[11px] leading-4 text-slate-500">
                {path}
            </figcaption>
        </figure>
    );
}

function GenerationTaskCard(
    { task, index, assets }: {
        task: GenerationPlanTask;
        index: number;
        assets: Record<string, GenerationPlanAsset>;
    },
) {
    return (
        <article class="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-100/50">
            <div class="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
                <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-mono text-xs font-semibold text-slate-500">
                    {String(index + 1).padStart(2, "0")}
                </span>
                <div class="min-w-0 flex-1">
                    <h2 class="break-words font-mono text-sm font-semibold leading-5 text-slate-900">
                        {task.id}
                    </h2>
                </div>
                <span class="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-100">
                    {task.aspect_ratio}
                </span>
            </div>

            <div class="flex flex-1 flex-col gap-4 px-5 py-4">
                <div>
                    <p class="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                        Target image
                    </p>
                    <p class="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-600 ring-1 ring-inset ring-slate-100">
                        {task.target_image_path}
                    </p>
                </div>

                <div>
                    <p class="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                        References · {task.reference_image_paths.length}
                    </p>
                    {task.reference_image_paths.length === 0
                        ? (
                            <p class="text-xs text-slate-400">
                                No reference images
                            </p>
                        )
                        : (
                            <div class="flex gap-3 overflow-x-auto pb-2">
                                {task.reference_image_paths.map((path) => (
                                    <ReferencePreview
                                        key={path}
                                        path={path}
                                        asset={assets[path]}
                                    />
                                ))}
                            </div>
                        )}
                </div>

                <div class="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-4">
                    <div class="mb-4 border-b border-slate-200 pb-3">
                        <h3 class="text-sm font-semibold text-slate-800">
                            Prompt
                        </h3>
                    </div>
                    <p class="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                        {task.prompt}
                    </p>
                </div>
            </div>
        </article>
    );
}

export default function GenerationPlan() {
    const plan = useSignal<LoadedGenerationPlan | null>(null);
    const error = useSignal<string | null>(null);
    const loading = useSignal(false);

    const choosePlan = async () => {
        error.value = null;
        loading.value = true;
        try {
            const selected = await trpc.pickGenerationPlan.mutate();
            if (selected) plan.value = selected;
        } catch (cause) {
            error.value = cause instanceof Error
                ? cause.message
                : "Unable to open this generation plan.";
        } finally {
            loading.value = false;
        }
    };

    return (
        <main class="min-h-screen bg-slate-50 text-slate-900">
            <header class="border-b border-slate-200 bg-white">
                <div class="mx-auto flex max-w-[1500px] flex-col gap-5 px-5 py-7 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">
                            <span class="h-px w-6 bg-indigo-400" />
                            Open Director
                        </div>
                        <h1 class="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                            Generation plan
                        </h1>
                        <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                            Open a TOML file containing [[tasks]] entries. The
                            backend resolves and serves its local reference
                            images automatically.
                        </p>
                    </div>

                    <button
                        type="button"
                        disabled={loading.value}
                        onClick={() => void choosePlan()}
                        class="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
                    >
                        {loading.value
                            ? (
                                <span class="size-4 animate-spin rounded-full border-2 border-indigo-300 border-t-white" />
                            )
                            : <UploadIcon class="size-4" />}
                        {plan.value
                            ? "Choose another TOML"
                            : "Choose TOML file"}
                    </button>
                </div>
            </header>

            <div class="mx-auto max-w-[1500px] px-5 py-6 sm:px-8">
                {error.value && (
                    <div
                        role="alert"
                        class="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                    >
                        <strong class="font-semibold">
                            Could not open plan.
                        </strong>{" "}
                        {error.value}
                    </div>
                )}

                {loading.value && (
                    <div class="flex min-h-72 items-center justify-center gap-3 text-sm text-slate-500">
                        <span class="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500" />
                        Reading plan…
                    </div>
                )}

                {!loading.value && plan.value && (
                    <>
                        <div class="mb-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                            <div class="flex min-w-0 items-center gap-3">
                                <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                                    <FileIcon class="size-5" />
                                </span>
                                <div class="min-w-0">
                                    <p class="truncate text-sm font-semibold text-slate-800">
                                        {plan.value.fileName}
                                    </p>
                                    <p class="text-xs text-slate-400">
                                        {formatBytes(plan.value.fileSize)}{" "}
                                        · parsed by backend · reference paths
                                        resolved
                                    </p>
                                </div>
                            </div>
                            <span class="self-start rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 sm:self-auto">
                                {plan.value.tasks.length}{" "}
                                {plan.value.tasks.length === 1
                                    ? "task"
                                    : "tasks"}
                            </span>
                        </div>

                        {plan.value.tasks.length === 0
                            ? (
                                <div class="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center text-sm text-slate-500">
                                    This plan has no tasks.
                                </div>
                            )
                            : (
                                <div class="flex flex-col gap-4">
                                    {plan.value.tasks.map((task, index) => (
                                        <GenerationTaskCard
                                            key={task.id}
                                            task={task}
                                            index={index}
                                            assets={plan.value!.assets}
                                        />
                                    ))}
                                </div>
                            )}
                    </>
                )}

                {!loading.value && !plan.value && !error.value && (
                    <section class="flex min-h-[55vh] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white px-6 text-center">
                        <span class="mb-5 flex size-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500 ring-8 ring-indigo-50/50">
                            <FileIcon class="size-8" />
                        </span>
                        <h2 class="text-lg font-semibold text-slate-800">
                            No generation plan open
                        </h2>
                        <p class="mt-2 max-w-md text-sm leading-6 text-slate-500">
                            Choose a TOML file in the same format as
                            01_objects_props.toml. Each [[tasks]] entry will
                            appear as a card here.
                        </p>
                        <button
                            type="button"
                            onClick={() => void choosePlan()}
                            class="mt-6 inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                        >
                            <UploadIcon class="size-4" />
                            Browse files
                        </button>
                    </section>
                )}
            </div>
        </main>
    );
}
