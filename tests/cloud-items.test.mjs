import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("a gravacao individual envia somente o registro operacional alterado", async () => {
  const source = await readFile(new URL("../app/cloud-storage.ts", import.meta.url), "utf8");
  assert.match(source, /ITEM_STATE_KEYS.*closing-ops.*romaneio-ops/s);
  assert.match(source, /function itemChanges/);
  assert.match(source, /if \(!previous \|\| previous\.position !== item\.position \|\| !sameValue\(previous\.value, item\.value\)\)/);
  assert.match(source, /if \(!after\.has\(key\)\).*deleted: true/);
});

test("a API aplica alteracoes somente se a versao esperada ainda for atual", async () => {
  const route = await readFile(new URL("../app/api/cloud-items/route.ts", import.meta.url), "utf8");
  assert.match(route, /version = \$3 AND status = 'ready'/);
  assert.match(route, /WITH accepted AS/);
  assert.match(route, /FROM accepted, jsonb_to_recordset/);
  assert.match(route, /Nenhum registro foi substituído/);
});

test("a migracao individual parte do estado oficial sem apaga-lo", async () => {
  const route = await readFile(new URL("../app/api/cloud-items/route.ts", import.meta.url), "utf8");
  assert.match(route, /SELECT version, encoding, payload FROM cloud_state_records/);
  assert.doesNotMatch(route, /DELETE FROM cloud_state_records|TRUNCATE TABLE cloud_state_records/);
  assert.match(route, /status = 'ready'/);
});
