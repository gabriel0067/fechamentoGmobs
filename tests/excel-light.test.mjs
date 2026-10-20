import assert from "node:assert/strict";
import test from "node:test";
import {
  commissionTotal,
  normalizeCnpj,
  normalizeInvoiceKey,
  uniqueClosingExportRows,
  uniqueFitlogExportRows,
} from "../app/excel-light.ts";

test("normalização leve mantém CNPJ com zeros à esquerda", () => {
  assert.equal(normalizeCnpj("6127582000905"), "06127582000905");
});

test("normalização leve mantém base da NF sem série", () => {
  assert.equal(normalizeInvoiceKey("000123456 série 1"), "123456");
});

test("total do fechamento permanece BA mais TDE", () => {
  assert.equal(commissionTotal({ freight: 100, tde: 15 }), 115);
  assert.equal(commissionTotal({ freight: 100, reportedTotal: 80, tde: 15 }), 95);
});

test("Fitlog exporta uma única linha por CT-e e NF", () => {
  const rows = [
    { cte: "501067", invoice: "3326215 - 2", sender: "A", recipient: "B" },
    { cte: "501067", invoice: "3326215 - 2", sender: "A", recipient: "B" },
    { cte: "501068", invoice: "3326215 - 2", sender: "A", recipient: "B" },
  ];
  assert.deepEqual(uniqueFitlogExportRows(rows), [rows[0], rows[2]]);
});

test("Fitlog preserva reentrega e complemento do mesmo CT-e e NF", () => {
  const rows = [
    { cte: "501067", invoice: "3326215 - 2", status: "ET", freight: 100 },
    { cte: "501067", invoice: "3326215 - 2", status: "RE", freight: 100 },
    { cte: "501067", invoice: "3326215 - 2", status: "CF", freight: 400 },
    { cte: "501067", invoice: "3326215 - 2", status: "CF", freight: 400 },
  ];
  assert.deepEqual(uniqueFitlogExportRows(rows), rows.slice(0, 3));
});

test("todas as parceiras removem repetição do mesmo CT-e e NF", () => {
  const rows = [
    { cte: "700100", invoice: "12345 - 1", status: "ET", freight: 100 },
    { cte: "700100", invoice: "12345 - 1", status: "ET", freight: 100 },
    { cte: "700101", invoice: "12345 - 1", status: "ET", freight: 100 },
  ];
  assert.deepEqual(uniqueClosingExportRows(rows), [rows[0], rows[2]]);
});

test("regra geral preserva reentrega, complemento e adicional legítimos", () => {
  const rows = [
    { cte: "700100", invoice: "12345 - 1", status: "ET", freight: 100 },
    { cte: "700100", invoice: "12345 - 1", status: "RE", freight: 100 },
    { cte: "700100", invoice: "12345 - 1", status: "CF", freight: 300 },
    { cte: "700100", invoice: "12345 - 1", status: "AD-TDE", freight: 0, tde: 45 },
  ];
  assert.deepEqual(uniqueClosingExportRows(rows), rows);
});
