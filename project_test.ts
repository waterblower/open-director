import { resolve } from "@std/path";
import { loadFileExplorerState, resolveInProject } from "./project.ts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function createDirectoryLink(
    target: string,
    link: string,
): Promise<void> {
    try {
        await Deno.symlink(target, link, { type: "dir" });
        return;
    } catch (symlinkError) {
        if (Deno.build.os !== "windows") throw symlinkError;

        // Windows directory symlinks require Developer Mode or elevation;
        // junctions do not and exercise the same real-path containment rule.
        const result = await new Deno.Command("powershell", {
            args: [
                "-NoProfile",
                "-Command",
                "& { param($link, $target) New-Item -ItemType Junction -Path $link -Target $target | Out-Null }",
                link,
                target,
            ],
            stderr: "piped",
        }).output();
        if (!result.success) {
            const detail = new TextDecoder().decode(result.stderr).trim();
            throw new Error(`Unable to create test junction: ${detail}`, {
                cause: symlinkError,
            });
        }
    }
}

Deno.test("resolveInProject accepts contained existing and missing paths", async () => {
    const temp = await Deno.makeTempDir({ prefix: "open-director-path-" });
    try {
        const root = resolve(temp, "project");
        const existing = resolve(root, "media", "clip.mp4");
        await Deno.mkdir(resolve(root, "media"), { recursive: true });
        await Deno.writeTextFile(existing, "video");

        const existingResult = await resolveInProject(root, "media/clip.mp4");
        assert(
            existingResult === await Deno.realPath(existing),
            "Existing project file did not resolve canonically",
        );

        const missingResult = await resolveInProject(root, "new/output.mp4");
        assert(
            missingResult ===
                resolve(await Deno.realPath(root), "new", "output.mp4"),
            "Missing project path did not resolve beneath its existing ancestor",
        );
    } finally {
        await Deno.remove(temp, { recursive: true });
    }
});

Deno.test("resolveInProject rejects lexical traversal and absolute paths", async () => {
    const temp = await Deno.makeTempDir({ prefix: "open-director-path-" });
    try {
        const root = resolve(temp, "project");
        const outside = resolve(temp, "outside", "secret.txt");
        await Deno.mkdir(root, { recursive: true });
        await Deno.mkdir(resolve(temp, "outside"), { recursive: true });
        await Deno.writeTextFile(outside, "secret");

        assert(
            await resolveInProject(root, "../outside/secret.txt") instanceof
                Error,
            "Parent traversal escaped the project",
        );
        assert(
            await resolveInProject(root, outside) instanceof Error,
            "Absolute path escaped the project",
        );
    } finally {
        await Deno.remove(temp, { recursive: true });
    }
});

Deno.test("resolveInProject rejects symlink and junction escapes", async () => {
    const temp = await Deno.makeTempDir({ prefix: "open-director-path-" });
    try {
        const root = resolve(temp, "project");
        const outside = resolve(temp, "outside");
        const link = resolve(root, "linked");
        await Deno.mkdir(root, { recursive: true });
        await Deno.mkdir(outside, { recursive: true });
        await Deno.writeTextFile(resolve(outside, "secret.txt"), "secret");

        await createDirectoryLink(outside, link);

        assert(
            await resolveInProject(root, "linked/secret.txt") instanceof Error,
            "Existing symlink escaped the project",
        );
        assert(
            await resolveInProject(root, "linked/new/file.txt") instanceof
                Error,
            "Symlinked parent escaped the project for a missing target",
        );
    } finally {
        await Deno.remove(temp, { recursive: true });
    }
});

Deno.test("loadFileExplorerState migrates legacy root-relative paths", async () => {
    const root = await Deno.makeTempDir({ prefix: "open-director-path-" });
    try {
        const stateDir = resolve(root, ".open-director");
        await Deno.mkdir(stateDir);
        await Deno.writeTextFile(
            resolve(stateDir, "file-explorer.json"),
            JSON.stringify({
                expanded: ["/shots", "/shots/day", "/shots"],
                selected: "/shots/clip.mp4",
            }),
        );

        const state = await loadFileExplorerState(root);
        assert(!(state instanceof Error), "Explorer state failed to load");
        assert(
            JSON.stringify(state.expanded) ===
                JSON.stringify(["shots", "shots/day"]),
            "Legacy expanded paths were not migrated",
        );
        assert(
            state.selected === "shots/clip.mp4",
            "Legacy selected path was not migrated",
        );
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
