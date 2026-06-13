import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import Application from "../islands/Application.tsx";

export default define.page(function Home(ctx) {
    return (
        <>
            <Head>
                <title>Open Director</title>
            </Head>
            <Application />
        </>
    );
});
