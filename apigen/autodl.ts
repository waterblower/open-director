import { z } from "zod";

export const AUTODL_Models = ["minimax_h3_lightx2v_v5"] as const;

export const AutoDL_GenerateInput_Schema = z.object({
    model: z.enum(AUTODL_Models)
    // input: ,
});

export type AutoDL_GenerateInput = z.infer<typeof AutoDL_GenerateInput_Schema>;
