import { z } from "zod";
import {
    CreateTaskRequestSchema as SeedanceCreateTaskRequestSchema,
    TaskSchema as SeedanceTaskSchema,
} from "@/apigen/seedance/seedance.ts";
import { seedance_client } from "@/apigen/seedance/seedance_client.ts";
import {
    CreateTaskRequestSchema as ZzdhCreateTaskRequestSchema,
    ModelSchema as ZzdhModelSchema,
    TaskSchema as ZzdhTaskSchema,
    ZzdhClient,
} from "@/apigen/zzdh/zzdh_client.ts";
import { getStoredApiKey } from "@/kv.ts";

export const GenerateInputSchema = z.union([
    SeedanceCreateTaskRequestSchema,
    ZzdhCreateTaskRequestSchema,
]);
export const GenerationTaskSchema = z.union([
    SeedanceTaskSchema,
    ZzdhTaskSchema,
]);

export type GenerateInput = z.infer<typeof GenerateInputSchema>;
export type GenerationTask = z.infer<typeof GenerationTaskSchema>;
export type LocalTaskStatus = "queued" | "running" | "succeeded" | "failed";

export async function generate(input: GenerateInput) {
    if (isZzdhInput(input)) {
        const zzdhClient = new ZzdhClient({
            apiKey: (await getStoredApiKey("zzdh")) ?? "",
        });
        return await zzdhClient.createTask(input);
    }

    return await seedance_client.generate(input);
}

export async function getTask(model: string, taskId: string) {
    if (isZzdhModel(model)) {
        const zzdhClient = new ZzdhClient({
            apiKey: (await getStoredApiKey("zzdh")) ?? "",
        });
        return await zzdhClient.getTask(taskId);
    }
    return await seedance_client.getTask(taskId);
}

export async function getVideoContent(
    model: string,
    taskId: string,
    task: GenerationTask,
): Promise<Response | Error> {
    if (isZzdhModel(model)) {
        const zzdhClient = new ZzdhClient({
            apiKey: (await getStoredApiKey("zzdh")) ?? "",
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
