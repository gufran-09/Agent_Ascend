const express = require("express");
const { z } = require('zod');
const crypto = require('crypto');
const router = express.Router();
<<<<<<< HEAD
const validate = require('../middleware/validate');
const { executePlan } = require('../core/executor');
const { checkSpendCap } = require('../core/token_counter');
const { getAvailableModels } = require('../db/models');
const supabase = require('../db/supabase');

// Demo mode in-memory cache — keyed by prompt hash, expires after 60 min
const demoCache = new Map();

const executeSchema = z.object({
  session_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  demo_mode: z.boolean().optional()
});

router.post('/', validate(executeSchema), async (req, res, next) => {
  try {
    const { session_id, plan_id, demo_mode } = req.body;

    // 2. Fetch plan from Supabase
    let planData;
    if (supabase.getLatestPlan) {
      const { data, error } = await supabase.getLatestPlan(plan_id);
      if (error || !data) return res.status(404).json({ success: false, error: 'Plan not found' });
      if (data.session_id !== session_id) return res.status(404).json({ success: false, error: 'Plan not found' });
      planData = data.plan_json;
    } else {
      const { data, error } = await supabase
        .from('plans')
        .select('*')
        .eq('id', plan_id)
        .eq('session_id', session_id)
        .single();
      if (error || !data) return res.status(404).json({ success: false, error: 'Plan not found' });
      planData = typeof data.plan_json === 'string' ? JSON.parse(data.plan_json) : data.plan_json;
    }

    const plan = planData;

    // Demo cache check — return cached result if available
    let cacheKey = null;
    if (demo_mode && plan.subtasks) {
      cacheKey = crypto.createHash('md5')
        .update(JSON.stringify(plan.subtasks.map(t => t.prompt)))
        .digest('hex');
      if (demoCache.has(cacheKey)) {
        console.log('[demo] Returning cached result for demo_mode request');
        return res.json({ success: true, result: demoCache.get(cacheKey), fromCache: true });
      }
    }

    // 3. Check spend cap
    const cap = await checkSpendCap(session_id);
    if (!cap.allowed) {
      const config = require('../config');
      return res.status(402).json({
        success: false,
        error: `Daily spend cap of $${config.dailyCapUSD} reached. Used today: $${cap.todaySpend.toFixed(4)}`,
        code: 'SPEND_CAP_EXCEEDED',
        todaySpend: cap.todaySpend,
      });
    }

    // 4. Fetch encrypted keys
    const { data: keys, error: keysError } = await supabase
      .from('api_key_vault')
      .select('provider, encrypted_key, iv, auth_tag')
      .eq('session_id', session_id)
      .eq('is_valid', true)
      .is('revoked_at', null);

    if (keysError || !keys || keys.length === 0) {
      return res.status(400).json({ success: false, error: 'No active API keys found' });
    }

    // Build keyMap
    const keyMap = {};
    for (const k of keys) {
      let combinedKey = k.encrypted_key;
      if (!combinedKey.includes(':') && k.iv && k.auth_tag) {
        combinedKey = `${k.iv}:${k.auth_tag}:${k.encrypted_key}`;
      }
      keyMap[k.provider] = combinedKey;
    }

    // 5. Fetch availableModels
    const availableModels = await getAvailableModels(session_id);
    if (!availableModels || availableModels.length === 0) {
      return res.status(400).json({ success: false, error: 'No models available' });
    }

    // 7. Execute Plan
    const result = await executePlan(plan, keyMap, availableModels);

    // Demo cache store — only for demo_mode requests
    if (demo_mode && cacheKey) {
      demoCache.set(cacheKey, result);
      setTimeout(() => demoCache.delete(cacheKey), 60 * 60 * 1000); // 60 min TTL
    }

    // 8. Insert into executions table
    const executionId = crypto.randomUUID();
    let promptSnippet = "";
    if (plan.subtasks && plan.subtasks.length > 0 && plan.subtasks[0].prompt) {
      promptSnippet = plan.subtasks[0].prompt.slice(0, 500);
    }

    const { error: insertError } = await supabase
      .from('executions')
      .insert({
        id: executionId,
        session_id,
        plan_id,
        prompt_raw: promptSnippet,
        prompt_category: plan.category,
        difficulty: plan.difficulty,
        models_used: result.subtaskResults.map(r => r.modelUsed),
        total_input_tokens: result.totalInputTokens,
        total_output_tokens: result.totalOutputTokens,
        total_cost_usd: result.totalCostUSD,
        latency_ms: result.totalLatencyMs,
        status: result.status,
        had_fallback: result.subtaskResults.some(r => r.wasFallback),
        created_at: new Date().toISOString()
      });

    if (insertError) {
      console.warn("[executor] Failed to log execution to DB:", insertError);
    } else {
      // Fire-and-forget analytics logging — never await this
      const { logExecution } = require('../db/analytics');
      logExecution({
        id: executionId,
        session_id,
        category: plan.category,
        models_used: result.subtaskResults.map(r => r.modelUsed),
        total_cost_usd: result.totalCostUSD
      }, result.subtaskResults).catch(err =>
        console.error('[analytics] Logging failed (non-fatal):', err.message)
      );
    }

    // 9. Return 200
    return res.status(200).json({ success: true, result });

  } catch (error) {
    console.error('Error in POST /api/execute:', error);
    next(error);
=======
const { getPlan } = require('../core/plan_store');
const { executePlan } = require('../core/executor');
const analyticsDb = require('../db/analytics');

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Plan is required');
  }
  if (!Array.isArray(plan.subtasks) || plan.subtasks.length === 0) {
    throw new Error('Plan subtasks are required');
  }
  if (!Array.isArray(plan.availableModels) || plan.availableModels.length === 0) {
    throw new Error('Plan availableModels are required');
  }
}

router.post('/', async (req, res) => {
  try {
    const { plan_id, session_id, plan } = req.body || {};
    if (!session_id) {
      return res.status(400).json({
        error: 'Missing required field: session_id'
      });
    }

    let resolvedPlan = null;
    let planId = plan_id || null;

    if (plan) {
      validatePlan(plan);
      resolvedPlan = plan;
      if (!planId) {
        planId = `inline-${Date.now()}`;
      }
    } else {
      if (!plan_id) {
        return res.status(400).json({
          error: 'Provide either plan_id or plan payload'
        });
      }
      const storedPlan = getPlan(plan_id);
      if (!storedPlan) {
        return res.status(404).json({
          error: 'Plan not found. Generate a plan first via POST /api/plan'
        });
      }
      if (storedPlan.sessionId !== session_id) {
        return res.status(403).json({
          error: 'Plan does not belong to the provided session_id'
        });
      }
      resolvedPlan = storedPlan;
      planId = storedPlan.planId || plan_id;
    }

    const executionResult = await executePlan(resolvedPlan, session_id);

    const analyticsError = await analyticsDb.logExecution({
      sessionId: session_id,
      planId,
      prompt: resolvedPlan.prompt || null,
      category: resolvedPlan.category || null,
      difficulty: resolvedPlan.difficulty || null,
      ...executionResult
    }).then(() => null).catch((error) => error.message);

    return res.json({
      planId,
      status: executionResult.status,
      subtaskResults: executionResult.subtaskResults,
      finalOutput: executionResult.finalOutput,
      analytics: executionResult.analytics,
      warnings: analyticsError ? [`Analytics write failed: ${analyticsError}`] : []
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to execute plan',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
>>>>>>> backend_engineer
  }
});

module.exports = router;
