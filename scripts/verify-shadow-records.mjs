import { neon } from "@neondatabase/serverless";

const OWNER = "shared:fechamentos-gmobs";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
const sql = neon(process.env.DATABASE_URL);

await sql.query(`CREATE TABLE IF NOT EXISTS cloud_state_shadow_records (
  owner_id TEXT NOT NULL, state_key TEXT NOT NULL, version TEXT NOT NULL,
  encoding TEXT NOT NULL, payload TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, state_key))`);
await sql.query(`INSERT INTO cloud_state_shadow_records
  (owner_id, state_key, version, encoding, payload, updated_at)
  SELECT owner_id, state_key, version, encoding, payload, updated_at::timestamptz
  FROM cloud_state_records
  WHERE owner_id = $1
  ON CONFLICT (owner_id, state_key) DO NOTHING`, [OWNER]);

const rows = await sql.query(`SELECT current.state_key,
    current.version = shadow.version
      AND current.encoding = shadow.encoding
      AND current.payload = shadow.payload AS matches
  FROM cloud_state_records current
  LEFT JOIN cloud_state_shadow_records shadow
    ON shadow.owner_id = current.owner_id AND shadow.state_key = current.state_key
  WHERE current.owner_id = $1
  ORDER BY current.state_key`, [OWNER]);

for (const row of rows) console.log(`${row.state_key}: ${row.matches ? "idêntico" : "divergente"}`);
if (rows.length !== 10 || rows.some((row) => !row.matches))
  throw new Error("O espelho inicial não corresponde aos 10 conjuntos oficiais.");
console.log("Gravação dupla pronta: 10 de 10 conjuntos idênticos.");
