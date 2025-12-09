const DEFAULT_MODEL = 'gpt-4-turbo';
const PRICING_LAST_UPDATED = '2025-12-01'; // adjust when pricing changes

const MODEL_PRICES = {
  'gpt-4': { inputPer1k: 0.03, outputPer1k: 0.06 },
  'gpt-4-turbo': { inputPer1k: 0.01, outputPer1k: 0.03 },
  'gpt-3.5-turbo': { inputPer1k: 0.0005, outputPer1k: 0.0015 },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
};

function getPricing(model) {
  return MODEL_PRICES[model] ?? MODEL_PRICES[DEFAULT_MODEL];
}

function toUSD(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Simple cost estimator for LLM usage.
 * Rates are approximate; adjust as pricing changes.
 */
export class CostEstimator {
  constructor(model = DEFAULT_MODEL) {
    this.model = model;
    this.pricing = getPricing(model);
    this.lastUpdated = PRICING_LAST_UPDATED;
  }

  /**
   * Estimate cost from token counts.
   * @param {number} inputTokens
   * @param {number} outputTokens
   * @returns {{usd: number, inputTokens: number, outputTokens: number, model: string}}
   */
  estimateCost(inputTokens = 0, outputTokens = 0) {
    const inCost = (inputTokens / 1000) * this.pricing.inputPer1k;
    const outCost = (outputTokens / 1000) * this.pricing.outputPer1k;
    return {
      usd: toUSD(inCost + outCost),
      inputTokens,
      outputTokens,
      model: this.model,
    };
  }

  /**
   * Rough estimate from diff+skills.
   * Uses diff token estimate plus skill overhead (instructions/prompts).
   * @param {{tokenEstimate?: number, rawTokenEstimate?: number}} diff
   * @param {Array} skills
   */
  estimateFromDiff(diff = {}, skills = []) {
    const baseTokens = diff.tokenEstimate ?? diff.rawTokenEstimate ?? 0;
    const skillTokens = skills.length * 200; // overhead per skill
    const inputTokens = baseTokens + skillTokens;
    const outputTokens = Math.max(300, skills.length * 50); // small response allowance
    return this.estimateCost(inputTokens, outputTokens);
  }

  /**
   * Format cost information for human-friendly display.
   * @param {{usd: number, inputTokens: number, outputTokens: number, model: string}} cost
   */
  formatCost(cost) {
    const usd = cost?.usd ?? 0;
    return `Model: ${cost?.model || this.model}
Estimated cost: $${usd.toFixed(4)} USD
Tokens: ${cost.inputTokens} (input) + ${cost.outputTokens} (output)
Pricing last updated: ${this.lastUpdated}`;
  }
}

export default CostEstimator;
