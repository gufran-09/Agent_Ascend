const supabase = require('../db/supabase');
const { decryptKeyParts } = require('../security/vault');
const { classify } = require('./classifier');
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function callLLM(model, provider, systemPrompt, userPrompt, sessionId) {
  const { data: keyData, error } = await supabase
    .from('api_key_vault')
    .select('encrypted_key, iv, auth_tag')
    .eq('session_id', sessionId)
    .eq('provider', provider)
    .eq('is_valid', true)
    .is('revoked_at', null)
    .single();

  if (error || !keyData) {
    throw new Error(`Could not retrieve API key for provider ${provider}`);
  }

  const apiKey = decryptKeyParts(keyData.encrypted_key, keyData.iv, keyData.auth_tag);

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });
    return response.choices[0].message.content;
  } else if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: model,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    });
    return response.content[0].text;
  } else if (provider === 'google_gemini') {
    const genAI = new GoogleGenerativeAI(apiKey);
    const genModel = genAI.getGenerativeModel({ model: model, systemInstruction: systemPrompt });
    const response = await genModel.generateContent(userPrompt);
    return response.response.text();
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function generatePlan(prompt, availableModels, sessionId) {
  if (!availableModels || availableModels.length === 0) {
    throw new Error("No available models to generate plan");
  }

  const { category, difficulty, needsDecomposition } = classify(prompt);

  const availableModelsList = availableModels
    .map(m => `${m.id} (${m.strengths.join(', ')})`)
    .join('\n');

  const sortedModels = [...availableModels].sort((a, b) => a.inputCostPer1k - b.inputCostPer1k);
  const metaModel = sortedModels[0];

  const systemPrompt = `You are an AI orchestration router.

AVAILABLE MODELS (you must ONLY use these exact model IDs, no others):
${availableModelsList}

TASK CATEGORY: ${category}
DIFFICULTY: ${difficulty}
NEEDS DECOMPOSITION: ${needsDecomposition}

Return ONLY a valid JSON object. No markdown, no explanation, no code fences.

If needsDecomposition is false, return:
{
  "category": "...",
  "difficulty": "...",
  "needsDecomposition": false,
  "subtasks": [
    {
      "id": 1,
      "title": "Direct execution",
      "assignedModel": "<one exact model ID from available list>",
      "prompt": "<the original user prompt>",
      "rationale": "<one sentence: why this model fits this task>"
    }
  ]
}

If needsDecomposition is true, return:
{
  "category": "...",
  "difficulty": "...",
  "needsDecomposition": true,
  "subtasks": [
    {
      "id": 1,
      "title": "<short task name>",
      "assignedModel": "<one exact model ID from available list>",
      "prompt": "<focused sub-prompt for this model>",
      "rationale": "<one sentence>",
      "dependsOn": []
    },
    {
      "id": 2,
      "title": "<short task name>",
      "assignedModel": "<one exact model ID from available list>",
      "prompt": "<sub-prompt, may reference output of subtask 1>",
      "rationale": "<one sentence>",
      "dependsOn": [1]
    }
  ]
}`;

  let planJsonStr;
  let plan;

  try {
    planJsonStr = await callLLM(metaModel.id, metaModel.provider, systemPrompt, prompt, sessionId);
    planJsonStr = planJsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
    plan = JSON.parse(planJsonStr);
  } catch (err) {
    try {
      const retrySystemPrompt = `${systemPrompt}\n\nCRITICAL: You must return ONLY raw JSON. Do not include markdown formatting or any other text.`;
      planJsonStr = await callLLM(metaModel.id, metaModel.provider, retrySystemPrompt, prompt, sessionId);
      planJsonStr = planJsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
      plan = JSON.parse(planJsonStr);
    } catch (retryErr) {
      plan = {
        category,
        difficulty,
        needsDecomposition: false,
        subtasks: [
          {
            id: 1,
            title: "Direct execution",
            assignedModel: metaModel.id,
            prompt: prompt,
            rationale: "Fallback plan due to parsing errors",
            dependsOn: []
          }
        ]
      };
    }
  }

  const availableIds = new Set(availableModels.map(m => m.id));
  
  if (!plan.subtasks || !Array.isArray(plan.subtasks)) {
    plan.subtasks = [
      {
        id: 1,
        title: "Direct execution",
        assignedModel: metaModel.id,
        prompt: prompt,
        rationale: "Fallback plan due to invalid structure",
        dependsOn: []
      }
    ];
  }

  if (plan.needsDecomposition) {
    const { decompose } = require('./decomposer');
    plan.subtasks = decompose(plan.subtasks, availableModels);
  } else {
    plan.subtasks.forEach(t => { 
      t.dependsOn = []; 
      t.wave = 0; 
      t.canRunInParallel = true; 
    });
  }

  for (const task of plan.subtasks) {
    if (!availableIds.has(task.assignedModel)) {
      task.assignedModel = metaModel.id;
      task.repaired = true;
      console.warn(`[router] Repaired invalid model assignment → ${metaModel.id}`);
    }
  }

  return plan;
}

module.exports = { generatePlan };
