import { ZzdhClient } from "@/apigen/zzdh/zzdh_client.ts";

const API_KEY = "";

Deno.test({
    name: "generate",
    async fn() {
        const client = new ZzdhClient({ apiKey: API_KEY });
        const result = await client.createTask({
            model: "zzdh-minimax-h3-限时优惠-多参考图生-768p",
            prompt: "东京郊区夜晚。镜头在汽车内部，后排坐。她将高跟鞋脱下放到座位底下，然后背靠车门，横着将双腿放到沙发上休息。画面最终定格在她的玉足。没有配乐，没有字幕。",
            duration: 15,
            aspect_ratio: "horizontal",
            reference_images: [
                {
                    url: "https://github-production-user-asset-6210df.s3.amazonaws.com/127284497/644339410-3ac8133b-c938-461f-95fc-b456a9cec0e6.jpeg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAVCODYLSA53PQK4ZA%2F20260901%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260901T131718Z&X-Amz-Expires=300&X-Amz-Signature=218ad04c7cc32474a8b3bb43fe130aa24f741922bd6287402a20bcd2d052532d&X-Amz-SignedHeaders=host&response-content-type=image%2Fjpeg",
                    role: "reference_image",
                },
                {
                    url: "https://github-production-user-asset-6210df.s3.amazonaws.com/127284497/644342073-055f6ebe-320d-4263-acb7-ce2b4822d052.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAVCODYLSA53PQK4ZA%2F20260901%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260901T131748Z&X-Amz-Expires=300&X-Amz-Signature=4bae684c1f1b37eb87e976c93ca856ebf8d00785e0d4a2c2eb5d78b696c0d681&X-Amz-SignedHeaders=host&response-content-type=image%2Fpng",
                    role: "reference_image",
                }
            ],
        });
        if (result instanceof Error) throw result;


        console.log("Created ZZDH task:", result);
    },
});

Deno.test("download", async () => {
    const taskId = "66e35963-bd1b-4461-ab58-f05014f4893e";
    const outputUrl = new URL(`../data/${taskId}.mp4`, import.meta.url);
    const client = new ZzdhClient({ apiKey: API_KEY });

    const response = await client.getContent(taskId);
    if (response instanceof Error) throw response;
    if (!response.body) {
        throw new Error("ZZDH video response did not contain a body");
    }

    const output = await Deno.open(outputUrl, {
        create: true,
        write: true,
        truncate: true,
    });
    await response.body.pipeTo(output.writable);

    const file = await Deno.stat(outputUrl);
    if (file.size === 0) throw new Error("Downloaded ZZDH video was empty");

    console.log("Downloaded ZZDH video to:", outputUrl.pathname);
});
