const supabase = require('../db/supabase');
const config = require('../config');

const PRICING = {
  'claude-3-5-sonnet-20241022':   { inputPer1k: 0.003,    outputPer1k: 0.015   },
  'claude-3-haiku-20240307':      { inputPer1k: 0.00025,  outputPer1k: 0.00125 },
  'gpt-4o':                       { inputPer1k: 0.005,    outputPer1k: 0.015   },
  'gpt-4o-mini':                  { inputPer1k: 0.00015,  outputPer1k: 0.0006  },
  'gemini-1.5-pro':               { inputPer1k: 0.0035,   outputPer1k: 0.0105  },
  'gemini-1.5-flash':             { inputPer1k: 0.000075, outputPer1k: 0.0003  },
};
const FALLBACK_PRICE = { inputPer1k: 0.001, outputPer1k: 0.003 };
const INR_RATE = 83.5;

function estimateTokens(text) {
  if (typeof text !== 'string') text = '';
  const inputTokens = Math.ceil(text.length / 4);
  const outputTokens = Math.ceil(inputTokens * 1.5);
  return { input: inputTokens, output: outputTokens };
}

function estimateCost(modelId, promptText, availableModels) {
  const { input, output } = estimateTokens(promptText);
  const pricing = PRICING[modelId] || FALLBACK_PRICE;
  
  const usd = (input / 1000 * pricing.inputPer1k) + (output / 1000 * pricing.outputPer1k);
  
  return {
    estimatedInputTokens: input,
    estimatedOutputTokens: output,
    estimatedCostUSD: parseFloat(usd.toFixed(6)),
    estimatedCostINR: parseFloat((usd * INR_RATE).toFixed(4)),
    estimatedLatencyMs: Math.ceil(input * 0.5 + output * 1.2)
  };
}

function computeActualCost(modelId, usageObject) {
  if (!usageObject) usageObject = { input_tokens: 0, output_tokens: 0 };
  let { input_tokens, output_tokens } = usageObject;
  
  // If provider is google_gemini and tokens are 0:
  if (modelId.startsWith('gemini') && input_tokens === 0 && output_tokens === 0) {
    const fallbackEstimate = estimateTokens(usageObject.fallback_text || '');
    input_tokens = fallbackEstimate.input;
    output_tokens = fallbackEstimate.output;
  }
  
  const pricing = PRICING[modelId] || FALLBACK_PRICE;
  const usd = (input_tokens / 1000 * pricing.inputPer1k) + (output_tokens / 1000 * pricing.outputPer1k);
  return parseFloat(usd.toFixed(8));
}

function aggregatePlanCost(subtasks) {
  if (!subtasks || !Array.isArray(subtasks)) return {
    totalEstimatedCostUSD: 0, totalEstimatedCostINR: 0,
    totalEstimatedInputTokens: 0, totalEstimatedOutputTokens: 0,
    totalEstimatedTokens: 0, totalEstimatedLatencyMs: 0
  };

  const sums = subtasks.reduce((acc, t) => {
    acc.usd += (t.estimatedCostUSD || 0);
    acc.inr += (t.estimatedCostINR || 0);
    acc.in += (t.estimatedInputTokens || 0);
    acc.out += (t.estimatedOutputTokens || 0);
    acc.lat += (t.estimatedLatencyMs || 0);
    return acc;
  }, { usd: 0, inr: 0, in: 0, out: 0, lat: 0 });

  return {
    totalEstimatedCostUSD: parseFloat(sums.usd.toFixed(6)),
    totalEstimatedCostINR: parseFloat((sums.usd * INR_RATE).toFixed(4)),
    totalEstimatedInputTokens: sums.in,
    totalEstimatedOutputTokens: sums.out,
    totalEstimatedTokens: sums.in + sums.out,
    totalEstimatedLatencyMs: sums.lat
  };
}

async function checkSpendCap(sessionId) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('executions')
      .select('total_cost_usd')
      .eq('session_id', sessionId)
      .gte('created_at', today);
      
    if (error) {
      console.warn("Failed to query spend cap", error);
      return { allowed: true, todaySpend: 0, remaining: config.dailyCapUSD };
    }

    const spend = data.reduce((sum, row) => sum + (parseFloat(row.total_cost_usd) || 0), 0);
    const todaySpend = parseFloat(spend.toFixed(6));
    const remaining = config.dailyCapUSD - todaySpend;

    return {
      allowed: remaining > 0,
      todaySpend,
      remaining: parseFloat(remaining.toFixed(6))
    };
  } catch (err) {
    console.warn("Error in checkSpendCap:", err);
    return { allowed: true, todaySpend: 0, remaining: config.dailyCapUSD };
  }
}

module.exports = {
  PRICING,
  FALLBACK_PRICE,
  INR_RATE,
  estimateTokens,
  estimateCost,
  computeActualCost,
  aggregatePlanCost,
  checkSpendCap
};
