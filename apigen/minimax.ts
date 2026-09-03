/**
 * Standalone MiniMax client for file management and H3 video generation V2.
 *
 * Uploaded video inputs can be referenced from generation requests as
 * `mm_file://{file_id}` for seven days.
 */
import { z } from "zod";

const DEFAULT_API_ORIGIN = "https://api.minimax.cn";
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|heic|heif)$/i;

const NonEmptyStringSchema = z.string().refine(
    (value) => value.trim().length > 0,
    { error: "String cannot be empty" },
);

const HttpUrlSchema = NonEmptyStringSchema.refine(
    (value) => /^https?:\/\//i.test(value) && URL.canParse(value),
    { error: "Expected a public HTTP or HTTPS URL" },
);

function mediaUrlSchema(dataUriPattern: RegExp) {
    return NonEmptyStringSchema.refine(
        (value) =>
            (/^https?:\/\//i.test(value) && URL.canParse(value)) ||
            /^mm_file:\/\/\d+$/.test(value) ||
            dataUriPattern.test(value),
        {
            error:
                "Expected a public URL, mm_file://{file_id}, or supported base64 data URI",
        },
    );
}


export const FileIdSchema = z.union([
    z.number().int().positive(),
    z.string().regex(/^\d+$/, "File ID must contain only digits"),
]);

export const FilePurposeSchema = z.enum([
    "voice_clone",
    "prompt_audio",
    "t2a_async_input",
    "video_understanding",
    "video_generation_input",
]);

export const FileSchema = z.object({
    file_id: FileIdSchema,
    bytes: z.number().int().nonnegative(),
    created_at: z.number().int().nonnegative(),
    filename: z.string().nonempty(),
    purpose: FilePurposeSchema,
}).catchall(z.unknown());

export const BaseResponseSchema = z.object({
    status_code: z.number().int(),
    status_msg: z.string(),
}).catchall(z.unknown());

export const UploadImageResponseSchema = z.object({
    file: FileSchema,
    base_resp: BaseResponseSchema,
}).catchall(z.unknown());

export const ListFilesResponseSchema = z.object({
    files: z.array(FileSchema),
    base_resp: BaseResponseSchema,
}).catchall(z.unknown());

export const VideoModelSchema = z.enum(["MiniMax-H3", "MiniMax-H3-Max"]);
export const VideoResolutionSchema = z.enum(["480P", "768P", "2K"]);
export const VideoRatioSchema = z.enum([
    "adaptive",
    "21:9",
    "16:9",
    "4:3",
    "1:1",
    "3:4",
    "9:16",
]);
export const VideoTaskStatusSchema = z.enum([
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
]);

export const TextContentSchema = z.object({
    type: z.literal("text"),
    text: NonEmptyStringSchema.refine((value) => value.length <= 7000, {
        error: "Video prompt cannot exceed 7000 characters",
    }),
}).strict();

export const ImageContentSchema = z.object({
    type: z.literal("image_url"),
    image_url: z.object({ url: z.string() }),
    role: z.enum([
        "first_frame",
        "last_frame",
        "reference_image",
    ]).optional(),
});

export const VideoContentSchema = z.object({
    type: z.literal("video_url"),
    video_url: z.object({ url: z.string() }),
    role: z.literal("reference_video"),
});

export const AudioContentSchema = z.object({
    type: z.literal("audio_url"),
    audio_url: z.object({ url: z.string() }),
    role: z.literal("reference_audio"),
});

export const VideoGenerationContentSchema = z.discriminatedUnion("type", [
    TextContentSchema,
    ImageContentSchema,
    VideoContentSchema,
    AudioContentSchema,
]);

export const CreateVideoTaskRequestSchema = z.object({
    model: VideoModelSchema,
    content: z.array(VideoGenerationContentSchema).min(1),
    resolution: VideoResolutionSchema,
    duration: z.number().int().min(4).max(15),
    ratio: VideoRatioSchema.optional(),
    callback_url: HttpUrlSchema.optional(),
    aigc_watermark: z.boolean().optional(),
}).strict().superRefine((request, context) => {
    const textItems = request.content.filter((item) => item.type === "text");
    if (textItems.length !== 1) {
        context.addIssue({
            code: "custom",
            path: ["content"],
            message: "content must contain exactly one non-empty text item",
        });
    }

    const images = request.content.filter((item) => item.type === "image_url");
    const firstFrames = images.filter((item) =>
        item.role === undefined || item.role === "first_frame"
    );
    const lastFrames = images.filter((item) => item.role === "last_frame");
    const referenceImages = images.filter((item) =>
        item.role === "reference_image"
    );
    const referenceVideos = request.content.filter((item) =>
        item.type === "video_url"
    );
    const referenceAudios = request.content.filter((item) =>
        item.type === "audio_url"
    );
    const hasFrames = firstFrames.length > 0 || lastFrames.length > 0;
    const hasReferences = referenceImages.length > 0 ||
        referenceVideos.length > 0 || referenceAudios.length > 0;

    if (firstFrames.length > 1) {
        addContentIssue(context, "Only one first-frame image is allowed");
    }
    if (lastFrames.length > 1) {
        addContentIssue(context, "Only one last-frame image is allowed");
    }
    if (referenceImages.length > 9) {
        addContentIssue(context, "At most 9 reference images are allowed");
    }
    if (referenceVideos.length > 3) {
        addContentIssue(context, "At most 3 reference videos are allowed");
    }
    if (referenceAudios.length > 3) {
        addContentIssue(context, "At most 3 reference audios are allowed");
    }
    if (hasFrames && hasReferences) {
        addContentIssue(
            context,
            "Frame images and multimodal references cannot be mixed",
        );
    }

    if (request.model === "MiniMax-H3") {
        if (request.resolution === "480P") {
            context.addIssue({
                code: "custom",
                path: ["resolution"],
                message: "MiniMax-H3 supports only 768P or 2K",
            });
        }
    } else {
        if (request.resolution === "2K") {
            context.addIssue({
                code: "custom",
                path: ["resolution"],
                message: "MiniMax-H3-Max supports only 480P or 768P",
            });
        }
        if (request.duration < 5) {
            context.addIssue({
                code: "custom",
                path: ["duration"],
                message: "MiniMax-H3-Max duration must be between 5 and 15",
            });
        }
        if (hasReferences) {
            addContentIssue(
                context,
                "MiniMax-H3-Max does not support multimodal references",
            );
        }
    }

    const isTextToVideo = images.length === 0 && !hasReferences;
    if (
        isTextToVideo &&
        (request.ratio === undefined || request.ratio === "adaptive")
    ) {
        context.addIssue({
            code: "custom",
            path: ["ratio"],
            message:
                "Text-to-video requires a concrete ratio; adaptive is not supported",
        });
    }
});

export const CreateVideoTaskResponseSchema = z.object({
    task_id: NonEmptyStringSchema,
}).catchall(z.unknown());

export const VideoTaskErrorSchema = z.object({
    code: z.string(),
    message: z.string(),
}).catchall(z.unknown());

export const VideoTaskContentSchema = z.object({
    url: z.string().optional(),
    prompt: z.string().optional(),
}).catchall(z.unknown());

export const VideoTaskUsageSchema = z.object({
    total_seconds: z.number().int().nonnegative().optional(),
    input_seconds: z.number().int().nonnegative().optional(),
    output_seconds: z.number().int().nonnegative().optional(),
    input_image_count: z.number().int().nonnegative().optional(),
    input_audio_seconds: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
}).catchall(z.unknown());

export const VideoTaskSchema = z.object({
    id: NonEmptyStringSchema,
    model: z.string(),
    status: VideoTaskStatusSchema,
    error: VideoTaskErrorSchema.optional(),
    created_at: z.number().int().nonnegative(),
    updated_at: z.number().int().nonnegative(),
    content: VideoTaskContentSchema.optional(),
    resolution: z.string().optional(),
    duration: z.number().int().nonnegative().optional(),
    usage: VideoTaskUsageSchema.optional(),
    ratio: z.string().optional(),
    task_type: z.enum([
        "generation",
        "h3_context_ir",
        "regeneration",
    ]),
    modality: z.enum(["video", "text"]).optional(),
}).catchall(z.unknown());

export const GetVideoTaskResponseSchema = z.object({
    task: VideoTaskSchema,
}).catchall(z.unknown());

export const ListVideoTasksRequestSchema = z.object({
    page_num: z.number().int().positive().optional(),
    page_size: z.number().int().positive().optional(),
    status: VideoTaskStatusSchema.optional(),
    task_ids: z.array(NonEmptyStringSchema).optional(),
    model: NonEmptyStringSchema.optional(),
    task_type: z.enum([
        "generation",
        "h3_context_ir",
        "regeneration",
    ]).optional(),
}).strict();

export const ListVideoTasksResponseSchema = z.object({
    items: z.array(VideoTaskSchema),
    total: z.number().int().nonnegative(),
}).catchall(z.unknown());

const OaiErrorResponseSchema = z.object({
    type: z.string().optional(),
    error: z.object({
        type: z.string().optional(),
        message: z.string().optional(),
        http_code: z.string().optional(),
    }).catchall(z.unknown()).optional(),
    request_id: z.string().optional(),
}).catchall(z.unknown());

export type FileId = z.infer<typeof FileIdSchema>;
export type FilePurpose = z.infer<typeof FilePurposeSchema>;
export type MiniMaxFile = z.infer<typeof FileSchema>;
export type UploadImageResponse = z.infer<typeof UploadImageResponseSchema>;
export type ListFilesResponse = z.infer<typeof ListFilesResponseSchema>;
export type VideoModel = z.infer<typeof VideoModelSchema>;
export type VideoResolution = z.infer<typeof VideoResolutionSchema>;
export type VideoRatio = z.infer<typeof VideoRatioSchema>;
export type VideoTaskStatus = z.infer<typeof VideoTaskStatusSchema>;
export type VideoGenerationContent = z.infer<
    typeof VideoGenerationContentSchema
>;
export type CreateVideoTaskRequest = z.infer<
    typeof CreateVideoTaskRequestSchema
>;
export type CreateVideoTaskResponse = z.infer<
    typeof CreateVideoTaskResponseSchema
>;
export type VideoTask = z.infer<typeof VideoTaskSchema>;
export type GetVideoTaskResponse = z.infer<typeof GetVideoTaskResponseSchema>;
export type ListVideoTasksRequest = z.infer<
    typeof ListVideoTasksRequestSchema
>;
export type ListVideoTasksResponse = z.infer<
    typeof ListVideoTasksResponseSchema
>;

export interface MiniMaxClientOptions {
    apiKey: string;
    /** Defaults to https://api.minimax.cn. */
    baseUrl?: string;
}

export interface UploadImageRequest {
    file: Blob;
    /** Required for a plain Blob; a File's name is used by default. */
    filename?: string;
}


export class MiniMaxClient {
    readonly apiKey: string;
    readonly baseUrl: string;

    constructor(options: MiniMaxClientOptions) {
        this.apiKey = options.apiKey;
        this.baseUrl = (options.baseUrl ?? DEFAULT_API_ORIGIN).replace(
            /\/$/,
            "",
        );
    }

    /** POST /v2/video_generation */
    async createVideoTask(
        request: CreateVideoTaskRequest,
    ): Promise<CreateVideoTaskResponse | Error> {
        const parsedRequest = CreateVideoTaskRequestSchema.safeParse(request);
        if (!parsedRequest.success) return parsedRequest.error;

        const response = await this.requestJson("/v2/video_generation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsedRequest.data),
        });
        if (response instanceof Error) return response;

        const parsedResponse = CreateVideoTaskResponseSchema.safeParse(
            response,
        );
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    /** GET /v2/query/video_generation/{task_id} */
    async getVideoTask(taskId: string): Promise<GetVideoTaskResponse | Error> {
        const parsedTaskId = NonEmptyStringSchema.safeParse(taskId);
        if (!parsedTaskId.success) return parsedTaskId.error;

        const response = await this.requestJson(
            `/v2/query/video_generation/${
                encodeURIComponent(parsedTaskId.data)
            }`,
            { method: "GET" },
        );
        if (response instanceof Error) return response;

        const parsedResponse = GetVideoTaskResponseSchema.safeParse(response);
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    /** GET /v2/query/video_generation */
    async listVideoTasks(
        input: ListVideoTasksRequest = {},
    ): Promise<ListVideoTasksResponse | Error> {
        const parsedInput = ListVideoTasksRequestSchema.safeParse(input);
        if (!parsedInput.success) return parsedInput.error;

        const query = new URLSearchParams();
        const params = parsedInput.data;
        if (params.page_num !== undefined) {
            query.set("page_num", String(params.page_num));
        }
        if (params.page_size !== undefined) {
            query.set("page_size", String(params.page_size));
        }
        if (params.status) query.set("filter.status", params.status);
        for (const taskId of params.task_ids ?? []) {
            query.append("filter.task_ids", taskId);
        }
        if (params.model) query.set("filter.model", params.model);
        if (params.task_type) {
            query.set("filter.task_type", params.task_type);
        }

        const suffix = query.size > 0 ? `?${query}` : "";
        const response = await this.requestJson(
            `/v2/query/video_generation${suffix}`,
            { method: "GET" },
        );
        if (response instanceof Error) return response;

        const parsedResponse = ListVideoTasksResponseSchema.safeParse(response);
        return parsedResponse.success
            ? parsedResponse.data
            : parsedResponse.error;
    }

    /** GET /v1/files/list?purpose=video_generation_input */
    async listVideoGenerationFiles(): Promise<ListFilesResponse | Error> {
        const query = new URLSearchParams({
            purpose: "video_generation_input",
        });
        const response = await this.requestJson(`/v1/files/list?${query}`, {
            method: "GET",
        });
        if (response instanceof Error) return response;

        const parsedResponse = ListFilesResponseSchema.safeParse(response);
        if (!parsedResponse.success) return parsedResponse.error;
        if (parsedResponse.data.base_resp.status_code !== 0) {
            return new MiniMaxApiError(
                200,
                String(parsedResponse.data.base_resp.status_code),
                parsedResponse.data.base_resp.status_msg,
            );
        }
        return parsedResponse.data;
    }

    /**
     * POST /v1/files/upload
     *
     * Uploads a JPG, JPEG, PNG, WebP, HEIC, or HEIF image (maximum 30 MiB)
     * for MiniMax video generation. Reference it as `mm_file://{file_id}`.
     */
    async uploadImage(
        input: File | UploadImageRequest,
    ): Promise<UploadImageResponse | Error> {
        const request = input instanceof File ? { file: input } : input;
        if (!(request.file instanceof Blob)) {
            return new TypeError("file must be a Blob or File");
        }

        const filename = input instanceof File ? input.name : input.filename;
        if (!filename) return new TypeError("filename is required for a Blob");
        if (!IMAGE_EXTENSION.test(filename)) {
            return new TypeError(
                "Image filename must end in jpg, jpeg, png, webp, heic, or heif",
            );
        }
        if (request.file.size <= 0 || request.file.size > MAX_IMAGE_BYTES) {
            return new RangeError(
                `Image size must be between 1 byte and ${MAX_IMAGE_BYTES} bytes`,
            );
        }

        const form = new FormData();
        form.append("purpose", "video_generation_input");
        form.append("file", request.file, filename);

        const response = await this.requestJson("/v1/files/upload", {
            method: "POST",
            // Do not set Content-Type; fetch adds the multipart boundary.
            body: form,
        });
        if (response instanceof Error) return response;

        const parsed = UploadImageResponseSchema.safeParse(response);
        if (!parsed.success) return parsed.error;
        return parsed.data;
    }

    /** GET /v1/files/retrieve_content?file_id={file_id} */
    async downloadFile(fileId: FileId): Promise<Response | Error> {
        const parsedFileId = FileIdSchema.safeParse(fileId);
        if (!parsedFileId.success) return parsedFileId.error;

        const query = new URLSearchParams({
            file_id: String(parsedFileId.data),
        });
        const response = await this.fetch(
            `/v1/files/retrieve_content?${query}`,
            { method: "GET" },
        );
        if (response instanceof Error) return response;
        return response;
    }

    private async requestJson(
        path: string,
        init: RequestInit,
    ): Promise<unknown | Error> {
        const response = await this.fetch(path, init);
        if (response instanceof Error) return response;
        if (!response.ok) {
            return new Error(`[${response.status}] ${response.statusText}`)
        }

        const text = await response.text();

        try {
            return JSON.parse(text);
        } catch (e) {
            return e as Error
        }
    }

    private async fetch(
        path: string,
        init: RequestInit,
    ): Promise<Response | Error> {
        try {
            return await fetch(`${this.baseUrl}${path}`, {
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

function addContentIssue(
    context: z.RefinementCtx,
    message: string,
): void {
    context.addIssue({ code: "custom", path: ["content"], message });
}
