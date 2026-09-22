export function normalizeUsage(raw) {
  return { input: raw.input_tokens, cacheRead: raw.cached_input_tokens ?? 0,
    cacheCreation: raw.cache_creation_tokens ?? 0, output: raw.output_tokens,
    total: raw.input_tokens + raw.output_tokens };
}
