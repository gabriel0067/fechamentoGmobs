export type CloudStateKey =
  | "closing"
  | "scans"
  | "tde"
  | "maex"
  | "billed"
  | "romaneios";
export type CloudStateRecord<T> = { value: T; version: string };

type CloudEncoding = "gzip-base64" | "json";

const CLOUD_STATE_ENDPOINT = "/api/cloud-state";
const TRANSFER_CHUNK_SIZE = 700_000;

export function isHostedSite() {
  if (typeof window === "undefined") return false;
  return !["localhost", "127.0.0.1", "0.0.0.0"].includes(
    window.location.hostname,
  );
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + blockSize, bytes.length)),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encodeState(value: unknown): Promise<{
  encoding: CloudEncoding;
  payload: string;
}> {
  const json = JSON.stringify(value);
  if (typeof CompressionStream === "undefined")
    return { encoding: "json", payload: json };

  const compressed = await new Response(
    new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  return {
    encoding: "gzip-base64",
    payload: bytesToBase64(new Uint8Array(compressed)),
  };
}

async function decodeState<T>(encoding: CloudEncoding, payload: string) {
  let json = payload;
  if (encoding === "gzip-base64") {
    if (typeof DecompressionStream === "undefined")
      throw new Error("Este navegador não consegue abrir o backup compactado.");
    json = await new Response(
      new Blob([base64ToBytes(payload)])
        .stream()
        .pipeThrough(new DecompressionStream("gzip")),
    ).text();
  }
  return JSON.parse(json) as T;
}

function cloudError(response: Response) {
  if (response.status === 401)
    return new Error("Entre no site para acessar os dados salvos no banco.");
  return new Error("O banco não respondeu. Tente novamente antes de continuar.");
}

export async function loadCloudStateRecord<T>(stateKey: CloudStateKey) {
  const head = await fetch(
    `${CLOUD_STATE_ENDPOINT}?key=${encodeURIComponent(stateKey)}`,
    { method: "HEAD", cache: "no-store" },
  );
  if (head.status === 204) return undefined;
  if (!head.ok) throw cloudError(head);
  const encoding = head.headers.get("x-gmobs-encoding") as CloudEncoding;
  if (encoding !== "gzip-base64" && encoding !== "json")
    throw new Error("O banco retornou um formato de dados desconhecido.");
  const version = head.headers.get("x-gmobs-version") || "";
  const count = Number(head.headers.get("x-gmobs-chunks"));
  if (!version || !Number.isInteger(count) || count < 1 || count > 100)
    throw new Error("O banco retornou um tamanho inválido.");
  const chunks: string[] = [];
  for (let start = 0; start < count; start += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, count - start) }, async (_, offset) => {
        const response = await fetch(
          `${CLOUD_STATE_ENDPOINT}?key=${encodeURIComponent(stateKey)}&index=${start + offset}&version=${encodeURIComponent(version)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw cloudError(response);
        return response.text();
      }),
    );
    chunks.push(...batch);
  }
  return {
    value: await decodeState<T>(encoding, chunks.join("")),
    version,
  } satisfies CloudStateRecord<T>;
}

export async function loadCloudState<T>(stateKey: CloudStateKey) {
  return (await loadCloudStateRecord<T>(stateKey))?.value;
}

export async function getCloudStateVersion(stateKey: CloudStateKey) {
  const response = await fetch(
    `${CLOUD_STATE_ENDPOINT}?key=${encodeURIComponent(stateKey)}`,
    { method: "HEAD", cache: "no-store" },
  );
  if (response.status === 204) return undefined;
  if (!response.ok) throw cloudError(response);
  return response.headers.get("x-gmobs-version") || "";
}

export async function saveCloudState(
  stateKey: CloudStateKey,
  value: unknown,
) {
  const { encoding, payload } = await encodeState(value);
  const uploadId = crypto.randomUUID();
  const units = encoding === "json" ? Array.from(payload) : payload;
  const chunks: string[] = [];
  for (let offset = 0; offset < units.length; offset += TRANSFER_CHUNK_SIZE)
    chunks.push(encoding === "json"
      ? (units as string[]).slice(offset, offset + TRANSFER_CHUNK_SIZE).join("")
      : (units as string).slice(offset, offset + TRANSFER_CHUNK_SIZE));
  if (!chunks.length) chunks.push("");
  if (chunks.length > 100)
    throw new Error("O conjunto de dados excede o limite de transferência; não foi salvo.");
  for (let start = 0; start < chunks.length; start += 4) {
    await Promise.all(
      chunks.slice(start, start + 4).map(async (chunk, offset) => {
        const response = await fetch(
          `${CLOUD_STATE_ENDPOINT}?key=${encodeURIComponent(stateKey)}&upload=${uploadId}&index=${start + offset}`,
          { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8", "x-gmobs-encoding": encoding }, body: chunk },
        );
        if (!response.ok) throw cloudError(response);
      }),
    );
  }
  const response = await fetch(`${CLOUD_STATE_ENDPOINT}?key=${encodeURIComponent(stateKey)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploadId, chunkCount: chunks.length, encoding }),
  });
  if (!response.ok) throw cloudError(response);
  const result = (await response.json()) as { updatedAt?: string };
  return result.updatedAt || "";
}
