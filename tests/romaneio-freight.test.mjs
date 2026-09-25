import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/romaneio-light.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const cjsModule = { exports: {} };
new Function("module", "exports", transpiled)(cjsModule, cjsModule.exports);
const { romaneioFreightTotal } = cjsModule.exports;

test("não duplica um frete total repetido nas linhas do mesmo romaneio", () => {
  assert.equal(romaneioFreightTotal([100, 100]), 100);
  assert.equal(romaneioFreightTotal([23.45, 23.45, 23.45]), 23.45);
});

test("soma parcelas diferentes do frete", () => {
  assert.equal(romaneioFreightTotal([100, 50, 25.5]), 175.5);
});
