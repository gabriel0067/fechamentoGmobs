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
  const response = await fetch(
    `${CLOUD_STATE_ENDPOINT}?key=${encodeURIComponent(stateKey)}`,
    { cache: "no-store" },
  );
  if (response.status === 204) return undefined;
  if (!response.ok) throw cloudError(response);
  const encoding = response.headers.get("x-gmobs-encoding") as CloudEncoding;
  if (encoding !== "gzip-base64" && encoding !== "json")
    throw new Error("O banco retornou um formato de dados desconhecido.");
  return {
    value: await decodeState<T>(encoding, await response.text()),
    version: response.headers.get("x-gmobs-version") || "",
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
  const response = await fetch(
    `${CLOUD_STATE_ENDPOINT}?key=${encodeURIComponent(stateKey)}`,
    {
      method: "PUT",
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        "x-gmobs-encoding": encoding,
      },
      body: payload,
    },
  );
  if (!response.ok) throw cloudError(response);
  const result = (await response.json()) as { updatedAt?: string };
  return result.updatedAt || "";
}
