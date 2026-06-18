/**
 * Rough cost estimates for Seedance video generations.
 *
 * Volcano Ark bills Seedance 2.0 by tokens, at a per-model rate:
 *   - Seedance 2.0 (standard): ¥28 / million tokens
 *   - Seedance 2.0 Fast:       ¥22 / million tokens
 *   - Seedance 2.0 Mini:       ¥14 / million tokens
 * Source: Volcano Ark pricing — https://www.volcengine.com/docs/82379/1544106
 *
 * These are approximate: actual billing can vary by resolution / service tier.
 */
import type { SeedanceModel } from "./seedance.ts";

const RMB_PER_MILLION: Record<SeedanceModel, number> = {
    "doubao-seedance-2-0-260128": 28,
    "doubao-seedance-2-0-fast-260128": 22,
    "doubao-seedance-2-0-mini-260615": 14,
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
 * model it ran on.
 */
export function estimateCost(
    totalTokens: number,
    model: SeedanceModel,
): CostEstimate {
    const rate = RMB_PER_MILLION[model] ??
        RMB_PER_MILLION["doubao-seedance-2-0-260128"];
    const rmb = (totalTokens / 1_000_000) * rate;
    return { rmb, usd: rmb * USD_PER_RMB };
}
