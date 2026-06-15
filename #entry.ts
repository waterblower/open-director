import server from "./_fresh/server.js";

// @ts-ignore:
Deno.serve(server.fetch);
