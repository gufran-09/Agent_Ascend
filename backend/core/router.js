const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../db/supabase');
const { decryptKey } = require('../security/vault');
const { classifyPrompt } = require('./classifier');

const ROUTER_PROMPT = `You are an AI orchestration router.
Return ONLY valid JSON in this exact shape:
{
  "category": "research|coding|logic|creative|planning|math|general",
  "difficulty": "easy|medium|hard|agentic",
  "needsDecomposition": true,
  "subtasks": [
    {
      "id": 1,
      "title": "subtask title",
      "assignedModel": "must be one value from availableModels",
      "prompt": "subtask prompt"
    }
  ]
}
Rules:
- Use only models listed in availableModels.
- If prompt is simple, return 1 subtask with needsDecomposition=false.
- Keep subtasks concise and execution-ready.`;

function modelToProvider(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('gpt')) return 'openai';
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gemini')) return 'google_gemini';
  throw new Error(`Unsupported model mapping for: ${model}`);
}

function choosePreferredModel(availableModels) {
  const preference = ['gpt-4o-mini', 'gemini-1.5-flash', 'claude-3-haiku-20240307', 'gpt-4o'];
  for (const preferred of preference) {
    if (availableModels.includes(preferred)) return preferred;
  }
  return availableModels[0];
}

async function getProviderKey(sessionId, provider) {
  const { data, error } = await supabase
    .from('api_key_vault')
    .select('encrypted_key')
    .eq('session_id', sessionId)
    .eq('provider', provider)
    .eq('revoked_at', null)
    .eq('is_valid', true)
    .order('last_validated_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load key for provider ${provider}: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`No active validated key for provider ${provider}`);
  }
  return decryptKey(data[0].encrypted_key);
}

function buildHeuristicSubtasks(prompt, availableModels, classification) {
  const bestModel = choosePreferredModel(availableModels);
  if (!classification.needsDecomposition) {
    return [{
      id: 1,
      title: 'Complete request',
      assignedModel: bestModel,
      prompt
    }];
  }

  const chunks = [
    { id: 1, title: 'Analyze objective', prompt: `Analyze the request and extract key objectives:\n${prompt}` },
    { id: 2, title: 'Produce detailed solution', prompt: `Create the main deliverable for this request:\n${prompt}` },
    { id: 3, title: 'Review and finalize output', prompt: `Review the output for completeness and return polished final content for:\n${prompt}` }
  ];

  return chunks.map((task, index) => ({
    ...task,
    assignedModel: availableModels[index % availableModels.length]
  }));
}

function normalizePlan(plan, prompt, availableModels) {
  const fallback = classifyPrompt(prompt);
  const category = ['research', 'coding', 'logic', 'creative', 'planning', 'math', 'general'].includes(plan?.category)
    ? plan.category
    : fallback.category;
  const difficulty = ['easy', 'medium', 'hard', 'agentic'].includes(plan?.difficulty)
    ? plan.difficulty
    : fallback.difficulty;

  const rawSubtasks = Array.isArray(plan?.subtasks) && plan.subtasks.length > 0
    ? plan.subtasks
    : buildHeuristicSubtasks(prompt, availableModels, fallback);

  const subtasks = rawSubtasks.map((task, idx) => {
    const assignedModel = availableModels.includes(task.assignedModel) ? task.assignedModel : availableModels[0];
    return {
      id: Number.isInteger(task.id) ? task.id : idx + 1,
      title: String(task.title || `Subtask ${idx + 1}`),
      assignedModel,
      prompt: String(task.prompt || prompt)
    };
  });

  return {
    category,
    difficulty,
    needsDecomposition: Boolean(plan?.needsDecomposition ?? (subtasks.length > 1)),
    subtasks
  };
}

function safeJsonParse(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Router response is empty');
  }
  const trimmed = text.trim();
  const fenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    : trimmed;
  return JSON.parse(fenced);
}

async function routeWithOpenAI(model, apiKey, prompt, availableModels) {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: ROUTER_PROMPT },
      { role: 'user', content: `availableModels: ${JSON.stringify(availableModels)}\nuserPrompt: ${prompt}` }
    ],
    response_format: { type: 'json_object' }
  });
  return safeJsonParse(response.choices?.[0]?.message?.content);
}

async function routeWithAnthropic(model, apiKey, prompt, availableModels) {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 1200,
    system: `${ROUTER_PROMPT}\nReturn only JSON.`,
    messages: [{ role: 'user', content: `availableModels: ${JSON.stringify(availableModels)}\nuserPrompt: ${prompt}` }]
  });
  const text = response.content?.[0]?.text;
  return safeJsonParse(text);
}

async function routeWithGemini(model, apiKey, prompt, availableModels) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const llm = genAI.getGenerativeModel({ model });
  const response = await llm.generateContent(
    `${ROUTER_PROMPT}\navailableModels: ${JSON.stringify(availableModels)}\nuserPrompt: ${prompt}\nReturn JSON only.`
  );
  const text = response.response.text();
  return safeJsonParse(text);
}

async function generatePlan(prompt, availableModels, sessionId) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required');
  }
  if (!Array.isArray(availableModels) || availableModels.length === 0) {
    throw new Error('availableModels must contain at least one model');
  }
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('sessionId is required');
  }

  const routingModel = choosePreferredModel(availableModels);
  const provider = modelToProvider(routingModel);
  let llmPlan = null;

  try {
    const decryptedKey = await getProviderKey(sessionId, provider);
    if (provider === 'openai') {
      llmPlan = await routeWithOpenAI(routingModel, decryptedKey, prompt, availableModels);
    } else if (provider === 'anthropic') {
      llmPlan = await routeWithAnthropic(routingModel, decryptedKey, prompt, availableModels);
    } else {
      llmPlan = await routeWithGemini(routingModel, decryptedKey, prompt, availableModels);
    }
  } catch (_routingError) {
    llmPlan = null;
  }

  const normalized = normalizePlan(llmPlan, prompt, availableModels);
  return {
    ...normalized,
    routerModel: routingModel
  };
}

module.exports = {
  generatePlan
};
