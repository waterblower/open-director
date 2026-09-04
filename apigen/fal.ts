import { z } from "zod";
import { safeFetch } from "@/apigen/fetch.ts";
import { delay } from "@std/async/delay";

/** The one fal endpoint we currently expose, used as a model identifier. */
export const FAL_REFERENCE_TO_VIDEO = "fal/minimax/h3/reference-to-video";

// https://fal.ai/models/minimax/h3/reference-to-video/api#schema-input
export const FalInputSchema = z.object({
    "prompt": z.string(),
    "duration": z.number().max(15),
    "resolution": z.enum(["480P", "768P"]),
    "enable_safety_checker": z.boolean(),
    "prompt_expansion_mode": z.enum(["fast", "balanced", "quality"]),
    "aspect_ratio": z.enum([
        "adaptive",
        "21:9",
        "16:9",
        "4:3",
        "1:1",
        "3:4",
        "9:16",
    ]),
    "reference_image_urls": z.array(z.string()),
});

export type FalInput = z.infer<typeof FalInputSchema>;

const OutputSchema = z.object({
    status: z.enum(["IN_QUEUE"]),
    request_id: z.string(),
    response_url: z.string(),
    status_url: z.string(),
    cancel_url: z.string(),
    logs: z.null(),
    metrics: z.object({}),
    queue_position: z.number(),
});

export async function reference_to_video(input: FalInput, apikey: string) {
    if (!apikey) {
        return new Error("apikey is required");
    }
    const res = await safeFetch(
        "https://queue.fal.run/minimax/h3/reference-to-video",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Key ${apikey}`,
            },
            body: JSON.stringify(input),
        },
    );
    if (res instanceof Error) {
        return res;
    }
    const json = await res.json();
    const output = OutputSchema.safeParse(json);
    if (output.error) {
        return output.error;
    }
    return output.data;
}

const ResultSchema = z.union([
    z.object({
        status: z.literal(404),
        detail: z.string(),
    }),
    z.object({
        status: z.literal(422),
        detail: z.array(
            z.object({
                loc: z.array(z.union([z.string(), z.number()])),
                msg: z.string(),
                type: z.enum([
                    "content_policy_violation",
                    "file_download_error",
                ]),
                url: z.string(),
                input: z.union([
                    z.string(),
                    z.object({
                        text: z.array(z.string()),
                        image_url: z.array(z.string()),
                    }),
                ]),
            }),
        ),
    }),
    z.object({
        status: z.literal(400),
        cancel_url: z.string(),
        detail: z.string(),
        request_id: z.string(),
        response_url: z.string(),
        status_url: z.string(),
    }),
    z.object({
        status: z.literal(200),
        video: z.object({
            url: z.string(),
            content_type: z.literal("video/mp4"),
            file_name: z.string(),
            file_size: z.number(),
        }),
        expanded_prompt: z.string(),
    }),
]);

export async function get_result(requestID: string, apikey: string) {
    if (!apikey) {
        return new Error("apikey is required");
    }
    const res = await safeFetch(
        `https://queue.fal.run/minimax/h3/requests/${requestID}`,
        {
            method: "GET",
            headers: {
                "Authorization": `Key ${apikey}`,
            },
        },
    );
    if (res instanceof Error) {
        return res;
    }
    const text = await res.text();
    const json = JSON.parse(text);
    const final_result = ResultSchema.safeParse({
        status: res.status,
        ...json,
    }, {
        reportInput: true,
    });
    if (final_result.error) {
        return final_result.error;
    }
    return final_result.data;
}

export async function wait_for_result(requestID: string, apikey: string) {
    if (!apikey) {
        return new Error("apikey is required");
    }
    while (true) {
        const result = await get_result(requestID, apikey);
        if (result instanceof Error) {
            return result;
        }
        if (result.status === 200) {
            return result;
        } else if (result.status == 400) {
            if (result.detail == "Request is still in progress") {
                await delay(10000);
                continue;
            }
        } else if (result.status == 422) {
            return result;
        } else {
            console.error(result);
            throw new Error("Unexpected");
        }
    }
}
