/**
 * SQLite-backed log of every generation, stored at
 * `<project>/.project/generations.db` and keyed by task id (= the video's
 * filename stem). Records the request we sent (with its prompt) and the polled
 * task we got back.
 *
 * Uses Deno's built-in `node:sqlite`, which is part of the runtime — so it
 * compiles into a `deno compile` binary with no external native library.
 */
// @ts-types="./node_sqlite.d.ts"
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { CreateTaskRequestSchema, TaskSchema } from "./seedance.ts";
import { projectDir } from "./project.ts";

/**
 * A TEXT column holding JSON serialized from `schema`. Parses and validates it
 * to the typed value, yielding null when the column is null, the JSON is
 * malformed, or it no longer matches the schema — tolerant so one stale row
 * can't break a whole listing.
 */
function jsonColumn<T>(schema: z.ZodType<T>) {
    return z.string().nullable().transform((s): T | null => {
        if (s === null) return null;
        try {
            return schema.parse(JSON.parse(s));
        } catch {
            return null;
        }
    });
}

export const db = getDatabase(await projectDir());

/** Open (once per project root) the generations DB, creating it if needed. */
function getDatabase(projectDir: string) {
    const path = `${projectDir}/.project/database.sqlite`;
    const db = new DatabaseSync(path);
    db.exec(`
        CREATE TABLE IF NOT EXISTS Generations (
            task_id       TEXT PRIMARY KEY,
            status        TEXT,
            request_json  TEXT,
            task_json     TEXT,
            created_at    TEXT,
            downloaded_at TEXT
        );
    `);
    return db;
}

/** A row of the `Generations` table. */
export const GenerationRowSchema = z.object({
    task_id: z.string(),
    status: z.string().nullable(),
    /** The create request, parsed from its stored JSON. */
    request_json: jsonColumn(CreateTaskRequestSchema),
    /** The last polled task, parsed from its stored JSON. */
    task_json: jsonColumn(TaskSchema),
    /** RFC 3339 timestamp. */
    created_at: z.string().nullable(),
    /** RFC 3339 timestamp. */
    downloaded_at: z.string().nullable(),
});

export type GenerationRow = z.infer<typeof GenerationRowSchema>;

/**
 * Record a freshly created generation (the full request + prompt, known only
 * client-side). Upserts so a later download won't clobber the request fields.
 */
export function recordGeneration(db: DatabaseSync, row: {
    taskId: string;
    requestJson: string;
    createdAt: string;
}): void | Error {
    try {
        db.prepare(
            `INSERT INTO Generations (task_id, request_json, created_at)
             VALUES (:task_id, :request_json, :created_at)
             ON CONFLICT(task_id) DO UPDATE SET
                 request_json = excluded.request_json,
                 created_at = COALESCE(Generations.created_at, excluded.created_at)`,
        ).run({
            // Coerce undefined → null; node:sqlite rejects undefined binds.
            task_id: row.taskId,
            request_json: row.requestJson ?? null,
            created_at: row.createdAt ?? null,
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
             (task_id, status, task_json, downloaded_at)
         VALUES (:task_id, :status, :task_json, :downloaded_at)
         ON CONFLICT(task_id) DO UPDATE SET
             status = excluded.status,
             task_json = excluded.task_json,
             downloaded_at = excluded.downloaded_at`,
    ).run({
        // Coerce undefined → null; node:sqlite rejects undefined binds.
        task_id: row.taskId,
        status: row.status ?? null,
        task_json: row.taskJson ?? null,
        downloaded_at: row.downloadedAt ?? null,
    });
}

/** Fetch one generation row by task id. */
export function getGeneration(
    db: DatabaseSync,
    taskId: string,
) {
    return db.prepare("SELECT * FROM Generations WHERE task_id = ?")
        .get(taskId);
}

/** All generations, newest created first. */
export function listGenerations(db: DatabaseSync): GenerationRow[] {
    const rows = db.prepare(
        "SELECT * FROM Generations ORDER BY created_at DESC",
    ).all();
    return z.array(GenerationRowSchema).parse(rows);
}
