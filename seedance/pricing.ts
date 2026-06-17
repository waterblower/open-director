/**
 * Rough cost estimates for Seedance video generations.
 *
 * Volcano Ark bills Seedance 2.0 by tokens, at a rate that depends on whether
 * the prompt included a reference video:
 *   - with video input (video editing):       ¥28 / million tokens
 *   - without video input (pure generation):   ¥46 / million tokens
 * (≈ ¥1 per second of generated video). Source: Volcano Ark pricing, Mar 2026
 * — https://www.volcengine.com/docs/82379/1544106
 *
 * These are approximate: actual billing can vary by resolution / service tier,
 * and the mini model's published rate isn't separated out, so it reuses the
 * Seedance 2.0 rates here.
 */
const RMB_PER_MILLION_WITH_VIDEO = 28;
const RMB_PER_MILLION_NO_VIDEO = 46;

/** Rough CNY→USD rate, only for showing an approximate dollar figure. */
const USD_PER_RMB = 1 / 7.2;

export interface CostEstimate {
    /** Estimated cost in Chinese yuan. */
    rmb: number;
    /** Estimated cost in US dollars (converted at a fixed rough rate). */
    usd: number;
}

/**
 * Estimate the rough cost of a generation from its total token usage and
 * whether the request used a reference video.
 */
export function estimateCost(
    totalTokens: number,
    hasVideoInput: boolean,
): CostEstimate {
    const rate = hasVideoInput
        ? RMB_PER_MILLION_WITH_VIDEO
        : RMB_PER_MILLION_NO_VIDEO;
    const rmb = (totalTokens / 1_000_000) * rate;
    return { rmb, usd: rmb * USD_PER_RMB };
}
