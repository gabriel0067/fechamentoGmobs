const keyPrefix = "gmobs:escaped:";

export function encodeItemKey(key: string) {
  return key.includes("\u0000") || key.startsWith(keyPrefix)
    ? keyPrefix + JSON.stringify(key)
    : key;
}

export function decodeItemKey(key: string) {
  if (!key.startsWith(keyPrefix)) return key;
  try {
    const decoded: unknown = JSON.parse(key.slice(keyPrefix.length));
    if (typeof decoded === "string" && encodeItemKey(decoded) === key) return decoded;
  } catch {
    // A key saved before escaping may already use this prefix.
  }
  return key;
}

export function encodeItemPayload(value: unknown) {
  const json = JSON.stringify(value);
  // Store the JSON as a string when the decoded value may contain NUL.
  return json?.includes("\\u0000")
    ? { payload: json, payload_encoded: true }
    : { payload: value, payload_encoded: false };
}

