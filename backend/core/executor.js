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
  };
}

module.exports = {
  callLLMProvider,
  executeSubtask,
  executePlan
};
