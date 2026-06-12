/**
 * Seedance 2.0 SDK — Volcano Engine Ark
 * https://www.volcengine.com/docs/82379/1520757
 */

// ---------------------------------------------------------------------------
// Content item types
// ---------------------------------------------------------------------------

export interface TextContent {
    type: "text";
    text: string;
}

export interface ImageContent {
    type: "image_url";
    image_url: { url: string };
    role?: "reference_image";
}

export interface VideoContent {
    type: "video_url";
    video_url: { url: string };
    role?: "reference_video";
}

export interface AudioContent {
    type: "audio_url";
    audio_url: { url: string };
    role?: "reference_audio";
}

export type ContentItem =
    | TextContent
    | ImageContent
    | VideoContent
    | AudioContent;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export type AspectRatio =
    | "16:9"
    | "9:16"
    | "1:1"
    | "4:3"
    | "3:4"
    | "21:9"
    | "adaptive"
    | (string & {});

export type Resolution = "480p" | "720p" | "1080p";

export type ServiceTier = "default" | "flex";

export type SeedanceModel = "doubao-seedance-2-0-260128";

/** Tool the model may call. Only supported by Seedance 2.0 & 2.0 fast. */
export interface SeedanceTool {
    type: string;
    [key: string]: unknown;
}

export interface CreateTaskRequest {
    /** Model ID, or an inference endpoint ID (ep-...) configured with a video model */
    model: SeedanceModel | (string & {});
    /**
     * Multimodal prompt — text, images, video reference, audio reference,
     * or a draft task ID. Supported combinations: text alone, or optional
     * text plus any of image / video / image+audio / image+video /
     * video+audio / image+video+audio.
     */
    content: ContentItem[];
    /**
     * Callback URL notified via POST whenever the task status changes
     * (queued / running / succeeded / failed / expired). The payload matches
     * the query-task API response body.
     */
    callback_url?: string;
    /**
     * true: also produce the last frame of the generated video (PNG, same
     * dimensions as the video, no watermark), retrievable via the query-task
     * API. Useful for chaining consecutive videos. Default false.
     */
    return_last_frame?: boolean;
    /**
     * Generate an audio track (voice, sound effects, background music)
     * synchronized with the video. Put dialogue in double quotes for best
     * results. Only Seedance 2.0 & 2.0 fast and Seedance 1.5 pro.
     */
    generate_audio?: boolean;
    /**
     * Draft (sample) mode — generates a cheap preview video to validate scene
     * structure, camera work, and prompt intent. Only Seedance 1.5 pro.
     */
    draft?: boolean;
    /** Tools the model may call. Only Seedance 2.0 & 2.0 fast. */
    tools?: SeedanceTool[];
    /**
     * Stable, unique end-user identifier (≤64 ASCII chars) to help the
     * platform detect policy violations. Prefer a hash of the username,
     * user ID, or email.
     */
    safety_identifier?: string;
    /**
     * Service tier. "default": online inference (lower RPM/concurrency
     * quota, low latency). "flex": offline inference (higher TPD quota,
     * 50% of the online price). Seedance 2.0 & 2.0 fast do not support
     * "flex". Cannot be changed after the task is submitted.
     */
    service_tier?: ServiceTier;
    /**
     * Task expiry in seconds, counted from created_at. Tasks still queued or
     * running past this are terminated and marked "expired".
     * Range [3600, 259200]. Defaults to 172800 (48 h).
     */
    execution_expires_after?: number;
    /**
     * Output resolution. "1080p" is not supported by Seedance 2.0 fast or
     * Seedance 1.0 lite reference-image mode. Defaults to "720p"
     * ("1080p" for Seedance 1.0 pro & pro-fast).
     */
    resolution?: Resolution;
    /**
     * Output aspect ratio. "adaptive" picks the best fit for the input.
     * Defaults to "adaptive" for Seedance 2.0 & 2.0 fast and 1.5 pro;
     * for other models, "16:9" (text-to-video) or "adaptive" (image-to-video).
     */
    ratio?: AspectRatio;
    /**
     * Output duration in whole seconds. Seedance 2.0 & 2.0 fast: [4, 15]
     * or -1; Seedance 1.5 pro: [4, 12] or -1; Seedance 1.0 pro / pro-fast /
     * lite: [2, 12]. If both are set, `frames` takes precedence.
     */
    duration?: number;
    /**
     * Output length in frames (duration × 24 fps) for fractional-second
     * videos. Valid values: integers of the form 25 + 4n within [29, 289].
     * Takes precedence over `duration`. Not supported by Seedance 2.0 &
     * 2.0 fast or Seedance 1.5 pro.
     */
    frames?: number;
    /** Random seed controlling generation. Integer in [-1, 2^32-1]. */
    seed?: number;
    /**
     * true: append a fixed-camera instruction to the prompt (best effort).
     * Not supported in reference-image mode or by Seedance 2.0 & 2.0 fast.
     */
    camera_fixed?: boolean;
    /** Embed watermark in the output video */
    watermark?: boolean;
}

// ---------------------------------------------------------------------------
// Response / task types
// ---------------------------------------------------------------------------

export type TaskStatus =
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "expired";

export interface TaskContent {
    /** URL of the generated video. Present once the task has succeeded. Valid for 24h. */
    video_url?: string;
    /** URL of the video's last frame image. Returned when return_last_frame was true. Valid for 24h. */
    last_frame_url?: string;
}

export interface TaskError {
    code: string;
    message: string;
}

export interface TaskUsage {
    /** Tokens consumed generating the video */
    completion_tokens?: number;
    /** Total tokens consumed */
    total_tokens?: number;
}

export interface Task {
    /** Unique task ID */
    id: string;
    /** Model used for this task */
    model: string;
    /** Current task status */
    status: TaskStatus;
    /** Generated output. `video_url` is present once status is "succeeded". */
    content?: TaskContent;
    usage?: TaskUsage;
    /** Unix timestamp (seconds) when the task was created */
    created_at: number;
    /** Unix timestamp (seconds) when the task was last updated */
    updated_at?: number;
    /** Random seed used for generation */
    seed?: number;
    resolution?: Resolution;
    ratio?: AspectRatio;
    /** Output duration in whole seconds */
    duration?: number;
    /** Output frame rate */
    framespersecond?: number;
    service_tier?: ServiceTier;
    /** Task expiry in seconds, counted from created_at */
    execution_expires_after?: number;
    generate_audio?: boolean;
    draft?: boolean;
    priority?: number;
    /** Available when status is "failed" */
    error?: TaskError;
}

// ---------------------------------------------------------------------------
// List endpoint types
// ---------------------------------------------------------------------------

export interface ListTasksResponse {
    items: Task[];
    total: number;
}

// ---------------------------------------------------------------------------
// Cancel / delete response
// ---------------------------------------------------------------------------

export interface CancelTaskResponse {
    id: string;
    status: TaskStatus;
}

// ---------------------------------------------------------------------------
// File API types
// ---------------------------------------------------------------------------

export type FilePurpose =
    | "user_data"
    | "agent";

export type FileStatus = "uploaded" | "processed" | "error";

export interface ArkFile {
    id: string;
    object: "file";
    /** File size in bytes */
    bytes: number;
    /** Unix timestamp (seconds) when the file was created */
    created_at: number;
    /** Unix timestamp (seconds) when the file expires */
    expire_at?: number;
    filename: string;
    mime_type?: string;
    purpose: FilePurpose;
    status: FileStatus;
    /** Error details when status is "error" */
    status_details?: string;
}

export interface ListFilesRequest {
    /** Filter by purpose */
    purpose?: FilePurpose;
    /** Maximum number of files to return (1–10000). Defaults to 10000. */
    limit?: number;
    /** Cursor for forward pagination — file ID to start after */
    after?: string;
    /** Sort order by created_at. "asc" or "desc". Defaults to "desc". */
    order?: "asc" | "desc";
}

export interface ListFilesResponse {
    object: "list";
    data: ArkFile[];
    has_more: boolean;
    first_id?: string;
    last_id?: string;
}

export interface DeleteFileResponse {
    id: string;
    object: "file";
    deleted: boolean;
}

export interface UploadFileRequest {
    /** The file content — a Blob, File, or any BodyInit-compatible value */
    file: Blob | File;
    /** Intended use of the file */
    purpose: FilePurpose;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class SeedanceError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly requestId?: string,
    ) {
        super(`[${status}] ${code}: ${message}`);
        this.name = "SeedanceError";
    }
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface SeedanceClientOptions {
    apiKey: string;
    /** Defaults to "https://ark.cn-beijing.volces.com/api/v3" */
    baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Poll options (used by waitForCompletion)
// ---------------------------------------------------------------------------

export interface PollOptions {
    /** How often to poll in milliseconds. Defaults to 3_000. */
    intervalMs?: number;
    /** Maximum time to wait in milliseconds. Defaults to 300_000 (5 min). */
    timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SeedanceClient {
    readonly apiKey: string;
    readonly baseUrl: string;

    constructor(options: SeedanceClientOptions) {
        this.apiKey = options.apiKey;
        this.baseUrl =
            (options.baseUrl ?? "https://ark.cn-beijing.volces.com/api/v3")
                .replace(/\/$/, "");
    }

    // -------------------------------------------------------------------------
    // Create a video generation task
    // POST /contents/generations/tasks
    // -------------------------------------------------------------------------

    async createTask(request: CreateTaskRequest): Promise<Task> {
        return this.post<Task>("/contents/generations/tasks", request);
    }

    // -------------------------------------------------------------------------
    // Query a single task by ID
    // GET /contents/generations/tasks/{id}
    // -------------------------------------------------------------------------

    async getTask(taskId: string): Promise<Task> {
        return this.get<Task>(
            `/contents/generations/tasks/${encodeURIComponent(taskId)}`,
        );
    }

    // -------------------------------------------------------------------------
    // List tasks
    // GET /contents/generations/tasks
    // -------------------------------------------------------------------------

    async listTasks(params?: {
        /** Page number, 1-based. Range [1, 500]. Defaults to 1. */
        page_num?: number;
        /** Items per page. Range [1, 500]. Defaults to 20. */
        page_size?: number;
        /** Filter by task status */
        status?: TaskStatus;
        /** Filter by task IDs (exact match, multiple allowed) */
        task_ids?: string[];
        /** Filter by inference endpoint ID (exact match) */
        model?: string;
        /** Filter by service tier */
        service_tier?: ServiceTier;
    }): Promise<ListTasksResponse> {
        const query = new URLSearchParams();
        if (params?.page_num !== undefined) {
            query.set("page_num", String(params.page_num));
        }
        if (params?.page_size !== undefined) {
            query.set("page_size", String(params.page_size));
        }
        if (params?.status) query.set("filter.status", params.status);
        // task_ids is passed as a repeated query parameter
        for (const id of params?.task_ids ?? []) {
            query.append("filter.task_ids", id);
        }
        if (params?.model) query.set("filter.model", params.model);
        if (params?.service_tier) {
            query.set("filter.service_tier", params.service_tier);
        }
        const qs = query.toString();
        return await this.get<ListTasksResponse>(
            `/contents/generations/tasks${qs ? `?${qs}` : ""}`,
        );
    }

    // -------------------------------------------------------------------------
    // Cancel or delete a task
    // DELETE /contents/generations/tasks/{id}
    // -------------------------------------------------------------------------

    async cancelTask(taskId: string): Promise<CancelTaskResponse> {
        return this.delete<CancelTaskResponse>(
            `/contents/generations/tasks/${encodeURIComponent(taskId)}`,
        );
    }

    // -------------------------------------------------------------------------
    // Poll until a task reaches a terminal state
    // -------------------------------------------------------------------------

    async waitForCompletion(
        taskId: string,
        options?: PollOptions,
    ): Promise<Task> {
        const intervalMs = options?.intervalMs ?? 3_000;
        const timeoutMs = options?.timeoutMs ?? 300_000;
        const deadline = Date.now() + timeoutMs;

        while (true) {
            const task = await this.getTask(taskId);

            if (
                task.status === "succeeded" || task.status === "failed" ||
                task.status === "cancelled" || task.status === "expired"
            ) {
                return task;
            }

            if (Date.now() + intervalMs > deadline) {
                throw new SeedanceError(
                    408,
                    "timeout",
                    `Task ${taskId} did not complete within ${timeoutMs}ms`,
                );
            }

            await delay(intervalMs);
        }
    }

    // -------------------------------------------------------------------------
    // Convenience: create task and wait for completion
    // -------------------------------------------------------------------------

    async generate(
        request: CreateTaskRequest,
        pollOptions?: PollOptions,
    ): Promise<Task> {
        const task = await this.createTask(request);
        return this.waitForCompletion(task.id, pollOptions);
    }

    // -------------------------------------------------------------------------
    // File API
    // -------------------------------------------------------------------------

    async uploadFile(request: UploadFileRequest): Promise<ArkFile> {
        const form = new FormData();
        form.append("file", request.file);
        form.append("purpose", request.purpose);
        return this.postForm<ArkFile>("/files", form);
    }

    async getFile(fileId: string): Promise<ArkFile> {
        return this.get<ArkFile>(`/files/${encodeURIComponent(fileId)}`);
    }

    async listFiles(params?: ListFilesRequest): Promise<ListFilesResponse> {
        const query = new URLSearchParams();
        if (params?.purpose) query.set("purpose", params.purpose);
        if (params?.limit !== undefined) {
            query.set("limit", String(params.limit));
        }
        if (params?.after) query.set("after", params.after);
        if (params?.order) query.set("order", params.order);
        const qs = query.toString();
        return this.get<ListFilesResponse>(`/files${qs ? `?${qs}` : ""}`);
    }

    async deleteFile(fileId: string): Promise<DeleteFileResponse> {
        return this.delete<DeleteFileResponse>(
            `/files/${encodeURIComponent(fileId)}`,
        );
    }

    // -------------------------------------------------------------------------
    // Internal HTTP helpers
    // -------------------------------------------------------------------------

    async postForm<T>(path: string, form: FormData): Promise<T> {
        // Do NOT set Content-Type — the browser/runtime must set it with the boundary
        const res = await this.fetchRaw(path, { method: "POST", body: form });
        return this.parseResponse<T>(res);
    }

    async post<T>(path: string, body: unknown): Promise<T> {
        const res = await this.fetchRaw(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return this.parseResponse<T>(res);
    }

    async get<T>(path: string): Promise<T> {
        const res = await this.fetchRaw(path, { method: "GET" });
        return this.parseResponse<T>(res);
    }

    async delete<T>(path: string): Promise<T> {
        const res = await this.fetchRaw(path, { method: "DELETE" });
        return this.parseResponse<T>(res);
    }

    async fetchRaw(path: string, init: RequestInit): Promise<Response> {
        const url = `${this.baseUrl}${path}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1000 * 60 * 30); // 30 minutes

        try {
            return await fetch(url, {
                ...init,
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    ...init.headers,
                },
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    }

    async parseResponse<T>(res: Response): Promise<T> {
        const requestId = res.headers.get("x-request-id") ?? undefined;
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
            const code = body?.error?.code ?? body?.code ?? String(res.status);
            const message = body?.error?.message ?? body?.message ??
                res.statusText;
            throw new SeedanceError(res.status, code, message, requestId);
        }

        return body as T;
    }
}

// ---------------------------------------------------------------------------
// Internal utility
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
