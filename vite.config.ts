import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [fresh(), tailwindcss()],
    // Bind to all interfaces so other devices on the LAN (e.g. a phone on the
    // same Wi‑Fi) can reach the dev server — needed for /filedrop.
    server: { host: "0.0.0.0" },
});
