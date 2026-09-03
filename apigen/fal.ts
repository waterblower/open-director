import { z } from "zod";
import { safeFetch } from "@/apigen/fetch.ts";

// https://fal.ai/models/minimax/h3/reference-to-video/api#schema-input
const FalInputSchema = z.object({
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
        detail: z.array(
            z.object({
                loc: z.array(z.string()),
                msg: z.string(),
                type: z.string(),
                url: z.string(),
                input: z.string(),
            }),
        ),
    }),
    z.object({
        cancel_url:z.string(),
        detail: z.string(),
        request_id: z.string(),
        response_url: z.string(),
        status_url: z.string(),
    }),
    z.object({
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
    const json = await res.json();
    return [res.status, json];
    // const output =  OutputSchema.safeParse(json);
    // if(output.error) {
    //     return output.error
    // }
    // return output.data;
}
