const supabase = require('./supabase');

async function logExecution({ sessionId, plan, result }) {
  if (!sessionId || !plan || !result) return null;

  const fallbackEvents = (result.subtaskResults || [])
    .filter(item => item.usedFallback)
    .map(item => ({ id: item.id, title: item.title, model: item.model }));

  const confidenceScores = (result.subtaskResults || [])
    .map(item => ({ id: item.id, score: item.confidenceScore, note: item.confidenceNote }));

  const { data, error } = await supabase
    .from('executions')
    .insert({
      session_id: sessionId,
      plan_id: result.planId || plan.planId,
      prompt: plan.prompt,
      category: plan.category,
      difficulty: plan.difficulty,
      status: result.status,
      models_used: result.analytics?.modelsUsed || [],
      total_tokens: result.analytics?.totalTokens || 0,
      total_cost: result.analytics?.totalCost || 0,
      total_time_ms: result.analytics?.totalTimeMs || 0,
      fallback_events: fallbackEvents,
      confidence_scores: confidenceScores,
    })
    .select()
    .single();

  if (error) {
    // Analytics must not break user execution. Log only sanitized error.
    console.error('Analytics log failed:', error.message);
    return null;
  }

  return data;
}

async function upsertModelUsageStats() {
  // Future enhancement. Execution-level logging is implemented for MVP.
  return null;
}

async function checkDailySpendCap() {
  // Future enhancement. Spend caps are stretch scope.
  return { allowed: true };
}

module.exports = {
  logExecution,
  upsertModelUsageStats,
  checkDailySpendCap,
};
