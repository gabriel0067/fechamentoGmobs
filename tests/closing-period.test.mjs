import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesMaexAdditionalCutoff,
  matchesNormalClosingPeriod,
} from "../app/closing-period.ts";

const entry = (overrides = {}) => ({
  date: "2026-08-15",
  deliveryDate: "2026-08-15",
  status: "ET",
  isRedelivery: false,
  ...overrides,
});

test("exclui entrega posterior à data final mesmo com emissão dentro", () => {
  assert.equal(
    matchesNormalClosingPeriod(
      entry({ deliveryDate: "2026-08-18" }),
      "2026-08-01",
      "2026-08-16",
    ),
    false,
  );
});

test("mantém emissão e entrega dentro do período", () => {
  assert.equal(
    matchesNormalClosingPeriod(
      entry(),
      "2026-08-01",
      "2026-08-16",
    ),
    true,
  );
});

test("exclui registro comum sem data de entrega quando há filtro", () => {
  assert.equal(
    matchesNormalClosingPeriod(
      entry({ deliveryDate: "" }),
      "2026-08-01",
      "2026-08-16",
    ),
    false,
  );
});

for (const exception of [
  { status: "RE", isRedelivery: true },
  { status: "CF" },
  { status: "OUTROS" },
]) {
  test(`mantém a exceção ${exception.status} sem data de entrega`, () => {
    assert.equal(
      matchesNormalClosingPeriod(
        entry({ ...exception, deliveryDate: "" }),
        "2026-08-01",
        "2026-08-16",
      ),
      true,
    );
  });
}

test("MAEX ADICIONAL usa somente a emissão até a data final", () => {
  assert.equal(
    matchesMaexAdditionalCutoff("2026-08-15", "2026-08-16"),
    true,
  );
  assert.equal(
    matchesMaexAdditionalCutoff("2026-08-18", "2026-08-16"),
    false,
  );
});
