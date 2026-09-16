import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const source = process.env.GMOBS_SOURCE_URL;
const username = process.env.GMOBS_LOGIN_USER;
const password = process.env.GMOBS_LOGIN_PASSWORD;
if (!source || !username || !password)
  throw new Error("Configure GMOBS_SOURCE_URL, GMOBS_LOGIN_USER e GMOBS_LOGIN_PASSWORD no ambiente antes do backup.");

const origin = new URL(source).origin;
const sourceUrl = new URL(origin);
if (sourceUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(sourceUrl.hostname))
  throw new Error("A origem precisa usar HTTPS.");
const login = await fetch(`${origin}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username, password }),
});
if (!login.ok) throw new Error(`Não foi possível entrar na origem (${login.status}).`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("A origem não retornou a sessão.");

const keys = ["closing", "scans", "tde", "maex", "billed", "romaneios"];
const states = {};
for (const key of keys) {
  const response = await fetch(`${origin}/api/cloud-state?key=${key}`, {
    headers: { cookie }, cache: "no-store",
  });
  if (response.status === 204) {
    states[key] = { present: false };
    continue;
  }
  if (!response.ok) throw new Error(`Falha ao ler ${key} (${response.status}); nenhum backup foi gravado.`);
  const encoding = response.headers.get("x-gmobs-encoding");
  const payload = await response.text();
  const json = encoding === "gzip-base64"
    ? gunzipSync(Buffer.from(payload, "base64")).toString("utf8")
    : encoding === "json" ? payload : null;
  if (json === null) throw new Error(`Codificação desconhecida em ${key}.`);
  JSON.parse(json);
  states[key] = {
    present: true, encoding, payload,
    version: response.headers.get("x-gmobs-version") || "",
    sha256: createHash("sha256").update(payload).digest("hex"),
  };
  console.log(`${key}: lido e validado (${payload.length} caracteres).`);
}

for (const key of keys) {
  const response = await fetch(`${origin}/api/cloud-state?key=${key}`, {
    method: "HEAD", headers: { cookie }, cache: "no-store",
  });
  const before = states[key];
  if (response.status !== (before.present ? 200 : 204) ||
      (before.present && response.headers.get("x-gmobs-version") !== before.version))
    throw new Error(`O conjunto ${key} mudou durante o backup. Refaça a captura; nenhum arquivo incompleto foi salvo.`);
}

const backup = { product: "Fechamentos GMOBS - banco completo", version: 1,
  source: origin, exportedAt: new Date().toISOString(), states };
const defaultTarget = join(dirname(fileURLToPath(import.meta.url)), "../..",
  `backup-gmobs-d1-${new Date().toISOString().replaceAll(":", "-")}.json.gz`);
const target = resolve(process.argv[2] || defaultTarget);
await writeFile(target, gzipSync(JSON.stringify(backup)), { flag: "wx" });
console.log(`Backup completo salvo em ${target}`);
