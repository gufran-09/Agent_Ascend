const supabase = require('./supabase');

async function upsertModelUsageStats(sessionId, modelId, callCount, tokensIn, tokensOut, costUsd) {
  const periodDate = new Date().toISOString().slice(0, 10);

  const { data: existing, error: fetchError } = await supabase
    .from('model_usage_stats')
    .select('*')
    .eq('session_id', sessionId)
    .eq('model_id', modelId)
    .eq('period_date', periodDate)
    .limit(1);

  if (fetchError) {
    throw new Error(`Failed to fetch model usage stats: ${fetchError.message}`);
  }

  const row = existing && existing[0];
  if (row) {
    const { error: updateError } = await supabase
      .from('model_usage_stats')
      .update({
        call_count: (row.call_count || 0) + callCount,
        total_tokens_in: (row.total_tokens_in || 0) + tokensIn,
        total_tokens_out: (row.total_tokens_out || 0) + tokensOut,
        total_cost_usd: Number(((row.total_cost_usd || 0) + costUsd).toFixed(6))
      })
      .eq('id', row.id);

    if (updateError) {
      throw new Error(`Failed to update model usage stats: ${updateError.message}`);
    }
    return;
  }

  const { error: insertError } = await supabase
    .from('model_usage_stats')
    .insert({
      session_id: sessionId,
      model_id: modelId,
      period_date: periodDate,
      call_count: callCount,
      total_tokens_in: tokensIn,
      total_tokens_out: tokensOut,
      total_cost_usd: Number(costUsd.toFixed(6))
    });

  if (insertError) {
    throw new Error(`Failed to insert model usage stats: ${insertError.message}`);
  }
}

async function checkDailySpendCap(sessionId, cap) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('executions')
    .select('total_cost_usd')
    .eq('session_id', sessionId)
    .gte('created_at', `${today}T00:00:00.000Z`)
    .lt('created_at', `${today}T23:59:59.999Z`);

  if (error) {
    throw new Error(`Failed to check daily spend cap: ${error.message}`);
  }

  const total = (data || []).reduce((sum, row) => sum + Number(row.total_cost_usd || 0), 0);
  return total <= cap;
}

async function logExecution(execution) {
  const {
    sessionId,
    planId,
    prompt,
    category,
    difficulty,
    status,
    subtaskResults,
    analytics
  } = execution;

  const { error: insertExecError } = await supabase
    .from('executions')
    .insert({
      session_id: sessionId,
      plan_id: planId,
      prompt,
      category,
      difficulty,
      models_used: analytics.modelsUsed,
      total_tokens: analytics.totalTokens,
      total_cost: analytics.totalCost,
      total_time_ms: analytics.totalTimeMs,
      subtask_count: Array.isArray(subtaskResults) ? subtaskResults.length : 0,
      status
    });

  if (insertExecError) {
    throw new Error(`Failed to insert execution analytics: ${insertExecError.message}`);
  }

  for (const result of subtaskResults) {
    await upsertModelUsageStats(
      sessionId,
      result.model,
      1,
      Math.floor((result.actualTokens || 0) / 2),
      Math.ceil((result.actualTokens || 0) / 2),
      Number(result.actualCost || 0)
    );
  }

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      action: 'execution_completed',
      resource_type: 'execution',
      resource_id: planId,
      metadata: {
        session_id: sessionId,
        status,
        models_used: analytics.modelsUsed,
        total_tokens: analytics.totalTokens,
        total_cost: analytics.totalCost
      }
    });

  if (auditError) {
    throw new Error(`Failed to insert audit log: ${auditError.message}`);
  }
}

module.exports = {
  upsertModelUsageStats,
  checkDailySpendCap,
  logExecution
};
