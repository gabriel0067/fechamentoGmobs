import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

test("a reconciliacao preserva adicoes distintas e exclusoes locais", async () => {
  const source = await readFile(new URL("../app/cloud-storage.ts", import.meta.url), "utf8");
  const helper = source.match(/const sameValue[\s\S]*?\n}\n\nexport async function saveCloudState/)?.[0]
    ?.replace(/\nexport async function saveCloudState[\s\S]*/, "");
  assert.ok(helper, "função de reconciliação não encontrada");
  const javascript = ts.transpileModule(`${helper}\nexport { mergeConcurrentValue };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", javascript)(module, module.exports);
  const merge = module.exports.mergeConcurrentValue;
  const base = { statuses: { a: { key: "a", situation: "delivered" } }, covers: [{ id: "1", name: "antiga" }] };
  const local = { statuses: {}, covers: [{ id: "1", name: "antiga" }, { id: "2", name: "local" }] };
  const remote = { statuses: { a: { key: "a", situation: "delivered" }, b: { key: "b", situation: "return" } }, covers: [{ id: "1", name: "antiga" }, { id: "3", name: "remota" }] };
  assert.deepEqual(merge(base, local, remote), {
    statuses: { b: { key: "b", situation: "return" } },
    covers: [{ id: "1", name: "antiga" }, { id: "3", name: "remota" }, { id: "2", name: "local" }],
  });
});
