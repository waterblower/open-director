import { assert, assertEquals } from "@std/assert";
import { delay } from "@std/async";
import { join } from "@std/path";
import { watchProjectFiles } from "./project_watcher.ts";

Deno.test("watcher batches changes, ignores .DS_Store, and closes pending reads", async () => {
    const root = await Deno.realPath(await Deno.makeTempDir());
    await Deno.mkdir(join(root, "nested"));
    // Let macOS finish reporting fixture directory creation before watching.
    await delay(300);
    const watcher = watchProjectFiles(root);
    assert(!(watcher instanceof Error));
    const received: (void | Error)[] = [];
    const consumer = (async () => {
        for (;;) {
            const event = await watcher.next();
            if (event instanceof Error) {
                return event;
            }
            received.push(event);
        }
    })();
    try {
        await Deno.writeTextFile(join(root, "nested", ".DS_Store"), "metadata");
        await delay(400);
        assertEquals(received, []);

        await Deno.writeTextFile(join(root, "nested", "clip.txt"), "first");
        await Deno.writeTextFile(join(root, "nested", "clip.txt"), "updated");
        await Deno.rename(
            join(root, "nested", "clip.txt"),
            join(root, "nested", "renamed.txt"),
        );
        const deadline = Date.now() + 5000;
        while (received.length === 0 && Date.now() < deadline) {
            await delay(20);
        }
        assertEquals(received, [undefined]);
        await delay(400);
        assertEquals(received, [undefined]);

        assertEquals(await watcher.close(), undefined);
        assert((await consumer) instanceof Error);
        assert((await watcher.next()) instanceof Error);
        assertEquals(await watcher.close(), undefined);
        await Deno.writeTextFile(join(root, "after-close.txt"), "ignored");
        await delay(250);
        assertEquals(received, [undefined]);
    }
    finally {
        await watcher.close();
        await consumer;
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("watcher returns startup errors", async () => {
    const root = await Deno.makeTempDir();
    try {
        assert(watchProjectFiles(join(root, "missing")) instanceof Error);
    }
    finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("closing before consumption discards pending changes", async () => {
    const root = await Deno.realPath(await Deno.makeTempDir());
    const watcher = watchProjectFiles(root);
    assert(!(watcher instanceof Error));
    try {
        await Deno.writeTextFile(join(root, "clip.txt"), "data");
        await delay(50);
        assertEquals(await watcher.close(), undefined);
        assert((await watcher.next()) instanceof Error);
    }
    finally {
        await watcher.close();
        await Deno.remove(root, { recursive: true });
    }
});
