const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../db/supabase');
const { decryptKey } = require('../security/vault');
const { fetchAvailableModelRecords, validatePlanModels } = require('./router');
const { estimateTokens, estimateCost } = require('./token_counter');

async function executePlan(plan, sessionId) {
  if (!plan || !Array.isArray(plan.subtasks)) throw new Error('Valid plan is required');
  if (!sessionId) throw new Error('sessionId is required');

  const availableModels = await fetchAvailableModelRecords(sessionId, plan.availableModels || []);
  validatePlanModels(plan, availableModels.map(model => model.id));

  const keyMap = await loadProviderKeys(sessionId);
  const startedAt = Date.now();
  const subtaskResults = [];

  for (const subtask of plan.subtasks) {
    const result = await executeSubtaskWithFallback(subtask, availableModels, keyMap);
    subtaskResults.push(result);
  }

  const status = getExecutionStatus(subtaskResults);
  const finalOutput = aggregateResults(plan.prompt, subtaskResults);
  const analytics = buildAnalytics(subtaskResults, Date.now() - startedAt);

  return {
    planId: plan.planId,
    status,
    subtaskResults,
    finalOutput,
    analytics,
  };
}

async function loadProviderKeys(sessionId) {
  const { data: keys, error } = await supabase
    .from('api_key_vault')
    .select('provider, encrypted_key')
    .eq('session_id', sessionId)
    .eq('is_valid', true)
    .is('revoked_at', null);

  if (error) throw error;

  const keyMap = new Map();
  for (const key of keys || []) {
    keyMap.set(key.provider, key.encrypted_key);
  }
  return keyMap;
}

async function executeSubtaskWithFallback(subtask, availableModels, keyMap) {
  const orderedModels = getFallbackModels(subtask.assignedModel, availableModels, keyMap);
  const errors = [];

  for (let i = 0; i < orderedModels.length; i++) {
    const model = orderedModels[i];
    try {
      const encryptedKey = keyMap.get(model.provider);
      if (!encryptedKey) throw new Error(`No valid key connected for provider ${model.provider}`);

      const apiKey = decryptKey(encryptedKey);
      const callResult = await callModel({
        provider: model.provider,
        modelId: model.id,
        apiKey,
        prompt: subtask.prompt,
      });

      const inputTokens = callResult.inputTokens || estimateTokens(subtask.prompt);
      const outputTokens = callResult.outputTokens || estimateTokens(callResult.output);
      const totalTokens = callResult.totalTokens || inputTokens + outputTokens;
      const cost = estimateCost(inputTokens, outputTokens, model);
      const confidence = scoreResponse(subtask.title, callResult.output, i > 0, null);

      return {
        id: subtask.id,
        title: subtask.title,
        model: model.id,
        output: callResult.output,
        tokens: totalTokens,
        cost,
        latencyMs: callResult.latencyMs,
        usedFallback: i > 0,
        confidenceScore: confidence.score,
        confidenceNote: confidence.note,
      };
    } catch (error) {
      errors.push(`${model.id}: ${error.message}`);
    }
  }

  const output = `Subtask failed after trying available fallback models. Errors: ${errors.join(' | ')}`;
  const confidence = scoreResponse(subtask.title, output, true, new Error(output));
  return {
    id: subtask.id,
    title: subtask.title,
    model: subtask.assignedModel,
    output,
    tokens: estimateTokens(output),
    cost: 0,
    latencyMs: 0,
    usedFallback: true,
    confidenceScore: confidence.score,
    confidenceNote: confidence.note,
  };
}

function getFallbackModels(assignedModelId, availableModels, keyMap) {
  const usable = availableModels.filter(model => keyMap.has(model.provider));
  const assigned = usable.find(model => model.id === assignedModelId);
  const rest = usable
    .filter(model => model.id !== assignedModelId)
    .sort((a, b) => (a.cost_per_1k_input + a.cost_per_1k_output) - (b.cost_per_1k_input + b.cost_per_1k_output));
  return assigned ? [assigned, ...rest] : rest;
}

async function callModel({ provider, modelId, apiKey, prompt }) {
  const startedAt = Date.now();
  let output;
  let usage = {};

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    output = response.choices?.[0]?.message?.content || '';
    usage = response.usage || {};
  } else if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
    output = (response.content || [])
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n');
    usage = {
      prompt_tokens: response.usage?.input_tokens,
      completion_tokens: response.usage?.output_tokens,
      total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };
  } else if (provider === 'google_gemini') {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelId });
    const response = await model.generateContent(prompt);
    output = response.response?.text?.() || '';
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  if (!output) throw new Error(`No output returned from ${modelId}`);

  const inputTokens = usage.prompt_tokens || estimateTokens(prompt);
  const outputTokens = usage.completion_tokens || estimateTokens(output);
  return {
    output,
    inputTokens,
    outputTokens,
    totalTokens: usage.total_tokens || inputTokens + outputTokens,
    latencyMs: Date.now() - startedAt,
  };
}

function aggregateResults(prompt, subtaskResults) {
  const successful = subtaskResults.filter(result => !result.output.startsWith('Subtask failed'));
  if (successful.length === 0) {
    return `# Execution Failed\n\n${subtaskResults.map(result => result.output).join('\n\n')}`;
  }

  if (subtaskResults.length === 1) return subtaskResults[0].output;

  return [
    '# Final Response',
    '',
    `Original prompt: ${prompt}`,
    '',
    ...subtaskResults.flatMap(result => [
      `## ${result.id}. ${result.title}`,
      `Model: ${result.model}${result.usedFallback ? ' (fallback used)' : ''}`,
      '',
      result.output,
      '',
    ]),
  ].join('\n');
}

function buildAnalytics(subtaskResults, totalTimeMs) {
  return {
    totalTokens: subtaskResults.reduce((sum, result) => sum + Number(result.tokens || 0), 0),
    totalCost: Number(subtaskResults.reduce((sum, result) => sum + Number(result.cost || 0), 0).toFixed(6)),
    totalTimeMs,
    modelsUsed: [...new Set(subtaskResults.map(result => result.model))],
  };
}

function getExecutionStatus(subtaskResults) {
  const failed = subtaskResults.filter(result => result.output.startsWith('Subtask failed')).length;
  if (failed === 0) return 'completed';
  if (failed === subtaskResults.length) return 'failed';
  return 'partial';
}

function scoreResponse(title, output, usedFallback, error) {
  if (error) return { score: 20, note: 'Subtask failed after fallback attempts.' };

  let score = 70;
  if (output.length > 500) score += 10;
  if (output.toLowerCase().includes(String(title).toLowerCase().split(' ')[0])) score += 5;
  if (usedFallback) score -= 10;
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    note: usedFallback
      ? 'Response completed using a fallback model.'
      : 'Response completed successfully with the assigned model.',
  };
}

module.exports = {
  executePlan,
  callModel,
  getFallbackModels,
  aggregateResults,
  scoreResponse,
};
