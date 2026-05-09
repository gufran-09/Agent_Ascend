function estimateCost(assignedModelId, prompt, availableModels) {
  const model = availableModels.find(m => m.id === assignedModelId);
  if (!model) {
    return {
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      estimatedCostUSD: 0,
      estimatedCostINR: 0,
      estimatedLatencyMs: 0
    };
  }

  // Rough estimation: 1 word ≈ 1.3 tokens
  const estimatedInputTokens = Math.ceil((prompt.length / 5) * 1.3);
  
  // Output estimation: heuristics based on prompt length, capped
  const estimatedOutputTokens = Math.min(Math.ceil(estimatedInputTokens * 1.5), 2000);

  const costUSD = (estimatedInputTokens / 1000) * model.inputCostPer1k + (estimatedOutputTokens / 1000) * model.outputCostPer1k;
  
  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUSD: Number(costUSD.toFixed(6)),
    estimatedCostINR: Number((costUSD * 83).toFixed(4)),
    estimatedLatencyMs: Math.ceil(estimatedOutputTokens * 20)
  };
}

module.exports = {
  estimateCost,
  estimateTokensAndCost: async (prompt, model) => {
    throw new Error('Not implemented yet - coming in Phase 3');
  }
};
