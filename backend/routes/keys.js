const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const { encryptKey } = require('../security/vault');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * POST /api/keys
 * Submit and validate an API key for a provider
 * Body: { provider: "openai"|"anthropic"|"google_gemini", api_key: "sk-...", session_id: "uuid" }
 */
router.post('/', async (req, res) => {
  try {
    const { provider, api_key, session_id } = req.body;

    // Validate input
    if (!provider || !api_key || !session_id) {
      return res.status(400).json({
        error: 'Missing required fields: provider, api_key, session_id'
      });
    }

    const validProviders = ['openai', 'anthropic', 'google_gemini'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`
      });
    }

    // Validate API key with a cheap test call
    let isValid = false;
    let validationError = null;

    try {
      isValid = await validateApiKey(provider, api_key);
    } catch (error) {
      validationError = error.message;
      console.error(`Key validation failed for ${provider}:`, error.message);
    }

    // Encrypt the key
    const encryptedKey = encryptKey(api_key);
    const keyHint = `...${api_key.slice(-4)}`; // Last 4 chars only

    // Store in Supabase. Never store or return plaintext keys.
    const { data: existingKey, error: fetchError } = await supabase
      .from('api_key_vault')
      .select('*')
      .eq('session_id', session_id)
      .eq('provider', provider)
      .is('revoked_at', null)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (existingKey) {
      // Update existing key
      const { error: updateError } = await supabase
        .from('api_key_vault')
        .update({
          encrypted_key: encryptedKey,
          key_hint: keyHint,
          is_valid: isValid,
          last_validated_at: new Date().toISOString(),
          validation_error: validationError,
          rotated_at: new Date().toISOString()
        })
        .eq('id', existingKey.id);

      if (updateError) throw updateError;
    } else {
      // Insert new key
      const { error: insertError } = await supabase
        .from('api_key_vault')
        .insert({
          session_id,
          provider,
          encrypted_key: encryptedKey,
          key_hint: keyHint,
          is_valid: isValid,
          last_validated_at: new Date().toISOString(),
          validation_error: validationError
        });

      if (insertError) throw insertError;
    }

    // CRITICAL: Never return the key in the response
    res.json({
      provider,
      status: isValid ? 'active' : 'invalid',
      hint: keyHint,
      validated_at: new Date().toISOString(),
      error: validationError
    });

  } catch (error) {
    console.error('Error in POST /api/keys:', error);
    res.status(500).json({
      error: 'Failed to store API key',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/models?session_id=xxx
 * Return available models for a session (only models with valid keys)
 */
router.get('/models', async (req, res) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({
        error: 'Missing required query parameter: session_id'
      });
    }

    const modelList = await getAvailableModelsForSession(session_id);
    res.json({
      models: modelList,
      count: modelList.length
    });

  } catch (error) {
    console.error('Error in GET /api/models:', error);
    res.status(500).json({
      error: 'Failed to fetch available models',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

async function getAvailableModelsForSession(sessionId) {
  const { data: keys, error: keysError } = await supabase
    .from('api_key_vault')
    .select('provider, is_valid')
    .eq('session_id', sessionId)
    .eq('is_valid', true)
    .is('revoked_at', null);

  if (keysError) throw keysError;
  if (!keys || keys.length === 0) return [];

  const availableProviders = [...new Set(keys.map(k => k.provider))];
  const { data: models, error: modelsError } = await supabase
    .from('model_registry')
    .select('*')
    .in('provider', availableProviders)
    .eq('is_active', true)
    .order('provider');

  if (modelsError) throw modelsError;

  return (models || []).map(model => ({
    id: model.model_id,
    provider: model.provider,
    display_name: model.display_name,
    strengths: model.strengths || [],
    context_window: model.context_window,
    cost_per_1k_input: Number(model.cost_per_1k_input || 0),
    cost_per_1k_output: Number(model.cost_per_1k_output || 0),
    avg_latency_ms: model.avg_latency_ms,
    supports_streaming: model.supports_streaming,
    supports_json_mode: model.supports_json_mode
  }));
}

/**
 * Validate an API key with a cheap test call
 * @param {string} provider - The provider name
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<boolean>} - True if valid, false otherwise
 */
async function validateApiKey(provider, apiKey) {
  switch (provider) {
    case 'openai':
      return await validateOpenAIKey(apiKey);
    case 'anthropic':
      return await validateAnthropicKey(apiKey);
    case 'google_gemini':
      return await validateGoogleKey(apiKey);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Validate OpenAI API key
 */
async function validateOpenAIKey(apiKey) {
  try {
    const client = new OpenAI({ apiKey });
    // Cheap test call: list models (minimal cost)
    await client.models.list({ limit: 1 });
    return true;
  } catch (error) {
    if (error.status === 401) return false;
    throw error;
  }
}

/**
 * Validate Anthropic API key
 */
async function validateAnthropicKey(apiKey) {
  try {
    const client = new Anthropic({ apiKey });
    // Cheap test call: list models
    await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Hi' }]
    });
    return true;
  } catch (error) {
    if (error.status === 401) return false;
    throw error;
  }
}

/**
 * Validate Google Gemini API key
 */
async function validateGoogleKey(apiKey) {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Cheap test call. The installed SDK version does not consistently expose
    // listModels(), so use a tiny generation request for validation.
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    await model.generateContent('Hi');
    return true;
  } catch (error) {
    if (error.status === 401 || error.status === 403) return false;
    throw error;
  }
}

router.getAvailableModelsForSession = getAvailableModelsForSession;

module.exports = router;
