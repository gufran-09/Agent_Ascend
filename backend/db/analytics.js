// Placeholder for Phase 5 - Analytics + Fallback
// This will be implemented in Phase 5 (coordinate with M3)

module.exports = {
  upsertModelUsageStats: async (userId, modelId, callCount, tokensIn, tokensOut, costUsd) => {
    throw new Error('Not implemented yet - coming in Phase 5');
  },
  checkDailySpendCap: async (userId, cap) => {
    throw new Error('Not implemented yet - coming in Phase 5');
  }
};
