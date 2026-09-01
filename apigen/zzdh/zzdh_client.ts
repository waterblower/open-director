/**
 * Standalone client for the 字字动画 MiniMax H3 limited-offer API.
 *
 * This module intentionally implements only text-to-video generation for the
 * `zzdh-minimax-h3-限时优惠` series.
 */
import { z } from "zod";

const API_ORIGIN = "http://zizidonghua.com";

export const ZZDH_MODELS = [
    "zzdh-minimax-h3-限时优惠-文生-480p",
    "zzdh-minimax-h3-限时优惠-文生-768p",
] as const;

export const ZzdhModelSchema = z.enum(ZZDH_MODELS);
export const ZzdhAspectRatioSchema = z.enum(["horizontal", "vertical"]);
export const ZzdhTaskStatusSchema = z.enum([
    "queued",
    "in_progress",
    "completed",
    "failed",
]);

const NonEmptyStringSchema = z.string().refine(
    (value) => value.trim().length > 0,
    { error: "String cannot be empty" },
);

export const CreateZzdhTaskRequestSchema = z.object({
    model: ZzdhModelSchema,
    prompt: NonEmptyStringSchema,
    /** Whole-number output duration from 1 through 15 seconds. Defaults to 5. */
    duration: z.number().int().min(1).max(15).optional(),
    /** Defaults to vertical. The API does not support 1:1 for this series. */
    aspect_ratio: ZzdhAspectRatioSchema.optional(),
    seed: z.number().int().optional(),
}).strict();

export const CreateZzdhTaskResponseSchema = z.union([
    z.object({
        id: NonEmptyStringSchema,
        task_id: NonEmptyStringSchema.optional(),
    }).catchall(z.unknown()),
    z.object({
        id: NonEmptyStringSchema.optional(),
        task_id: NonEmptyStringSchema,
    }).catchall(z.unknown()),
]);

export const ZzdhTaskSchema = z.object({
    id: NonEmptyStringSchema.optional(),
    task_id: NonEmptyStringSchema.optional(),
    status: ZzdhTaskStatusSchema,
}).catchall(z.unknown());

const TaskIdSchema = NonEmptyStringSchema;
const ErrorResponseSchema = z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    error: z.object({
        code: z.string().optional(),
        message: z.string().optional(),
    }).catchall(z.unknown()).optional(),
}).catchall(z.unknown());

export type ZzdhModel = z.infer<typeof ZzdhModelSchema>;
export type ZzdhAspectRatio = z.infer<typeof ZzdhAspectRatioSchema>;
export type ZzdhTaskStatus = z.infer<typeof ZzdhTaskStatusSchema>;

export type TextToVideoModel = ZzdhModel;
export type TextToVideoRequest = z.infer<
    typeof CreateZzdhTaskRequestSchema
>;
export type CreateZzdhTaskRequest = TextToVideoRequest;
export type CreateZzdhTaskResponse = z.infer<
    typeof CreateZzdhTaskResponseSchema
>;
export type ZzdhTask = z.infer<typeof ZzdhTaskSchema>;

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
        const parsedRequest = CreateZzdhTaskRequestSchema.safeParse(request);
        if (!parsedRequest.success) return parsedRequest.error;

        const response = await this.requestJson("/v8/videos/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsedRequest.data),
        });
        if (response instanceof Error) return response;

        const parsedResponse = CreateZzdhTaskResponseSchema.safeParse(response);
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    /** GET /v8/videos/generations/{task_id} */
    async getTask(taskId: string): Promise<ZzdhTask | Error> {
        const parsedTaskId = TaskIdSchema.safeParse(taskId);
        if (!parsedTaskId.success) return parsedTaskId.error;
        const response = await this.requestJson(
            `/v8/videos/generations/${encodeURIComponent(parsedTaskId.data)}`,
            { method: "GET" },
        );
        if (response instanceof Error) return response;

        const parsedResponse = ZzdhTaskSchema.safeParse(response);
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    /**
     * GET /v1/videos/{task_id}/content
     *
     * Returns the successful response unchanged so callers can consume it as
     * a stream, Blob, or ArrayBuffer without the client altering video bytes.
     */
    async getContent(taskId: string): Promise<Response | Error> {
        const parsedTaskId = TaskIdSchema.safeParse(taskId);
        if (!parsedTaskId.success) return parsedTaskId.error;
        const response = await this.fetch(
            `/v1/videos/${encodeURIComponent(parsedTaskId.data)}/content`,
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
    request: unknown,
): z.ZodError | undefined {
    const result = CreateZzdhTaskRequestSchema.safeParse(request);
    return result.success ? undefined : result.error;
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

    const parsed = ErrorResponseSchema.safeParse(body);
    const errorBody = parsed.success ? parsed.data : undefined;
    const code = errorBody?.error?.code ?? errorBody?.code ??
        String(response.status);
    const message = errorBody?.error?.message ?? errorBody?.message ??
        (text || response.statusText);

    return new ZzdhApiError(response.status, code, message);
}
