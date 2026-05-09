const express = require("express");
const { z } = require("zod");
const validate = require("../middleware/validate");
const supabase = require("../db/supabase");
const { encryptKeyParts } = require("../security/vault");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const router = express.Router();

const keySchema = z.object({
  session_id: z.string().uuid(),
  provider: z.enum(["openai", "anthropic", "google_gemini"]),
  api_key: z.string().min(10),
});

/**
 * POST /api/keys
 * Submit and validate an API key for a provider
 * Body: { provider: "openai"|"anthropic"|"google_gemini", api_key: "sk-...", session_id: "uuid" }
 */
router.post("/keys", validate(keySchema), async (req, res, next) => {
  try {
    const { provider, api_key, session_id } = req.body;

    try {
      await validateApiKey(provider, api_key);
    } catch (error) {
      if (error.status === 400) {
        return res.status(400).json({
          success: false,
          error: "Invalid API key",
          status: "invalid",
        });
      }

      if (error.status === 429) {
        return res.status(429).json({
          success: false,
          error: "Rate limited — key may be valid, try again",
        });
      }

      return next(error);
    }

    const { ciphertext, iv, authTag } = encryptKeyParts(api_key);
    const keyHint = api_key.slice(-4);

    // Store in Supabase (session_id maps to user_id in DB)
    const { data: existingKey, error: fetchError } = await supabase
      .from("api_key_vault")
      .select("*")
      .eq("session_id", session_id)
      .eq("provider", provider)
      .eq("revoked_at", null)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      throw fetchError;
    }

    const validatedAt = new Date().toISOString();

    if (existingKey) {
      // Update existing key
      const { error: updateError } = await supabase
        .from("api_key_vault")
        .update({
          encrypted_key: ciphertext,
          iv,
          auth_tag: authTag,
          key_hint: keyHint,
          is_valid: true,
          last_validated_at: validatedAt,
          validation_error: null,
          rotated_at: validatedAt,
        })
        .eq("id", existingKey.id);

      if (updateError) throw updateError;
    } else {
      // Insert new key
      const { error: insertError } = await supabase
        .from("api_key_vault")
        .insert({
          user_id: session_id,
          provider,
          encrypted_key: ciphertext,
          iv,
          auth_tag: authTag,
          key_hint: keyHint,
          is_valid: true,
          last_validated_at: validatedAt,
          validation_error: null,
        });

      if (insertError) throw insertError;
    }

    res.json({
      success: true,
      provider,
      status: "active",
      hint: keyHint,
      validated_at: validatedAt,
    });
  } catch (error) {
    console.error("Error in POST /api/keys:", error.message);
    return next(error);
  }
});

/**
 * GET /api/models?session_id=xxx
 * Return available models for a session (only models with valid keys)
 */
router.get("/models", async (req, res, next) => {
  try {
    const { session_id } = req.query;

    const sessionCheck = z.string().uuid().safeParse(session_id);
    if (!sessionCheck.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid session_id",
      });
    }

    // Fetch all valid API keys for this user
    const { data: keys, error: keysError } = await supabase
      .from("api_key_vault")
      .select("provider")
      .eq("session_id", session_id)
      .eq("is_valid", true)
      .eq("revoked_at", null);

    if (keysError) throw keysError;

    if (!keys || keys.length === 0) {
      return res.json({ success: true, count: 0, models: [] });
    }

    // Get available providers
    const availableProviders = keys.map((k) => k.provider);

    // Fetch models from model_registry for available providers
    const { data: models, error: modelsError } = await supabase
      .from("model_registry")
      .select("*")
      .in("provider", availableProviders)
      .eq("is_active", true)
      .order("provider");

    if (modelsError) throw modelsError;

    // Return model list in contract format
    const modelList = models.map((model) => ({
      id: model.model_id,
      provider: model.provider,
      display_name: model.display_name,
      strengths: model.strengths,
      context_window: model.context_window,
      input_cost_per_1k: parseFloat(model.cost_per_1k_input),
      output_cost_per_1k: parseFloat(model.cost_per_1k_output),
      supports_streaming: model.supports_streaming,
    }));

    res.json({
      success: true,
      count: modelList.length,
      models: modelList,
    });
  } catch (error) {
    console.error("Error in GET /api/models:", error.message);
    return next(error);
  }
});

/**
 * Validate an API key with a cheap test call
 * @param {string} provider - The provider name
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<boolean>} - True if valid, false otherwise
 */
async function validateApiKey(provider, apiKey) {
  switch (provider) {
    case "openai":
      return await validateOpenAIKey(apiKey);
    case "anthropic":
      return await validateAnthropicKey(apiKey);
    case "google_gemini":
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
    await client.models.list();
    return true;
  } catch (error) {
    throw mapProviderError(error);
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
      model: "claude-3-haiku-20240307",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return true;
  } catch (error) {
    throw mapProviderError(error);
  }
}

/**
 * Validate Google Gemini API key
 */
async function validateGoogleKey(apiKey) {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    await model.generateContent("hi");
    return true;
  } catch (error) {
    throw mapProviderError(error);
  }
}

function mapProviderError(error) {
  const status = error.status || error.statusCode;

  if (status === 401 || status === 403) {
    const err = new Error("Invalid API key");
    err.status = 400;
    err.code = "INVALID_API_KEY";
    return err;
  }

  if (status === 429) {
    const err = new Error("Rate limited — key may be valid, try again");
    err.status = 429;
    err.code = "RATE_LIMIT";
    return err;
  }

  return error;
}

module.exports = router;
