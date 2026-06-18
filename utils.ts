import { createDefine } from "fresh";

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
    return `/project-file/.project/generations/${
        encodeURIComponent(task_id)
    }.mp4`;
}
