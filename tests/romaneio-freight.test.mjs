import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/romaneio-light.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const cjsModule = { exports: {} };
new Function("module", "exports", transpiled)(cjsModule, cjsModule.exports);
const {
  driverDailyReportTotals,
  romaneioClosingInvoiceCount,
  romaneioFreightPartsTotal,
  romaneioFreightTotal,
} = cjsModule.exports;

test("soma as diárias quando o total da quinzena não foi informado", () => {
  const days = [{ paidAmount: 150.5 }, { paidAmount: 175.25 }];
  const discounts = [{ amount: 20 }];
  assert.deepEqual(driverDailyReportTotals({ days, discounts, manualDiscount: 5 }), {
    grossTotal: 325.75, discountTotal: 25, netTotal: 300.75,
  });
  assert.deepEqual(driverDailyReportTotals({ days, discounts, totalPaid: 400 }), {
    grossTotal: 400, discountTotal: 20, netTotal: 380,
  });
  assert.equal(driverDailyReportTotals({ days, totalPaid: 0 }).grossTotal, 0);
});

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

test("não desconta volta duas vezes quando ela já ficou fora das notas contadas", () => {
  assert.equal(romaneioClosingInvoiceCount(8, 2), 8);
  assert.equal(romaneioClosingInvoiceCount(8, 0), 8);
});
