export type CloudStateKey =
  | "closing"
  | "scans"
  | "tde"
  | "maex"
  | "billed"
  | "romaneios";
export type CloudStateRecord<T> = { value: T; version: string };
export type CloudSaveResult<T> = { value: T; version: string; reconciled: boolean };

type CloudEncoding = "gzip-base64" | "json";

const CLOUD_STATE_ENDPOINT = "/api/cloud-state";
const TRANSFER_CHUNK_SIZE = 700_000;

let codecWorker: Worker | null = null;
let nextCodecRequestId = 0;
const codecRequests = new Map<number, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}>();

function runCodecWorker<T>(request: Record<string, unknown>): Promise<T> | null {
  if (typeof Worker === "undefined") return null;
  try {
    if (!codecWorker) {
      codecWorker = new Worker(new URL("./cloud-codec.worker.ts", import.meta.url), { type: "module" });
      codecWorker.onmessage = ({ data }: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
        const pending = codecRequests.get(data.id);
        if (!pending) return;
        codecRequests.delete(data.id);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.result);
      };
      codecWorker.onerror = () => {
        codecWorker?.terminate();
        codecWorker = null;
        codecRequests.forEach(({ reject }) => reject(new Error("Falha ao processar os dados em segundo plano.")));
        codecRequests.clear();
      };
    }
    const id = ++nextCodecRequestId;
    return new Promise<T>((resolve, reject) => {
      codecRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      try {
        codecWorker?.postMessage({ ...request, id });
      } catch (error) {
        codecRequests.delete(id);
        reject(error instanceof Error ? error : new Error("Falha ao enviar os dados para segundo plano."));
      }
    });
  } catch {
    codecWorker?.terminate();
    codecWorker = null;
    return null;
  }
}

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
  const background = runCodecWorker<{ encoding: CloudEncoding; payload: string }>({ action: "encode", value });
  if (background) {
    try { return await background; } catch { /* Compatibilidade: usa a linha principal. */ }
  }
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
  const background = runCodecWorker<T>({ action: "decode", encoding, payload });
  if (background) {
    try { return await background; } catch { /* Compatibilidade: usa a linha principal. */ }
  }
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

export class CloudStateConflictError extends Error {}

const sameValue = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export function mergeConcurrentValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (sameValue(local, base)) return remote;
  if (sameValue(remote, base)) return local;
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const identity = (item: unknown) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return String(record.id || record.key || "");
    };
    if ([...base, ...local, ...remote].every((item) => identity(item))) {
      const baseMap = new Map(base.map((item) => [identity(item), item]));
      const localMap = new Map(local.map((item) => [identity(item), item]));
      const remoteMap = new Map(remote.map((item) => [identity(item), item]));
      const merged: unknown[] = [];
      for (const key of new Set([...baseMap.keys(), ...remoteMap.keys(), ...localMap.keys()])) {
        const baseItem = baseMap.get(key);
        const localItem = localMap.get(key);
        const remoteItem = remoteMap.get(key);
        if (baseItem !== undefined && localItem === undefined) continue;
        if (localItem === undefined) { if (remoteItem !== undefined) merged.push(remoteItem); continue; }
        if (remoteItem === undefined) { merged.push(localItem); continue; }
        merged.push(mergeConcurrentValue(baseItem, localItem, remoteItem));
      }
      return merged;
    }
    return [...new Set([...remote, ...local].map((item) => JSON.stringify(item)))].map((item) => JSON.parse(item));
  }
  if (base && local && remote && typeof base === "object" && typeof local === "object" && typeof remote === "object") {
    const baseRecord = base as Record<string, unknown>;
    const localRecord = local as Record<string, unknown>;
    const remoteRecord = remote as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(baseRecord), ...Object.keys(remoteRecord), ...Object.keys(localRecord)])) {
      if (key in baseRecord && !(key in localRecord)) continue;
      if (!(key in localRecord)) { if (key in remoteRecord) result[key] = remoteRecord[key]; continue; }
      if (!(key in remoteRecord)) { result[key] = localRecord[key]; continue; }
      result[key] = mergeConcurrentValue(baseRecord[key], localRecord[key], remoteRecord[key]);
    }
    return result;
  }
  return local;
}

export async function getCloudStateVersions(): Promise<Partial<Record<CloudStateKey, string>>> {
  const response = await fetch(`${CLOUD_STATE_ENDPOINT}?versions=1`, { cache: "no-store" });
  if (!response.ok) throw cloudError(response);
  return response.json();
}

export async function saveCloudState(
  stateKey: CloudStateKey,
  value: unknown,
  expectedVersion: string,
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
    body: JSON.stringify({ uploadId, chunkCount: chunks.length, encoding, expectedVersion }),
  });
  if (response.status === 409)
    throw new CloudStateConflictError("Outra pessoa alterou os dados durante a gravação.");
  if (!response.ok) throw cloudError(response);
  const result = (await response.json()) as { updatedAt?: string };
  return result.updatedAt || "";
}

export async function saveCloudStateReconciled<T>(
  stateKey: CloudStateKey,
  value: T,
  expectedVersion: string,
  baseValue: T,
): Promise<CloudSaveResult<T>> {
  try {
    return { value, version: await saveCloudState(stateKey, value, expectedVersion), reconciled: false };
  } catch (error) {
    if (!(error instanceof CloudStateConflictError)) throw error;
    const remote = await loadCloudStateRecord<T>(stateKey);
    if (!remote) throw error;
    const merged = mergeConcurrentValue(baseValue, value, remote.value) as T;
    const version = await saveCloudState(stateKey, merged, remote.version);
    return { value: merged, version, reconciled: true };
  }
}
