const PRICING = {
  'gpt-4o': { input: 0.0025, output: 0.0100, speed: 40 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006, speed: 80 },
  'claude-sonnet': { input: 0.0030, output: 0.0150, speed: 50 },
  'claude-3-5-sonnet-20241022': { input: 0.0030, output: 0.0150, speed: 50 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125, speed: 90 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003, speed: 100 },
  'gemini-flash': { input: 0.000075, output: 0.0003, speed: 100 },
  default: { input: 0.0025, output: 0.0100, speed: 40 }
};

function countTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function getPricing(model) {
  return PRICING[model] || PRICING.default;
}

function estimateTokensAndCost(prompt, model) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string');
  }

  const inputTokens = countTokens(prompt);
  const outputTokens = Math.max(60, Math.ceil(inputTokens * 1.6));
  const totalTokens = inputTokens + outputTokens;
  const pricing = getPricing(model);

  const estimatedCost = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
  const estimatedTime = Math.max(3, Math.round(outputTokens / pricing.speed));

  return {
    inputTokens,
    outputTokens,
    tokens: totalTokens,
    cost: Number(estimatedCost.toFixed(4)),
    timeSeconds: estimatedTime
  };
}

module.exports = {
  estimateTokensAndCost,
  countTokens
};
