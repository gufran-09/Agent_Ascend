const CATEGORY_KEYWORDS = [
  ['coding', ['code', 'bug', 'debug', 'api', 'react', 'node', 'database', 'sql', 'function', 'component', 'backend', 'frontend', 'typescript', 'javascript', 'python']],
  ['math', ['calculate', 'equation', 'proof', 'algebra', 'geometry', 'statistics', 'probability', 'derivative', 'integral']],
  ['research', ['research', 'sources', 'compare', 'summarize', 'market', 'study', 'evidence', 'literature']],
  ['creative', ['write', 'story', 'poem', 'brand', 'copy', 'creative', 'script', 'tagline']],
  ['planning', ['plan', 'roadmap', 'steps', 'strategy', 'schedule', 'timeline', 'milestone']],
  ['logic', ['logic', 'reason', 'deduce', 'puzzle', 'constraint', 'decision', 'evaluate']],
];

function classifyPrompt(prompt = '') {
  const text = String(prompt).toLowerCase();
  const category = detectCategory(text);
  const difficulty = detectDifficulty(text);

  return {
    category,
    difficulty,
    needsDecomposition: shouldDecompose(prompt, difficulty),
  };
}

function detectCategory(text) {
  let best = { category: 'general', score: 0 };
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    const score = keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
    if (score > best.score) best = { category, score };
  }
  return best.category;
}

function detectDifficulty(prompt = '') {
  const text = String(prompt).toLowerCase();
  const length = prompt.length;
  const multiStepSignals = ['step by step', 'full implementation', 'build', 'deploy', 'test', 'integrate', 'architecture', 'end-to-end', 'e2e'];
  const hardSignals = ['complex', 'comprehensive', 'production', 'optimize', 'refactor', 'security', 'scalable'];

  const multiStepCount = multiStepSignals.filter(signal => text.includes(signal)).length;
  const hardCount = hardSignals.filter(signal => text.includes(signal)).length;

  if (length > 1200 || multiStepCount >= 3) return 'agentic';
  if (length > 700 || hardCount >= 2 || multiStepCount >= 2) return 'hard';
  if (length > 240 || hardCount >= 1 || multiStepCount >= 1) return 'medium';
  return 'easy';
}

function shouldDecompose(prompt = '', difficulty = 'medium') {
  const text = String(prompt).toLowerCase();
  return ['hard', 'agentic'].includes(difficulty) ||
    text.includes('step by step') ||
    text.includes('break down') ||
    text.includes('multiple') ||
    text.includes('end-to-end');
}

module.exports = {
  classifyPrompt,
  detectDifficulty,
  shouldDecompose,
};
