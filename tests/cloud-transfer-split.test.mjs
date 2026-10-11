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
