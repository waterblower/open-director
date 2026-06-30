import { Head } from "fresh/runtime";
import { join } from "@std/path";
import { qrcode } from "@libs/qrcode";
import { define } from "../utils.ts";
import FileDrop from "../islands/FileDrop.tsx";

/** Absolute path to the current user's Downloads folder. */
function downloadsDir(): string {
    const home = Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
    return join(home, "Downloads");
}

/**
 * Best-effort LAN IPv4 address so a phone on the same network can reach this
 * server. Prefers private ranges (192.168.x / 10.x / 172.16–31.x) and falls
 * back to the first non-internal IPv4 interface.
 */
function lanAddress(): string | null {
    const isPrivate = (ip: string) =>
        ip.startsWith("192.168.") ||
        ip.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

    let fallback: string | null = null;
    for (const iface of Deno.networkInterfaces()) {
        if (iface.family !== "IPv4") continue;
        if (iface.address.startsWith("127.")) continue;
        if (isPrivate(iface.address)) return iface.address;
        fallback ??= iface.address;
    }
    return fallback;
}

/** The URL a phone should open, built from the LAN IP and the request's port. */
function phoneUrl(req: Request): string | null {
    const ip = lanAddress();
    if (!ip) return null;
    const url = new URL(req.url);
    const port = url.port ? `:${url.port}` : "";
    return `http://${ip}${port}/filedrop`;
}

/** Strip path separators / control chars so an upload can't escape Downloads. */
function safeName(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? "";
    // deno-lint-ignore no-control-regex
    const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, "_").trim();
    return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "upload";
}

/** Pick a non-existing path in `dir`, adding " (1)", " (2)", … on collision. */
async function uniquePath(dir: string, name: string): Promise<string> {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 0; i < 1000; i++) {
        const candidate = join(dir, i === 0 ? name : `${stem} (${i})${ext}`);
        try {
            await Deno.lstat(candidate);
        } catch (err) {
            if (err instanceof Deno.errors.NotFound) return candidate;
            throw err;
        }
    }
    return join(dir, `${stem}-${crypto.randomUUID()}${ext}`);
}

export const handler = define.handlers({
    // Receive uploaded files and stream them into the Downloads folder.
    async POST(ctx) {
        const dir = downloadsDir();
        await Deno.mkdir(dir, { recursive: true });

        const form = await ctx.req.formData();
        const saved: string[] = [];
        for (const value of form.getAll("files")) {
            if (!(value instanceof File)) continue;
            const dest = await uniquePath(dir, safeName(value.name));
            const file = await Deno.open(dest, {
                write: true,
                createNew: true,
            });
            await value.stream().pipeTo(file.writable);
            saved.push(dest.split(/[\\/]/).pop()!);
        }

        if (saved.length === 0) {
            return Response.json({ ok: false, error: "No files received" }, {
                status: 400,
            });
        }
        return Response.json({ ok: true, saved });
    },
});

export default define.page(function FileDropPage(ctx) {
    const url = phoneUrl(ctx.req);
    const svg = url
        ? qrcode(url, { output: "svg", border: 1 }).replace(/<\?xml.*?\?>/, "")
        : null;
    const dest = downloadsDir();

    return (
        <>
            <Head>
                <title>File Drop — Open Director</title>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
            </Head>

            <main class="min-h-screen bg-slate-900 text-slate-200">
                <div class="mx-auto max-w-xl px-4 py-6 pb-16">
                    <h1 class="mt-2 mb-1 text-2xl font-bold">File Drop</h1>
                    <p class="mb-6 text-slate-400">
                        Send files from your phone to this computer's Downloads
                        folder.
                    </p>

                    <section class="mb-5 rounded-2xl border border-slate-700 bg-slate-800 p-5">
                        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-300">
                            1 · Scan with your phone
                        </h2>
                        {svg
                            ? (
                                <>
                                    <div
                                        class="mx-auto w-56 max-w-full rounded-xl bg-white p-3 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
                                        // deno-lint-ignore react-no-danger
                                        dangerouslySetInnerHTML={{
                                            __html: svg,
                                        }}
                                    />
                                    <a
                                        class="mt-3 block break-all text-center text-sky-400"
                                        href={url!}
                                    >
                                        {url}
                                    </a>
                                </>
                            )
                            : (
                                <p class="text-amber-400">
                                    Couldn't determine this machine's local
                                    network address. Make sure you're connected
                                    to Wi‑Fi or a LAN.
                                </p>
                            )}
                    </section>

                    <section class="mb-5 rounded-2xl border border-slate-700 bg-slate-800 p-5">
                        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-300">
                            2 · Choose files to upload
                        </h2>
                        <FileDrop />
                        <p class="mt-4 break-all text-xs text-slate-500">
                            Saving to:{" "}
                            <code class="text-slate-400">{dest}</code>
                        </p>
                    </section>
                </div>
            </main>
        </>
    );
});
