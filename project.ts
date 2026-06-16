import { getStoredProjectPath } from "./kv.ts";

/** Resolve a project-relative path to an absolute one, rejecting traversal. */
export async function resolveInProject(sub: string) {
    if (sub.includes("..")) throw new Error("Path may not contain '..'");
    const root = await getStoredProjectPath();
    return sub ? `${root}/${sub}` : root;
}

/**
 * Open a native OS folder picker and return the chosen absolute path, or null
 * if the user cancelled (or no picker tool is available). Runs server-side, so
 * the dialog appears on the machine hosting the backend.
 */
export async function pickProjectFolder(): Promise<string | null> {
    const command = (() => {
        switch (Deno.build.os) {
            case "darwin":
                return new Deno.Command("osascript", {
                    args: [
                        "-e",
                        'POSIX path of (choose folder with prompt "选择项目文件夹")',
                    ],
                });
            case "windows":
                return new Deno.Command("powershell", {
                    args: [
                        "-NoProfile",
                        "-STA",
                        "-Command",
                        "Add-Type -AssemblyName System.Windows.Forms;" +
                        "$f=New-Object System.Windows.Forms.FolderBrowserDialog;" +
                        "$f.AutoUpgradeEnabled=$true;" +
                        "if($f.ShowDialog() -eq 'OK'){" +
                        "[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($f.SelectedPath))" +
                        "}",
                    ],
                });
            default: // linux & others — needs `zenity` installed
                return new Deno.Command("zenity", {
                    args: [
                        "--file-selection",
                        "--directory",
                        "--title=选择项目文件夹",
                    ],
                });
        }
    })();

    const { success, stdout } = await command.output();
    if (!success) return null; // cancelled, or the picker tool is missing
    const out = new TextDecoder().decode(stdout).trim();
    if (!out) return null;
    const path = Deno.build.os === "windows"
        ? new TextDecoder().decode(
            Uint8Array.from(atob(out), (char) => char.charCodeAt(0)),
        )
        : out;
    // macOS `POSIX path` has a trailing slash; trim it (but keep root "/").
    console.log("pickProjectFolder", path);
    return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
