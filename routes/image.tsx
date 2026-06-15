import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import ImageGridEditor from "../islands/ImageGridEditor.tsx";

export default define.page(function ImagePage() {
    return (
        <>
            <Head>
                <title>Image Grid Editor — Open Director</title>
            </Head>
            <ImageGridEditor />
        </>
    );
});
