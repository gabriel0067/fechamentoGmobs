import { gzipSync, gunzipSync } from "node:zlib";
import { neon } from "@neondatabase/serverless";
import { authenticatedUsername } from "../../auth";
import { decodeItemKey, encodeItemKey, encodeItemPayload } from "../../cloud-item-codec";

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
    await sql().query("ALTER TABLE cloud_state_live_items_v3 ADD COLUMN IF NOT EXISTS payload_encoded BOOLEAN NOT NULL DEFAULT false");
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
  const existing = await sql().query(
    "SELECT version, status FROM cloud_state_live_v3 WHERE owner_id = $1 AND state_key = $2",
    [OWNER, stateKey],
  ) as { version: string; status: string }[];
  if (existing[0]?.status === "ready") return existing[0].version;
  const legacy = await sql().query(
    "SELECT version, encoding, payload FROM cloud_state_records WHERE owner_id = $1 AND state_key = $2",
    [OWNER, stateKey],
  ) as { version: string; encoding: string; payload: string }[];
  if (!legacy.length) return "";
  const version = `v3:${legacy[0].version}`;
  const attempt = `preparing:${crypto.randomUUID()}`;
  const rows = flatten(stateKey, decodeLegacy(legacy[0].encoding, legacy[0].payload))
    .map((row) => ({ ...row, item_key: encodeItemKey(row.item_key), ...encodeItemPayload(row.payload) }));
  // The claim, replacement of incomplete rows, and activation commit together.
  await sql().transaction((tx) => {
    const queries = [
      tx.query(
        `INSERT INTO cloud_state_live_v3 (owner_id, state_key, version, status)
         VALUES ($1, $2, $3, 'preparing')
         ON CONFLICT (owner_id, state_key) DO UPDATE SET version = EXCLUDED.version
         WHERE cloud_state_live_v3.status = 'preparing'`,
        [OWNER, stateKey, attempt],
      ),
      tx.query(
        `DELETE FROM cloud_state_live_items_v3 item USING cloud_state_live_v3 state
         WHERE item.owner_id = $1 AND item.state_key = $2
           AND state.owner_id = $1 AND state.state_key = $2
           AND state.version = $3 AND state.status = 'preparing'`,
        [OWNER, stateKey, attempt],
      ),
    ];
    for (let offset = 0; offset < rows.length; offset += 500) {
      queries.push(tx.query(
        `INSERT INTO cloud_state_live_items_v3
           (owner_id, state_key, collection, item_key, position, payload, payload_encoded)
         SELECT $1, $2, row.collection, row.item_key, row.position, row.payload, row.payload_encoded
         FROM cloud_state_live_v3 state, jsonb_to_recordset($4::jsonb)
           AS row(collection TEXT, item_key TEXT, position INTEGER, payload JSONB, payload_encoded BOOLEAN)
         WHERE state.owner_id = $1 AND state.state_key = $2
           AND state.version = $3 AND state.status = 'preparing'
         ON CONFLICT (owner_id, state_key, collection, item_key) DO NOTHING`,
        [OWNER, stateKey, attempt, JSON.stringify(rows.slice(offset, offset + 500))],
      ));
    }
    queries.push(tx.query(
      `UPDATE cloud_state_live_v3 SET version = $4, status = 'ready', updated_at = now()
       WHERE owner_id = $1 AND state_key = $2 AND version = $3 AND status = 'preparing'`,
      [OWNER, stateKey, attempt, version],
    ));
    return queries;
  });
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
      `SELECT collection, item_key, position, payload, payload_encoded
       FROM cloud_state_live_items_v3
       WHERE owner_id = $1 AND state_key = $2
       ORDER BY collection, position, item_key`,
      [OWNER, access.stateKey],
    ) as { collection: string; item_key: string; payload: unknown; payload_encoded: boolean }[];
    const value: Record<string, unknown> = {};
    for (const [collection, kind] of Object.entries(shapes[access.stateKey]))
      value[collection] = kind === "map" ? {} : [];
    for (const row of rows) {
      const payload = row.payload_encoded ? JSON.parse(String(row.payload)) : row.payload;
      if (shapes[access.stateKey][row.collection] === "map")
        (value[row.collection] as Record<string, unknown>)[decodeItemKey(row.item_key)] = payload;
      else (value[row.collection] as unknown[]).push(payload);
    }
    if (request.headers.get("accept-encoding")?.includes("gzip")) {
      const body = gzipSync(JSON.stringify({ value, version }));
      return new Response(new Uint8Array(body), { headers: {
        "cache-control": "no-store", "content-type": "application/json",
        "content-encoding": "gzip", vary: "Accept-Encoding",
      } });
    }
    return Response.json({ value, version }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  let input: { expectedVersion?: string; version?: string; changes?: { collection: string; itemKey: string; position?: number; value?: unknown; deleted?: boolean; move?: boolean }[] };
  try {
    const encoding = request.headers.get("x-gmobs-encoding");
    input = encoding === "gzip-base64"
      ? decodeLegacy(encoding, await request.text()) as typeof input
      : await request.json();
  } catch { return Response.json({ error: "Alteração inválida." }, { status: 400 }); }
  if (!input.expectedVersion || !input.version || !Array.isArray(input.changes) || input.changes.length > 20_000)
    return Response.json({ error: "Alteração inválida." }, { status: 400 });
  const changes = input.changes.filter((change) =>
    change && Object.hasOwn(shapes[access.stateKey], change.collection) &&
    typeof change.itemKey === "string" && change.itemKey &&
    (change.deleted === true || change.move === true || Object.hasOwn(change, "value")));
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
       ), moved AS (
         UPDATE cloud_state_live_items_v3 item SET position = change.position
         FROM accepted, jsonb_to_recordset($5::jsonb)
           AS change(collection TEXT, item_key TEXT, position INTEGER, move BOOLEAN, deleted BOOLEAN)
         WHERE change.move IS TRUE AND change.deleted IS NOT TRUE
           AND item.owner_id = $1 AND item.state_key = $2
           AND item.collection = change.collection AND item.item_key = change.item_key
       ), removed AS (
         DELETE FROM cloud_state_live_items_v3 item
         USING accepted, jsonb_to_recordset($5::jsonb)
           AS change(collection TEXT, item_key TEXT, position INTEGER, deleted BOOLEAN, payload JSONB)
         WHERE change.deleted IS TRUE AND item.owner_id = $1 AND item.state_key = $2
           AND item.collection = change.collection AND item.item_key = change.item_key
       ), saved AS (
         INSERT INTO cloud_state_live_items_v3
           (owner_id, state_key, collection, item_key, position, payload, payload_encoded)
         SELECT $1, $2, change.collection, change.item_key, coalesce(change.position, 0), change.payload, change.payload_encoded
         FROM accepted, jsonb_to_recordset($5::jsonb)
           AS change(collection TEXT, item_key TEXT, position INTEGER, deleted BOOLEAN, move BOOLEAN, payload JSONB, payload_encoded BOOLEAN)
         WHERE change.deleted IS NOT TRUE AND change.move IS NOT TRUE
         ON CONFLICT (owner_id, state_key, collection, item_key)
         DO UPDATE SET position = EXCLUDED.position, payload = EXCLUDED.payload,
           payload_encoded = EXCLUDED.payload_encoded, updated_at = now()
       ) SELECT version FROM accepted`,
      [OWNER, access.stateKey, input.expectedVersion, input.version,
       JSON.stringify(changes.map((change) => ({
         collection: change.collection, item_key: encodeItemKey(change.itemKey), position: change.position || 0,
         deleted: !!change.deleted, move: !!change.move,
         ...encodeItemPayload(change.deleted || change.move ? null : change.value),
       })))],
    ) as { version: string }[];
    if (!rows.length)
      return Response.json({ error: "Os dados foram alterados por outra pessoa. Nenhum registro foi substituído." }, { status: 409 });
    return Response.json({ version: rows[0].version });
  } catch (error) { return failure(error); }
}
