/**
 * Focused MiniMax file client.
 *
 * Uploads image inputs through POST /v1/files/upload using the
 * `video_generation_input` purpose. MiniMax video requests can reference the
 * returned ID as `mm_file://{file_id}` for seven days.
 *
 * GET /v1/files/retrieve_content downloads model-generated output files. The
 * MiniMax documentation does not describe it as a download endpoint for input
 * images uploaded with `video_generation_input`.
 */
import { z } from "zod";

const DEFAULT_API_ORIGIN = "https://api.minimaxi.com";
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|heic|heif)$/i;

const NonEmptyStringSchema = z.string().refine(
    (value) => value.trim().length > 0,
    { error: "String cannot be empty" },
);

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
    filename: NonEmptyStringSchema,
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

const ErrorResponseSchema = z.object({
    base_resp: BaseResponseSchema.optional(),
    status_code: z.number().int().optional(),
    status_msg: z.string().optional(),
    message: z.string().optional(),
}).catchall(z.unknown());

export type FileId = z.infer<typeof FileIdSchema>;
export type FilePurpose = z.infer<typeof FilePurposeSchema>;
export type MiniMaxFile = z.infer<typeof FileSchema>;
export type UploadImageResponse = z.infer<typeof UploadImageResponseSchema>;

export interface MiniMaxClientOptions {
    apiKey: string;
    /** Defaults to https://api.minimaxi.com. */
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

        const filename = request.filename ??
            (request.file instanceof File ? request.file.name : "");
        const parsedFilename = NonEmptyStringSchema.safeParse(filename);
        if (!parsedFilename.success) return parsedFilename.error;
        if (!IMAGE_EXTENSION.test(parsedFilename.data)) {
            return new TypeError(
                "Image filename must end in .jpg, .jpeg, .png, .webp, .heic, or .heif",
            );
        }
        if (request.file.size <= 0 || request.file.size > MAX_IMAGE_BYTES) {
            return new RangeError(
                `Image size must be between 1 byte and ${MAX_IMAGE_BYTES} bytes`,
            );
        }

        const form = new FormData();
        form.append("purpose", "video_generation_input");
        form.append("file", request.file, parsedFilename.data);

        const response = await this.fetch("/v1/files/upload", {
            method: "POST",
            // Do not set Content-Type; fetch adds the multipart boundary.
            body: form,
        });
        if (response instanceof Error) return response;

        const body = await parseJsonResponse(response);
        if (body instanceof Error) return body;
        if (!response.ok) {
            return new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        const parsed = UploadImageResponseSchema.safeParse(body);
        if (!parsed.success) return parsed.error;

        return parsed.data;
    }

    /**
     * GET /v1/files/retrieve_content?file_id={file_id}
     *
     * Returns the successful response unchanged so callers can stream it or
     * consume it as a Blob/ArrayBuffer. MiniMax documents this endpoint for
     * model-generated output files, not uploaded video-generation inputs.
     */
    async downloadFile(fileId: FileId): Promise<Response | Error> {
        const parsedFileId = FileIdSchema.safeParse(fileId);
        if (!parsedFileId.success) return parsedFileId.error;

        const query = new URLSearchParams({
            file_id: String(parsedFileId.data),
        });
        const url = `/v1/files/retrieve_content?${query}`
        console.log(url)
        const response = await this.fetch(
            url,
            { method: "GET" },
        );
        if (response instanceof Error) return response;
        if (!response.ok) {
            return new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return response;
    }

    private async fetch(
        path: string,
        init: RequestInit,
    ): Promise<Response | Error> {
        const parsedApiKey = NonEmptyStringSchema.safeParse(this.apiKey);
        if (!parsedApiKey.success) return parsedApiKey.error;

        try {
            return await fetch(`${this.baseUrl}${path}`, {
                ...init,
                headers: {
                    Authorization: `Bearer ${parsedApiKey.data}`,
                    ...init.headers,
                },
            });
        } catch (error) {
            return error as Error
        }
    }
}

async function parseJsonResponse(response: Response): Promise<unknown | Error> {
    let text: string;
    try {
        text = await response.text();
    } catch (error) {
        return error as Error
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        return e as Error
    }
}
