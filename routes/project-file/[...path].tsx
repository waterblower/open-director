import { define } from "../../utils.ts";
import { resolveInProject_deprecated } from "../../project.ts";

const CONTENT_TYPES: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
};

/** Stream `length` bytes from an already-seeked file, then close it. */
function limitedStream(
    file: Deno.FsFile,
    length: number,
): ReadableStream<Uint8Array> {
    let remaining = length;
    return new ReadableStream({
        async pull(controller) {
            if (remaining <= 0) {
                controller.close();
                file.close();
                return;
            }
            const buf = new Uint8Array(Math.min(64 * 1024, remaining));
            const n = await file.read(buf);
            if (n === null) {
                controller.close();
                file.close();
                return;
            }
            remaining -= n;
            controller.enqueue(buf.subarray(0, n));
        },
        cancel() {
            file.close();
        },
    });
}

// Streams a file from inside the project dir (e.g. /project-file/.project/vid1.mp4).
// Supports HTTP Range requests so <video> can play/seek.
export const handler = define.handlers({
    async GET(ctx) {
        // Fresh decodes path params, but fall back to a decoded form just in
        // case the raw value is still percent-encoded.
        const candidates = [ctx.params.path];
        try {
            const decoded = decodeURIComponent(ctx.params.path);
            if (decoded !== ctx.params.path) candidates.push(decoded);
        } catch { /* malformed escape — ignore */ }

        let target: string | null = null;
        let size = 0;
        let ext = "";
        for (const rel of candidates) {
            const abs = await resolveInProject_deprecated(rel);
            if (!abs) {
                throw new Error("Path not found");
            }
            try {
                const stat = await Deno.stat(abs);
                if (stat.isFile) {
                    target = abs;
                    size = stat.size;
                    ext = rel.split(".").pop()?.toLowerCase() ?? "";
                    break;
                }
            } catch { /* try next candidate */ }
        }
        if (target === null) return new Response("Not found", { status: 404 });

        const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
        const range = ctx.req.headers.get("range");
        const match = range && /^bytes=(\d*)-(\d*)/.exec(range);

        if (match) {
            const start = match[1] ? Number(match[1]) : 0;
            const end = match[2] ? Number(match[2]) : size - 1;
            if (start > end || start >= size) {
                return new Response("Range Not Satisfiable", {
                    status: 416,
                    headers: { "content-range": `bytes */${size}` },
                });
            }
            const clampedEnd = Math.min(end, size - 1);
            const length = clampedEnd - start + 1;
            const file = await Deno.open(target, { read: true });
            await file.seek(start, Deno.SeekMode.Start);
            return new Response(limitedStream(file, length), {
                status: 206,
                headers: {
                    "content-type": contentType,
                    "content-length": String(length),
                    "content-range": `bytes ${start}-${clampedEnd}/${size}`,
                    "accept-ranges": "bytes",
                },
            });
        }

        const file = await Deno.open(target, { read: true });
        return new Response(file.readable, {
            status: 200,
            headers: {
                "content-type": contentType,
                "content-length": String(size),
                "accept-ranges": "bytes",
            },
        });
    },
});
