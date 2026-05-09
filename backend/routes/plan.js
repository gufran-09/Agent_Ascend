const express = require('express');
const { z } = require('zod');
const crypto = require('crypto');
const validate = require('../middleware/validate');
const { getAvailableModels } = require('../db/models');
const { generatePlan } = require('../core/router');
const { estimateCost } = require('../core/token_counter');
const supabase = require('../db/supabase');

const router = express.Router();
const crypto = require('crypto');
const supabase = require('../db/supabase');
const { generatePlan } = require('../core/router');
const { estimateTokensAndCost } = require('../core/token_counter');
const { savePlan } = require('../core/plan_store');

<<<<<<< HEAD
const planSchema = z.object({
  session_id: z.string().uuid(),
  prompt: z.string().min(3).max(10000)
});

router.post('/', validate(planSchema), async (req, res, next) => {
  try {
    const { session_id, prompt } = req.body;

    const availableModels = await getAvailableModels(session_id);
    if (!availableModels || availableModels.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No API keys connected. Submit at least one key via POST /api/keys.'
      });
    }

    const plan = await generatePlan(prompt, availableModels, session_id);

    plan.subtasks = plan.subtasks.map(task => {
      const estimates = estimateCost(task.assignedModel, task.prompt, availableModels);
      return {
        ...task,
        ...estimates
      };
    });

    plan.totalEstimatedCostUSD = plan.subtasks.reduce((s, t) => s + (t.estimatedCostUSD || 0), 0);
    plan.totalEstimatedTokens = plan.subtasks.reduce((s, t) => s + (t.estimatedInputTokens || 0) + (t.estimatedOutputTokens || 0), 0);

    plan.sessionId = session_id;
    plan.createdAt = new Date().toISOString();
    plan.planVersion = 1;

    const planId = crypto.randomUUID();
    plan.planId = planId;
    
    // Save new plan using the helper
    if (supabase.savePlanVersion) {
      const { error } = await supabase.savePlanVersion(planId, session_id, plan, 1);
      if (error) {
        console.warn("Could not save plan to database:", error);
      }
    }
    
    return res.status(200).json({ success: true, plan });
  } catch (error) {
    next(error);
  }
});

const editSchema = z.object({
  session_id: z.string().uuid(),
  edits: z.array(z.object({
    subtaskId: z.number(),
    field: z.enum(['assignedModel', 'prompt', 'title']),
    value: z.string()
  }))
});

router.post('/:planId/edit', validate(editSchema), async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { session_id, edits } = req.body;

    // Fetch plan from Supabase
    if (!supabase.getLatestPlan) {
      return res.status(500).json({ success: false, error: 'Database helpers not initialized' });
    }

    const { data: latestPlanRow, error: fetchError } = await supabase.getLatestPlan(planId);
    
    if (fetchError || !latestPlanRow) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    if (latestPlanRow.session_id !== session_id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    let plan = latestPlanRow.plan_json;

    // Fetch available models for validation and cost recalculation
    const availableModels = await getAvailableModels(session_id);
    const availableModelIds = new Set(availableModels.map(m => m.id));

    // Apply edits
    for (const edit of edits) {
      const taskIndex = plan.subtasks.findIndex(t => t.id === edit.subtaskId);
      if (taskIndex === -1) continue;

      if (edit.field === 'assignedModel') {
        if (!availableModelIds.has(edit.value)) {
          return res.status(400).json({ success: false, error: `Invalid assignedModel: ${edit.value}` });
        }
      }

      plan.subtasks[taskIndex][edit.field] = edit.value;

      // If model or prompt changed, recalculate cost
      if (edit.field === 'assignedModel' || edit.field === 'prompt') {
        const estimates = estimateCost(plan.subtasks[taskIndex].assignedModel, plan.subtasks[taskIndex].prompt, availableModels);
        plan.subtasks[taskIndex] = {
          ...plan.subtasks[taskIndex],
          ...estimates
        };
      }
    }

    // Recalculate totals
    plan.totalEstimatedCostUSD = plan.subtasks.reduce((s, t) => s + (t.estimatedCostUSD || 0), 0);
    plan.totalEstimatedTokens = plan.subtasks.reduce((s, t) => s + (t.estimatedInputTokens || 0) + (t.estimatedOutputTokens || 0), 0);

    const newVersion = latestPlanRow.plan_version + 1;
    plan.planVersion = newVersion;
    plan.createdAt = new Date().toISOString(); // Update timestamp for this version

    // Save new version
    const { error: saveError } = await supabase.savePlanVersion(planId, session_id, plan, newVersion);
    if (saveError) {
      console.warn("Could not save edited plan to database:", saveError);
      return res.status(500).json({ success: false, error: 'Could not save edited plan' });
    }

    return res.status(200).json({ success: true, plan, planVersion: newVersion });
  } catch (error) {
    next(error);
  }
=======
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
>>>>>>> backend_engineer
});

module.exports = router;
