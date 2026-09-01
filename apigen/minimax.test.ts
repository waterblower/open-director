import { assertEquals } from "@std/assert/equals";
import { MiniMaxClient } from "./minimax.ts";


const IMAGE_NAME = "沈云舒-正脸-35.jpeg";
const SOURCE_URL = new URL(`./data/${IMAGE_NAME}`, import.meta.url);
const DOWNLOAD_URL = new URL(
    "./data/沈云舒-正脸-35.downloaded.jpeg",
    import.meta.url,
);


async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        bytes as Uint8Array<ArrayBuffer>,
    );
    return Array.from(
        new Uint8Array(digest),
        (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
}

Deno.test({
    name: "upload and download a MiniMax video-generation input image",
    async fn() {
        const client = new MiniMaxClient({ apiKey: "" });
        const sourceBytes = await Deno.readFile(SOURCE_URL);
        const sourceFile = new File([sourceBytes], IMAGE_NAME, {
            type: "image/jpeg",
        });

        const uploaded = await client.uploadImage(sourceFile);
        if (uploaded instanceof Error) throw uploaded;

        assertEquals(
            uploaded.file.bytes , sourceBytes.byteLength,
            `Uploaded byte count ${uploaded.file.bytes} does not match source ${sourceBytes.byteLength}`,
        );
        console.log(
            "Uploaded MiniMax image:",
            `mm_file://${uploaded.file.file_id}`,
        );

        const response = await client.downloadFile(uploaded.file.file_id);
        if (response instanceof Error) throw response;

        const downloadedBytes = new Uint8Array(await response.arrayBuffer());
        // const [sourceHash, downloadedHash] = await Promise.all([
        //     sha256(sourceBytes),
        //     sha256(downloadedBytes),
        // ]);
        // assertEquals(
        //     downloadedHash, sourceHash,
        //     `Downloaded SHA-256 ${downloadedHash} does not match source ${sourceHash}`,
        // );

        await Deno.mkdir(new URL("./data/", import.meta.url), {
            recursive: true,
        });
        await Deno.writeFile(DOWNLOAD_URL, downloadedBytes);
        console.log("Downloaded MiniMax image to:", DOWNLOAD_URL.pathname);
    },
});
