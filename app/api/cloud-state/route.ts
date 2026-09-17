import { neon } from "@neondatabase/serverless";
import { authenticatedUsername } from "../../auth";

export const runtime = "nodejs";

const OWNER = "shared:fechamentos-gmobs";
const CHUNK_SIZE = 700_000;
const MAX_CHUNKS = 100;
const KEYS = new Set(["closing", "scans", "tde", "maex", "billed", "romaneios"]);
const ENCODINGS = new Set(["gzip-base64", "json"]);
let client: ReturnType<typeof neon> | undefined;
let uploadSchemaReady: Promise<void> | undefined;

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  return (client ??= neon(url));
}

function ensureUploadSchema() {
  uploadSchemaReady ??= (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await sql().query(`CREATE TABLE IF NOT EXISTS cloud_state_upload_chunks (
          owner_id TEXT NOT NULL, state_key TEXT NOT NULL, upload_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL, encoding TEXT NOT NULL, payload TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (owner_id, state_key, upload_id, chunk_index))`);
        return;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (attempt === 2 || (code !== "23505" && code !== "42P07")) throw error;
        // Another serverless instance may have created the table concurrently.
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  })().catch((error) => { uploadSchemaReady = undefined; throw error; });
  return uploadSchemaReady;
}

async function check(request: Request) {
  if (!(await authenticatedUsername(request)))
    return { response: Response.json({ error: "É necessário entrar no site." }, { status: 401 }) };
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!KEYS.has(key))
    return { response: Response.json({ error: "Tipo de dado inválido." }, { status: 400 }) };
  return { key };
}

function failure(error: unknown) {
  console.error("Falha ao acessar o estado no Neon", error);
  return Response.json({ error: "Não foi possível acessar os dados." }, { status: 500 });
}

export async function HEAD(request: Request) {
  const access = await check(request);
  if (access.response) return access.response;
  try {
    const rows = await sql().query(
      "SELECT version, encoding, length(payload) AS size FROM cloud_state_records WHERE owner_id = $1 AND state_key = $2",
      [OWNER, access.key],
    ) as Record<string, unknown>[];
    if (!rows.length) return new Response(null, { status: 204 });
    return new Response(null, { headers: {
      "cache-control": "no-store",
      "x-gmobs-version": String(rows[0].version),
      "x-gmobs-encoding": String(rows[0].encoding),
      "x-gmobs-chunks": String(Math.max(1, Math.ceil(Number(rows[0].size) / CHUNK_SIZE))),
    } });
  } catch (error) { return failure(error); }
}

export async function GET(request: Request) {
  const access = await check(request);
  if (access.response) return access.response;
  const url = new URL(request.url);
  const index = Number(url.searchParams.get("index"));
  if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS)
    return Response.json({ error: "Parte inválida." }, { status: 400 });
  try {
    const rows = await sql().query(
      "SELECT version, substr(payload, $3, $4) AS chunk FROM cloud_state_records WHERE owner_id = $1 AND state_key = $2",
      [OWNER, access.key, index * CHUNK_SIZE + 1, CHUNK_SIZE],
    ) as Record<string, unknown>[];
    if (!rows.length) return new Response(null, { status: 204 });
    if (url.searchParams.get("version") !== rows[0].version)
      return Response.json({ error: "Os dados mudaram durante a leitura. Tente novamente." }, { status: 409 });
    return new Response(String(rows[0].chunk), { headers: {
      "cache-control": "no-store", "content-type": "text/plain;charset=UTF-8",
    } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const access = await check(request);
  if (access.response) return access.response;
  const url = new URL(request.url);
  const uploadId = url.searchParams.get("upload") || "";
  const index = Number(url.searchParams.get("index"));
  const encoding = request.headers.get("x-gmobs-encoding") || "";
  if (!/^[0-9a-f-]{36}$/i.test(uploadId) || !Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS || !ENCODINGS.has(encoding))
    return Response.json({ error: "Envio inválido." }, { status: 400 });
  const chunk = await request.text();
  if (Array.from(chunk).length > CHUNK_SIZE)
    return Response.json({ error: "Parte excede o limite." }, { status: 413 });
  try {
    await ensureUploadSchema();
    await sql().query(
      `INSERT INTO cloud_state_upload_chunks (owner_id, state_key, upload_id, chunk_index, encoding, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (owner_id, state_key, upload_id, chunk_index)
       DO UPDATE SET encoding = EXCLUDED.encoding, payload = EXCLUDED.payload`,
      [OWNER, access.key, uploadId, index, encoding, chunk],
    );
    return new Response(null, { status: 204 });
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  const access = await check(request);
  if (access.response) return access.response;
  let input: { uploadId?: string; chunkCount?: number; encoding?: string };
  try { input = await request.json(); }
  catch { return Response.json({ error: "Confirmação inválida." }, { status: 400 }); }
  const { uploadId, chunkCount, encoding } = input;
  if (!uploadId || !/^[0-9a-f-]{36}$/i.test(uploadId) || !Number.isInteger(chunkCount) || !chunkCount || chunkCount > MAX_CHUNKS || !encoding || !ENCODINGS.has(encoding))
    return Response.json({ error: "Confirmação inválida." }, { status: 400 });
  try {
    await ensureUploadSchema();
    const rows = await sql().query(
      `INSERT INTO cloud_state_records (owner_id, state_key, version, encoding, payload, updated_at)
       SELECT $1, $2, $3, $4, string_agg(payload, '' ORDER BY chunk_index), $5
       FROM cloud_state_upload_chunks
       WHERE owner_id = $1 AND state_key = $2 AND upload_id = $3 AND encoding = $4
       HAVING count(*) = $6 AND min(chunk_index) = 0 AND max(chunk_index) = $6 - 1
       ON CONFLICT (owner_id, state_key)
       DO UPDATE SET version = EXCLUDED.version, encoding = EXCLUDED.encoding,
                     payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
       RETURNING version`,
      [OWNER, access.key, uploadId, encoding, new Date().toISOString(), chunkCount],
    ) as Record<string, unknown>[];
    if (!rows.length)
      return Response.json({ error: "Envio incompleto; os dados anteriores foram preservados." }, { status: 409 });
    await sql().query(
      "DELETE FROM cloud_state_upload_chunks WHERE owner_id = $1 AND state_key = $2 AND upload_id = $3",
      [OWNER, access.key, uploadId],
    );
    return Response.json({ saved: true, updatedAt: uploadId });
  } catch (error) { return failure(error); }
}
