import { parse } from "@std/toml";
import { basename, dirname, extname, relative, resolve } from "@std/path";
import { resolveInProject } from "./project.ts";

const PLAN_TTL_MS = 60 * 60 * 1000;
const MAX_REGISTERED_PLANS = 20;

const WINDOWS_FILE_PICKER_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Choose generation plan"
$dialog.Filter = "TOML files (*.toml)|*.toml|All files (*.*)|*.*"
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($dialog.FileName))
}
`;

const IMAGE_CONTENT_TYPES: Record<string, string> = {
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
};

export interface GenerationPlanTask {
    id: string;
    target_image_path: string;
    reference_image_paths: string[];
    aspect_ratio: string;
    prompt: string;
}

export type GenerationPlanAssetStatus =
    | "ready"
    | "missing"
    | "unsupported"
    | "blocked";

export interface GenerationPlanAsset {
    path: string;
    status: GenerationPlanAssetStatus;
    url?: string;
}

export interface LoadedGenerationPlan {
    token: string;
    fileName: string;
    fileSize: number;
    tasks: GenerationPlanTask[];
    assets: Record<string, GenerationPlanAsset>;
}

interface RegisteredAsset {
    path: string;
    contentType: string;
}

interface RegisteredPlan {
    expiresAt: number;
    assets: Map<string, RegisteredAsset>;
}

const registeredPlans = new Map<string, RegisteredPlan>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(
    task: Record<string, unknown>,
    field: string,
    index: number,
): string {
    const value = task[field];
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(
            `Task ${index + 1}: "${field}" must be a non-empty string.`,
        );
    }
    return value;
}

/** Parse and validate the generation-plan contract used by image_plan files. */
export function parseGenerationPlan(source: string): GenerationPlanTask[] {
    const document = parse(source);
    if (!Array.isArray(document.tasks)) {
        throw new Error('Expected one or more "[[tasks]]" entries.');
    }

    const ids = new Set<string>();
    return document.tasks.map((value, index) => {
        if (!isRecord(value)) {
            throw new Error(`Task ${index + 1} must be a TOML table.`);
        }

        const id = requiredString(value, "id", index);
        if (ids.has(id)) {
            throw new Error(`Task ${index + 1}: duplicate id "${id}".`);
        }
        ids.add(id);

        const references = value.reference_image_paths;
        if (
            !Array.isArray(references) ||
            references.some((path) => typeof path !== "string")
        ) {
            throw new Error(
                `Task ${
                    index + 1
                }: "reference_image_paths" must be an array of strings.`,
            );
        }

        return {
            id,
            target_image_path: requiredString(
                value,
                "target_image_path",
                index,
            ),
            reference_image_paths: references as string[],
            aspect_ratio: requiredString(value, "aspect_ratio", index),
            prompt: requiredString(value, "prompt", index),
        };
    });
}

function pruneRegisteredPlans(): void {
    const now = Date.now();
    for (const [token, plan] of registeredPlans) {
        if (plan.expiresAt <= now) registeredPlans.delete(token);
    }
    while (registeredPlans.size >= MAX_REGISTERED_PLANS) {
        const oldest = registeredPlans.keys().next().value;
        if (oldest === undefined) break;
        registeredPlans.delete(oldest);
    }
}

async function pickTomlFile(): Promise<string | null> {
    const command = (() => {
        switch (Deno.build.os) {
            case "darwin":
                return new Deno.Command("osascript", {
                    args: [
                        "-e",
                        'POSIX path of (choose file with prompt "Choose generation plan")',
                    ],
                });
            case "windows":
                return new Deno.Command("powershell", {
                    args: [
                        "-NoProfile",
                        "-STA",
                        "-Command",
                        WINDOWS_FILE_PICKER_SCRIPT,
                    ],
                });
            default:
                return new Deno.Command("zenity", {
                    args: [
                        "--file-selection",
                        "--title=Choose generation plan",
                        "--file-filter=TOML files | *.toml",
                    ],
                });
        }
    })();

    const { success, stdout } = await command.output();
    if (!success) return null;
    const output = new TextDecoder().decode(stdout).trim();
    if (!output) return null;
    const path = Deno.build.os === "windows"
        ? new TextDecoder().decode(
            Uint8Array.from(atob(output), (char) => char.charCodeAt(0)),
        )
        : output;
    if (extname(path).toLowerCase() !== ".toml") {
        throw new Error("Choose a .toml generation plan file.");
    }
    return path;
}

function projectRootForPlan(planPath: string): string {
    const planDir = dirname(planPath);
    return basename(planDir).toLowerCase() === "image_plan"
        ? dirname(planDir)
        : planDir;
}

async function inspectReference(
    planPath: string,
    referencePath: string,
): Promise<
    | { status: Exclude<GenerationPlanAssetStatus, "ready"> }
    | { status: "ready"; path: string; contentType: string }
> {
    const planDir = dirname(planPath);
    const projectRoot = projectRootForPlan(planPath);
    const candidate = resolve(planDir, referencePath);
    const projectRelative = relative(projectRoot, candidate);
    const safePath = await resolveInProject(projectRoot, projectRelative);
    if (safePath instanceof Error) return { status: "blocked" };

    let stat: Deno.FileInfo;
    try {
        stat = await Deno.stat(safePath);
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) return { status: "missing" };
        throw err;
    }
    if (!stat.isFile) return { status: "missing" };

    const contentType = IMAGE_CONTENT_TYPES[extname(safePath).toLowerCase()];
    if (!contentType) return { status: "unsupported" };
    return { status: "ready", path: safePath, contentType };
}

/** Parse a plan path selected by the backend and register its local images. */
export async function loadGenerationPlan(
    planPath: string,
): Promise<LoadedGenerationPlan> {
    const [source, stat] = await Promise.all([
        Deno.readTextFile(planPath),
        Deno.stat(planPath),
    ]);
    const tasks = parseGenerationPlan(source);
    const token = crypto.randomUUID();
    const registeredAssets = new Map<string, RegisteredAsset>();
    const assets: Record<string, GenerationPlanAsset> = {};

    for (const task of tasks) {
        for (const referencePath of task.reference_image_paths) {
            if (assets[referencePath]) continue;
            const inspected = await inspectReference(planPath, referencePath);
            if (inspected.status !== "ready") {
                assets[referencePath] = {
                    path: referencePath,
                    status: inspected.status,
                };
                continue;
            }

            const assetId = String(registeredAssets.size + 1);
            registeredAssets.set(assetId, {
                path: inspected.path,
                contentType: inspected.contentType,
            });
            assets[referencePath] = {
                path: referencePath,
                status: "ready",
                url: `/generation-plan-asset/${token}/${assetId}`,
            };
        }
    }

    pruneRegisteredPlans();
    registeredPlans.set(token, {
        expiresAt: Date.now() + PLAN_TTL_MS,
        assets: registeredAssets,
    });

    return {
        token,
        fileName: basename(planPath),
        fileSize: stat.size,
        tasks,
        assets,
    };
}

/** Open a native picker, parse the selected plan, and register its images. */
export async function pickAndLoadGenerationPlan(): Promise<
    LoadedGenerationPlan | null
> {
    const planPath = await pickTomlFile();
    return planPath ? await loadGenerationPlan(planPath) : null;
}

/** Resolve an opaque plan/asset pair for the image-serving route. */
export function getGenerationPlanAsset(
    token: string,
    assetId: string,
): RegisteredAsset | null {
    pruneRegisteredPlans();
    const plan = registeredPlans.get(token);
    if (!plan) return null;
    plan.expiresAt = Date.now() + PLAN_TTL_MS;
    return plan.assets.get(assetId) ?? null;
}
