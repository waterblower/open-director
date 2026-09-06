export async function data_url(path: string) {
    const file = new URL(path, import.meta.url);
    const extension = file.pathname.split(".").pop()?.toLowerCase();
    const mimeType = extension === "png"
        ? "image/png"
        : extension === "jpg" || extension === "jpeg"
        ? "image/jpeg"
        : extension === "webp"
        ? "image/webp"
        : extension === "gif"
        ? "image/gif"
        : undefined;

    if (!mimeType) {
        throw new Error(`Unsupported image type: ${path}`);
    }

    const bytes = await Deno.readFile(file);
    return `data:${mimeType};base64,${bytes.toBase64()}`;
}
