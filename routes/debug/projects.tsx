import { Head } from "fresh/runtime";
import { basename } from "@std/path";
import { define } from "../../utils.ts";
import { listProjects } from "../../project_registry.ts";
import { kv } from "../../kv.ts";

function formatOpenedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export default define.page(async function ProjectsPage() {
    const projects = await listProjects(kv);

    return (
        <>
            <Head>
                <title>Projects · Open Director</title>
                <meta
                    name="description"
                    content="Every project opened with Open Director."
                />
            </Head>

            <main class="min-h-screen bg-slate-50 px-5 py-10 text-slate-900 sm:px-8">
                <div class="mx-auto max-w-4xl">
                    <header class="mb-7 flex items-end justify-between gap-4">
                        <div>
                            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">
                                Open Director
                            </p>
                            <h1 class="text-3xl font-bold tracking-tight">
                                Projects
                            </h1>
                            <p class="mt-2 text-sm text-slate-500">
                                Every project folder opened on this computer.
                            </p>
                        </div>
                        <span class="shrink-0 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
                            {projects.length}{" "}
                            {projects.length === 1 ? "project" : "projects"}
                        </span>
                    </header>

                    {projects.length === 0
                        ? (
                            <section class="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
                                <span class="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                                    <FolderIcon class="size-6" />
                                </span>
                                <h2 class="font-semibold text-slate-700">
                                    No projects yet
                                </h2>
                                <p class="mt-1 text-sm text-slate-400">
                                    Projects appear here after they are opened
                                    in Open Director.
                                </p>
                            </section>
                        )
                        : (
                            <ol class="space-y-3">
                                {projects.map((project) => (
                                    <li
                                        key={project.path}
                                        class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                                    >
                                        <div class="flex min-w-0 items-start gap-4">
                                            <span class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
                                                <FolderIcon class="size-5" />
                                            </span>
                                            <div class="min-w-0 flex-1">
                                                <h2 class="truncate text-base font-semibold text-slate-800">
                                                    {basename(project.path) ||
                                                        project.path}
                                                </h2>
                                                <p class="mt-1 break-all font-mono text-xs leading-5 text-slate-500">
                                                    {project.path}
                                                </p>
                                                <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                                                    <span>
                                                        Last opened{" "}
                                                        {formatOpenedAt(
                                                            project
                                                                .lastOpenedAt,
                                                        )}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        )}
                </div>
            </main>
        </>
    );
});

function FolderIcon(props: { class?: string }) {
    return (
        <svg
            class={props.class}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
        </svg>
    );
}
