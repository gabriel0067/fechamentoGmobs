import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("sincronizacao separa relatorios grandes das operacoes frequentes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/cloud-state/route.ts", import.meta.url), "utf8");

  for (const key of ["closing-data", "closing-ops", "romaneio-data", "romaneio-ops"]) {
    assert.match(page, new RegExp(`useCloudStateSync\\(\\s*"${key}"`));
    assert.match(route, new RegExp(`"${key}"`));
  }
  assert.doesNotMatch(page, /useCloudStateSync\(\s*"closing"/);
  assert.doesNotMatch(page, /useCloudStateSync\(\s*"romaneios"/);
});

test("gravacao oficial e espelho sao confirmados pela mesma operacao atomica", async () => {
  const route = await readFile(new URL("../app/api/cloud-state/route.ts", import.meta.url), "utf8");
  assert.match(route, /CREATE TABLE IF NOT EXISTS cloud_state_shadow_records/);
  assert.match(route, /WITH saved AS \([\s\S]*INSERT INTO cloud_state_records/);
  assert.match(route, /mirrored AS \([\s\S]*INSERT INTO cloud_state_shadow_records/);
  assert.match(route, /SELECT version FROM mirrored/);
  assert.match(route, /current\.payload = shadow\.payload/);
});
