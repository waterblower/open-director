import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [fresh(), tailwindcss()],
    server: {
        // Bind to all interfaces so other devices on the LAN (e.g. a phone on
        // the same Wi‑Fi) can reach the dev server — needed for /filedrop.
        host: "0.0.0.0",
        // Don't let runtime data writes trigger an HMR/full reload. The app
        // persists explorer state to `.open-director/file-explorer.json` (and
        // task_checker downloads videos) inside whatever project folder is
        // open — if that folder sits under the repo root, Vite would otherwise
        // watch those writes, reload the island, re-run `loadProjectData`, and
        // re-save: a feedback loop that hammers saveExplorerState.
        watch: { ignored: ["**/.open-director/**"] },
    },
});
