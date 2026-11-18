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

test("gravacao confirma somente o registro oficial e preserva o espelho historico", async () => {
  const route = await readFile(new URL("../app/api/cloud-state/route.ts", import.meta.url), "utf8");
  const put = route.slice(route.indexOf("export async function PUT"));
  assert.match(put, /INSERT INTO cloud_state_records/);
  assert.match(put, /RETURNING version/);
  assert.doesNotMatch(put, /INSERT INTO cloud_state_shadow_records/);
  assert.doesNotMatch(route.slice(0, route.indexOf("export async function HEAD")), /cloud_state_shadow_records/);
  assert.match(route, /current\.payload = shadow\.payload/);
});

test("falha temporaria mantem a alteracao pendente e agenda nova tentativa", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /catch \(error\) \{[\s\S]*pendingSaveRef\.current = true/);
  assert.match(page, /saveRetryDelayRef\.current = Math\.min\(retryDelay \* 2, 60_000\)/);
  assert.match(page, /window\.setTimeout\(runSave, retryDelay\)/);
});
