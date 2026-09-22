function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optionalCount(raw, key) {
  // Absent (undefined) defaults to 0; any supplied value, including null, must be a valid count.
  const value = raw[key];
  if (value === undefined) return 0;
  return isCount(value) ? value : undefined;
}

export function normalizeUsage(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const inputTokens = raw.input_tokens;
  const outputTokens = raw.output_tokens;
  if (!isCount(inputTokens) || !isCount(outputTokens)) return null;
  const cacheRead = optionalCount(raw, 'cached_input_tokens');
  const cacheCreation = optionalCount(raw, 'cache_creation_tokens');
  if (cacheRead === undefined || cacheCreation === undefined) return null;
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
