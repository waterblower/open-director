import { z } from "zod";
import { parseJSON, safeFetch } from "@/apigen/fetch.ts";

export const AUTODL_Models = [
    "autodl/minimax_h3_lightx2v_v5",
] as const;

export const AutoDL_Resolution_Options = [
    "480p横",
    "480p竖",
    "480p(1:1)",
    "768p横",
    "768p竖",
    "768p(1:1)",
    "1080p横",
    "1080p竖",
    "1080p(1:1)",
] as const;

export const AutoDL_Task_Status = ["QUEUED", "RUNNING", "SUCCESS"] as const;

export const AutoDL_GenerateInput_Schema = z.object({
    model: z.enum(AUTODL_Models),
    input: z.object({
        "seed": z.number().min(1).optional(),
        "prompt": z.string(),
        "duration": z.number().min(1).max(10),
        "resolution": z.enum(AutoDL_Resolution_Options),
        "ref_image_0": z.string(),
        "ref_image_1": z.string().optional(),
        "ref_image_2": z.string().optional(),
        "ref_image_3": z.string().optional(),
        "ref_image_4": z.string().optional(),
        "ref_image_5": z.string().optional(),
        "ref_image_6": z.string().optional(),
        "ref_image_7": z.string().optional(),
        "ref_image_8": z.string().optional(),
    }),
});
export type generate_Input = z.infer<typeof AutoDL_GenerateInput_Schema>;

export const generate_Output_Schema = z.object({
    code: z.string(),
    data: z.union([
        z.null(),
        z.object({
            status: z.enum(AutoDL_Task_Status),
            task_id: z.string(),
            workflow: z.string(),
            client_id: z.string(),
            message: z.string(),
            created_at: z.iso.datetime({ offset: true }),
        }),
    ]),
    msg: z.string(),
    request_id: z.string(),
});
export type generate_Output = z.infer<typeof generate_Output_Schema>;

export async function generate(
    input: generate_Input,
    apikey: string,
) {
    if (!apikey) {
        return new Error("apikey is required");
    }
    const url =
        "https://autodl.art/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_v5";
    const res = await safeFetch(
        url,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apikey}`,
            },
            body: JSON.stringify(input.input),
        },
    );
    if (res instanceof Error) {
        return res;
    }
    const text = await res.text();
    if (res.status != 200) {
        return new Error(`${url}: ${res.status}, ${text}`);
    }

    const json = parseJSON(text);
    if (json instanceof Error) {
        return json;
    }

    console.log("json", json);
    const output = generate_Output_Schema.safeParse(json, {
        reportInput: true,
    });
    if (output.error) {
        return output.error;
    }
    return output.data;
}

export const get_Output_Schema = z.object({
    code: z.string(),
    data: z.union([
        z.object({
            status: z.literal("RUNNING"),
            task_id: z.string(),
            client_id: z.string(),
            created_at: z.coerce.date(),
            started_at: z.coerce.date(),
            duration: z.number(),
            results: z.array(z.void()),
        }),
        z.object({
            status: z.literal("SUCCESS"),
            task_id: z.string(),
            client_id: z.string(),
            created_at: z.coerce.date(),
            started_at: z.coerce.date(),
            finished_at: z.coerce.date(),
            duration: z.number(),
            results: z.array(z.object({
                type: z.enum(["video"]),
                output_type: z.enum(["output"]),
                url: z.string(),
                file_type: z.enum(["mp4"]),
                alias: z.literal("final_video"),
                description: z.string(),
            })),
        }),
    ]),
    msg: z.string(),
    request_id: z.string(),
});

export async function get(task_id: string, apikey: string) {
    if (!apikey) {
        return new Error("apikey is required");
    }
    const url =
        `https://autodl.art/api/v1/comfyui/comfyui_workflow/result/${task_id}`;
    const res = await safeFetch(
        url,
        {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apikey}`,
            },
        },
    );
    if (res instanceof Error) {
        return res;
    }

    const text = await res.text();
    if (res.status != 200) {
        return new Error(`${url}: ${res.status}, ${text}`);
    }

    const json = parseJSON(text);
    if (json instanceof Error) {
        return json;
    }

    console.log("json", json);
    const output = get_Output_Schema.safeParse(json, {
        reportInput: true,
    });
    if (output.error) {
        return output.error;
    }
    return output.data;
}
// 7c1f8046-0539-443c-bd1d-7916d5a36f9d
// aec955e3-e39e-4785-a353-70fc4868c252
// ba1a5599-295f-4a76-9ddc-8e57af724ce2
// 0cfe0da0-5676-4a0e-9d7b-164554971e6f
