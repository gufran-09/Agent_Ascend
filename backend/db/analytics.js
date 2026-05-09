const supabase = require('./supabase');
<<<<<<< HEAD
const { getProviderForModel } = require('./models');

async function logExecution(executionRow, subtaskResults) {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get model UUIDs
    const modelStrIds = [...new Set(subtaskResults.map(r => r.modelUsed).filter(Boolean))];
    let modelUuidMap = {};
    if (modelStrIds.length > 0) {
      const { data: modelsData } = await supabase
        .from('model_registry')
        .select('id, model_id')
        .in('model_id', modelStrIds);
      if (modelsData) {
        modelsData.forEach(m => modelUuidMap[m.model_id] = m.id);
      }
    }

    // Upsert model_usage_stats
    for (const r of subtaskResults) {
      if (!r.modelUsed) continue;
      
      const modelUuid = modelUuidMap[r.modelUsed];
      if (!modelUuid) continue;
      
      const upsertData = {
        session_id: executionRow.session_id,
        model_id: modelUuid,
        period_date: today,
        call_count: 1,
        total_tokens_in: r.inputTokens || 0,
        total_tokens_out: r.outputTokens || 0,
        total_cost_usd: r.costUSD || 0,
        avg_latency_ms: r.latencyMs || 0,
        fallback_count: r.wasFallback ? 1 : 0
      };

      // Depending on schema, we might not have provider/category in model_usage_stats,
      // but if the prompt said so, we might need to add it or ignore it if Postgres rejects.
      // Based on database_schema.md, model_usage_stats does not have provider or category.
      // But the spec says onConflict 'session_id,model_id,date,category'. This means category is there?
      // I will omit provider and category if they are not in schema, but to be safe with the prompt
      // I'll leave them out since Postgres will throw an error if they don't exist, and the schema has no category in model_usage_stats!
      // Wait, let's look at schema: model_usage_stats -> id, user_id, model_id, period_date, call_count, total_tokens_in, total_tokens_out, total_cost_usd, avg_latency_ms, fallback_count, avg_confidence_score. NO CATEGORY! NO PROVIDER!
      // I will just use the schema fields.

      const { error: upsertErr } = await supabase.from('model_usage_stats').upsert(upsertData, {
        onConflict: 'session_id,model_id,period_date',
        count: 'exact'
      });
      if (upsertErr) {
        console.error('[analytics] Upsert failed:', upsertErr.message);
      }
    }

    // Insert to audit_logs
    const { error: auditErr } = await supabase.from('audit_logs').insert({
      user_id: null,
      action: 'execution_completed',
      resource_type: 'execution',
      resource_id: executionRow.id,
      metadata: {
        session_id: executionRow.session_id,
        category: executionRow.category,
        models_used: executionRow.models_used,
        total_cost: executionRow.total_cost_usd
      },
      created_at: new Date().toISOString()
    });
    
    if (auditErr) {
      console.error('[analytics] Audit log failed:', auditErr.message);
    }

  } catch (err) {
    console.error('[analytics] logExecution failed (non-fatal):', err.message);
  }
}

async function getSessionSummary(sessionId) {
  const today = new Date().toISOString().split('T')[0];

  const summary = {
    totalRuns: 0,
    totalCostUSD: 0,
    totalCostINR: 0,
    totalTokens: 0,
    avgLatencyMs: 0,
    successRate: 0,
    todaySpend: 0,
    spendByProvider: {},
    cheapestByCategory: {},
    fallbackRate: 0
  };

  try {
    // 1. Query executions
    const { data: execs, error: execsErr } = await supabase
      .from('executions')
      .select('*')
      .eq('session_id', sessionId);

    if (!execsErr && execs && execs.length > 0) {
      summary.totalRuns = execs.length;
      
      let sumCost = 0;
      let sumTokens = 0;
      let sumLatency = 0;
      let successCount = 0;
      let todayCost = 0;
      let fallbackCount = 0;

      for (const e of execs) {
        sumCost += parseFloat(e.total_cost_usd || 0);
        sumTokens += (e.total_input_tokens || 0) + (e.total_output_tokens || 0);
        sumLatency += (e.latency_ms || 0);
        if (e.status === 'completed') successCount++;
        
        const eDate = e.created_at ? e.created_at.split('T')[0] : null;
        if (eDate === today) {
          todayCost += parseFloat(e.total_cost_usd || 0);
        }
        
        if (e.had_fallback) fallbackCount++;
      }

      summary.totalCostUSD = parseFloat(sumCost.toFixed(6));
      summary.totalCostINR = parseFloat((sumCost * 83.5).toFixed(4));
      summary.totalTokens = sumTokens;
      summary.avgLatencyMs = sumLatency / summary.totalRuns;
      summary.successRate = parseFloat((successCount / summary.totalRuns).toFixed(6));
      summary.todaySpend = parseFloat(todayCost.toFixed(6));
      summary.fallbackRate = parseFloat((fallbackCount / summary.totalRuns).toFixed(6));
    }

    // 2. Query model_usage_stats with provider join
    // Since model_usage_stats doesn't have provider, we join model_registry
    const { data: stats, error: statsErr } = await supabase
      .from('model_usage_stats')
      .select('*, model_registry(provider)')
      .eq('session_id', sessionId);

    if (!statsErr && stats && stats.length > 0) {
      for (const s of stats) {
        const p = s.model_registry?.provider || 'unknown';
        if (!summary.spendByProvider[p]) summary.spendByProvider[p] = 0;
        summary.spendByProvider[p] += parseFloat(s.total_cost_usd || 0);
      }

      for (const key in summary.spendByProvider) {
        summary.spendByProvider[key] = parseFloat(summary.spendByProvider[key].toFixed(6));
      }
    }
  } catch (err) {
    console.error('[analytics] getSessionSummary failed:', err.message);
  }

  return summary;
}

async function getCheapestModelPerCategory(sessionId, availableModels) {
  const cheapest = {};
  try {
    // Because model_usage_stats does not have category, we actually can't group by category in the DB!
    // The prompt specified "cheapest model per category" from model_usage_stats, but schema lacks category.
    // If the schema is strictly what was provided, this query won't work as requested.
    // We'll fall back to just selecting the absolute cheapest models from the registry if category isn't there,
    // or we'll fetch executions which have category and models_used.
    
    // Let's use executions instead to find cost per category
    const { data: execs, error } = await supabase
      .from('executions')
      .select('prompt_category, models_used, total_cost_usd')
      .eq('session_id', sessionId);

    if (error || !execs || execs.length === 0) return cheapest;

    const availableIds = new Set(availableModels.map(m => m.id));

    const catMap = {};
    for (const e of execs) {
      const cat = e.prompt_category || 'general';
      const models = e.models_used || [];
      const cost = parseFloat(e.total_cost_usd || 0);
      
      // Heuristic: distribute cost equally
      const costPerModel = models.length > 0 ? cost / models.length : cost;
      
      for (const modelId of models) {
        if (!availableIds.has(modelId)) continue;
        if (!catMap[cat]) catMap[cat] = {};
        if (!catMap[cat][modelId]) catMap[cat][modelId] = { cost: 0, calls: 0 };
        catMap[cat][modelId].cost += costPerModel;
        catMap[cat][modelId].calls += 1;
      }
    }

    for (const cat in catMap) {
      let minAvg = Infinity;
      let bestModel = null;
      for (const modelId in catMap[cat]) {
        const avg = catMap[cat][modelId].cost / catMap[cat][modelId].calls;
        if (avg < minAvg) {
          minAvg = avg;
          bestModel = modelId;
        }
      }
      if (bestModel) {
        cheapest[cat] = bestModel;
      }
    }
  } catch (err) {
    console.error('[analytics] getCheapestModelPerCategory failed:', err.message);
  }

  return cheapest;
}

async function seedDemoData(sessionId) {
  try {
    const models = ['gpt-4o', 'claude-3-haiku-20240307', 'gemini-1.5-flash'];
    
    const { data: regModels } = await supabase.from('model_registry').select('id, model_id').in('model_id', models);
    const modelUuidMap = {};
    if (regModels) {
      regModels.forEach(m => modelUuidMap[m.model_id] = m.id);
    }

    const categories = ['coding', 'research', 'general'];
    const statuses = ['completed', 'completed', 'completed', 'partial'];
    
    for (let i = 0; i < 8; i++) {
      const msOffset = Math.random() * 3 * 24 * 60 * 60 * 1000;
      const createdAt = new Date(Date.now() - msOffset).toISOString();
      
      const execId = require('crypto').randomUUID();
      const model = models[i % models.length];
      const cat = categories[i % categories.length];
      
      await supabase.from('executions').insert({
        id: execId,
        session_id: sessionId,
        prompt_raw: `Demo prompt ${i}`,
        prompt_category: cat,
        difficulty: 'medium',
        status: statuses[i % statuses.length],
        models_used: [model],
        total_input_tokens: 100 + i * 50,
        total_output_tokens: 200 + i * 50,
        total_cost_usd: 0.005 + i * 0.001,
        latency_ms: 1000 + i * 200,
        had_fallback: i % 4 === 0,
        created_at: createdAt
      });

      const modelUuid = modelUuidMap[model];
      if (modelUuid) {
        await supabase.from('model_usage_stats').insert({
          session_id: sessionId,
          model_id: modelUuid,
          period_date: createdAt.split('T')[0],
          call_count: 1,
          total_tokens_in: 100 + i * 50,
          total_tokens_out: 200 + i * 50,
          total_cost_usd: 0.005 + i * 0.001,
          avg_latency_ms: 1000 + i * 200,
          fallback_count: i % 4 === 0 ? 1 : 0
        });
      }
    }
    console.log('[analytics] Seeded demo data');
  } catch (err) {
    console.error('[analytics] seedDemoData failed:', err.message);
=======

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
>>>>>>> backend_engineer
  }
}

module.exports = {
<<<<<<< HEAD
  logExecution,
  getSessionSummary,
  getCheapestModelPerCategory,
  seedDemoData
=======
  upsertModelUsageStats,
  checkDailySpendCap,
  logExecution
>>>>>>> backend_engineer
};
