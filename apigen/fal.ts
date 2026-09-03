/**
 * Standalone fal queue client for MiniMax H3 Max image-to-video generation.
 *
 * Model endpoint: minimax/h3-max/image-to-video
 */
import { z } from "zod";

const DEFAULT_QUEUE_ORIGIN = "https://queue.fal.run";
const DEFAULT_PLATFORM_ORIGIN = "https://api.fal.ai";
const MODEL_ENDPOINT = "minimax/h3-max/image-to-video";

const NonEmptyStringSchema = z.string().refine(
    (value) => value.trim().length > 0,
    { error: "String cannot be empty" },
);

/**
 * fal accepts public URLs, fal-hosted URLs, and base64 image data URIs.
 * Keep validation protocol-focused so signed URLs are preserved unchanged.
 */
export const ImageUrlSchema = NonEmptyStringSchema.refine((value) => {
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return true;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}, {
    error: "Expected a public HTTP(S) URL or an image data URI",
});

export const ResolutionSchema = z.enum(["480P", "768P"]);
export const PromptExpansionModeSchema = z.enum(["balanced", "quality"]);

export const ImageToVideoRequestSchema = z.object({
    prompt: NonEmptyStringSchema,
    /** First-frame reference image. */
    image_url: ImageUrlSchema,
    /** Optional last-frame reference image. */
    end_image_url: ImageUrlSchema.optional(),
    /** Defaults to 5 seconds on fal. */
    duration: z.number().int().optional(),
    /** Defaults to 768P on fal. */
    resolution: ResolutionSchema.optional(),
    seed: z.number().int().optional(),
    /** Defaults to true on fal. */
    enable_safety_checker: z.boolean().optional(),
    /** Return the video as base64 instead of a CDN URL. */
    sync_mode: z.boolean().optional(),
    /** Defaults to balanced on fal. */
    prompt_expansion_mode: PromptExpansionModeSchema.optional(),
}).strict();

export const SubmitResponseSchema = z.object({
    request_id: NonEmptyStringSchema,
    response_url: NonEmptyStringSchema,
    status_url: NonEmptyStringSchema,
    cancel_url: NonEmptyStringSchema,
    queue_position: z.number().int().nonnegative().optional(),
}).catchall(z.unknown());

export const QueueStatusSchema = z.enum([
    "IN_QUEUE",
    "IN_PROGRESS",
    "COMPLETED",
]);

export const QueueLogSchema = z.object({
    message: z.string(),
    timestamp: z.string().optional(),
}).catchall(z.unknown());

export const StatusResponseSchema = z.object({
    status: QueueStatusSchema,
    request_id: NonEmptyStringSchema,
    response_url: NonEmptyStringSchema.optional(),
    queue_position: z.number().int().nonnegative().optional(),
    logs: z.array(QueueLogSchema).optional(),
    metrics: z.object({
        inference_time: z.number().nonnegative().optional(),
    }).catchall(z.unknown()).optional(),
    error: z.string().optional(),
    error_type: z.string().optional(),
}).catchall(z.unknown());

export const FileSchema = z.object({
    url: NonEmptyStringSchema,
    content_type: z.string().optional(),
    file_name: z.string().optional(),
    file_size: z.number().int().nonnegative().optional(),
}).catchall(z.unknown());

export const ImageToVideoResultSchema = z.object({
    video: FileSchema,
    expanded_prompt: z.string().nullable().optional(),
    timings: z.record(z.string(), z.unknown()).nullable().optional(),
}).catchall(z.unknown());

export const CancelResponseSchema = z.object({
    status: z.enum([
        "CANCELLATION_REQUESTED",
        "ALREADY_COMPLETED",
        "NOT_FOUND",
    ]),
}).catchall(z.unknown());

export const RequestHistoryItemSchema = z.object({
    request_id: NonEmptyStringSchema,
    endpoint_id: NonEmptyStringSchema,
    sent_at: z.string().nullable().optional(),
    started_at: z.string().nullable().optional(),
    ended_at: z.string().nullable().optional(),
    status_code: z.number().int().nullable().optional(),
    duration: z.number().nonnegative().nullable().optional(),
    json_input: z.unknown().optional(),
    json_output: z.unknown().optional(),
}).catchall(z.unknown());

export const RequestHistoryPageSchema = z.object({
    items: z.array(RequestHistoryItemSchema),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
}).catchall(z.unknown());

const RequestIdSchema = NonEmptyStringSchema;

export type Resolution = z.infer<typeof ResolutionSchema>;
export type PromptExpansionMode = z.infer<
    typeof PromptExpansionModeSchema
>;
export type ImageToVideoRequest = z.infer<typeof ImageToVideoRequestSchema>;
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;
export type QueueStatus = z.infer<typeof QueueStatusSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export type FalFile = z.infer<typeof FileSchema>;
export type ImageToVideoResult = z.infer<typeof ImageToVideoResultSchema>;
export type CancelResponse = z.infer<typeof CancelResponseSchema>;
export type RequestHistoryItem = z.infer<typeof RequestHistoryItemSchema>;
export type RequestHistoryPage = z.infer<typeof RequestHistoryPageSchema>;

export interface ListRequestsOptions {
    /** Page size, from 1 through 100. Defaults to 50 on fal. */
    limit?: number;
    cursor?: string;
    /** Inclusive ISO-8601 lower time bound. fal defaults to the last 24 hours. */
    start?: string;
    /** Exclusive ISO-8601 upper time bound. */
    end?: string;
    /** Include json_input and json_output in each item. */
    expandPayloads?: boolean;
}

export interface FalClientOptions {
    apiKey: string;
    /** Defaults to https://queue.fal.run. */
    baseUrl?: string;
    /** Defaults to https://api.fal.ai. */
    platformBaseUrl?: string;
}

export class FalApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = "FalApiError";
    }
}

export class FalClient {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly platformBaseUrl: string;

    constructor(options: FalClientOptions) {
        this.apiKey = options.apiKey;
        this.baseUrl = (options.baseUrl ?? DEFAULT_QUEUE_ORIGIN).replace(
            /\/$/,
            "",
        );
        this.platformBaseUrl = (
            options.platformBaseUrl ?? DEFAULT_PLATFORM_ORIGIN
        ).replace(/\/$/, "");
    }

    /** POST /minimax/h3-max/image-to-video */
    async submit(
        request: ImageToVideoRequest,
    ): Promise<SubmitResponse | Error> {
        const parsedRequest = ImageToVideoRequestSchema.safeParse(request);
        if (!parsedRequest.success) return parsedRequest.error;

        const response = await this.requestJson(`/${MODEL_ENDPOINT}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsedRequest.data),
        });
        if (response instanceof Error) return response;

        const parsedResponse = SubmitResponseSchema.safeParse(response);
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    /** GET /minimax/h3-max/image-to-video/requests/{request_id}/status */
    async getStatus(
        requestId: string,
        options: { logs?: boolean } = {},
    ): Promise<StatusResponse | Error> {
        const parsedRequestId = RequestIdSchema.safeParse(requestId);
        if (!parsedRequestId.success) return parsedRequestId.error;

        const query = options.logs ? "?logs=1" : "";
        const response = await this.requestJson(
            `/${MODEL_ENDPOINT}/requests/${
                encodeURIComponent(parsedRequestId.data)
            }/status${query}`,
            { method: "GET" },
        );
        if (response instanceof Error) return response;

        const parsedResponse = StatusResponseSchema.safeParse(response);
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    /** GET /minimax/h3-max/image-to-video/requests/{request_id} */
    async getResult(requestId: string): Promise<ImageToVideoResult | Error> {
        const parsedRequestId = RequestIdSchema.safeParse(requestId);
        if (!parsedRequestId.success) return parsedRequestId.error;

        const response = await this.requestJson(
            `/${MODEL_ENDPOINT}/requests/${
                encodeURIComponent(parsedRequestId.data)
            }`,
            { method: "GET" },
        );
        if (response instanceof Error) return response;

        const parsedResponse = ImageToVideoResultSchema.safeParse(response);
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    /** PUT /minimax/h3-max/image-to-video/requests/{request_id}/cancel */
    async cancel(requestId: string): Promise<CancelResponse | Error> {
        const parsedRequestId = RequestIdSchema.safeParse(requestId);
        if (!parsedRequestId.success) return parsedRequestId.error;

        const response = await this.requestJson(
            `/${MODEL_ENDPOINT}/requests/${
                encodeURIComponent(parsedRequestId.data)
            }/cancel`,
            { method: "PUT" },
            // fal returns useful JSON for ALREADY_COMPLETED and NOT_FOUND even
            // though those responses use non-2xx HTTP status codes.
            true,
        );
        if (response instanceof Error) return response;

        const parsedResponse = CancelResponseSchema.safeParse(response);
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    /** GET /v1/models/requests/by-endpoint for H3 Max generations. */
    async listRequests(
        options: ListRequestsOptions = {},
    ): Promise<RequestHistoryPage | Error> {
        const query = new URLSearchParams({ endpoint_id: MODEL_ENDPOINT });
        if (options.limit !== undefined) {
            if (
                !Number.isInteger(options.limit) || options.limit < 1 ||
                options.limit > 100
            ) {
                return new Error(
                    "Request history limit must be an integer from 1 through 100",
                );
            }
            query.set("limit", String(options.limit));
        }
        if (options.cursor) query.set("cursor", options.cursor);
        if (options.start) query.set("start", options.start);
        if (options.end) query.set("end", options.end);
        if (options.expandPayloads) query.set("expand", "payloads");

        const response = await this.requestJsonFrom(
            this.platformBaseUrl,
            `/v1/models/requests/by-endpoint?${query}`,
            { method: "GET" },
        );
        if (response instanceof Error) return response;

        const parsedResponse = RequestHistoryPageSchema.safeParse(response);
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    private async requestJson(
        path: string,
        init: RequestInit,
        acceptErrorStatus = false,
    ): Promise<unknown | Error> {
        return await this.requestJsonFrom(
            this.baseUrl,
            path,
            init,
            acceptErrorStatus,
        );
    }

    private async requestJsonFrom(
        origin: string,
        path: string,
        init: RequestInit,
        acceptErrorStatus = false,
    ): Promise<unknown | Error> {
        let response: Response;
        try {
            response = await fetch(`${origin}${path}`, {
                ...init,
                headers: {
                    Authorization: `Key ${this.apiKey}`,
                    ...init.headers,
                },
            });
        } catch (error) {
            return error instanceof Error ? error : new Error(String(error));
        }

        let text: string;
        try {
            text = await response.text();
        } catch (error) {
            return error instanceof Error ? error : new Error(String(error));
        }

        let body: unknown;
        try {
            body = text ? JSON.parse(text) : undefined;
        } catch {
            return new FalApiError(
                response.status,
                text,
                `fal returned a non-JSON response (HTTP ${response.status})`,
            );
        }

        if (!response.ok && !acceptErrorStatus) {
            return new FalApiError(
                response.status,
                body,
                falErrorMessage(response.status, body),
            );
        }
        return body;
    }
}

export function validateImageToVideoRequest(
    request: unknown,
): z.ZodError | undefined {
    const result = ImageToVideoRequestSchema.safeParse(request);
    return result.success ? undefined : result.error;
}

function falErrorMessage(status: number, body: unknown): string {
    if (typeof body === "object" && body !== null) {
        const record = body as Record<string, unknown>;
        for (const key of ["message", "error", "detail"]) {
            const value = record[key];
            if (typeof value === "string" && value) {
                return `fal request failed (HTTP ${status}): ${value}`;
            }
        }
    }
    return `fal request failed (HTTP ${status}): ${JSON.stringify(body)}`;
}
