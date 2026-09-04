import { get_result, wait_for_result } from "@/apigen/fal.ts";
import { generate } from "./mod.ts";

const test_api_key =
    "90efd8f9-3f7e-4881-89b7-7fbdeaedb08e:a1bd36301b27b363eed791018c74e639";

Deno.test("generate", async () => {
    const res = await generate(
        {
            model: "fal/minimax/h3/reference-to-video",
            input: {
                prompt:
                    `In an private bathroom, the lady takes off her suit, preparing for shower. no music, no lyrics.`,
                duration: 15,
                resolution: "768P",
                enable_safety_checker: false,
                prompt_expansion_mode: "fast",
                aspect_ratio: "4:3",
                reference_image_urls: [
                    await data_url("./data/body.png"),
                    await data_url("./data/face.jpeg"),
                ],
            },
        },
        test_api_key,
    );
    console.log(res);
    if (res instanceof Error) {
        throw res;
    }
    if (res.model != "fal/minimax/h3/reference-to-video") {
        throw new Error("Unexpected model: " + res.model);
    }
    const result = await wait_for_result(
        res.res.request_id,
        test_api_key,
    );
    console.log(result);
});

Deno.test("get", async () => {
    const res = await wait_for_result(
        "01a06789-0f4a-7f83-a5fc-65f2cfa2df5b",
        // "01a06771-e3de-7143-a8a0-ef152e3eb16c",
        // "01a0676f-aa0c-79f2-9bcf-c19ba7375e21",
        // "01a06752-78b2-75a2-a229-e47ad1688619",
        // "01a0673e-df1d-7610-a008-c2769398c20d",
        test_api_key,
    );
    console.log(res);
});

async function data_url(path: string) {
    const file = new URL(path, import.meta.url);
    const extension = file.pathname.split(".").pop()?.toLowerCase();
    const mimeType = extension === "png"
        ? "image/png"
        : extension === "jpg" || extension === "jpeg"
        ? "image/jpeg"
        : extension === "webp"
        ? "image/webp"
        : extension === "gif"
        ? "image/gif"
        : undefined;

    if (!mimeType) {
        throw new Error(`Unsupported image type: ${path}`);
    }

    const bytes = await Deno.readFile(file);
    return `data:${mimeType};base64,${bytes.toBase64()}`;
}
