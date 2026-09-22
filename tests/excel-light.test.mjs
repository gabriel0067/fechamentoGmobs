import assert from "node:assert/strict";
import test from "node:test";
import { commissionTotal, normalizeCnpj, normalizeInvoiceKey } from "../app/excel-light.ts";

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
