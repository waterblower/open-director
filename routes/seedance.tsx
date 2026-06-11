import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import Scene3D from "../islands/Scene3D.tsx";
import Seedance from "../islands/Seedance.tsx";

export default define.page(function ThreeDPage() {
    return (
        <>
            <Head>
                <title>3D Scene</title>
                <style>{`body,html{margin:0;padding:0;overflow:hidden}`}</style>
            </Head>
            <Seedance />
        </>
    );
});
