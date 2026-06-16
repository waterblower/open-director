/**
 * SQLite-backed log of every generation, stored at
 * `<project>/.project/generations.db` and keyed by task id (= the video's
 * filename stem). Records the request we sent (with its prompt) and the polled
 * task we got back.
 *
 * Uses Deno's built-in `node:sqlite`, which is part of the runtime — so it
 * compiles into a `deno compile` binary with no external native library.
 */
import { DatabaseSync } from "node:sqlite";
import { join } from "@std/path";
import { ulid } from "@std/ulid";
import { z } from "zod";
import {
    CreateTaskRequest,
    CreateTaskRequestSchema,
    Task,
    TaskSchema,
    TaskStatus,
} from "./seedance.ts";
import { getStoredProjectPath } from "./kv.ts";

/**
 * A TEXT column holding JSON serialized from `schema`. Parses and validates it
 * to the typed value, yielding null when the column is null, the JSON is
 * malformed, or it no longer matches the schema — tolerant so one stale row
 * can't break a whole listing.
 */
function jsonColumn<T>(schema: z.ZodType<T>) {
    return z.string().transform((s): T => {
        return schema.parse(JSON.parse(s));
    });
}

// `let` (not `const`) so switching projects can swap in that project's DB; the
// export is a live binding, so importers see the new handle after `reopenDb()`.
export let db = await getDatabase();

/**
 * Reopen `db` against the current `projectDir()` — call after switching
 * projects so reads/writes hit the new project's `.project/database.sqlite`.
 */
export async function reopenDb() {
    if (!db) {
        db = await getDatabase();
        return;
    }
    try {
        db.close();
    } catch (e) {
        throw e as Error;
    }
    db = await getDatabase();
}

/** Open (once per project root) the generations DB, creating it if needed. */
async function getDatabase() {
    const projectDir = await getStoredProjectPath();
    if (!projectDir) {
        return null;
    }
    const dir = join(projectDir, ".project");
    Deno.mkdirSync(dir, { recursive: true });
    const path = join(dir, "database.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`
        CREATE TABLE IF NOT EXISTS Generations (
            id            TEXT PRIMARY KEY,
            task_id       TEXT UNIQUE,
            status        TEXT,
            request_json  TEXT,
            task_json     TEXT,
            created_at    TEXT,
            downloaded_at TEXT,
            failed_reason TEXT
        );
    `);
    return db;
}

/** A row of the `Generations` table. */
export const GenerationRowSchema = z.object({
    id: z.ulid(),
    created_at: z.iso.datetime(),
    status: z.enum(["running", "succeeded", "failed", "queued"]),
    request_json: jsonColumn(CreateTaskRequestSchema),
    task_id: z.string().nullable().optional(),
    task_json: jsonColumn(TaskSchema).nullable().optional(),
    downloaded_at: z.iso.datetime().nullable().optional(),
    failed_reason: z.string().nullable().optional(),
});

export type Generation = z.infer<typeof GenerationRowSchema>;

/**
 * Create a brand-new generation in the "queued" state, before it's been
 * submitted to Seedance — so it has no `task_id` yet. Returns the generated
 * ULID `id` (the row's primary key) for the caller to reference later.
 */
export function createGeneration(
    db: DatabaseSync,
    request: CreateTaskRequest,
) {
    try {
        const id = ulid();

        db.prepare(
            `INSERT INTO Generations (id, status, request_json, created_at)
             VALUES (:id, :status, :request_json, :created_at)`,
        ).run({
            id,
            status: "queued",
            request_json: JSON.stringify(request),
            created_at: new Date().toISOString(),
        });
        return {
            id,
            status: "queued",
            request_json: request,
            created_at: new Date().toISOString(),
        };
    } catch (err) {
        return err as Error;
    }
}

export const UpdateGenerationSchema = z.object({
    id: z.ulid(),
    status: z.enum(["running", "succeeded", "failed", "queued"]).optional(),
    request_json: jsonColumn(CreateTaskRequestSchema).optional(),
    task_id: z.string().optional(),
    task_json: jsonColumn(TaskSchema).optional(),
    downloaded_at: z.iso.datetime().optional(),
    failed_reason: z.string().optional(),
});
export type UpdateGeneration = z.infer<typeof UpdateGenerationSchema>;

/**
 * Patch an existing generation by its ULID `id`. Only the fields present on
 * `gen` are written — an absent (`undefined`) field is left unchanged, while an
 * explicit `null` clears the column. `request_json` / `task_json` are
 * re-serialized from their parsed form back to JSON text.
 */
export function updateGeneration(
    db: DatabaseSync,
    gen: UpdateGeneration,
): void | Error {
    const sets: string[] = [];
    const binds: Record<string, string | null> = { id: gen.id };
    const set = (col: string, value: string | null) => {
        sets.push(`${col} = :${col}`);
        binds[col] = value;
    };

    if (gen.status !== undefined) set("status", gen.status);
    if (gen.task_id !== undefined) set("task_id", gen.task_id);
    if (gen.request_json !== undefined) {
        set(
            "request_json",
            gen.request_json === null ? null : JSON.stringify(gen.request_json),
        );
    }
    if (gen.task_json !== undefined) {
        set(
            "task_json",
            gen.task_json === null ? null : JSON.stringify(gen.task_json),
        );
    }
    if (gen.downloaded_at !== undefined) {
        set("downloaded_at", gen.downloaded_at);
    }
    if (gen.failed_reason !== undefined) {
        set("failed_reason", gen.failed_reason);
    }

    if (sets.length === 0) return; // nothing to change

    try {
        const result = db.prepare(
            `UPDATE Generations SET ${sets.join(", ")} WHERE id = :id`,
        ).run(binds);
        if (result.changes === 0) {
            return new Error(`No generation with id ${gen.id}`);
        }
    } catch (err) {
        return err as Error;
    }
}

/**
 * Record a freshly created generation (the full request + prompt, known only
 * client-side). Upserts so a later download won't clobber the request fields.
 */
export function recordGeneration(db: DatabaseSync, row: {
    taskId: string;
    createdAt: string;
    requestJson: string;
    status?: TaskStatus;
    task: Task;
}): void | Error {
    try {
        db.prepare(
            `INSERT INTO Generations
                 (id, task_id, status, request_json, task_json, created_at)
             VALUES (:id, :task_id, :status, :request_json, :task_json, :created_at)
             ON CONFLICT(task_id) DO UPDATE SET
                 status = excluded.status,
                 request_json = excluded.request_json,
                 task_json = excluded.task_json,
                 created_at = COALESCE(Generations.created_at, excluded.created_at)`,
        ).run({
            // Coerce undefined → null; node:sqlite rejects undefined binds.
            id: ulid(),
            task_id: row.taskId,
            status: row.status ?? null,
            request_json: row.requestJson,
            task_json: JSON.stringify(row.task),
            created_at: row.createdAt,
        });
    } catch (err) {
        return err as Error;
    }
}

/**
 * Mark a generation downloaded, storing the full polled task. Upserts so tasks
 * created in a previous session (no `recordGeneration` row) still get logged.
 */
export function markDownloaded(
    db: DatabaseSync,
    row: {
        taskId: string;
        status?: string;
        taskJson: string;
        downloadedAt: string;
    },
) {
    db.prepare(
        `INSERT INTO Generations
             (id, task_id, status, task_json, downloaded_at)
         VALUES (:id, :task_id, :status, :task_json, :downloaded_at)
         ON CONFLICT(task_id) DO UPDATE SET
             status = excluded.status,
             task_json = excluded.task_json,
             downloaded_at = excluded.downloaded_at`,
    ).run({
        // Coerce undefined → null; node:sqlite rejects undefined binds.
        id: ulid(),
        task_id: row.taskId,
        status: row.status ?? null,
        task_json: row.taskJson ?? null,
        downloaded_at: row.downloadedAt ?? null,
    });
}

/**
 * Task ids of generations still worth polling: logged, not yet downloaded, and
 * not already known to have failed.
 */
export function listPendingGenerations(db: DatabaseSync) {
    const rows = db.prepare(
        `SELECT id, task_id FROM Generations
         WHERE task_id IS NOT NULL
           AND downloaded_at IS NULL
           AND (status IS NULL OR status != 'failed')`,
    ).all();
    return z.array(z.object({ id: z.string(), task_id: z.string() }))
        .parse(rows);
}

/**
 * Record a generation's polled status (and task snapshot) without marking it
 * downloaded — e.g. to persist a terminal "failed" so it stops being polled.
 */
export function recordTaskStatus(db: DatabaseSync, row: {
    taskId: string;
    status: string;
    taskJson: string;
    failedReason?: string;
}) {
    db.prepare(
        `INSERT INTO Generations
             (id, task_id, status, task_json, failed_reason)
         VALUES (:id, :task_id, :status, :task_json, :failed_reason)
         ON CONFLICT(task_id) DO UPDATE SET
             status = excluded.status,
             task_json = excluded.task_json,
             failed_reason = excluded.failed_reason`,
    ).run({
        id: ulid(),
        task_id: row.taskId,
        status: row.status,
        task_json: row.taskJson ?? null,
        failed_reason: row.failedReason ?? null,
    });
}

function parseRow(row: unknown): Generation | Error {
    if (row === undefined) return new Error("row not found");
    const result = GenerationRowSchema.safeParse(row);
    if (!result.success) {
        return result.error;
    }
    return result.data;
}

/** Fetch one generation row by its ULID primary key. */
export function getGenerationById(
    db: DatabaseSync,
    id: string,
): Generation | Error {
    return parseRow(
        db.prepare("SELECT * FROM Generations WHERE id = ?").get(id),
    );
}

/** Fetch one generation row by its Seedance task id. */
export function getGenerationByTaskId(
    db: DatabaseSync,
    taskId: string,
): Generation | Error {
    return parseRow(
        db.prepare("SELECT * FROM Generations WHERE task_id = ?").get(taskId),
    );
}

/**
 * The create request for a generation, looked up by either its ULID `id` or its
 * Seedance `task_id` (a grid card may key on either). Returns null when there's
 * no stored request or it can't be parsed. Loaded on demand so the list payload
 * doesn't have to carry every request's (potentially large) base64 attachments.
 */
export function getGenerationRequest(
    db: DatabaseSync,
    idOrTaskId: string,
): CreateTaskRequest | null | Error {
    const row = db.prepare(
        "SELECT request_json FROM Generations WHERE id = ? OR task_id = ? LIMIT 1",
    ).get(idOrTaskId, idOrTaskId) as
        | { request_json: string | null }
        | undefined;
    if (!row?.request_json) return null;
    const parsed = CreateTaskRequestSchema.safeParse(
        JSON.parse(row.request_json),
    );
    if (parsed.error) {
        return parsed.error;
    }
    return parsed.data;
}

/** All generations, newest created first. */
export function listGenerations(db: DatabaseSync): Generation[] {
    const rows = db.prepare(
        "SELECT * FROM Generations ORDER BY created_at DESC",
    ).all();
    return z.array(GenerationRowSchema).parse(rows);
}
