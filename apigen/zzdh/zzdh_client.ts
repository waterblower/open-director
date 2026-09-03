/**
 * Standalone client for the 字字动画 MiniMax H3 limited-offer API.
 *
 * This module implements the supported video-generation modes for the
 * `zzdh-minimax-h3-限时优惠` series.
 */
import { z } from "zod";

const API_ORIGIN = "https://zizidonghua.com";

export const ZZDH_MODELS = [
    "zzdh-minimax-h3-限时优惠-多参考图生-768p",
] as const;

export const ModelSchema = z.enum(ZZDH_MODELS);
export const AspectRatioSchema = z.enum(["horizontal", "vertical"]);
export const TaskStatusSchema = z.enum([
    "queued",
    "in_progress",
    "completed",
    "failed",
]);

const NonEmptyStringSchema = z.string().refine(
    (value) => value.trim().length > 0,
    { error: "String cannot be empty" },
);

const CommonRequestFields = {
    prompt: NonEmptyStringSchema,
    /** Whole-number output duration from 1 through 15 seconds. Defaults to 5. */
    duration: z.number().int().min(1).max(15).optional(),
    /** Defaults to vertical. The API does not support 1:1 for this series. */
    aspect_ratio: AspectRatioSchema.optional(),
    seed: z.number().int().optional(),
};

export const MultiReferenceImageModelSchema = z.literal(
    "zzdh-minimax-h3-限时优惠-多参考图生-768p",
);
export const ReferenceImageSchema = z.object({
    url: NonEmptyStringSchema,
    role: z.literal("reference_image"),
}).strict();

export const MultiReferenceImageRequestSchema = z.object({
    model: MultiReferenceImageModelSchema,
    ...CommonRequestFields,
    reference_images: z.array(ReferenceImageSchema).min(1).max(9),
}).strict();

export const CreateTaskRequestSchema = z.discriminatedUnion("model", [
    MultiReferenceImageRequestSchema,
]);

export const CreateTaskResponseSchema = z.union([
    z.object({
        id: NonEmptyStringSchema,
        task_id: NonEmptyStringSchema.optional(),
    }).catchall(z.unknown()),
    z.object({
        id: NonEmptyStringSchema.optional(),
        task_id: NonEmptyStringSchema,
    }).catchall(z.unknown()),
]);

export const TaskSchema = z.object({
    id: NonEmptyStringSchema.optional(),
    task_id: NonEmptyStringSchema.optional(),
    status: TaskStatusSchema,
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

export type Model = z.infer<typeof ModelSchema>;
export type AspectRatio = z.infer<typeof AspectRatioSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export type MultiReferenceImageModel = z.infer<
    typeof MultiReferenceImageModelSchema
>;
export type ReferenceImage = z.infer<typeof ReferenceImageSchema>;

export type MultiReferenceImageRequest = z.infer<
    typeof MultiReferenceImageRequestSchema
>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type CreateTaskResponse = z.infer<
    typeof CreateTaskResponseSchema
>;
export type Task = z.infer<typeof TaskSchema>;

export interface ClientOptions {
    apiKey: string;
}

export class ZzdhClient {
    readonly apiKey: string;

    constructor(options: ClientOptions) {
        this.apiKey = options.apiKey;
    }

    /** POST /v8/videos/generations */
    async createTask(
        request: CreateTaskRequest,
    ): Promise<CreateTaskResponse | Error> {
        const parsedRequest = CreateTaskRequestSchema.safeParse(request);
        if (!parsedRequest.success) return parsedRequest.error;

        const response = await this.requestJson("/v8/videos/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsedRequest.data),
        });
        if (response instanceof Error) return response;

        console.log("zzdh!", response);

        const parsedResponse = CreateTaskResponseSchema.safeParse(response);
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    /** GET /v8/videos/generations/{task_id} */
    async getTask(taskId: string): Promise<Task | Error> {
        const parsedTaskId = TaskIdSchema.safeParse(taskId);
        if (!parsedTaskId.success) return parsedTaskId.error;
        const response = await this.requestJson(
            `/v8/videos/generations/${encodeURIComponent(parsedTaskId.data)}`,
            { method: "GET" },
        );
        if (response instanceof Error) return response;

        const parsedResponse = TaskSchema.safeParse(response);
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
        if (!response.ok) {
            return new Error(
                `${response.statusText}: ${await response.text()}`,
            );
        }
        return response;
    }

    private async requestJson(
        path: string,
        init: RequestInit,
    ): Promise<unknown | Error> {
        const response = await this.fetch(path, init);
        if (response instanceof Error) return response;
        if (!response.ok) {
            const text = await response.text();
            return new Error(`${response.statusText}: ${text}`);
        }

        try {
            const text = await response.text();
            console.log(text, path, init);
            return JSON.parse(text);
        } catch (e) {
            return e as Error;
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
            return error as Error;
        }
    }
}

export function validateCreateTaskRequest(
    request: unknown,
): z.ZodError | undefined {
    const result = CreateTaskRequestSchema.safeParse(request);
    return result.success ? undefined : result.error;
}
