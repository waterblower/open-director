import { Head } from "fresh/runtime";
import GenerationPlan from "../islands/GenerationPlan.tsx";
import { define } from "../utils.ts";

export default define.page(function GenerationPlanPage() {
    return (
        <>
            <Head>
                <title>Generation Plan · Open Director</title>
                <meta
                    name="description"
                    content="Open a TOML generation plan and browse its tasks as cards."
                />
            </Head>
            <GenerationPlan />
        </>
    );
});
