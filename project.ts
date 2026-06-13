/** Helpers for resolving paths inside the configured project directory. */

/** Resolve the project directory from the `project` entry in .env. */
export async function projectDir(): Promise<string> {
    // Prefer an already-loaded env var; fall back to reading .env directly
    // (the Vite dev server doesn't populate Deno.env from .env).
    const fromEnv = Deno.env.get("project");
    if (fromEnv) return fromEnv;

    const text = await Deno.readTextFile(".env");
    for (const line of text.split("\n")) {
        const match = line.match(/^\s*project\s*=\s*(.*)$/);
        if (match) return match[1].trim();
    }
    throw new Error("`project` is not set in .env");
}

/** Resolve a project-relative path to an absolute one, rejecting traversal. */
export async function resolveInProject(sub: string): Promise<string> {
    if (sub.includes("..")) throw new Error("Path may not contain '..'");
    const root = await projectDir();
    return sub ? `${root}/${sub}` : root;
}
