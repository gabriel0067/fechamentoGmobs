type CodecRequest =
  | { id: number; action: "encode"; value: unknown }
  | { id: number; action: "decode"; encoding: "gzip-base64" | "json"; payload: string };

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

self.onmessage = async ({ data }: MessageEvent<CodecRequest>) => {
  const { id } = data;
  try {
    if (data.action === "encode") {
      const json = JSON.stringify(data.value);
      if (typeof CompressionStream === "undefined") {
        self.postMessage({ id, result: { encoding: "json", payload: json } });
        return;
      }
      const compressed = await new Response(
        new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer();
      self.postMessage({
        id,
        result: { encoding: "gzip-base64", payload: bytesToBase64(new Uint8Array(compressed)) },
      });
      return;
    }
    let json = data.payload;
    if (data.encoding === "gzip-base64") {
      if (typeof DecompressionStream === "undefined")
        throw new Error("Este navegador não consegue abrir o backup compactado.");
      json = await new Response(
        new Blob([base64ToBytes(data.payload)])
          .stream()
          .pipeThrough(new DecompressionStream("gzip")),
      ).text();
    }
    self.postMessage({ id, result: JSON.parse(json) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Falha ao processar os dados." });
  }
};
