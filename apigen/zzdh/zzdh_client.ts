/**
 * Standalone client for the 字字动画 MiniMax H3 limited-offer API.
 *
 * This module intentionally implements only text-to-video generation for the
 * `zzdh-minimax-h3-限时优惠` series.
 */

const API_ORIGIN = "http://zizidonghua.com";

export const ZZDH_MODELS = [
    "zzdh-minimax-h3-限时优惠-文生-480p",
    "zzdh-minimax-h3-限时优惠-文生-768p",
] as const;

export type ZzdhModel = (typeof ZZDH_MODELS)[number];
export type ZzdhAspectRatio = "horizontal" | "vertical";
export type ZzdhTaskStatus =
    | "queued"
    | "in_progress"
    | "completed"
    | "failed";

export type TextToVideoModel = ZzdhModel;

interface CommonCreateTaskFields {
    /** Whole-number output duration from 1 through 15 seconds. Defaults to 5. */
    duration?: number;
    /** Defaults to vertical. The API does not support 1:1 for this series. */
    aspect_ratio?: ZzdhAspectRatio;
    seed?: number;
}

export interface TextToVideoRequest extends CommonCreateTaskFields {
    model: TextToVideoModel;
    prompt: string;
}

export type CreateZzdhTaskRequest = TextToVideoRequest;

interface ZzdhResponseData {
    [key: string]: unknown;
}

export type CreateZzdhTaskResponse =
    & ZzdhResponseData
    & (
        | { id: string; task_id?: string }
        | { id?: string; task_id: string }
    );

export interface ZzdhTask extends ZzdhResponseData {
    id?: string;
    task_id?: string;
    status: ZzdhTaskStatus;
}

export interface ZzdhClientOptions {
    apiKey: string;
}

export class ZzdhApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
    ) {
        super(`[${status}] ${code}: ${message}`);
        this.name = "ZzdhApiError";
    }
}

export class ZzdhClient {
    readonly apiKey: string;

    constructor(options: ZzdhClientOptions) {
        this.apiKey = options.apiKey;
    }

    /** POST /v8/videos/generations */
    async createTask(
        request: CreateZzdhTaskRequest,
    ): Promise<CreateZzdhTaskResponse | Error> {
        const validation = validateCreateTaskRequest(request);
        if (validation) return validation;

        // Build the body from the documented fields so additional runtime
        // properties supplied by untyped callers are never forwarded.
        const body: Record<string, unknown> = {
            model: request.model,
            prompt: request.prompt,
            duration: request.duration,
            aspect_ratio: request.aspect_ratio,
            seed: request.seed,
        };
        for (const key of Object.keys(body)) {
            if (body[key] === undefined) delete body[key];
        }

        const response = await this.requestJson("/v8/videos/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (response instanceof Error) return response;

        if (!isRecord(response)) {
            return invalidResponse("Create-task response was not an object");
        }
        if (
            !isNonEmptyString(response.id) &&
            !isNonEmptyString(response.task_id)
        ) {
            return invalidResponse(
                "Create-task response did not contain id or task_id",
            );
        }
        return response as CreateZzdhTaskResponse;
    }

    /** GET /v8/videos/generations/{task_id} */
    async getTask(taskId: string): Promise<ZzdhTask | Error> {
        const validation = validateTaskId(taskId);
        if (validation) return validation;
        const response = await this.requestJson(
            `/v8/videos/generations/${encodeURIComponent(taskId)}`,
            { method: "GET" },
        );
        if (response instanceof Error) return response;

        if (!isRecord(response) || !isTaskStatus(response.status)) {
            return invalidResponse(
                "Task response did not contain a documented status",
            );
        }
        return response as ZzdhTask;
    }

    /**
     * GET /v1/videos/{task_id}/content
     *
     * Returns the successful response unchanged so callers can consume it as
     * a stream, Blob, or ArrayBuffer without the client altering video bytes.
     */
    async getContent(taskId: string): Promise<Response | Error> {
        const validation = validateTaskId(taskId);
        if (validation) return validation;
        const response = await this.fetch(
            `/v1/videos/${encodeURIComponent(taskId)}/content`,
            { method: "GET" },
        );
        if (response instanceof Error) return response;
        if (!response.ok) return await responseError(response);
        return response;
    }

    private async requestJson(
        path: string,
        init: RequestInit,
    ): Promise<unknown | Error> {
        const response = await this.fetch(path, init);
        if (response instanceof Error) return response;
        if (!response.ok) return await responseError(response);

        try {
            return await response.json();
        } catch {
            return invalidResponse("Response body was not valid JSON");
        }
    }

    private async fetch(
        path: string,
        init: RequestInit,
    ): Promise<Response | Error> {
        try {
            return await fetch(`${API_ORIGIN}${path}`, {
                ...init,
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    ...init.headers,
                },
            });
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            return new ZzdhApiError(0, "network_error", message);
        }
    }
}

export function validateCreateTaskRequest(
    request: CreateZzdhTaskRequest,
): ZzdhApiError | undefined {
    if (!isRecord(request)) {
        return validationError("Request must be an object");
    }
    if (!(ZZDH_MODELS as readonly string[]).includes(request.model)) {
        return validationError("model is not a documented ZZDH model");
    }
    if (
        request.duration !== undefined &&
        (!Number.isInteger(request.duration) || request.duration < 1 ||
            request.duration > 15)
    ) {
        return validationError("duration must be an integer from 1 to 15");
    }
    if (
        request.aspect_ratio !== undefined &&
        request.aspect_ratio !== "horizontal" &&
        request.aspect_ratio !== "vertical"
    ) {
        return validationError(
            "aspect_ratio must be horizontal or vertical",
        );
    }
    if (request.seed !== undefined && !Number.isInteger(request.seed)) {
        return validationError("seed must be an integer");
    }
    if (!isNonEmptyString(request.prompt)) {
        return validationError("prompt is required and cannot be empty");
    }
}

function validateTaskId(taskId: string): ZzdhApiError | undefined {
    if (!isNonEmptyString(taskId)) {
        return validationError("taskId cannot be empty");
    }
}

function isTaskStatus(value: unknown): value is ZzdhTaskStatus {
    return value === "queued" || value === "in_progress" ||
        value === "completed" || value === "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null &&
        !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function validationError(message: string): ZzdhApiError {
    return new ZzdhApiError(0, "validation_error", message);
}

function invalidResponse(message: string): ZzdhApiError {
    return new ZzdhApiError(0, "invalid_response", message);
}

async function responseError(response: Response): Promise<ZzdhApiError> {
    const text = await response.text().catch(() => "");
    let body: unknown;
    try {
        body = text ? JSON.parse(text) : undefined;
    } catch {
        body = undefined;
    }

    const record = isRecord(body) ? body : undefined;
    const nestedError = isRecord(record?.error) ? record.error : undefined;
    const code = isNonEmptyString(nestedError?.code)
        ? nestedError.code
        : isNonEmptyString(record?.code)
        ? record.code
        : String(response.status);
    const message = isNonEmptyString(nestedError?.message)
        ? nestedError.message
        : isNonEmptyString(record?.message)
        ? record.message
        : text || response.statusText;

    return new ZzdhApiError(response.status, code, message);
}
