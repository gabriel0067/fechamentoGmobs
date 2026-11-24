import { gunzipSync } from "node:zlib";
import { neon } from "@neondatabase/serverless";
import { authenticatedUsername } from "../../auth";

export const runtime = "nodejs";

const OWNER = "shared:fechamentos-gmobs";
const ITEM_KEYS = new Set(["closing-ops", "romaneio-ops"]);
let client: ReturnType<typeof neon> | undefined;
let schemaReady: Promise<void> | undefined;

const shapes: Record<string, Record<string, "array" | "map" | "string-array">> = {
  "closing-ops": {
    covers: "array", coverGenerators: "string-array", closingAdditionals: "array",
    billingInvoices: "array", pickupRecords: "array", dedicatedRecords: "array",
    financialEntries: "array", financialAccountNames: "string-array",
  },
  "romaneio-ops": {
    documentStatuses: "map", routeLabels: "map", groupNotes: "map",
    manualFreights: "map", pickupQuantities: "map", driverDiscountPlans: "map",
    retainedHistory: "array", manualRomaneios: "array",
  },
};

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  return (client ??= neon(url));
}

function ensureSchema() {
  schemaReady ??= (async () => {
    await sql().query(`CREATE TABLE IF NOT EXISTS cloud_state_live_v3 (
      owner_id TEXT NOT NULL, state_key TEXT NOT NULL, version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('preparing', 'ready')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, state_key))`);
    await sql().query(`CREATE TABLE IF NOT EXISTS cloud_state_live_items_v3 (
      owner_id TEXT NOT NULL, state_key TEXT NOT NULL, collection TEXT NOT NULL,
      item_key TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
      payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, state_key, collection, item_key))`);
    await sql().query(`CREATE TABLE IF NOT EXISTS cloud_state_activation_backups_v3 (
      owner_id TEXT NOT NULL, backup_id TEXT NOT NULL, state_key TEXT NOT NULL,
      version TEXT NOT NULL, encoding TEXT NOT NULL, payload TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, backup_id, state_key))`);
    await sql().query("ALTER TABLE cloud_state_live_v3 ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready'");
    await sql().query("ALTER TABLE cloud_state_live_items_v3 ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0");
    await sql().query(`CREATE INDEX IF NOT EXISTS cloud_state_live_items_v3_lookup
      ON cloud_state_live_items_v3 (owner_id, state_key, collection)`);
    await sql().query(`INSERT INTO cloud_state_activation_backups_v3
        (owner_id, backup_id, state_key, version, encoding, payload)
      SELECT owner_id, 'pre-live-v3-2026-11-23', state_key, version, encoding, payload
      FROM cloud_state_records WHERE owner_id = $1
      ON CONFLICT (owner_id, backup_id, state_key) DO NOTHING`, [OWNER]);
  })().catch((error) => { schemaReady = undefined; throw error; });
  return schemaReady;
}

function decodeLegacy(encoding: string, payload: string) {
  const json = encoding === "gzip-base64"
    ? gunzipSync(Buffer.from(payload, "base64")).toString("utf8")
    : payload;
  return JSON.parse(json) as Record<string, unknown>;
}

function arrayIdentity(value: unknown, index: number) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  return String(record?.id || record?.key || `fallback:${index}:${JSON.stringify(value)}`);
}

function flatten(stateKey: string, value: Record<string, unknown>) {
  const rows: { collection: string; item_key: string; position: number; payload: unknown }[] = [];
  for (const [collection, kind] of Object.entries(shapes[stateKey])) {
    const current = value?.[collection];
    if (kind === "map") {
      for (const [item_key, payload] of Object.entries(
        current && typeof current === "object" && !Array.isArray(current) ? current : {},
      )) rows.push({ collection, item_key, position: 0, payload });
    } else {
      const list = Array.isArray(current) ? current : [];
      list.forEach((payload, index) => rows.push({
        collection,
        item_key: kind === "string-array" ? `${String(payload)}\u0000${index}` : arrayIdentity(payload, index),
        position: index,
        payload,
      }));
    }
  }
  return rows;
}

async function ensureSeeded(stateKey: string) {
  let existing = await sql().query(
    "SELECT version, status FROM cloud_state_live_v3 WHERE owner_id = $1 AND state_key = $2",
    [OWNER, stateKey],
  ) as { version: string; status: string }[];
  if (existing[0]?.status === "ready") return existing[0].version;
  if (existing[0]?.status === "preparing") {
    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      existing = await sql().query(
        "SELECT version, status FROM cloud_state_live_v3 WHERE owner_id = $1 AND state_key = $2",
        [OWNER, stateKey],
      ) as { version: string; status: string }[];
      if (existing[0]?.status === "ready") return existing[0].version;
    }
    throw new Error(`A preparação de ${stateKey} ainda não terminou.`);
  }
  const legacy = await sql().query(
    "SELECT version, encoding, payload FROM cloud_state_records WHERE owner_id = $1 AND state_key = $2",
    [OWNER, stateKey],
  ) as { version: string; encoding: string; payload: string }[];
  if (!legacy.length) return "";
  const version = `v3:${legacy[0].version}`;
  const inserted = await sql().query(
    `INSERT INTO cloud_state_live_v3 (owner_id, state_key, version, status)
     VALUES ($1, $2, $3, 'preparing') ON CONFLICT DO NOTHING RETURNING version`,
    [OWNER, stateKey, `preparing:${crypto.randomUUID()}`],
  ) as { version: string }[];
  if (inserted.length) {
    const rows = flatten(stateKey, decodeLegacy(legacy[0].encoding, legacy[0].payload));
    for (let offset = 0; offset < rows.length; offset += 500) {
      await sql().query(
        `INSERT INTO cloud_state_live_items_v3
          (owner_id, state_key, collection, item_key, position, payload)
         SELECT $1, $2, row.collection, row.item_key, row.position, row.payload
         FROM jsonb_to_recordset($3::jsonb)
           AS row(collection TEXT, item_key TEXT, position INTEGER, payload JSONB)
         ON CONFLICT (owner_id, state_key, collection, item_key)
         DO NOTHING`,
        [OWNER, stateKey, JSON.stringify(rows.slice(offset, offset + 500))],
      );
    }
    await sql().query(
      `UPDATE cloud_state_live_v3 SET version = $3, status = 'ready', updated_at = now()
       WHERE owner_id = $1 AND state_key = $2 AND status = 'preparing'`,
      [OWNER, stateKey, version],
    );
  } else {
    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const concurrent = await sql().query(
        "SELECT version FROM cloud_state_live_v3 WHERE owner_id = $1 AND state_key = $2 AND status = 'ready'",
        [OWNER, stateKey],
      ) as { version: string }[];
      if (concurrent.length) return concurrent[0].version;
    }
    throw new Error(`A preparação concorrente de ${stateKey} ainda não terminou.`);
  }
  const ready = await sql().query(
    "SELECT version FROM cloud_state_live_v3 WHERE owner_id = $1 AND state_key = $2 AND status = 'ready'",
    [OWNER, stateKey],
  ) as { version: string }[];
  return ready[0]?.version || "";
}

async function authorize(request: Request) {
  if (!(await authenticatedUsername(request)))
    return { response: Response.json({ error: "É necessário entrar no site." }, { status: 401 }) };
  const stateKey = new URL(request.url).searchParams.get("key") || "";
  if (!ITEM_KEYS.has(stateKey))
    return { response: Response.json({ error: "Tipo de dado inválido." }, { status: 400 }) };
  return { stateKey };
}

function failure(error: unknown) {
  console.error("Falha ao acessar os registros individuais", error);
  return Response.json({ error: "Não foi possível acessar os dados." }, { status: 500 });
}

export async function HEAD(request: Request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  try {
    await ensureSchema();
    const version = await ensureSeeded(access.stateKey);
    if (!version) return new Response(null, { status: 204 });
    return new Response(null, { headers: { "cache-control": "no-store", "x-gmobs-version": version } });
  } catch (error) { return failure(error); }
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("status") === "1") {
    if (!(await authenticatedUsername(request)))
      return Response.json({ error: "É necessário entrar no site." }, { status: 401 });
    try {
      await ensureSchema();
      const rows = await sql().query(`SELECT
        (SELECT count(*) FROM cloud_state_records WHERE owner_id = $1) AS official_states,
        (SELECT count(*) FROM cloud_state_activation_backups_v3 WHERE owner_id = $1 AND backup_id = 'pre-live-v3-2026-11-23') AS backup_states,
        (SELECT count(*) FROM cloud_state_live_v3 WHERE owner_id = $1 AND status = 'ready') AS live_states,
        (SELECT count(*) FROM cloud_state_live_items_v3 WHERE owner_id = $1) AS live_items`, [OWNER]) as Record<string, unknown>[];
      return Response.json(rows[0], { headers: { "cache-control": "no-store" } });
    } catch (error) { return failure(error); }
  }
  if (new URL(request.url).searchParams.get("versions") === "1") {
    if (!(await authenticatedUsername(request)))
      return Response.json({ error: "É necessário entrar no site." }, { status: 401 });
    try {
      await ensureSchema();
      for (const key of ITEM_KEYS) await ensureSeeded(key);
      const rows = await sql().query(
        "SELECT state_key, version FROM cloud_state_live_v3 WHERE owner_id = $1 AND state_key = ANY($2::text[]) AND status = 'ready'",
        [OWNER, [...ITEM_KEYS]],
      ) as { state_key: string; version: string }[];
      return Response.json(Object.fromEntries(rows.map((row) => [row.state_key, row.version])),
        { headers: { "cache-control": "no-store" } });
    } catch (error) { return failure(error); }
  }
  const access = await authorize(request);
  if (access.response) return access.response;
  try {
    await ensureSchema();
    const version = await ensureSeeded(access.stateKey);
    if (!version) return new Response(null, { status: 204 });
    const rows = await sql().query(
      `SELECT collection, item_key, position, payload
       FROM cloud_state_live_items_v3
       WHERE owner_id = $1 AND state_key = $2
       ORDER BY collection, position, item_key`,
      [OWNER, access.stateKey],
    ) as { collection: string; item_key: string; payload: unknown }[];
    const value: Record<string, unknown> = {};
    for (const [collection, kind] of Object.entries(shapes[access.stateKey]))
      value[collection] = kind === "map" ? {} : [];
    for (const row of rows) {
      if (shapes[access.stateKey][row.collection] === "map")
        (value[row.collection] as Record<string, unknown>)[row.item_key] = row.payload;
      else (value[row.collection] as unknown[]).push(row.payload);
    }
    return Response.json({ value, version }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  let input: { expectedVersion?: string; version?: string; changes?: { collection: string; itemKey: string; position?: number; value?: unknown; deleted?: boolean }[] };
  try { input = await request.json(); } catch { return Response.json({ error: "Alteração inválida." }, { status: 400 }); }
  if (!input.expectedVersion || !input.version || !Array.isArray(input.changes) || input.changes.length > 20_000)
    return Response.json({ error: "Alteração inválida." }, { status: 400 });
  const changes = input.changes.filter((change) => shapes[access.stateKey][change.collection] && change.itemKey);
  if (changes.length !== input.changes.length)
    return Response.json({ error: "Alteração inválida." }, { status: 400 });
  try {
    await ensureSchema();
    await ensureSeeded(access.stateKey);
    const rows = await sql().query(
      `WITH accepted AS (
         UPDATE cloud_state_live_v3 SET version = $4, updated_at = now()
         WHERE owner_id = $1 AND state_key = $2 AND version = $3 AND status = 'ready'
         RETURNING version
       ), removed AS (
         DELETE FROM cloud_state_live_items_v3 item
         USING accepted, jsonb_to_recordset($5::jsonb)
           AS change(collection TEXT, item_key TEXT, position INTEGER, deleted BOOLEAN, payload JSONB)
         WHERE change.deleted IS TRUE AND item.owner_id = $1 AND item.state_key = $2
           AND item.collection = change.collection AND item.item_key = change.item_key
       ), saved AS (
         INSERT INTO cloud_state_live_items_v3
           (owner_id, state_key, collection, item_key, position, payload)
         SELECT $1, $2, change.collection, change.item_key, coalesce(change.position, 0), change.payload
         FROM accepted, jsonb_to_recordset($5::jsonb)
           AS change(collection TEXT, item_key TEXT, position INTEGER, deleted BOOLEAN, payload JSONB)
         WHERE change.deleted IS NOT TRUE
         ON CONFLICT (owner_id, state_key, collection, item_key)
         DO UPDATE SET position = EXCLUDED.position, payload = EXCLUDED.payload, updated_at = now()
       ) SELECT version FROM accepted`,
      [OWNER, access.stateKey, input.expectedVersion, input.version,
       JSON.stringify(changes.map((change) => ({ collection: change.collection, item_key: change.itemKey, position: change.position || 0, deleted: !!change.deleted, payload: change.deleted ? null : change.value })))],
    ) as { version: string }[];
    if (!rows.length)
      return Response.json({ error: "Os dados foram alterados por outra pessoa. Nenhum registro foi substituído." }, { status: 409 });
    return Response.json({ version: rows[0].version });
  } catch (error) { return failure(error); }
}
