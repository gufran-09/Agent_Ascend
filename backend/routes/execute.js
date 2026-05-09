const express = require('express');
const router = express.Router();
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
  }
});

module.exports = router;
