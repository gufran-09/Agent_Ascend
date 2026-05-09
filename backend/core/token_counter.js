function estimateTokens(text = '') {
  if (!text || typeof text !== 'string') return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateOutputTokens(inputTokens, difficulty = 'medium') {
  const multiplier = {
    easy: 0.8,
    medium: 1.2,
    hard: 1.8,
    agentic: 2.4,
  }[String(difficulty).toLowerCase()] || 1.2;

  return Math.max(128, Math.ceil(inputTokens * multiplier));
}

function estimateCost(inputTokens, outputTokens, model = {}) {
  const inputRate = Number(model.cost_per_1k_input || 0);
  const outputRate = Number(model.cost_per_1k_output || 0);
  return Number((((inputTokens / 1000) * inputRate) + ((outputTokens / 1000) * outputRate)).toFixed(6));
}

function estimateTokensAndCost(prompt, model, difficulty = 'medium') {
  const inputTokens = estimateTokens(prompt);
  const outputTokens = estimateOutputTokens(inputTokens, difficulty);
  const totalTokens = inputTokens + outputTokens;
  const cost = estimateCost(inputTokens, outputTokens, model);
  const timeSeconds = Math.max(1, Math.ceil(Number(model.avg_latency_ms || 1000) / 1000 + outputTokens / 80));

  return {
    inputTokens,
    outputTokens,
    tokens: totalTokens,
    cost,
    timeSeconds,
  };
}

function sumEstimates(estimates) {
  return estimates.reduce((total, estimate) => ({
    tokens: total.tokens + Number(estimate.tokens || 0),
    cost: Number((total.cost + Number(estimate.cost || 0)).toFixed(6)),
    timeSeconds: total.timeSeconds + Number(estimate.timeSeconds || 0),
  }), { tokens: 0, cost: 0, timeSeconds: 0 });
}

module.exports = {
  estimateTokens,
  estimateOutputTokens,
  estimateCost,
  estimateTokensAndCost,
  sumEstimates,
};
