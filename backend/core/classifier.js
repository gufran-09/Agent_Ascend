function classify(prompt) {
  if (typeof prompt !== 'string') prompt = '';
  const text = prompt;
  
  let category = 'general';
  if (/\b(code|function|implement|build|debug|fix|api|class|algorithm|script)\b/i.test(text)) category = 'coding';
  else if (/\b(research|summarize|explain|what is|overview|history|compare)\b/i.test(text)) category = 'research';
  else if (/\b(plan|roadmap|steps|strategy|breakdown|timeline|organize)\b/i.test(text)) category = 'planning';
  else if (/\b(calculate|solve|equation|math|formula|proof|compute)\b/i.test(text)) category = 'math';
  else if (/\b(write|story|poem|creative|draft|generate content|essay)\b/i.test(text)) category = 'creative';

  let difficulty = 'easy';
  if (text.length > 400 || /\b(comprehensive|complete|full|entire|detailed)\b/i.test(text)) {
    difficulty = 'hard';
  } else if (text.length >= 150 || /\b(and|also|then|plus|additionally)\b/i.test(text)) {
    difficulty = 'medium';
  }

  const andOccurrences = (text.match(/ and /gi) || []).length;
  let needsDecomposition = false;
  if (difficulty === 'hard' || andOccurrences >= 2) {
    needsDecomposition = true;
  }

  return { category, difficulty, needsDecomposition };
}

module.exports = { classify };
