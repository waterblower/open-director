/**
 * Content-addressed storage for reference attachments.
 *
 * The composer sends each attachment inline as a base64 data URL. Persisting
 * that base64 in the generations DB bloats every row (a reference image is
 * easily megabytes), so instead we write the decoded bytes to
 * `<project>/.project/uploads/<sha256>.<ext>` and store only a servable
 * `/project-file/...` reference in the request JSON.
 *
 * Content addressing (hash = filename) means re-using the same reference image
 * across generations writes the file once and dedupes automatically.
 */
import { join } from "@std/path";
import { ContentItem } from "./seedance/seedance.ts";
import { resolveInProject } from "./project.ts";

/** Project-relative uploads dir. Forward slashes — also used to build URLs. */
const UPLOADS_DIR = ".open-director/uploads";

/** Map a data-URL mime type to a file extension for the stored file. */
const MIME_EXT: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
};

/** Parse a `data:<mime>;base64,<payload>` URL into its mime type and bytes. */
function parseDataUrl(
    dataUrl: string,
): { mime: string; bytes: Uint8Array } | Error {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
    if (!match) {
        return new Error(`${dataUrl} is invalid data URL`);
    }
    const mime = match[1] || "application/octet-stream";
    const isBase64 = Boolean(match[2]);
    const payload = match[3];
    const bytes = isBase64
        ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(payload));
    return { mime, bytes };
}

/** Lowercase hex of a byte array. */
function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Write a data URL's bytes to the content-addressed uploads dir and return a
 * servable `/project-file/.project/uploads/<hash>.<ext>` reference. Idempotent:
 * identical bytes hash to the same name, so the write is skipped if the file
 * already exists. Returns null if `dataUrl` isn't a parseable data URL.
 */
export async function storeDataUrl(
    projectRoot: string,
    dataUrl: string,
) {
    const parsed = parseDataUrl(dataUrl);
    if (parsed instanceof Error) {
        return parsed;
    }
    const { mime, bytes } = parsed;

    const digest = await crypto.subtle.digest(
        "SHA-256",
        bytes as Uint8Array<ArrayBuffer>,
    );
    const hash = toHex(new Uint8Array(digest));
    const ext = MIME_EXT[mime.toLowerCase()] ?? "bin";
    const name = `${hash}.${ext}`;

    const dir = await resolveInProject(projectRoot, UPLOADS_DIR);
    if (dir instanceof Error) throw dir;
    await Deno.mkdir(dir, { recursive: true });
    const abs = join(dir, name);
    try {
        await Deno.lstat(abs); // already stored — content-addressed, so identical
    } catch {
        await Deno.writeFile(abs, bytes);
    }

    return `/project-file/${UPLOADS_DIR}/${name}`;
}

/**
 * Return a copy of `content` with every inline data-URL attachment replaced by
 * a stored `/project-file/...` reference. Items that aren't data URLs (already
 * stored references, plain text) pass through unchanged — so this is safe to
 * call on content that's been externalized before.
 */
export async function externalizeAttachments(
    projectRoot: string,
    content: ContentItem[],
): Promise<ContentItem[]> {
    return await Promise.all(
        content.map(async (item): Promise<ContentItem> => {
            if (
                item.type === "image_url" &&
                item.image_url.url.startsWith("data:")
            ) {
                const url = await storeDataUrl(projectRoot, item.image_url.url);
                if (url instanceof Error) {
                    console.error(url);
                    return item;
                }
                return { ...item, image_url: { url } };
            }
            if (
                item.type === "video_url" &&
                item.video_url.url.startsWith("data:")
            ) {
                const url = await storeDataUrl(projectRoot, item.video_url.url);
                return url ? { ...item, video_url: { url } } : item;
            }
            if (
                item.type === "audio_url" &&
                item.audio_url.url.startsWith("data:")
            ) {
                const url = await storeDataUrl(projectRoot, item.audio_url.url);
                if (url instanceof Error) {
                    console.error(url);
                    return item;
                }
                return { ...item, audio_url: { url } };
            }
            return item;
        }),
    );
}
