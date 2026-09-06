import { publicProcedure } from "@/trpc/init.ts";
import {
    createGeneration,
    db,
    type Generation,
    getGenerationById,
    recordGeneration,
    updateGeneration,
} from "../db.ts";
import { getLastOpenedProject } from "@/project_registry.ts";
import { getStoredApiKeyFromModel, kv } from "@/kv.ts";
import { global_event_bus } from "@/trpc/router.ts";
import { storeDataUrl } from "@/uploads.ts";
import {
    generate,
    type GenerateInput,
    GenerateInputSchema,
    getTask,
    isAutoDLInput,
    localTaskStatus,
    taskFailureReason,
    taskIdFromCreateResponse,
} from "@/apigen/mod.ts";
import { extname } from "@std/path";

export const tRPC_generate = publicProcedure
    .input(GenerateInputSchema)
    .mutation(async ({ input }) => {
        const result = await submitGeneration(input);
        if (result instanceof Error) {
            return {
                error: true as const,
                ...result,
            };
        }
        return result;
    });

async function submitGeneration(
    input: GenerateInput,
) {
    if (!db) {
        return new Error("Database not initialized");
    }
    const projectRoot = (await getLastOpenedProject(kv))?.path;
    if (!projectRoot) {
        return new Error("Project not initialized");
    }
    const prepared = await prepareRequestMedia(input, projectRoot);
    if (prepared instanceof Error) {
        return prepared;
    }
    const { request, storedRequest } = prepared;
    // Resolve the key *before* logging the generation: a row with
    // no task id looks "queued" to task_checker, which only gives
    // up after a 5 minute grace and then reports the generic
    // "never submitted" reason instead of the real cause.
    const apiKey = await getStoredApiKeyFromModel(request.model);
    if (!apiKey) {
        return new Error(
            `No API key configured for ${request.model} — add one in Settings`,
        );
    }

    const generation = createGeneration(db, storedRequest);
    if (generation instanceof Error) {
        return generation;
    }
    console.log("[trpc] generation created:", generation.id);
    await global_event_bus.put({
        type: "generation_created",
        gen: generation,
    });

    const created = await generate(request, apiKey);
    if (created instanceof Error) {
        return failGeneration(created.message, generation as Generation);
    }
    const taskId = taskIdFromCreateResponse(created.res);
    if (taskId instanceof Error) {
        return failGeneration(taskId.message, generation as Generation);
    }
    console.log("[trpc] task created:", created);
    const err = updateGeneration(db, {
        id: generation.id,
        task_id: taskId,
    });
    if (err instanceof Error) {
        return err;
    }

    const polled = await getTask(request.model, taskId, apiKey);
    if (polled instanceof Error) {
        // The task exists (we have its id) — leave it for
        // task_checker to poll rather than failing the row.
        console.error(
            `[trpc] first poll of ${taskId} failed:`,
            polled,
        );
        const gen = getGenerationById(db, generation.id);
        if (gen instanceof Error) {
            return gen;
        }
        return gen;
    }
    const task = polled.task;
    const status = polled.provider === "autodl"
        ? polled.task.status === "SUCCESS"
            ? "succeeded"
            : polled.task.status === "FAILED"
            ? "failed"
            : polled.task.status === "RUNNING"
            ? "running"
            : "queued"
        : localTaskStatus(polled.task.status);
    const failedReason = polled.provider === "autodl"
        ? polled.task.status === "FAILED"
            ? polled.task.message || (typeof polled.task.error === "string"
                ? polled.task.error
                : polled.task.error?.message) ||
                "AutoDL generation failed"
            : undefined
        : taskFailureReason(polled.task);
    const err2 = updateGeneration(db, {
        id: generation.id,
        task_json: task,
        status,
        failed_reason: failedReason,
    });
    if (err2 instanceof Error) {
        return err2;
    }

    console.log("[trpc] task result:", task);

    // Logging failure shouldn't fail the request — the task is created.
    const recordErr = recordGeneration(db, {
        taskId,
        requestJson: JSON.stringify(storedRequest),
        createdAt: new Date().toISOString(),
        status,
        task,
    });
    if (recordErr) {
        console.error(
            "[trpc] failed to record task log:",
            recordErr,
        );
    }
    const gen = getGenerationById(db, generation.id);
    if (gen instanceof Error) {
        return gen;
    }
    return gen;
}

/**
 * Mark the just-created row failed with the real reason. Any
 * throw from here on would otherwise strand it in "queued".
 */
const failGeneration = (reason: string, generation: Generation) => {
    console.error(
        `[trpc] generation ${generation.id} failed:`,
        reason,
    );
    const err = updateGeneration(db!, {
        id: generation.id,
        failed_reason: reason,
        status: "failed",
    });
    if (err instanceof Error) {
        return err;
    }
    const gen = getGenerationById(db!, generation.id);
    if (gen instanceof Error) {
        return gen;
    }
    return gen;
};

/** Native file reads may fail; return those failures to the RPC boundary. */
async function inlineMedia(url: string): Promise<string | Error> {
    if (/^(data:|https?:\/\/|mm_file:\/\/)/.test(url)) {
        return url;
    }
    let bytes: Uint8Array;
    try {
        bytes = await Deno.readFile(url);
    }
    catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
    const mime: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".mp3": "audio/mp3",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
    };
    return `data:${
        mime[extname(url).toLowerCase()] ?? "application/octet-stream"
    };base64,${bytes.toBase64()}`;
}

/** Prepare dispatch and history copies using the provider's known media shape. */
async function prepareRequestMedia(input: GenerateInput, projectRoot: string) {
    const request = structuredClone(input);
    const storedRequest = structuredClone(input);
    if (
        request.model === "fal/minimax/h3/reference-to-video" &&
        storedRequest.model === "fal/minimax/h3/reference-to-video"
    ) {
        for (
            const [index, url] of request.input.reference_image_urls.entries()
        ) {
            const media = await prepareMedia(url, projectRoot);
            if (media instanceof Error) {
                return media;
            }
            request.input.reference_image_urls[index] = media.inline;
            storedRequest.input.reference_image_urls[index] = media.stored;
        }
    }
    else if (isAutoDLInput(request) && isAutoDLInput(storedRequest)) {
        const keys = [
            "ref_image_0",
            "ref_image_1",
            "ref_image_2",
            "ref_image_3",
            "ref_image_4",
            "ref_image_5",
            "ref_image_6",
            "ref_image_7",
            "ref_image_8",
        ] as const;
        for (const key of keys) {
            const url = request.input[key];
            if (url === undefined) {
                continue;
            }
            const media = await prepareMedia(url, projectRoot);
            if (media instanceof Error) {
                return media;
            }
            request.input[key] = media.inline;
            storedRequest.input[key] = media.stored;
        }
    }
    else if ("content" in request && "content" in storedRequest) {
        // Seedance and MiniMax both discriminate content items by type.
        for (const [index, item] of request.content.entries()) {
            const storedItem = storedRequest.content[index];
            if (item.type === "image_url" && storedItem.type === "image_url") {
                const media = await prepareMedia(
                    item.image_url.url,
                    projectRoot,
                );
                if (media instanceof Error) {
                    return media;
                }
                item.image_url.url = media.inline;
                storedItem.image_url.url = media.stored;
            }
            else if (
                item.type === "video_url" && storedItem.type === "video_url"
            ) {
                const media = await prepareMedia(
                    item.video_url.url,
                    projectRoot,
                );
                if (media instanceof Error) {
                    return media;
                }
                item.video_url.url = media.inline;
                storedItem.video_url.url = media.stored;
            }
            else if (
                item.type === "audio_url" && storedItem.type === "audio_url"
            ) {
                const media = await prepareMedia(
                    item.audio_url.url,
                    projectRoot,
                );
                if (media instanceof Error) {
                    return media;
                }
                item.audio_url.url = media.inline;
                storedItem.audio_url.url = media.stored;
            }
        }
    }
    else {
        throw new Error("Unsupported generation request shape");
    }
    const parsed = GenerateInputSchema.safeParse(request);
    if (!parsed.success) {
        return parsed.error;
    }
    const stored = GenerateInputSchema.safeParse(storedRequest);
    if (!stored.success) {
        return stored.error;
    }
    return { request: parsed.data, storedRequest: stored.data };
}

async function prepareMedia(url: string, projectRoot: string) {
    const inline = await inlineMedia(url);
    if (inline instanceof Error) {
        return inline;
    }
    if (!inline.startsWith("data:")) {
        return { inline, stored: inline };
    }
    const stored = await storeDataUrl(projectRoot, inline);
    if (stored instanceof Error) {
        return stored;
    }
    return { inline, stored };
}
