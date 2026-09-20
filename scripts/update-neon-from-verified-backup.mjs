import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const [previousFile, latestFile, replacementFile] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (!previousFile || !latestFile || !replacementFile || !databaseUrl)
  throw new Error("Informe os três backups e a conexão do Neon.");

const owner = "shared:fechamentos-gmobs";
const keys = ["closing", "scans", "tde", "maex", "billed", "romaneios"];
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function md5(value) {
  return createHash("md5").update(value).digest("hex");
}
async function load(file) {
  const bytes = await readFile(file);
  const backup = JSON.parse(gunzipSync(bytes).toString("utf8"));
  if (backup.product !== "Fechamentos GMOBS - banco completo" || backup.version !== 1 ||
      !keys.every((key) => backup.states?.[key]?.present))
    throw new Error("Backup incompleto ou não reconhecido.");
  const decoded = {};
  for (const key of keys) {
    const record = backup.states[key];
    if (sha256(record.payload) !== record.sha256)
      throw new Error(`Integridade inválida em ${key}.`);
    const json = record.encoding === "gzip-base64"
      ? gunzipSync(Buffer.from(record.payload, "base64")).toString("utf8")
      : record.encoding === "json" ? record.payload : null;
    if (json === null) throw new Error(`Codificação inválida em ${key}.`);
    decoded[key] = JSON.parse(json);
  }
  return { backup, hash: sha256(bytes), decoded };
}

const previous = await load(previousFile);
const latest = await load(latestFile);
const replacement = await load(replacementFile);
if (previous.backup.source !== latest.backup.source ||
    latest.backup.source !== replacement.backup.source ||
    new Date(previous.backup.exportedAt) >= new Date(latest.backup.exportedAt) ||
    replacement.backup.mergeInfo?.oldBackupSha256 !== previous.hash ||
    replacement.backup.mergeInfo?.latestBackupSha256 !== latest.hash ||
    replacement.backup.mergeInfo?.kind !== "restore-missing-billed-records-only")
  throw new Error("A cópia combinada não corresponde ao backup antigo esperado.");
for (const key of keys.filter((key) => key !== "billed")) {
  if (replacement.backup.states[key].payload !== latest.backup.states[key].payload)
    throw new Error(`A cópia combinada alterou indevidamente ${key}.`);
}
const oldBilled = previous.decoded.billed;
const latestBilled = latest.decoded.billed;
const combinedBilled = replacement.decoded.billed;
const expectedBilled = { ...latestBilled,
  ...Object.fromEntries(Object.entries(oldBilled).filter(([key]) => !Object.hasOwn(latestBilled, key))) };
if (JSON.stringify(combinedBilled) !== JSON.stringify(expectedBilled))
  throw new Error("O histórico combinado não é exatamente a união segura dos dois backups.");

const sql = neon(databaseUrl);
const existing = await sql.query(
  "SELECT state_key, md5(payload) AS checksum FROM cloud_state_records WHERE owner_id = $1",
  [owner],
);
const byKey = new Map(existing.map((row) => [row.state_key, row.checksum]));
if (keys.every((key) => byKey.get(key) === md5(replacement.backup.states[key].payload))) {
  console.log("O Neon já contém exatamente a cópia combinada. Nenhuma alteração necessária.");
  process.exit(0);
}
if (byKey.size !== keys.length ||
    !keys.every((key) => byKey.get(key) === md5(previous.backup.states[key].payload)))
  throw new Error("O Neon contém dados diferentes do backup anterior. Nada foi substituído.");

await sql.query(`CREATE TABLE IF NOT EXISTS cloud_state_migration_snapshots (
  snapshot_id TEXT NOT NULL, owner_id TEXT NOT NULL, state_key TEXT NOT NULL,
  version TEXT NOT NULL, encoding TEXT NOT NULL, payload TEXT NOT NULL,
  updated_at TEXT NOT NULL, archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, owner_id, state_key))`);

const snapshotId = `before-merge-${previous.hash}`;
const queries = [];
for (const key of keys) {
  queries.push(sql.query(
    `INSERT INTO cloud_state_migration_snapshots
       (snapshot_id, owner_id, state_key, version, encoding, payload, updated_at)
     SELECT $1, owner_id, state_key, version, encoding, payload, updated_at
       FROM cloud_state_records
      WHERE owner_id = $2 AND state_key = $3 AND md5(payload) = $4
     ON CONFLICT (snapshot_id, owner_id, state_key) DO NOTHING`,
    [snapshotId, owner, key, md5(previous.backup.states[key].payload)],
  ));
}
for (const key of keys) {
  const record = replacement.backup.states[key];
  queries.push(sql.query(
    `UPDATE cloud_state_records
        SET version = $1, encoding = $2, payload = $3, updated_at = $4
      WHERE owner_id = $5 AND state_key = $6 AND md5(payload) = $7`,
    [record.version, record.encoding, record.payload,
      replacement.backup.exportedAt, owner, key,
      md5(previous.backup.states[key].payload)],
  ));
}
queries.push(sql.query(
  `SELECT CASE WHEN count(*) = $2 THEN 1
     ELSE 1 / (count(*) - count(*)) END AS verified
     FROM cloud_state_records r
     JOIN (VALUES ${keys.map((_, index) => `($${index * 2 + 3}, $${index * 2 + 4})`).join(", ")}) AS expected(state_key, checksum)
       ON r.state_key = expected.state_key AND md5(r.payload) = expected.checksum
    WHERE r.owner_id = $1`,
  [owner, keys.length, ...keys.flatMap((key) => [key, md5(replacement.backup.states[key].payload)])],
));

await sql.transaction(queries);
const confirmed = await sql.query(
  `SELECT state_key, md5(payload) AS checksum FROM cloud_state_records WHERE owner_id = $1`,
  [owner],
);
if (!keys.every((key) => confirmed.some((row) => row.state_key === key &&
    row.checksum === md5(replacement.backup.states[key].payload))))
  throw new Error("A conferência final falhou; não use o novo site até investigação.");
console.log("Seis conjuntos conferidos no Neon após a atualização atômica.");
console.log("O estado anterior também foi arquivado no próprio Neon.");
console.log("O site antigo não foi alterado.");
