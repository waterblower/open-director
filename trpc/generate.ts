import { publicProcedure } from "@/trpc/init.ts";
import * as z from "zod";
import {
    archiveGeneration,
    clearGenerationReaction,
    createGeneration,
    db,
    Generation,
    getGenerationById,
    getGenerationByTaskId,
    getGenerationDetail,
    getGenerationIdByContentHash,
    getGenerationReaction,
    getGenerationRequest,
    listArchivedGenerationIds,
    listGenerationReactions,
    listGenerations,
    recordGeneration,
    reopenDb,
    setGenerationReaction,
    unarchiveGeneration,
    updateGeneration,
} from "../db.ts";
import { getLastOpenedProject } from "@/project_registry.ts";
import { getStoredApiKeyFromModel, kv } from "@/kv.ts";
import { global_event_bus, resolveToDataUrl } from "@/trpc/router.ts";
import { externalizeAttachments, storeDataUrl } from "@/uploads.ts";

import {
    generate,
    GenerateInput,
    getTask,
    isFalModel,
    isMiniMaxModel,
    isSeedanceModel,
    localTaskStatus,
    taskIdFromCreateResponse,
} from "@/apigen/mod.ts";
import * as seedance from "../apigen/seedance/seedance.ts";
import { FalInput } from "@/apigen/fal.ts";
import * as minimax from "../apigen/minimax.ts";

export const tRPC_generate = publicProcedure
    .input(z.object({
        model: z.union([
            z.enum([
                "doubao-seedance-2-0-260128",
                "doubao-seedance-2-0-fast-260128",
                "doubao-seedance-2-0-mini-260615",
                "fal/minimax/h3/reference-to-video",
            ]),
            minimax.VideoModelSchema,
        ]),
        prompt: z.string(),
        attachments: z.array(z.object({
            kind: z.enum(["image", "video", "audio"]),
            dataUrlOrFilePath: z.string(),
        })),
        ratio: z.enum([
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9",
            "adaptive",
            "horizontal",
            "vertical",
        ]),
        resolution: z.enum([
            "1080p",
            "720p",
            "480p",
            "768P",
            "2K",
        ]),
        durationMode: z.enum(["seconds", "smart"]),
        duration: z.number(),
        audio: z.boolean(),
        mode: z.enum(["reference", "frames"]).default("reference"),
    }))
    .mutation(async (opts) => {
        if (!db) {
            throw new Error("Database not initialized");
        }
        const {
            prompt,
            attachments,
            ratio,
            durationMode,
            duration,
            audio,
            resolution,
            model,
            mode,
        } = opts.input;

        const projectRoot = (await getLastOpenedProject(kv))?.path;
        if (!projectRoot) {
            throw new Error("Project not initialized");
        }

        let request: GenerateInput;
        let storedRequest: GenerateInput;
        if (isFalModel(model)) {
            if (!prompt.trim()) {
                throw new Error(
                    "fal reference-to-video requires a prompt",
                );
            }
            if (attachments.some((att) => att.kind !== "image")) {
                throw new Error(
                    "fal reference-to-video accepts image references only",
                );
            }
            const falResolution = resolution === "480p"
                ? "480P"
                : resolution === "768P"
                ? "768P"
                : null;
            if (!falResolution) {
                throw new Error(
                    `Unsupported fal resolution: ${resolution}`,
                );
            }
            if (duration > 15) {
                throw new Error("fal duration must be at most 15s");
            }
            const falRatio = ratio === "horizontal"
                ? "16:9"
                : ratio === "vertical"
                ? "9:16"
                : ratio;
            // fal fetches references by URL, and our uploads dir isn't
            // reachable from the internet — so send the bytes inline
            // and only externalize the copy we persist.
            const inlineUrls = await Promise.all(
                attachments.map((att) =>
                    resolveToDataUrl(att.dataUrlOrFilePath)
                ),
            );
            const falInput: FalInput = {
                prompt: prompt.trim(),
                duration,
                resolution: falResolution,
                enable_safety_checker: false,
                prompt_expansion_mode: "fast",
                aspect_ratio: falRatio,
                reference_image_urls: inlineUrls,
            };
            request = { model, input: falInput };
            const storedUrls = await Promise.all(
                inlineUrls.map(async (url) => {
                    if (!url.startsWith("data:")) return url;
                    const stored = await storeDataUrl(
                        projectRoot,
                        url,
                    );
                    if (stored instanceof Error) {
                        console.error(
                            "[trpc] failed to store generated asset:",
                            stored,
                        );
                        return url;
                    }
                    return stored;
                }),
            );
            storedRequest = {
                model,
                input: {
                    ...falInput,
                    reference_image_urls: storedUrls,
                },
            };
        } else if (isMiniMaxModel(model)) {
            if (!prompt.trim()) {
                throw new Error("MiniMax H3 requires a prompt");
            }

            const useFrames = mode === "frames" ||
                model === "MiniMax-H3-Max";
            if (
                useFrames &&
                (attachments.length > 2 ||
                    attachments.some((att) => att.kind !== "image"))
            ) {
                throw new Error(
                    "MiniMax frame generation accepts at most two images",
                );
            }
            const content: minimax.VideoGenerationContent[] = [{
                type: "text",
                text: prompt.trim(),
            }];
            for (const [index, att] of attachments.entries()) {
                const rawUrl = await resolveToDataUrl(
                    att.dataUrlOrFilePath,
                );
                const url = normalizeMiniMaxDataUrl(rawUrl);
                if (useFrames) {
                    content.push({
                        type: "image_url",
                        image_url: { url },
                        role: index === 0 ? "first_frame" : "last_frame",
                    });
                } else if (att.kind === "image") {
                    content.push({
                        type: "image_url",
                        image_url: { url },
                        role: "reference_image",
                    });
                } else if (att.kind === "video") {
                    content.push({
                        type: "video_url",
                        video_url: { url },
                        role: "reference_video",
                    });
                } else {
                    content.push({
                        type: "audio_url",
                        audio_url: { url },
                        role: "reference_audio",
                    });
                }
            }

            const outputResolution = resolution === "2K"
                ? "2K"
                : resolution === "768P"
                ? "768P"
                : resolution === "480p"
                ? "480P"
                : null;
            if (!outputResolution) {
                throw new Error(
                    `Unsupported MiniMax resolution: ${resolution}`,
                );
            }
            const outputRatio = ratio === "horizontal"
                ? "16:9"
                : ratio === "vertical"
                ? "9:16"
                : ratio;
            request = {
                model,
                content,
                resolution: outputResolution,
                duration,
                ratio: useFrames && attachments.length > 0
                    ? "adaptive"
                    : outputRatio,
            };
            storedRequest = {
                ...request,
                content: await externalizeMiniMaxAttachments(
                    projectRoot,
                    content,
                ),
            };
        } else if (isSeedanceModel(model)) {
            // Assemble Seedance multimodal content: optional text, then
            // each attachment as a typed reference.
            if (resolution === "768P" || resolution === "2K") {
                throw new Error(
                    `Unsupported Seedance resolution: ${resolution}`,
                );
            }
            const content: seedance.ContentItem[] = [];
            if (prompt) content.push({ type: "text", text: prompt });
            for (const att of attachments) {
                const url = await resolveToDataUrl(
                    att.dataUrlOrFilePath,
                );
                if (att.kind === "image") {
                    content.push({
                        type: "image_url",
                        image_url: { url },
                        role: "reference_image",
                    });
                } else if (att.kind === "video") {
                    content.push({
                        type: "video_url",
                        video_url: { url },
                        role: "reference_video",
                    });
                } else {
                    content.push({
                        type: "audio_url",
                        audio_url: { url },
                        role: "reference_audio",
                    });
                }
            }
            const seedanceRequest = {
                model,
                content,
                generate_audio: audio,
                resolution,
                ratio: ratio as Exclude<
                    typeof ratio,
                    "horizontal" | "vertical"
                >,
                ...(durationMode === "seconds" ? { duration } : {}),
            } satisfies seedance.CreateTaskRequest;
            request = seedanceRequest;
            storedRequest = {
                ...seedanceRequest,
                content: await externalizeAttachments(
                    projectRoot,
                    content,
                ),
            };
        } else {
            throw new Error(`Unsupported model: ${model}`);
        }

        // Resolve the key *before* logging the generation: a row with
        // no task id looks "queued" to task_checker, which only gives
        // up after a 5 minute grace and then reports the generic
        // "never submitted" reason instead of the real cause.
        const apiKey = await getStoredApiKeyFromModel(request.model);
        if (!apiKey) {
            throw new Error(
                `No API key configured for ${request.model} — add one in Settings`,
            );
        }

        const generation = createGeneration(db, storedRequest);
        if (generation instanceof Error) {
            throw generation;
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
            throw err;
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
            if (gen instanceof Error) throw gen;
            return gen;
        }
        const task = polled.task;
        const err2 = updateGeneration(db, {
            id: generation.id,
            task_json: task,
            status: localTaskStatus(task),
        });
        if (err2 instanceof Error) {
            throw err2;
        }

        console.log("[trpc] task result:", task);

        // Logging failure shouldn't fail the request — the task is created.
        const recordErr = recordGeneration(db, {
            taskId,
            requestJson: JSON.stringify(storedRequest),
            createdAt: new Date().toISOString(),
            status: localTaskStatus(task),
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
            throw gen;
        }
        return gen;
    });

/** Normalize browser MIME aliases to the data-URI spellings MiniMax accepts. */
function normalizeMiniMaxDataUrl(url: string): string {
    return url
        .replace(/^data:audio\/mpeg;base64,/, "data:audio/mp3;base64,")
        .replace(
            /^data:audio\/(?:x-wav|wave);base64,/,
            "data:audio/wav;base64,",
        );
}
/** Keep generation history small by replacing inline MiniMax media with files. */
async function externalizeMiniMaxAttachments(
    projectRoot: string,
    content: minimax.VideoGenerationContent[],
): Promise<minimax.VideoGenerationContent[]> {
    return await Promise.all(content.map(async (item) => {
        if (item.type === "text") return item;

        const source = item.type === "image_url"
            ? item.image_url.url
            : item.type === "video_url"
            ? item.video_url.url
            : item.audio_url.url;
        if (!source.startsWith("data:")) return item;

        const url = await storeDataUrl(projectRoot, source);
        if (url instanceof Error) throw url;
        if (item.type === "image_url") {
            return { ...item, image_url: { url } };
        }
        if (item.type === "video_url") {
            return { ...item, video_url: { url } };
        }
        return { ...item, audio_url: { url } };
    }));
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
        throw err;
    }
    const gen = getGenerationById(db!, generation.id);
    if (gen instanceof Error) {
        throw gen;
    }
    return gen;
};
