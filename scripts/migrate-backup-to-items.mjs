import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

const OWNER = "shared:fechamentos-gmobs";
const backupPath = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const apply = process.argv.includes("--apply");
const verifyOnly = process.argv.includes("--verify-only");
if (!backupPath) throw new Error("Informe o caminho do backup JSON.");
if ((apply || verifyOnly) && !process.env.DATABASE_URL)
  throw new Error("DATABASE_URL é obrigatória para usar --apply ou --verify-only.");

const backup = JSON.parse(await readFile(resolve(backupPath), "utf8"));
if (backup?.product !== "Fechamentos GMOBS" || backup?.version !== 1)
  throw new Error("O arquivo não é um backup completo reconhecido do GMOBS.");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value ?? null);
const itemIdentity = (value, index) => {
  const explicit = value && typeof value === "object" && (value.id || value.key);
  return explicit ? String(explicit) : `fallback:${index}:${sha256(json(value))}`;
};

function createCollector(stateKey) {
  const items = [];
  const identities = new Set();
  const add = (collection, itemKey, payload) => {
    const identity = `${collection}\u0000${itemKey}`;
    if (identities.has(identity))
      throw new Error(`${stateKey}: identidade repetida em ${collection}/${itemKey}.`);
    identities.add(identity);
    const serialized = json(payload);
    items.push({
      collection,
      item_key: String(itemKey),
      payload,
      item_hash: sha256(serialized),
    });
  };
  const array = (collection, values = []) => {
    if (!Array.isArray(values)) throw new Error(`${stateKey}.${collection} não é uma lista.`);
    values.forEach((value, index) => add(collection, itemIdentity(value, index), value));
  };
  const stringArray = (collection, values = []) => {
    if (!Array.isArray(values)) throw new Error(`${stateKey}.${collection} não é uma lista.`);
    values.forEach((value, index) => add(collection, `${String(value)}\u0000${index}`, value));
  };
  const map = (collection, values = {}) => {
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new Error(`${stateKey}.${collection} não é um objeto.`);
    Object.entries(values).forEach(([key, value]) => add(collection, key, value));
  };
  const singleton = (collection, value) => add(collection, "value", value ?? null);
  return { stateKey, items, array, stringArray, map, singleton };
}

function collectStates(source) {
  const states = [];
  {
    const state = createCollector("closing-data");
    state.array("entries", source.closing?.entries);
    state.array("referenceEntries", source.closing?.referenceEntries);
    state.singleton("importInfo", source.closing?.importInfo);
    states.push(state);
  }
  {
    const state = createCollector("closing-ops");
    state.array("covers", source.closing?.covers);
    state.stringArray("coverGenerators", source.closing?.coverGenerators);
    state.array("closingAdditionals", source.closing?.closingAdditionals);
    state.array("billingInvoices", source.closing?.billingInvoices);
    state.array("pickupRecords", source.closing?.pickupRecords);
    state.array("dedicatedRecords", source.closing?.dedicatedRecords);
    state.array("financialEntries", source.closing?.financialEntries);
    state.stringArray("financialAccountNames", source.closing?.financialAccountNames);
    states.push(state);
  }
  {
    const state = createCollector("scans");
    Object.entries(source.scans || {}).forEach(([partner, records]) =>
      state.map(`partner:${partner}`, records),
    );
    states.push(state);
  }
  {
    const state = createCollector("tde");
    state.array("rates", source.tde?.rates);
    state.singleton("importInfo", source.tde?.importInfo);
    states.push(state);
  }
  {
    const state = createCollector("maex");
    state.map("senders", source.maex);
    states.push(state);
  }
  {
    const state = createCollector("billed");
    state.map("documents", source.billed);
    states.push(state);
  }
  {
    const state = createCollector("romaneio-data");
    state.array("entries", source.romaneios?.entries);
    state.singleton("importInfo", source.romaneios?.importInfo);
    states.push(state);
  }
  {
    const state = createCollector("romaneio-ops");
    state.map("documentStatuses", source.romaneios?.documentStatuses);
    state.map("routeLabels", source.romaneios?.routeLabels);
    state.map("groupNotes", source.romaneios?.groupNotes);
    state.map("manualFreights", source.romaneios?.manualFreights);
    state.map("pickupQuantities", source.romaneios?.pickupQuantities);
    state.map("driverDiscountPlans", source.romaneios?.driverDiscountPlans);
    state.array("retainedHistory", source.romaneios?.retainedHistory);
    state.array("manualRomaneios", source.romaneios?.manualRomaneios);
    states.push(state);
  }
  return states;
}

const states = collectStates(backup);
const prepared = states.map((state) => {
  const encodedItems = state.items.map((item) => ({
    collection: item.collection,
    item_key_b64: Buffer.from(item.item_key, "utf8").toString("base64"),
    payload_text: json(item.payload),
    item_hash: item.item_hash,
  }));
  encodedItems.sort((left, right) =>
    left.collection.localeCompare(right.collection) ||
    left.item_key_b64.localeCompare(right.item_key_b64),
  );
  const checksum = createHash("md5")
    .update(encodedItems.map((item) => item.item_hash).sort().join(""))
    .digest("hex");
  return { stateKey: state.stateKey, items: encodedItems, checksum };
});

for (const state of prepared)
  console.log(`${state.stateKey}: ${state.items.length} itens · checksum ${state.checksum}`);

if (!apply && !verifyOnly) {
  console.log("Validação local concluída. Use --apply somente com a conexão Neon correta.");
  process.exit(0);
}

const sql = neon(process.env.DATABASE_URL);
if (verifyOnly) {
  const sourceVersion = `backup:${backup.exportedAt}`;
  for (const state of prepared) {
    const rows = await sql.query(
      `SELECT item_count, checksum
       FROM cloud_state_item_snapshots_v2
       WHERE owner_id = $1 AND state_key = $2 AND source_version = $3 AND status = 'complete'
       ORDER BY completed_at DESC
       LIMIT 1`,
      [OWNER, state.stateKey, sourceVersion],
    );
    const row = rows[0];
    if (Number(row?.item_count) !== state.items.length || row?.checksum !== state.checksum)
      throw new Error(`${state.stateKey}: snapshot completo não corresponde ao backup.`);
    console.log(`${state.stateKey}: verificação independente aprovada (${row.item_count} itens).`);
  }
  const legacy = await sql.query(
    `SELECT count(*)::integer AS state_count FROM cloud_state_records WHERE owner_id = $1`,
    [OWNER],
  );
  console.log(`Estrutura original preservada: ${legacy[0]?.state_count ?? 0} conjuntos ativos.`);
  process.exit(0);
}
await sql.query(`CREATE TABLE IF NOT EXISTS cloud_state_item_snapshots_v2 (
  owner_id TEXT NOT NULL,
  state_key TEXT NOT NULL,
  snapshot_id UUID NOT NULL,
  source_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preparing', 'complete')),
  item_count INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (owner_id, state_key, snapshot_id)
)`);
await sql.query(`CREATE TABLE IF NOT EXISTS cloud_state_items_v2 (
  owner_id TEXT NOT NULL,
  state_key TEXT NOT NULL,
  snapshot_id UUID NOT NULL,
  collection TEXT NOT NULL,
  item_key_b64 TEXT NOT NULL,
  payload_text TEXT NOT NULL,
  item_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, state_key, snapshot_id, collection, item_key_b64)
)`);
await sql.query(`CREATE INDEX IF NOT EXISTS cloud_state_items_v2_active_lookup
  ON cloud_state_items_v2 (owner_id, state_key, snapshot_id, collection)`);

for (const state of prepared) {
  const snapshotId = randomUUID();
  const sourceVersion = `backup:${backup.exportedAt}`;
  await sql.query(
    `INSERT INTO cloud_state_item_snapshots_v2
      (owner_id, state_key, snapshot_id, source_version, status)
     VALUES ($1, $2, $3, $4, 'preparing')`,
    [OWNER, state.stateKey, snapshotId, sourceVersion],
  );
  for (let offset = 0; offset < state.items.length; offset += 500) {
    const batch = state.items.slice(offset, offset + 500);
    await sql.query(
      `INSERT INTO cloud_state_items_v2
        (owner_id, state_key, snapshot_id, collection, item_key_b64, payload_text, item_hash)
       SELECT $1, $2, $3, item.collection, item.item_key_b64, item.payload_text, item.item_hash
       FROM jsonb_to_recordset($4::jsonb)
         AS item(collection TEXT, item_key_b64 TEXT, payload_text TEXT, item_hash TEXT)`,
      [OWNER, state.stateKey, snapshotId, JSON.stringify(batch)],
    );
  }
  const verification = await sql.query(
    `SELECT count(*)::integer AS item_count,
       md5(string_agg(item_hash, '' ORDER BY item_hash)) AS checksum
     FROM cloud_state_items_v2
     WHERE owner_id = $1 AND state_key = $2 AND snapshot_id = $3`,
    [OWNER, state.stateKey, snapshotId],
  );
  const row = verification[0];
  if (Number(row?.item_count) !== state.items.length || row?.checksum !== state.checksum)
    throw new Error(`${state.stateKey}: a conferência do Neon não corresponde ao backup; snapshot não ativado.`);
  await sql.query(
    `UPDATE cloud_state_item_snapshots_v2
     SET status = 'complete', item_count = $4, checksum = $5, completed_at = now()
     WHERE owner_id = $1 AND state_key = $2 AND snapshot_id = $3 AND status = 'preparing'`,
    [OWNER, state.stateKey, snapshotId, state.items.length, state.checksum],
  );
  console.log(`${state.stateKey}: snapshot paralelo conferido e concluído.`);
}

console.log("Migração paralela v2 concluída. cloud_state_records não foi alterada.");
