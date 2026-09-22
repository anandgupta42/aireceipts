function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optionalCount(raw, key) {
  // Only a missing/undefined key is "absent"; null and anything else must validate.
  if (raw[key] === undefined) return 0;
  return isCount(raw[key]) ? raw[key] : null;
}

export function normalizeUsage(raw) {
  if (raw === null || typeof raw !== 'object') return null;

  const inputTokens = raw.input_tokens;
  const outputTokens = raw.output_tokens;
  if (!isCount(inputTokens) || !isCount(outputTokens)) return null;

  const cacheRead = optionalCount(raw, 'cached_input_tokens');
  const cacheCreation = optionalCount(raw, 'cache_creation_tokens');
  if (cacheRead === null || cacheCreation === null) return null;

  if (cacheRead > inputTokens) return null;

  const total = inputTokens + outputTokens + cacheCreation;
  if (!Number.isSafeInteger(total)) return null;

  return {
    input: inputTokens - cacheRead,
    cacheRead,
    cacheCreation,
    output: outputTokens,
    total,
  };
}
