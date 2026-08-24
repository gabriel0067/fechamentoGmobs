import { env } from "cloudflare:workers";
import { authenticatedUsername } from "../../auth";

const ALLOWED_STATE_KEYS = new Set([
  "closing",
  "scans",
  "tde",
  "maex",
  "billed",
]);
const ALLOWED_ENCODINGS = new Set(["gzip-base64", "json"]);
const CHUNK_SIZE = 1_500_000;
const MAX_PAYLOAD_SIZE = 60_000_000;

let schemaReady: Promise<unknown> | null = null;

function ensureSchema() {
  schemaReady ??= env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS cloud_state_chunks (
        owner_id TEXT NOT NULL,
        state_key TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        encoding TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, state_key, chunk_index)
      )
    `),
    env.DB.prepare("PRAGMA optimize"),
  ]).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

async function ownerId(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname))
    return "local-development";
  return (await authenticatedUsername(request))
    ? "shared:fechamentos-gmobs"
    : null;
}

function requestedStateKey(request: Request) {
  const stateKey = new URL(request.url).searchParams.get("key") || "";
  return ALLOWED_STATE_KEYS.has(stateKey) ? stateKey : null;
}

function unauthorized() {
  return Response.json(
    { error: "É necessário entrar no site para acessar estes dados." },
    { status: 401 },
  );
}

function versionHeaders(updatedAt: string) {
  return {
    "cache-control": "no-store",
    "last-modified": new Date(updatedAt).toUTCString(),
    "x-gmobs-version": updatedAt,
  };
}

async function migrateLegacyState(stateKey: string) {
  const sharedExists = await env.DB.prepare(
    `SELECT 1
     FROM cloud_state_chunks
     WHERE owner_id = ? AND state_key = ?
     LIMIT 1`,
  )
    .bind("shared:fechamentos-gmobs", stateKey)
    .first();
  if (sharedExists) return;

  const legacy = await env.DB.prepare(
    `SELECT owner_id
     FROM cloud_state_chunks
     WHERE owner_id NOT IN (?, ?) AND state_key = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
  )
    .bind("shared:fechamentos-gmobs", "local-development", stateKey)
    .first<{ owner_id: string }>();
  if (!legacy?.owner_id) return;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO cloud_state_chunks
       (owner_id, state_key, chunk_index, encoding, payload, updated_at)
     SELECT ?, state_key, chunk_index, encoding, payload, updated_at
     FROM cloud_state_chunks
     WHERE owner_id = ? AND state_key = ?`,
  )
    .bind("shared:fechamentos-gmobs", legacy.owner_id, stateKey)
    .run();
}

export async function HEAD(request: Request) {
  const owner = await ownerId(request);
  if (!owner) return unauthorized();
  const stateKey = requestedStateKey(request);
  if (!stateKey)
    return Response.json({ error: "Tipo de dado inválido." }, { status: 400 });

  try {
    await ensureSchema();
    if (owner === "shared:fechamentos-gmobs")
      await migrateLegacyState(stateKey);
    const row = await env.DB.prepare(
      `SELECT updated_at
       FROM cloud_state_chunks
       WHERE owner_id = ? AND state_key = ?
       ORDER BY chunk_index
       LIMIT 1`,
    )
      .bind(owner, stateKey)
      .first<{ updated_at: string }>();
    if (!row) return new Response(null, { status: 204 });
    return new Response(null, { status: 200, headers: versionHeaders(row.updated_at) });
  } catch (error) {
    console.error("Falha ao consultar versão do estado do GMOBS", error);
    return Response.json({ error: "Não foi possível consultar os dados." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const owner = await ownerId(request);
  if (!owner) return unauthorized();
  const stateKey = requestedStateKey(request);
  if (!stateKey)
    return Response.json({ error: "Tipo de dado inválido." }, { status: 400 });

  try {
    await ensureSchema();
    if (owner === "shared:fechamentos-gmobs")
      await migrateLegacyState(stateKey);
    const result = await env.DB.prepare(
      `SELECT encoding, payload, updated_at
       FROM cloud_state_chunks
       WHERE owner_id = ? AND state_key = ?
       ORDER BY chunk_index`,
    )
      .bind(owner, stateKey)
      .all<{ encoding: string; payload: string; updated_at: string }>();
    if (!result.results.length) return new Response(null, { status: 204 });

    return new Response(result.results.map((row) => row.payload).join(""), {
      headers: {
        ...versionHeaders(result.results[0].updated_at),
        "content-type": "text/plain;charset=UTF-8",
        "x-gmobs-encoding": result.results[0].encoding,
      },
    });
  } catch (error) {
    console.error("Falha ao carregar estado do GMOBS", error);
    return Response.json({ error: "Não foi possível carregar os dados." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const owner = await ownerId(request);
  if (!owner) return unauthorized();
  const stateKey = requestedStateKey(request);
  if (!stateKey)
    return Response.json({ error: "Tipo de dado inválido." }, { status: 400 });

  const encoding = request.headers.get("x-gmobs-encoding") || "";
  if (!ALLOWED_ENCODINGS.has(encoding))
    return Response.json({ error: "Codificação inválida." }, { status: 400 });

  const payload = await request.text();
  if (payload.length > MAX_PAYLOAD_SIZE)
    return Response.json({ error: "Os dados excedem o limite de segurança." }, { status: 413 });

  try {
    await ensureSchema();
    const updatedAt = new Date().toISOString();
    const chunks: string[] = [];
    for (let offset = 0; offset < payload.length; offset += CHUNK_SIZE)
      chunks.push(payload.slice(offset, offset + CHUNK_SIZE));
    if (!chunks.length) chunks.push("");

    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM cloud_state_chunks WHERE owner_id = ? AND state_key = ?",
      ).bind(owner, stateKey),
      ...chunks.map((chunk, chunkIndex) =>
        env.DB.prepare(
          `INSERT INTO cloud_state_chunks
             (owner_id, state_key, chunk_index, encoding, payload, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(owner, stateKey, chunkIndex, encoding, chunk, updatedAt),
      ),
    ]);

    return Response.json({ saved: true, chunks: chunks.length, updatedAt });
  } catch (error) {
    console.error("Falha ao salvar estado do GMOBS", error);
    return Response.json({ error: "Não foi possível salvar os dados." }, { status: 500 });
  }
}
