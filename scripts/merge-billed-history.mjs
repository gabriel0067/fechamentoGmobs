import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";

const [oldPath, latestPath, outputPath] = process.argv.slice(2);
if (!oldPath || !latestPath || !outputPath || new Set([oldPath, latestPath, outputPath]).size !== 3)
  throw new Error("Informe os backups antigo e atual e um arquivo de saída diferente.");

const keys = ["closing", "scans", "tde", "maex", "billed", "romaneios"];
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
async function load(path) {
  const backup = JSON.parse(gunzipSync(await readFile(path)).toString("utf8"));
  if (backup.product !== "Fechamentos GMOBS - banco completo" || backup.version !== 1 ||
      !keys.every((key) => backup.states?.[key]?.present))
    throw new Error("Backup incompleto ou não reconhecido.");
  const decoded = {};
  for (const key of keys) {
    const record = backup.states[key];
    if (digest(record.payload) !== record.sha256) throw new Error(`Integridade inválida em ${key}.`);
    const json = record.encoding === "gzip-base64"
      ? gunzipSync(Buffer.from(record.payload, "base64")).toString("utf8")
      : record.encoding === "json" ? record.payload : null;
    if (json === null) throw new Error(`Codificação inválida em ${key}.`);
    decoded[key] = JSON.parse(json);
  }
  return { backup, decoded };
}

const old = await load(oldPath);
const latest = await load(latestPath);
if (old.backup.source !== latest.backup.source ||
    new Date(old.backup.exportedAt) >= new Date(latest.backup.exportedAt))
  throw new Error("Os backups não são da mesma origem ou estão fora de ordem.");

const oldBilled = old.decoded.billed;
const latestBilled = latest.decoded.billed;
if (Array.isArray(oldBilled) || Array.isArray(latestBilled) ||
    typeof oldBilled !== "object" || typeof latestBilled !== "object" ||
    oldBilled === null || latestBilled === null)
  throw new Error("Formato do histórico de faturamento inesperado.");

const restored = Object.fromEntries(
  Object.entries(oldBilled).filter(([key]) => !Object.hasOwn(latestBilled, key)),
);
const combined = { ...latestBilled, ...restored };
if (Object.keys(combined).length !== Object.keys(latestBilled).length + Object.keys(restored).length)
  throw new Error("Falha ao conferir o histórico combinado.");

const json = JSON.stringify(combined);
const encoding = latest.backup.states.billed.encoding;
const payload = encoding === "gzip-base64"
  ? gzipSync(json).toString("base64")
  : encoding === "json" ? json : null;
if (payload === null) throw new Error("Codificação do histórico não reconhecida.");

const merged = {
  ...latest.backup,
  preparedAt: new Date().toISOString(),
  mergeInfo: {
    kind: "restore-missing-billed-records-only",
    oldBackupSha256: digest(await readFile(oldPath)),
    latestBackupSha256: digest(await readFile(latestPath)),
    latestCount: Object.keys(latestBilled).length,
    restoredCount: Object.keys(restored).length,
    combinedCount: Object.keys(combined).length,
  },
  states: {
    ...latest.backup.states,
    billed: {
      ...latest.backup.states.billed,
      payload,
      version: randomUUID(),
      sha256: digest(payload),
    },
  },
};
await writeFile(outputPath, gzipSync(JSON.stringify(merged)), { flag: "wx" });
console.log(`Histórico atual: ${merged.mergeInfo.latestCount}`);
console.log(`Registros antigos ausentes recuperados: ${merged.mergeInfo.restoredCount}`);
console.log(`Histórico combinado: ${merged.mergeInfo.combinedCount}`);
console.log("Os demais cinco conjuntos vieram integralmente do backup mais recente.");
console.log(`Nova cópia combinada: ${outputPath}`);
