import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeItemKey, encodeItemKey, encodeItemPayload } from "../app/cloud-item-codec.ts";

test("chaves e valores com NUL sobrevivem ao armazenamento em JSONB", () => {
  for (const key of ["normal", "Operador\u00000", 'gmobs:escaped:"normal"']) {
    const stored = encodeItemKey(key);
    assert.equal(stored.includes("\u0000"), false);
    assert.equal(decodeItemKey(stored), key);
  }
  const original = { names: ["Operador\u0000Turno"], "id\u00001": "preservado" };
  const stored = encodeItemPayload(original);
  assert.equal(stored.payload_encoded, true);
  assert.deepEqual(JSON.parse(stored.payload), original);
  assert.deepEqual(encodeItemPayload({ value: 42 }), { payload: { value: 42 }, payload_encoded: false });
});

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
  assert.match(route, /sql\(\)\.transaction/);
  assert.match(route, /WHERE cloud_state_live_v3\.status = 'preparing'/);
  assert.match(route, /state\.version = \$3 AND state\.status = 'preparing'/);
});
