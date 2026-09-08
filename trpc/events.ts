import { chan } from "@blowater/csp";
import type { Generation } from "../db.ts";
import type { GenerateInput } from "../apigen/mod.ts";

export const global_event_bus = chan<
    | {
        type: "tick";
        n: number;
    }
    | {
        type: "generation_finished";
        gen: Generation;
    }
    | {
        type: "generation_created";
        gen: {
            id: string;
            status: string;
            request_json: GenerateInput;
            created_at: string;
        };
    }
    | { type: "fs_changed" }
>();
