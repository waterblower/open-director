import { SeedanceClient } from "@/apigen/seedance/seedance.ts";


const IMAGE_NAME = "沈云舒-正脸-35.jpeg";
const IMAGE_URL = new URL(`./data/${IMAGE_NAME}`, import.meta.url);

const seedance_client = new SeedanceClient({
    apiKey: ""
})

Deno.test({
    name: "upload image",
    async fn() {
        const bytes = await Deno.readFile(IMAGE_URL);
        const image = new File([bytes], IMAGE_NAME, {
            type: "image/jpeg",
        });

        const result = await seedance_client.uploadFile({
            file: image,
            purpose: "user_data",
        });
        if (result instanceof Error) throw result;

        if (result.object !== "file") {
            throw new Error(
                `Expected a file object, received ${result.object}`,
            );
        }
        if (result.filename !== IMAGE_NAME) {
            throw new Error(
                `Expected filename ${IMAGE_NAME}, received ${result.filename}`,
            );
        }
        if (result.bytes !== bytes.byteLength) {
            throw new Error(
                `Expected ${bytes.byteLength} bytes, received ${result.bytes}`,
            );
        }

        console.log("Uploaded Seedance image:", result);
    },
});
