import { webcrypto } from "node:crypto";

const SESSION_COOKIE = "gmobs_session";
const SESSION_SECONDS = 8 * 60 * 60;

type AuthEnv = {
  GMOBS_LOGIN_USER?: string;
  GMOBS_LOGIN_PASSWORD?: string;
  GMOBS_SESSION_SECRET?: string;
};

const encoder = new TextEncoder();

function authEnv() {
  const runtime = process.env as AuthEnv;
  const username = runtime.GMOBS_LOGIN_USER;
  const password = runtime.GMOBS_LOGIN_PASSWORD;
  const secret = runtime.GMOBS_SESSION_SECRET;
  if (!username || !password || !secret)
    throw new Error("A autenticação do site ainda não foi configurada.");
  return { username, password, secret };
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string, secret: string) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await webcrypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
}

async function safeEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    webcrypto.subtle.digest("SHA-256", encoder.encode(left)),
    webcrypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index++)
    difference |= leftBytes[index] ^ (rightBytes[index] || 0);
  return difference === 0;
}

function cookieValue(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`),
  );
  return match?.[1] || "";
}

export async function validateCredentials(username: string, password: string) {
  const expected = authEnv();
  const [validUser, validPassword] = await Promise.all([
    safeEqual(username, expected.username),
    safeEqual(password, expected.password),
  ]);
  return validUser && validPassword;
}

export async function createSessionCookie(secure = true) {
  const { username, secret } = authEnv();
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({ username, expiresAt: Date.now() + SESSION_SECONDS * 1000 }),
    ),
  );
  const signature = toBase64Url(await hmac(payload, secret));
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie(secure = true) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Strict; Max-Age=0`;
}

export async function authenticatedUsername(request: Request) {
  try {
    const token = cookieValue(request);
    const separator = token.lastIndexOf(".");
    if (separator < 1) return null;
    const payload = token.slice(0, separator);
    const suppliedSignature = fromBase64Url(token.slice(separator + 1));
    const { username, secret } = authEnv();
    const expectedSignature = await hmac(payload, secret);
    if (suppliedSignature.length !== expectedSignature.length) return null;
    let difference = 0;
    for (let index = 0; index < expectedSignature.length; index++)
      difference |= expectedSignature[index] ^ suppliedSignature[index];
    if (difference !== 0) return null;

    const decoded = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payload)),
    ) as { username?: string; expiresAt?: number };
    if (
      decoded.username !== username ||
      typeof decoded.expiresAt !== "number" ||
      decoded.expiresAt <= Date.now()
    )
      return null;
    return username;
  } catch {
    return null;
  }
}
