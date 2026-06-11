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
    | (string & {});

export type SeedanceModel = "doubao-seedance-2-0-260128";

export interface CreateTaskRequest {
    /** Model ID */
    model: SeedanceModel;
    /** Multimodal prompt — text, images, video reference, audio reference */
    content: ContentItem[];
    /** Generate audio track for the output video */
    generate_audio?: boolean;
    /** Output aspect ratio */
    ratio?: AspectRatio;
    /** Output duration in seconds */
    duration?: number;
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
    | "cancelled";

export interface TaskOutput {
    video_url?: string;
    audio_url?: string;
    cover_image_url?: string;
}

export interface TaskError {
    code: string;
    message: string;
}

export interface TaskUsage {
    /** Total tokens consumed */
    total_tokens?: number;
    /** Video duration in seconds billed */
    video_duration?: number;
}

export interface Task {
    /** Unique task ID */
    id: string;
    /** Model used for this task */
    model: string;
    /** Current task status */
    status: TaskStatus;
    /** Unix timestamp (seconds) when the task was created */
    created_at: number;
    /** Unix timestamp (seconds) when the task finished */
    finished_at?: number;
    /** The content submitted in the creation request */
    content: ContentItem[];
    /** Available when status is "succeeded" */
    output?: TaskOutput;
    /** Available when status is "failed" */
    error?: TaskError;
    usage?: TaskUsage;
}

// ---------------------------------------------------------------------------
// List endpoint types
// ---------------------------------------------------------------------------

export interface ListTasksRequest {
    /** Page number, 1-based */
    page_num?: number;
    /** Items per page */
    page_size?: number;
    /** Filter by status */
    status?: TaskStatus;
    /** Filter by model */
    model?: string;
}

export interface ListTasksResponse {
    items: Task[];
    total: number;
    page_num: number;
    page_size: number;
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
    /** Default fetch timeout in milliseconds. Defaults to 30_000. */
    timeoutMs?: number;
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
    readonly timeoutMs: number;

    constructor(options: SeedanceClientOptions) {
        this.apiKey = options.apiKey;
        this.baseUrl =
            (options.baseUrl ?? "https://ark.cn-beijing.volces.com/api/v3")
                .replace(/\/$/, "");
        this.timeoutMs = options.timeoutMs ?? 30_000;
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

    async listTasks(params?: ListTasksRequest): Promise<ListTasksResponse> {
        const query = new URLSearchParams();
        if (params?.page_num !== undefined) {
            query.set("page_num", String(params.page_num));
        }
        if (params?.page_size !== undefined) {
            query.set("page_size", String(params.page_size));
        }
        if (params?.status) query.set("status", params.status);
        if (params?.model) query.set("model", params.model);
        const qs = query.toString();
        return this.get<ListTasksResponse>(
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
                task.status === "cancelled"
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
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

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
