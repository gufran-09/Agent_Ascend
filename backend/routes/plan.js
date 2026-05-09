const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../db/supabase');
const { generatePlan } = require('../core/router');
const { estimateTokensAndCost } = require('../core/token_counter');
const { savePlan } = require('../core/plan_store');

async function getAvailableModelsForSession(sessionId) {
  const { data: keys, error: keysError } = await supabase
    .from('api_key_vault')
    .select('provider')
    .eq('session_id', sessionId)
    .eq('is_valid', true)
    .eq('revoked_at', null);

  if (keysError) {
    throw new Error(`Failed to resolve available providers: ${keysError.message}`);
  }
  if (!keys || keys.length === 0) {
    return [];
  }

  const providers = [...new Set(keys.map((k) => k.provider))];
  const { data: models, error: modelError } = await supabase
    .from('model_registry')
    .select('model_id')
    .in('provider', providers)
    .eq('is_active', true);

  if (modelError) {
    throw new Error(`Failed to resolve model registry: ${modelError.message}`);
  }

  return [...new Set((models || []).map((m) => m.model_id))];
}

router.post('/', (req, res) => {
  (async () => {
    const { session_id, prompt, available_models } = req.body || {};
    if (!session_id || !prompt) {
      return res.status(400).json({
        error: 'Missing required fields: session_id, prompt'
      });
    }

    const resolvedModels = Array.isArray(available_models) && available_models.length > 0
      ? [...new Set(available_models)]
      : await getAvailableModelsForSession(session_id);

    if (resolvedModels.length === 0) {
      return res.status(400).json({
        error: 'No available models found for session. Connect at least one valid provider key first.'
      });
    }

    const plan = await generatePlan(prompt, resolvedModels, session_id);
    const enrichedSubtasks = plan.subtasks.map((task) => {
      const estimate = estimateTokensAndCost(task.prompt, task.assignedModel);
      return {
        id: task.id,
        title: task.title,
        assignedModel: task.assignedModel,
        prompt: task.prompt,
        estimatedTokens: estimate.tokens,
        estimatedCost: estimate.cost,
        estimatedTime: estimate.timeSeconds
      };
    });

    const totals = enrichedSubtasks.reduce((acc, task) => {
      acc.tokens += task.estimatedTokens;
      acc.cost += task.estimatedCost;
      acc.timeSeconds += task.estimatedTime;
      return acc;
    }, { tokens: 0, cost: 0, timeSeconds: 0 });

    const planId = crypto.randomUUID();
    savePlan(planId, {
      planId,
      prompt,
      sessionId: session_id,
      category: plan.category,
      difficulty: plan.difficulty,
      needsDecomposition: plan.needsDecomposition,
      availableModels: resolvedModels,
      subtasks: enrichedSubtasks,
      totalEstimate: {
        tokens: totals.tokens,
        cost: Number(totals.cost.toFixed(4)),
        timeSeconds: totals.timeSeconds
      }
    });

    return res.json({
      planId,
      prompt,
      category: plan.category,
      difficulty: plan.difficulty,
      needsDecomposition: plan.needsDecomposition,
      availableModels: resolvedModels,
      subtasks: enrichedSubtasks.map(({ prompt: _prompt, ...task }) => task),
      totalEstimate: {
        tokens: totals.tokens,
        cost: Number(totals.cost.toFixed(4)),
        timeSeconds: totals.timeSeconds
      }
    });
  })().catch((error) => {
    res.status(500).json({
      error: 'Failed to generate execution plan',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  });
});

module.exports = router;
