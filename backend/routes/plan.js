const express = require('express');
const { z } = require('zod');
const crypto = require('crypto');
const validate = require('../middleware/validate');
const { getAvailableModels } = require('../db/models');
const { generatePlan } = require('../core/router');
const { estimateCost } = require('../core/token_counter');
const supabase = require('../db/supabase');

const router = express.Router();

const planSchema = z.object({
  session_id: z.string().uuid(),
  prompt: z.string().min(3).max(10000)
});

router.post('/plan', validate(planSchema), async (req, res, next) => {
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

router.post('/plan/:planId/edit', validate(editSchema), async (req, res, next) => {
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
});

module.exports = router;
