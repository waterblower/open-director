import type {
    CreateTaskRequest as SeedanceCreateTaskRequest,
} from "@/apigen/seedance/seedance.ts";
import { seedance_client } from "@/apigen/seedance/seedance_client.ts";
import {
    type CreateTaskRequest as ZzdhCreateTaskRequest,
    ZzdhClient,
} from "@/apigen/zzdh/zzdh_client.ts";
import { getStoredApiKey } from "@/kv.ts";

export type GenerateInput =
    | SeedanceCreateTaskRequest
    | ZzdhCreateTaskRequest;

export async function generate(input: GenerateInput) {
    if (isZzdhInput(input)) {
        const zzdhClient = new ZzdhClient({
            apiKey: (await getStoredApiKey("zzdh")) ?? "",
        });
        return await zzdhClient.createTask(input);
    }

    return await seedance_client.generate(input);
}

function isZzdhInput(input: GenerateInput): input is ZzdhCreateTaskRequest {
    return input.model.startsWith("zzdh-");
}
