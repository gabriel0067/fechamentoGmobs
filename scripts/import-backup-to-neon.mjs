import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const file = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!file || !databaseUrl)
  throw new Error("Informe o arquivo .json.gz e configure DATABASE_URL no ambiente.");
const backup = JSON.parse(gunzipSync(await readFile(file)).toString("utf8"));
const keys = ["closing", "scans", "tde", "maex", "billed", "romaneios"];
if (backup.product !== "Fechamentos GMOBS - banco completo" || backup.version !== 1 ||
    !keys.every((key) => backup.states?.[key]))
  throw new Error("Backup incompleto ou não reconhecido.");

for (const key of keys) {
  const record = backup.states[key];
  if (!record.present) continue;
  if (!["gzip-base64", "json"].includes(record.encoding) ||
      createHash("sha256").update(record.payload).digest("hex") !== record.sha256)
    throw new Error(`Integridade inválida em ${key}.`);
  const json = record.encoding === "gzip-base64"
    ? gunzipSync(Buffer.from(record.payload, "base64")).toString("utf8")
    : record.payload;
  JSON.parse(json);
}

const sql = neon(databaseUrl);
await sql.query(`CREATE TABLE IF NOT EXISTS cloud_state_records (
  owner_id TEXT NOT NULL, state_key TEXT NOT NULL, version TEXT NOT NULL,
  encoding TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, state_key))`);
const owner = "shared:fechamentos-gmobs";
const existing = await sql.query(
  "SELECT state_key, md5(payload) AS checksum FROM cloud_state_records WHERE owner_id = $1", [owner],
);
for (const row of existing) {
  const record = backup.states[row.state_key];
  if (!record?.present || row.checksum !== createHash("md5").update(record.payload).digest("hex"))
    throw new Error("O banco Neon contém dados diferentes. Importação interrompida para não sobrescrever nada.");
}

for (const key of keys) {
  const record = backup.states[key];
  if (!record.present) continue;
  const version = record.version || new Date().toISOString();
  await sql.query(
    `INSERT INTO cloud_state_records (owner_id, state_key, version, encoding, payload, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    [owner, key, version, record.encoding, record.payload, backup.exportedAt],
  );
  const rows = await sql.query(
    "SELECT md5(payload) AS checksum, length(payload) AS size FROM cloud_state_records WHERE owner_id = $1 AND state_key = $2",
    [owner, key],
  );
  const expected = createHash("md5").update(record.payload).digest("hex");
  if (rows[0]?.checksum !== expected || Number(rows[0]?.size) !== record.payload.length)
    throw new Error(`Falha na conferência de ${key}; não publique o novo site.`);
  console.log(`${key}: presente e conferido.`);
}
console.log("Cópia validada no Neon. O site antigo continua sem alterações.");
