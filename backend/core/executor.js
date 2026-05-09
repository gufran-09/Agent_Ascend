<<<<<<< HEAD
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getFallbackOrder } = require('./fallback');
const { getProviderForModel } = require('../db/models');
const vault = require('../security/vault');
const { computeActualCost } = require('./token_counter');

async function callLLMProvider(provider, modelId, apiKey, prompt) {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: modelId,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    });
    return {
      text: msg.content[0].text,
      usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }
    };
  } else if (provider === 'openai') {
    const client = new OpenAI({ apiKey });
    const res = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048
    });
    return {
      text: res.choices[0].message.content,
      usage: { input_tokens: res.usage.prompt_tokens, output_tokens: res.usage.completion_tokens }
    };
  } else if (provider === 'google_gemini') {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelId });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    // Gemini usage metadata may be unavailable on free tier — default to 0
    const usage = {
      input_tokens: result.response.usageMetadata?.promptTokenCount || 0,
      output_tokens: result.response.usageMetadata?.candidatesTokenCount || 0
    };
    return { text, usage };
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function executeSubtask(subtask, availableModels, keyMap, category) {
  const modelsToTry = getFallbackOrder(category, subtask.assignedModel, availableModels);
  
  for (const modelId of modelsToTry) {
    const provider = getProviderForModel(modelId);
    const encryptedKey = keyMap[provider];
    
    if (!encryptedKey) continue;
    
    const start = Date.now();
    const apiKey = vault.decryptKey(encryptedKey);
    
    try {
      const result = await callLLMProvider(provider, modelId, apiKey, subtask.prompt);
      const actualCost = computeActualCost(modelId, result.usage);
      
      return {
        subtaskId: subtask.id,
        modelUsed: modelId,
        wasFallback: modelId !== subtask.assignedModel,
        output: result.text,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        latencyMs: Date.now() - start,
        costUSD: actualCost,
        costINR: parseFloat((actualCost * 83.5).toFixed(4))
      };
    } catch (err) {
      console.warn(`[executor] ${modelId} failed: ${err.message}`);
      continue;
    }
  }
  
  throw new Error(`All models failed for subtask ${subtask.id}`);
}

async function executePlan(plan, keyMap, availableModels) {
  const waveMap = {};
  for (const subtask of plan.subtasks) {
    const wave = subtask.wave || 0;
    if (!waveMap[wave]) waveMap[wave] = [];
    waveMap[wave].push(subtask);
  }

  const waves = Object.keys(waveMap).map(Number).sort((a, b) => a - b);
  const results = [];

  for (const waveIndex of waves) {
    const subtasksInWave = waveMap[waveIndex];
    // SEQUENTIAL execution for now
    for (const subtask of subtasksInWave) {
      const deps = subtask.dependsOn || [];
      const priorOutputs = results
        .filter(r => deps.includes(r.subtaskId))
        .map(r => `[Output from subtask ${r.subtaskId}]\n${r.output}`)
        .join('\n\n');
        
      const enrichedPrompt = priorOutputs
        ? `Context from previous steps:\n${priorOutputs}\n\nYour task:\n${subtask.prompt}`
        : subtask.prompt;
        
      const enrichedSubtask = { ...subtask, prompt: enrichedPrompt };
      
      try {
        const result = await executeSubtask(enrichedSubtask, availableModels, keyMap, plan.category);
        results.push(result);
      } catch (err) {
        console.error(`Execution failed on subtask ${subtask.id}:`, err);
        // Continue but output will be missing for this task, marked as partial
        results.push({
          subtaskId: subtask.id,
          modelUsed: null,
          wasFallback: false,
          output: null,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          costUSD: 0,
          costINR: 0,
          error: err.message
        });
      }
    }
  }

  const validResults = results.filter(r => r.output);
  const finalOutput = validResults.map(r => `### Step ${r.subtaskId} (${r.modelUsed})\n${r.output}`).join('\n\n---\n\n');

  return {
    subtaskResults: results,
    finalOutput,
    totalInputTokens: results.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: results.reduce((s, r) => s + r.outputTokens, 0),
    totalCostUSD: parseFloat(results.reduce((s, r) => s + r.costUSD, 0).toFixed(8)),
    totalCostINR: parseFloat(results.reduce((s, r) => s + r.costINR, 0).toFixed(4)),
    totalLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0),
    status: results.every(r => r.output) ? 'completed' : 'partial'
=======
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../db/supabase');
const { decryptKey } = require('../security/vault');
const { estimateTokensAndCost } = require('./token_counter');

function modelToProvider(model) {
  const lower = String(model || '').toLowerCase();
  if (lower.includes('gpt')) return 'openai';
  if (lower.includes('claude')) return 'anthropic';
  if (lower.includes('gemini')) return 'google_gemini';
  throw new Error(`Unsupported model: ${model}`);
}

function resolveProviderModel(model) {
  const lower = String(model || '').toLowerCase();
  if (lower.includes('claude-sonnet')) return 'claude-3-5-sonnet-20241022';
  if (lower.includes('claude-haiku')) return 'claude-3-haiku-20240307';
  if (lower === 'gemini-flash') return 'gemini-1.5-flash';
  return model;
}

async function getApiKey(sessionId, provider) {
  const { data, error } = await supabase
    .from('api_key_vault')
    .select('encrypted_key')
    .eq('session_id', sessionId)
    .eq('provider', provider)
    .eq('is_valid', true)
    .eq('revoked_at', null)
    .order('last_validated_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load key for ${provider}: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`No active key for provider ${provider}`);
  }

  return decryptKey(data[0].encrypted_key);
}

function buildConfidence(output, errorMessage) {
  if (errorMessage) {
    return {
      score: 15,
      note: 'Execution failed after fallback attempts'
    };
  }
  const outputLength = (output || '').trim().length;
  if (outputLength > 2000) return { score: 90, note: 'Comprehensive response with strong coverage' };
  if (outputLength > 900) return { score: 82, note: 'Solid response with good depth' };
  if (outputLength > 250) return { score: 74, note: 'Useful response but could include more depth' };
  return { score: 62, note: 'Concise response with limited depth' };
}

async function callOpenAI(model, apiKey, prompt) {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }]
  });
  const output = response.choices?.[0]?.message?.content || '';
  const usage = response.usage || {};
  return {
    output,
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0
  };
}

async function callAnthropic(model, apiKey, prompt) {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  });
  const output = response.content?.map((c) => c.text || '').join('\n').trim() || '';
  const usage = response.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  return {
    output,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens
  };
}

async function callGemini(model, apiKey, prompt) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const llm = genAI.getGenerativeModel({ model });
  const response = await llm.generateContent(prompt);
  const output = response.response.text() || '';
  const usage = response.response.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
  const totalTokens = usage.totalTokenCount || (inputTokens + outputTokens);
  return {
    output,
    inputTokens,
    outputTokens,
    totalTokens
  };
}

async function callModel(model, prompt, sessionId) {
  const provider = modelToProvider(model);
  const providerModel = resolveProviderModel(model);
  const apiKey = await getApiKey(sessionId, provider);
  const started = Date.now();

  let response;
  if (provider === 'openai') {
    response = await callOpenAI(providerModel, apiKey, prompt);
  } else if (provider === 'anthropic') {
    response = await callAnthropic(providerModel, apiKey, prompt);
  } else {
    response = await callGemini(providerModel, apiKey, prompt);
  }

  const latencyMs = Date.now() - started;
  return { ...response, latencyMs };
}

function buildMergedOutput(subtaskResults) {
  return subtaskResults
    .filter((result) => result.output)
    .map((result) => `## ${result.title}\n${result.output}`)
    .join('\n\n---\n\n');
}

async function executeSubtask(task, availableModels, sessionId, previousOutput) {
  const uniqueModels = [...new Set([task.assignedModel, ...availableModels])];
  const modelsToTry = uniqueModels.slice(0, 3);
  const maxFallbackAttempts = 2;

  let lastError = null;
  for (let attempt = 0; attempt < modelsToTry.length; attempt += 1) {
    const model = modelsToTry[attempt];
    try {
      const chainedPrompt = previousOutput
        ? `${task.prompt}\n\nContext from previous subtask:\n${previousOutput}`
        : task.prompt;
      const result = await callModel(model, chainedPrompt, sessionId);
      const estimate = estimateTokensAndCost(chainedPrompt, model);
      const actualCost = (result.inputTokens || result.outputTokens)
        ? Number((((result.inputTokens || 0) / 1000) * (estimate.cost / Math.max(estimate.tokens, 1)) + ((result.outputTokens || 0) / 1000) * (estimate.cost / Math.max(estimate.tokens, 1))).toFixed(4))
        : estimate.cost;
      const confidence = buildConfidence(result.output, null);

      return {
        id: task.id,
        title: task.title,
        model,
        output: result.output,
        actualTokens: result.totalTokens || estimate.tokens,
        actualCost,
        latencyMs: result.latencyMs,
        confidenceScore: confidence.score,
        confidenceNote: confidence.note,
        fallbackTriggered: attempt > 0,
        fallbackAttempts: Math.min(attempt, maxFallbackAttempts)
      };
    } catch (error) {
      lastError = error;
    }
  }

  const confidence = buildConfidence('', lastError ? lastError.message : 'Unknown failure');
  return {
    id: task.id,
    title: task.title,
    model: task.assignedModel,
    output: '',
    actualTokens: 0,
    actualCost: 0,
    latencyMs: 0,
    confidenceScore: confidence.score,
    confidenceNote: confidence.note,
    fallbackTriggered: true,
    fallbackAttempts: maxFallbackAttempts,
    error: lastError ? lastError.message : 'Unknown execution error'
  };
}

async function executePlan(plan, sessionId) {
  if (!plan || !Array.isArray(plan.subtasks) || plan.subtasks.length === 0) {
    throw new Error('Plan must include subtasks');
  }
  if (!Array.isArray(plan.availableModels) || plan.availableModels.length === 0) {
    throw new Error('Plan must include availableModels');
  }
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('sessionId is required');
  }

  const subtaskResults = [];
  let previousOutput = '';

  for (const task of plan.subtasks) {
    const result = await executeSubtask(task, plan.availableModels, sessionId, previousOutput);
    subtaskResults.push(result);
    if (result.output) {
      previousOutput = result.output;
    }
  }

  const completedCount = subtaskResults.filter((result) => !result.error).length;
  const status = completedCount === subtaskResults.length
    ? 'completed'
    : completedCount > 0
      ? 'partial'
      : 'failed';
  const finalOutput = buildMergedOutput(subtaskResults);

  const analytics = {
    totalTokens: subtaskResults.reduce((sum, result) => sum + (result.actualTokens || 0), 0),
    totalCost: Number(subtaskResults.reduce((sum, result) => sum + (result.actualCost || 0), 0).toFixed(4)),
    totalTimeMs: subtaskResults.reduce((sum, result) => sum + (result.latencyMs || 0), 0),
    modelsUsed: [...new Set(subtaskResults.map((result) => result.model))]
  };

  return {
    status,
    subtaskResults,
    finalOutput,
    analytics
>>>>>>> backend_engineer
  };
}

module.exports = {
<<<<<<< HEAD
  callLLMProvider,
  executeSubtask,
=======
>>>>>>> backend_engineer
  executePlan
};
