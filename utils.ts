import { createDefine } from "fresh";
import { join } from "@std/path";

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
    shared: string;
}

export const define = createDefine<State>();

export function get_video_url(task_id: string) {
    return join(
        "project-file",
        ".project",
        "generations",
        `${encodeURIComponent(task_id)}.mp4`,
    );
}
