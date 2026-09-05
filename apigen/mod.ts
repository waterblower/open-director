import { z } from "zod";
import {
    CreateTaskRequestSchema as SeedanceCreateTaskRequestSchema,
    SeedanceClient,
    type SeedanceModel,
    SeedanceModelSchema,
    TaskSchema as SeedanceTaskSchema,
} from "@/apigen/seedance/seedance.ts";

import {
    CreateVideoTaskRequestSchema as MiniMaxCreateVideoTaskRequestSchema,
    MiniMaxClient,
    VideoModelSchema as MiniMaxVideoModelSchema,
    VideoTaskSchema as MiniMaxVideoTaskSchema,
} from "@/apigen/minimax.ts";
import {
    FAL_REFERENCE_TO_VIDEO,
    FalInputSchema,
    get_result,
    reference_to_video,
} from "@/apigen/fal.ts";
import { safeFetch } from "@/apigen/fetch.ts";

/**
 * fal requests don't follow the OpenAI-ish `content` shape the other providers
 * use — they're a flat endpoint payload — so they're modelled as
 * `{ model, input }`. Keeping `model` at the top level matters: the DB extracts
 * it with `json_extract(request_json, '$.model')` to route polling.
 */
export const FalGenerateInputSchema = z.object({
    model: z.literal(FAL_REFERENCE_TO_VIDEO),
    input: FalInputSchema,
});

export const GenerateInputSchema = z.union([
    MiniMaxCreateVideoTaskRequestSchema,
    SeedanceCreateTaskRequestSchema,
    FalGenerateInputSchema,
]);
export const GenerationTaskSchema = z.union([
    MiniMaxVideoTaskSchema,
    SeedanceTaskSchema,
]);

export type GenerateInput = z.infer<typeof GenerateInputSchema>;
export type GenerationTask = z.infer<typeof GenerationTaskSchema>;
export type LocalTaskStatus = "queued" | "running" | "succeeded" | "failed";

export async function generate(
    input: GenerateInput,
    apiKey: string,
) {
    if (isFalInput(input)) {
        const result = await reference_to_video(input.input, apiKey);
        console.log("[apigen] fal task created:", result);
        if (result instanceof Error) {
            return result;
        }

        return {
            provider: "fal" as const,
            model: input.model,
            res: result,
        };
    } else if (isMiniMaxInput(input)) {
        const client = new MiniMaxClient({
            apiKey,
        });
        const result = await client.createVideoTask(input);
        if (result instanceof Error) {
            return result;
        }
        return {
            provider: "minimax" as const,
            model: input.model,
            res: result,
        };
    } else {
        const res = await new SeedanceClient({ apiKey }).generate(input);
        if (res instanceof Error) {
            return res;
        }
        return {
            provider: "seedance" as const,
            model: input.model,
            res,
        };
    }
}

type FalModel = typeof FAL_REFERENCE_TO_VIDEO;
type MiniMaxModel = z.infer<typeof MiniMaxVideoModelSchema>;
type SeedanceTask = z.infer<typeof SeedanceTaskSchema>;
type MiniMaxTask = z.infer<typeof MiniMaxVideoTaskSchema>;

/**
 * A polled task, tagged with the model it came from so callers can narrow to
 * the provider's own task shape instead of re-parsing `GenerationTask`.
 *
 * fal has no task resource of its own — its queue result is adapted to the
 * Seedance task shape (see `falResultToTask`), which is also what gets stored
 * in `task_json`.
 */
export type GetTaskResult =
    | { model: FalModel; task: SeedanceTask }
    | { model: SeedanceModel; task: SeedanceTask }
    | { model: MiniMaxModel; task: MiniMaxTask };

export async function getTask(
    model: string,
    taskId: string,
    apiKey: string,
): Promise<GetTaskResult | Error> {
    if (isFalModel(model)) {
        const result = await get_result(taskId, apiKey);
        if (result instanceof Error) {
            return result;
        }
        return { model, task: falResultToTask(model, taskId, result) };
    } else if (isMiniMaxModel(model)) {
        const client = new MiniMaxClient({
            apiKey,
        });
        const response = await client.getVideoTask(taskId);
        return response instanceof Error
            ? response
            : { model, task: response.task };
    } else if (isSeedanceModel(model)) {
        const task = await new SeedanceClient({ apiKey }).getTask(taskId);
        return task instanceof Error ? task : { model, task };
    } else {
        return new Error(`Unsupported model: ${model}`);
    }
}

export async function getVideoContent(
    model: string,
    taskId: string,
    task: GenerationTask,
    apiKey: string,
): Promise<Response | Error> {
    if (isMiniMaxModel(model)) {
        const parsed = MiniMaxVideoTaskSchema.safeParse(task);
        if (!parsed.success) return parsed.error;
        const url = parsed.data.content?.url;
        if (!url) return new Error(`Task ${taskId} has no video URL`);
        return await safeFetch(url);
    } else if (isFalModel(model)) {
        // fal queue results are adapted into the Seedance task shape by
        // `falResultToTask`, so the URL sits at the same place. fal serves the
        // file from its public CDN, so no `apiKey` is needed to download it.
        const parsed = SeedanceTaskSchema.safeParse(task);
        if (!parsed.success) return parsed.error;
        const url = parsed.data.content?.video_url;
        if (!url) return new Error(`Task ${taskId} has no video URL`);
        return await safeFetch(url);
    } else if (isSeedanceModel(model)) {
        const parsed = SeedanceTaskSchema.safeParse(task);
        if (!parsed.success) return parsed.error;
        const url = parsed.data.content?.video_url;
        if (!url) return new Error(`Task ${taskId} has no video URL`);
        return await safeFetch(url);
    } else {
        return new Error(`Unknown model: ${model}`);
    }
}

export function isSeedanceModel(model: unknown): model is SeedanceModel {
    return SeedanceModelSchema.safeParse(model).success;
}

export function isMiniMaxModel(model: unknown): model is z.infer<
    typeof MiniMaxVideoModelSchema
> {
    return MiniMaxVideoModelSchema.safeParse(model).success;
}

export function isFalModel(
    model: unknown,
): model is typeof FAL_REFERENCE_TO_VIDEO {
    return model === FAL_REFERENCE_TO_VIDEO;
}

export function isFalInput(
    input: GenerateInput,
): input is z.infer<typeof FalGenerateInputSchema> {
    return isFalModel(input.model);
}

/**
 * Adapt a fal queue result to the Seedance-shaped task the rest of the app
 * polls, downloads and renders, so fal generations need no special-casing
 * downstream. fal's queue reports "still in progress" as an HTTP 400 with a
 * sentinel detail string rather than a status field.
 */
function falResultToTask(
    model: string,
    requestId: string,
    result: Exclude<Awaited<ReturnType<typeof get_result>>, Error>,
): SeedanceTask {
    const base = {
        id: requestId,
        model,
        created_at: Math.floor(Date.now() / 1000),
    };
    if (result.status === 200) {
        return {
            ...base,
            status: "succeeded",
            content: { video_url: result.video.url },
        };
    } else if (result.status === 400) {
        if (result.detail === "Request is still in progress") {
            return { ...base, status: "running" };
        }
        return {
            ...base,
            status: "failed",
            error: { code: "400", message: result.detail },
        };
    } else {
        return {
            ...base,
            status: "failed",
            error: { code: "404", message: JSON.stringify(result.detail) },
        };
    }
}

export function isMiniMaxInput(
    input: GenerateInput,
): input is z.infer<typeof MiniMaxCreateVideoTaskRequestSchema> {
    return isMiniMaxModel(input.model);
}

export function localTaskStatus(task: GenerationTask): LocalTaskStatus {
    switch (task.status) {
        case "cancelled":
        case "expired":
            return "failed";
        case "running":
        case "succeeded":
        case "failed":
        case "queued":
            return task.status;
        default:
            return "queued";
    }
}

export function taskIdFromCreateResponse(
    response: { id?: string; task_id?: string; request_id?: string },
): string | Error {
    const taskId = response.id ?? response.task_id ?? response.request_id;
    return taskId || new Error("Create response did not contain a task id");
}

export function taskFailureReason(task: GenerationTask): string | undefined {
    const error = task.error;
    if (!error || typeof error !== "object") return undefined;
    const code = "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    const message = "message" in error && typeof error.message === "string"
        ? error.message
        : undefined;
    return code && message ? `${code}: ${message}` : message ?? code;
}
