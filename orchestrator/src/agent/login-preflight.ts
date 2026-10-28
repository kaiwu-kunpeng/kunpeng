const LOGIN_FAILURE_PATTERNS = [
  /\bnot\s+logged\s+in\b/i,
  /please\s+run\s+\/login/i,
  /\b401\s+unauthorized\b/i,
  /\bauthentication\s+failed\b/i,
  /\binvalid\s+credentials\b/i,
];

const SHORT_GARBAGE_SPEC_CHARS = 500;

export function detectLoginFailure(text: string): boolean {
  return LOGIN_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

function looksLikeSubstantialSpec(text: string): boolean {
  return text.length > SHORT_GARBAGE_SPEC_CHARS && /^#{1,6}\s+/m.test(text);
}

export function isGarbageSpec(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (!detectLoginFailure(trimmed)) return false;
  return !looksLikeSubstantialSpec(trimmed);
}
