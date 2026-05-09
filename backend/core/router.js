const crypto = require('crypto');
const supabase = require('../db/supabase');
const { classifyPrompt } = require('./classifier');
const { estimateTokensAndCost, sumEstimates } = require('./token_counter');

async function generatePlan(prompt, availableModelIds = [], sessionId) {
  if (!prompt || typeof prompt !== 'string') throw new Error('Prompt is required');
  if (!sessionId) throw new Error('sessionId is required');

  const models = await fetchAvailableModelRecords(sessionId, availableModelIds);
  if (models.length === 0) throw new Error('No available models connected for this session');

  const classification = classifyPrompt(prompt);
  const subtasks = buildSubtasks(prompt, classification);

  const plannedSubtasks = subtasks.map((subtask, index) => {
    const model = chooseBestModel(models, classification.category, index);
    const estimate = estimateTokensAndCost(subtask.prompt, model, classification.difficulty);
    return {
      id: index + 1,
      title: subtask.title,
      assignedModel: model.id,
      prompt: subtask.prompt,
      estimatedTokens: estimate.tokens,
      estimatedCost: estimate.cost,
      estimatedTime: estimate.timeSeconds,
    };
  });

  const totalEstimate = sumEstimates(plannedSubtasks.map(task => ({
    tokens: task.estimatedTokens,
    cost: task.estimatedCost,
    timeSeconds: task.estimatedTime,
  })));

  const plan = {
    planId: `plan_${crypto.randomUUID()}`,
    prompt,
    category: classification.category,
    difficulty: classification.difficulty,
    needsDecomposition: classification.needsDecomposition,
    availableModels: models.map(model => model.id),
    subtasks: plannedSubtasks,
    totalEstimate,
  };

  validatePlanModels(plan, models.map(model => model.id));
  return plan;
}

async function fetchAvailableModelRecords(sessionId, requestedModelIds = []) {
  const { data: keys, error: keysError } = await supabase
    .from('api_key_vault')
    .select('provider')
    .eq('session_id', sessionId)
    .eq('is_valid', true)
    .is('revoked_at', null);

  if (keysError) throw keysError;
  if (!keys || keys.length === 0) return [];

  const providers = [...new Set(keys.map(key => key.provider))];
  let query = supabase
    .from('model_registry')
    .select('*')
    .in('provider', providers)
    .eq('is_active', true);

  if (requestedModelIds.length > 0) {
    query = query.in('model_id', requestedModelIds);
  }

  const { data: models, error: modelsError } = await query;
  if (modelsError) throw modelsError;

  return (models || []).map(normalizeModelRecord);
}

function normalizeModelRecord(model) {
  return {
    id: model.model_id,
    model_id: model.model_id,
    provider: model.provider,
    display_name: model.display_name,
    strengths: model.strengths || [],
    context_window: model.context_window,
    cost_per_1k_input: Number(model.cost_per_1k_input || 0),
    cost_per_1k_output: Number(model.cost_per_1k_output || 0),
    avg_latency_ms: Number(model.avg_latency_ms || 1000),
    supports_streaming: Boolean(model.supports_streaming),
    supports_json_mode: Boolean(model.supports_json_mode),
  };
}

function buildSubtasks(prompt, classification) {
  if (!classification.needsDecomposition) {
    return [{ title: 'Answer the user request', prompt }];
  }

  const category = classification.category;
  if (category === 'coding') {
    return [
      { title: 'Analyze requirements and design approach', prompt: `Analyze this coding task and propose the implementation approach:\n\n${prompt}` },
      { title: 'Implement the core solution', prompt: `Implement the core solution for this task. Include concrete code or file-level guidance:\n\n${prompt}` },
      { title: 'Validate and identify edge cases', prompt: `Review the solution, list tests, validation steps, and edge cases for:\n\n${prompt}` },
    ];
  }

  if (category === 'research') {
    return [
      { title: 'Research key facts and context', prompt: `Research the key facts and context for:\n\n${prompt}` },
      { title: 'Compare options and tradeoffs', prompt: `Compare relevant options, evidence, and tradeoffs for:\n\n${prompt}` },
      { title: 'Synthesize final recommendation', prompt: `Synthesize a concise final recommendation for:\n\n${prompt}` },
    ];
  }

  return [
    { title: 'Break down the task', prompt: `Break down this request into the important parts:\n\n${prompt}` },
    { title: 'Solve the main task', prompt: `Solve the main request in detail:\n\n${prompt}` },
    { title: 'Review and finalize', prompt: `Review the answer for completeness and provide the final response:\n\n${prompt}` },
  ];
}

function chooseBestModel(models, category, index = 0) {
  const preferenceByCategory = {
    coding: ['coding', 'reasoning', 'analysis'],
    math: ['reasoning', 'complex-reasoning'],
    logic: ['reasoning', 'analysis'],
    research: ['research', 'analysis', 'long-context'],
    creative: ['writing', 'general'],
    planning: ['reasoning', 'analysis', 'general'],
    general: ['fast', 'general'],
  };

  const preferences = preferenceByCategory[category] || preferenceByCategory.general;
  const scored = models.map(model => {
    const strengths = model.strengths || [];
    const strengthScore = preferences.reduce((score, pref) => score + (strengths.includes(pref) ? 10 : 0), 0);
    const cheapnessScore = 1 / Math.max(0.000001, model.cost_per_1k_input + model.cost_per_1k_output);
    const latencyScore = 1 / Math.max(1, model.avg_latency_ms);
    return { model, score: strengthScore + cheapnessScore * 0.0001 + latencyScore };
  }).sort((a, b) => b.score - a.score);

  return scored[index % Math.min(scored.length, 2)]?.model || models[0];
}

function validatePlanModels(plan, availableModelIds) {
  if (!plan || !Array.isArray(plan.subtasks) || plan.subtasks.length === 0) {
    throw new Error('Generated plan must include at least one subtask');
  }

  const allowed = new Set(availableModelIds);
  for (const task of plan.subtasks) {
    if (!task.id || !task.title || !task.assignedModel || !task.prompt) {
      throw new Error('Each subtask must include id, title, assignedModel, and prompt');
    }
    if (!allowed.has(task.assignedModel)) {
      throw new Error(`Plan assigned unavailable model: ${task.assignedModel}`);
    }
  }

  if (!plan.totalEstimate || !Number.isFinite(Number(plan.totalEstimate.tokens)) || !Number.isFinite(Number(plan.totalEstimate.cost))) {
    throw new Error('Plan estimates must be numeric');
  }

  return true;
}

module.exports = {
  generatePlan,
  fetchAvailableModelRecords,
  normalizeModelRecord,
  validatePlanModels,
  chooseBestModel,
};
