import { global_event_bus } from "./trpc/events.ts";
import { closed } from "@blowater/csp";
import { assertEquals } from "@std/assert";
import { sleep } from "@blowater/csp";
import { join } from "@std/path";
import { watchActiveProject } from "./project_watcher_backend.ts";

Deno.test("backend watches the opened project and closes old watchers on rapid switches", async () => {
    const root = await Deno.realPath(await Deno.makeTempDir());
    const first = join(root, "first");
    const second = join(root, "second");
    const third = join(root, "third");
    for (const path of [first, second, third]) {
        await Deno.mkdir(path);
    }
    await sleep(300);
    const changes: { type: "fs_changed" }[] = [];
    const consumer = (async () => {
        for (;;) {
            const event = await global_event_bus.pop();
            if (event === closed || event.type === "tick") {
                return;
            }
            if (event.type === "fs_changed") {
                changes.push(event);
            }
        }
    })();
    try {
        assertEquals(await watchActiveProject(first), undefined);
        await Deno.writeTextFile(join(first, "clip.txt"), "first");
        await waitForChanges(changes);
        assertEquals(changes, [{ type: "fs_changed" }]);

        await Promise.all([
            watchActiveProject(second),
            watchActiveProject(third),
        ]);
        changes.length = 0;
        for (const path of [first, second, third]) {
            await Deno.writeTextFile(join(path, "clip.txt"), "changed");
        }
        await waitForChanges(changes);
        await sleep(300);
        assertEquals(changes, [{ type: "fs_changed" }]);

        assertEquals(await watchActiveProject(null), undefined);
        changes.length = 0;
        await Deno.writeTextFile(join(third, "clip.txt"), "closed");
        await sleep(300);
        assertEquals(changes, []);
    }
    finally {
        await watchActiveProject(null);
        await global_event_bus.put({ type: "tick", n: -1 });
        await consumer;
        await Deno.remove(root, { recursive: true });
    }
});

async function waitForChanges(
    changes: { type: "fs_changed" }[],
): Promise<void> {
    const deadline = Date.now() + 5000;
    while (changes.length === 0 && Date.now() < deadline) {
        await sleep(20);
    }
}
