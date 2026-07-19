import { join, resolve } from "@std/path";
import {
    getLastOpenedProject,
    listProjects,
    ProjectRecordSchema,
    registerProject,
} from "./project_registry.ts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function withRegistry(
    run: (kv: Deno.Kv) => Promise<void>,
): Promise<void> {
    const temp = await Deno.makeTempDir({ prefix: "open-director-registry-" });
    const kv = await Deno.openKv(join(temp, "registry.sqlite3"));
    try {
        await run(kv);
    } finally {
        kv.close();
        await Deno.remove(temp, { recursive: true });
    }
}

Deno.test("project registry stores and lists every opened project", async () => {
    await withRegistry(async (kv) => {
        const temp = await Deno.makeTempDir({
            prefix: "open-director-projects-",
        });
        try {
            const firstRoot = resolve(temp, "first");
            const secondRoot = resolve(temp, "second");
            await Deno.mkdir(firstRoot);
            await Deno.mkdir(secondRoot);

            const first = await registerProject(
                kv,
                firstRoot,
                "2026-01-01T00:00:00.000Z",
            );
            const second = await registerProject(
                kv,
                secondRoot,
                "2026-01-02T00:00:00.000Z",
            );
            const projects = await listProjects(kv);

            assert(projects.length === 2, "Expected two registered projects");
            assert(
                projects[0].path === second.path,
                "Newest project was not first",
            );
            assert(
                projects[1].path === first.path,
                "First project was lost",
            );
        } finally {
            await Deno.remove(temp, { recursive: true });
        }
    });
});

Deno.test("latest project is selected by last-opened time", async () => {
    await withRegistry(async (kv) => {
        const firstPath = resolve("first-latest-project");
        const secondPath = resolve("second-latest-project");

        await registerProject(kv, firstPath, "2026-01-03T00:00:00.000Z");
        await registerProject(kv, secondPath, "2026-01-02T00:00:00.000Z");
        assert(
            (await getLastOpenedProject(kv))?.path === firstPath,
            "Project with the latest lastOpenedAt was not selected",
        );

        await registerProject(kv, secondPath, "2026-01-04T00:00:00.000Z");
        assert(
            (await getLastOpenedProject(kv))?.path === secondPath,
            "Reopened project did not become the latest project",
        );
    });
});

Deno.test("project registry deduplicates canonical paths", async () => {
    await withRegistry(async (kv) => {
        const root = await Deno.makeTempDir({
            prefix: "open-director-project-",
        });
        try {
            const first = await registerProject(
                kv,
                root,
                "2026-01-01T00:00:00.000Z",
            );
            const reopened = await registerProject(
                kv,
                join(root, "."),
                "2026-01-03T00:00:00.000Z",
            );
            const projects = await listProjects(kv);

            assert(projects.length === 1, "Canonical duplicate was registered");
            assert(
                reopened.path === first.path,
                "Reopened project changed path",
            );
            assert(
                reopened.firstOpenedAt === first.firstOpenedAt,
                "First-opened time changed",
            );
            assert(
                reopened.lastOpenedAt === "2026-01-03T00:00:00.000Z",
                "Last-opened time was not updated",
            );
        } finally {
            await Deno.remove(root, { recursive: true });
        }
    });
});

Deno.test("concurrent opens create one project record", async () => {
    await withRegistry(async (kv) => {
        const root = await Deno.makeTempDir({
            prefix: "open-director-project-",
        });
        try {
            const [first, second] = await Promise.all([
                registerProject(kv, root, "2026-01-01T00:00:00.000Z"),
                registerProject(kv, root, "2026-01-01T00:00:00.000Z"),
            ]);
            const projects = await listProjects(kv);

            assert(
                projects.length === 1,
                "Concurrent opens created duplicates",
            );
            assert(
                first.path === second.path,
                "Concurrent opens got different paths",
            );
        } finally {
            await Deno.remove(root, { recursive: true });
        }
    });
});

Deno.test("project records persist after reopening KV", async () => {
    const temp = await Deno.makeTempDir({ prefix: "open-director-registry-" });
    const root = await Deno.makeTempDir({ prefix: "open-director-project-" });
    const path = join(temp, "registry.sqlite3");
    try {
        const firstKv = await Deno.openKv(path);
        const registered = await registerProject(firstKv, root);
        firstKv.close();

        const secondKv = await Deno.openKv(path);
        try {
            const projects = await listProjects(secondKv);
            assert(projects.length === 1, "Persisted project was not loaded");
            assert(
                projects[0].path === registered.path,
                "Project path changed",
            );
        } finally {
            secondKv.close();
        }
    } finally {
        await Deno.remove(temp, { recursive: true });
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("project record schema accepts only the current shape", () => {
    const path = resolve("schema-project");
    assert(
        ProjectRecordSchema.safeParse({
            path,
            firstOpenedAt: "2026-01-01T00:00:00.000Z",
            lastOpenedAt: "2026-01-02T00:00:00.000Z",
        }).success,
        "Valid project record was rejected",
    );
    assert(
        !ProjectRecordSchema.safeParse({
            path,
            firstOpenedAt: "2026-01-01T00:00:00.000Z",
            lastOpenedAt: "2026-01-02T00:00:00.000Z",
            obsoleteMetadata: 3,
        }).success,
        "Project record with unknown fields was accepted",
    );
});

Deno.test("listing deletes invalid project records", async () => {
    await withRegistry(async (kv) => {
        const path = resolve("invalid-project-record");
        await kv.set(["projects", path], {
            path,
            firstOpenedAt: "2026-01-01T00:00:00.000Z",
            lastOpenedAt: "2026-01-02T00:00:00.000Z",
            obsoleteMetadata: 3,
        });

        const projects = await listProjects(kv);
        const stored = await kv.get(["projects", path]);

        assert(projects.length === 0, "Invalid project was returned");
        assert(stored.value === null, "Invalid project was not deleted");
    });
});

Deno.test("registration replaces invalid data at the project key", async () => {
    await withRegistry(async (kv) => {
        const root = await Deno.makeTempDir({
            prefix: "open-director-project-",
        });
        try {
            const canonicalPath = await Deno.realPath(root);
            const pathIdentity = Deno.build.os === "windows"
                ? canonicalPath.toLocaleLowerCase()
                : canonicalPath;
            await kv.set(["projects", pathIdentity], { invalid: true });

            const registered = await registerProject(
                kv,
                root,
                "2026-01-02T00:00:00.000Z",
            );

            assert(registered.path === canonicalPath, "Project was not stored");
            assert(
                ProjectRecordSchema.safeParse(
                    (await kv.get(["projects", pathIdentity])).value,
                ).success,
                "Invalid data was not replaced",
            );
        } finally {
            await Deno.remove(root, { recursive: true });
        }
    });
});
