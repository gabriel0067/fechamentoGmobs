import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { test } from "node:test";

test("backup inclui os seis conjuntos sem modificar a origem", async () => {
  const keys = ["closing", "scans", "tde", "maex", "billed", "romaneios"];
  const seen = [];
  const server = createServer((request, response) => {
    if (request.url === "/api/auth/login") {
      response.setHeader("set-cookie", "gmobs_session=test; HttpOnly");
      response.end('{"authenticated":true}');
      return;
    }
    const key = new URL(request.url, "http://localhost").searchParams.get("key");
    seen.push(`${request.method}:${key}`);
    assert.equal(request.headers.cookie, "gmobs_session=test");
    response.setHeader("x-gmobs-encoding", "gzip-base64");
    response.setHeader("x-gmobs-version", "v1");
    response.end(request.method === "HEAD" ? "" : gzipSync(JSON.stringify({ key })).toString("base64"));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const directory = await mkdtemp(join(tmpdir(), "gmobs-backup-test-"));
  try {
    const file = join(directory, "backup.json.gz");
    const address = server.address();
    const child = spawn(process.execPath, [resolve("scripts/backup-cloud-data.mjs"), file], {
      env: { ...process.env, GMOBS_SOURCE_URL: `http://127.0.0.1:${address.port}`,
        GMOBS_LOGIN_USER: "teste", GMOBS_LOGIN_PASSWORD: "teste" },
      cwd: resolve("."),
    });
    const exit = await new Promise((done) => child.on("exit", done));
    assert.equal(exit, 0);
    assert.deepEqual(seen, [...keys.map((key) => `GET:${key}`), ...keys.map((key) => `HEAD:${key}`)]);
    const backup = JSON.parse(gunzipSync(await readFile(file)).toString("utf8"));
    assert.deepEqual(Object.keys(backup.states), keys);
    for (const key of keys)
      assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(backup.states[key].payload, "base64"))), { key });
  } finally {
    server.close();
    await rm(join(directory, "backup.json.gz"), { force: true });
    await rmdir(directory);
  }
});
