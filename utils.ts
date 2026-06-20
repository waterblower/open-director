import { createDefine } from "fresh";
import { join } from "@std/path";

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
    shared: string;
}

export const define = createDefine<State>();

// Servable URL for a generated video. Leading-slash absolute path (matching the
// `/project-file/...` convention everywhere else) so it loads regardless of the
// current page and so consumers can strip the `/project-file/` prefix to get a
// project-relative path (e.g. for drag-and-drop copy).
export function get_video_url(task_id: string) {
    return join(
        "/project-file",
        ".open-director",
        "generations",
        `${task_id}.mp4`,
    );
}

/** Hex-encoded SHA-256 digest of `bytes`, for content-addressing files. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
