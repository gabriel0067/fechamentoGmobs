import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/romaneio-light.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const cjsModule = { exports: {} };
new Function("module", "exports", transpiled)(cjsModule, cjsModule.exports);
const {
  romaneioClosingInvoiceCount,
  romaneioFreightPartsTotal,
  romaneioFreightTotal,
} = cjsModule.exports;

test("não duplica um frete total repetido nas linhas do mesmo romaneio", () => {
  assert.equal(romaneioFreightTotal([100, 100]), 100);
  assert.equal(romaneioFreightTotal([23.45, 23.45, 23.45]), 23.45);
});

test("soma parcelas diferentes do frete", () => {
  assert.equal(romaneioFreightTotal([100, 50, 25.5]), 175.5);
});

test("uma versão nova da mesma parcela não altera a anterior", () => {
  assert.equal(
    romaneioFreightPartsTotal([
      { key: "M-100", value: 100 },
      { key: "M-100", value: 110 },
      { key: "M-200", value: 50 },
    ]),
    150,
  );
});

test("parcelas de documentos diferentes continuam sendo somadas", () => {
  assert.equal(
    romaneioFreightPartsTotal([
      { key: "M-100", value: 100 },
      { key: "M-200", value: 50 },
    ]),
    150,
  );
});

test("desconta somente os documentos marcados como volta do total de notas", () => {
  assert.equal(romaneioClosingInvoiceCount(8, 2), 6);
  assert.equal(romaneioClosingInvoiceCount(8, 0), 8);
});
