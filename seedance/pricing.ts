/**
 * Rough cost estimates for Seedance video generations.
 *
 * Volcano Ark bills Seedance 2.0 by tokens, but the per-token price depends on
 * three things: the model, the output resolution, and whether the request
 * includes a video input. Volcano publishes the "with video input, 480p/720p"
 * scenario as the 1:1 baseline and expresses the others as a deduction ratio;
 * applying the ratio to the baseline yields each scenario's actual unit price,
 * which is what these rates encode (¥ / million tokens):
 *
 *   Seedance 2.0       — 480p/720p: 28 (w/ video) / 46 (no video)
 *                        1080p:     31 (w/ video) / 51 (no video)
 *   Seedance 2.0 Fast  — 480p/720p: 22 (w/ video) / 37 (no video)  [no 1080p]
 *   Seedance 2.0 Mini  — 480p/720p: 14 (w/ video) / 23 (no video)
 *
 * Source: Volcano Ark pricing — https://www.volcengine.com/docs/82379/1544106
 *
 * These are still approximate: actual billing can also vary by service tier.
 */
import type { CreateTaskRequest, SeedanceModel } from "./seedance.ts";

/** ¥ / million tokens, keyed by whether the request includes a video input. */
interface ScenarioRates {
    /** With a video input (the 1:1 baseline scenario). */
    withVideo: number;
    /** Without a video input (text / image / audio only). */
    noVideo: number;
}

interface ModelRates {
    /** Rates for 480p / 720p output. */
    sd: ScenarioRates;
    /** Rates for 1080p output, if the model supports it. */
    hd?: ScenarioRates;
}

const RMB_PER_MILLION: Record<SeedanceModel, ModelRates> = {
    "doubao-seedance-2-0-260128": {
        sd: { withVideo: 28, noVideo: 46 },
        hd: { withVideo: 31, noVideo: 51 },
    },
    "doubao-seedance-2-0-fast-260128": {
        sd: { withVideo: 22, noVideo: 37 },
    },
    "doubao-seedance-2-0-mini-260615": {
        sd: { withVideo: 14, noVideo: 23 },
    },
};

/** Rough CNY→USD rate, only for showing an approximate dollar figure. */
const USD_PER_RMB = 1 / 7;

export interface CostEstimate {
    /** Estimated cost in Chinese yuan. */
    rmb: number;
    /** Estimated cost in US dollars (converted at a fixed rough rate). */
    usd: number;
}

/**
 * Estimate the rough cost of a generation from its total token usage and the
 * request it ran with. The request's model, resolution, and whether it carried
 * a video input all affect the per-token rate.
 */
export function estimateCost(
    totalTokens: number,
    request: Pick<CreateTaskRequest, "model" | "resolution" | "content">,
): CostEstimate {
    const rates = RMB_PER_MILLION[request.model] ??
        RMB_PER_MILLION["doubao-seedance-2-0-260128"];
    // Fall back to the SD rates if 1080p isn't a listed scenario for the model.
    const tier = request.resolution === "1080p" && rates.hd ? rates.hd : rates.sd;
    const hasVideoInput = request.content.some((c) => c.type === "video_url");
    const rate = hasVideoInput ? tier.withVideo : tier.noVideo;
    const rmb = (totalTokens / 1_000_000) * rate;
    return { rmb, usd: rmb * USD_PER_RMB };
}
