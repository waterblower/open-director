import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import Scene3D from "../islands/Scene3D.tsx";

export default define.page(function Home(ctx) {
  console.log("Shared value " + ctx.state.shared);

  return (
    <>
      <Head>
        <title>Fresh counter</title>
      </Head>
      <Scene3D />
    </>
  );
});
