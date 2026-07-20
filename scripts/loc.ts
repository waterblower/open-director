const extensions = new Set(["ts", "tsx", "css", "json", "md", "html"]);
const excludedDirectories = new Set([
    ".git",
    "_dist",
    "_fresh",
    "node_modules",
]);
const totals = new Map<string, number>();

async function visit(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
        if (entry.isDirectory) {
            if (!excludedDirectories.has(entry.name)) {
                await visit(`${directory}/${entry.name}`);
            }
            continue;
        }
        if (!entry.isFile) continue;

        const extension = entry.name.match(/\.([^.]+)$/)?.[1];
        if (!extension || !extensions.has(extension)) continue;

        const text = await Deno.readTextFile(`${directory}/${entry.name}`);
        const lines = text.length === 0
            ? 0
            : text.split(/\r\n|\r|\n/).length - (text.endsWith("\n") ? 1 : 0);
        totals.set(extension, (totals.get(extension) ?? 0) + lines);
    }
}

await visit(".");

let total = 0;
for (const [extension, lines] of [...totals].sort()) {
    console.log(`${extension.padEnd(6)} ${String(lines).padStart(7)}`);
    total += lines;
}
console.log(`${"total".padEnd(6)} ${String(total).padStart(7)}`);
