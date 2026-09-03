import { z } from "zod";
import {
    CreateTaskRequestSchema as SeedanceCreateTaskRequestSchema,
    SeedanceClient,
    TaskSchema as SeedanceTaskSchema,
} from "@/apigen/seedance/seedance.ts";
import {
    CreateTaskRequestSchema as ZzdhCreateTaskRequestSchema,
    ModelSchema as ZzdhModelSchema,
    TaskSchema as ZzdhTaskSchema,
    ZzdhClient,
} from "@/apigen/zzdh/zzdh_client.ts";
import {
    CreateVideoTaskRequestSchema as MiniMaxCreateVideoTaskRequestSchema,
    MiniMaxClient,
    VideoModelSchema as MiniMaxVideoModelSchema,
    VideoTaskSchema as MiniMaxVideoTaskSchema,
} from "@/apigen/minimax.ts";
import { S } from "@/_fresh/client/assets/signals.module-DwPwiWj3.js";

export const GenerateInputSchema = z.union([
    MiniMaxCreateVideoTaskRequestSchema,
    SeedanceCreateTaskRequestSchema,
    ZzdhCreateTaskRequestSchema,
]);
export const GenerationTaskSchema = z.union([
    MiniMaxVideoTaskSchema,
    SeedanceTaskSchema,
    ZzdhTaskSchema,
]);

export type GenerateInput = z.infer<typeof GenerateInputSchema>;
export type GenerationTask = z.infer<typeof GenerationTaskSchema>;
export type LocalTaskStatus = "queued" | "running" | "succeeded" | "failed";

import { fal } from "@fal-ai/client";
import { FalInput, reference_to_video } from "@/apigen/fal.ts";

export async function generate(
    input: GenerateInput | {
        model: "fal/minimax/h3/reference-to-video";
        input: FalInput;
    },
    apiKey: string,
) {
    if (input.model == "fal/minimax/h3/reference-to-video") {
        const result = await reference_to_video(input.input, apiKey);
        console.log(result);
        if(result instanceof Error) {
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
        if(result instanceof Error) {
            return result;
        }
        return {
            provider: "minimax" as const,
            model: input.model,
            res: result,
        }
    } else if (isZzdhInput(input)) {
        const zzdhClient = new ZzdhClient({
            apiKey,
        });
        const res = await zzdhClient.createTask(input);
        if(res instanceof Error) {
            return res;
        }
        return {
            provider: "zzdh" as const,
            model: input.model,
            res,
        }
    } else {
        const res = await new SeedanceClient({ apiKey }).generate(input);
        if(res instanceof Error) {
            return res;
        }
        return {
            provider: "seedance" as const,
            model: input.model,
            res,
        }
    }
}

export async function getTask(model: string, taskId: string, apiKey: string) {
    if (isMiniMaxModel(model)) {
        const client = new MiniMaxClient({
            apiKey,
        });
        const response = await client.getVideoTask(taskId);
        return response instanceof Error ? response : response.task;
    }
    if (isZzdhModel(model)) {
        const zzdhClient = new ZzdhClient({
            apiKey,
        });
        return await zzdhClient.getTask(taskId);
    }
    return await new SeedanceClient({ apiKey }).getTask(taskId);
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
        try {
            const response = await fetch(url);
            if (!response.ok) {
                return new Error(
                    `[${response.status}] ${await response.text()}`,
                );
            }
            return response;
        } catch (error) {
            return error instanceof Error ? error : new Error(String(error));
        }
    }
    if (isZzdhModel(model)) {
        const zzdhClient = new ZzdhClient({
            apiKey,
        });
        return await zzdhClient.getContent(taskId);
    }

    const parsed = SeedanceTaskSchema.safeParse(task);
    if (!parsed.success) return parsed.error;
    const url = parsed.data.content?.video_url;
    if (!url) return new Error(`Task ${taskId} has no video URL`);
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return new Error(`[${response.status}] ${await response.text()}`);
        }
        return response;
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
}

export function isZzdhModel(model: unknown): model is z.infer<
    typeof ZzdhModelSchema
> {
    return ZzdhModelSchema.safeParse(model).success;
}

export function isMiniMaxModel(model: unknown): model is z.infer<
    typeof MiniMaxVideoModelSchema
> {
    return MiniMaxVideoModelSchema.safeParse(model).success;
}

export function isMiniMaxInput(
    input: GenerateInput,
): input is z.infer<typeof MiniMaxCreateVideoTaskRequestSchema> {
    return isMiniMaxModel(input.model);
}

export function isZzdhInput(
    input: GenerateInput,
): input is z.infer<typeof ZzdhCreateTaskRequestSchema> {
    return isZzdhModel(input.model);
}

export function localTaskStatus(task: GenerationTask): LocalTaskStatus {
    switch (task.status) {
        case "in_progress":
            return "running";
        case "completed":
            return "succeeded";
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
    response: { id?: string; task_id?: string },
): string | Error {
    const taskId = response.id ?? response.task_id;
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
