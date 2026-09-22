export const normalizeCnpj = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const expanded = /e[+-]?\d+$/i.test(raw.replace(",", "."))
    ? String(Math.trunc(Number(raw.replace(",", "."))))
    : raw;
  const digits = expanded.replace(/\D/g, "");
  if (!digits || digits.length > 14) return "";
  return digits.padStart(14, "0");
};

export const normalizeInvoiceKey = (value: unknown) => {
  const raw = String(value ?? "").trim();
  const withSeries = raw.match(
    /^0*(\d{3,})\s*(?:-|\/|\s+s[eé]rie\s+|\s+)\s*0*\d{1,2}\s*$/i,
  );
  const firstPart = withSeries?.[1] || raw;
  const digits = firstPart.replace(/\D/g, "").replace(/^0+/, "");
  return digits || (firstPart.includes("0") ? "0" : "");
};

export const commissionTotal = (row: {
  reportedTotal?: number;
  freight: number;
  tde: number;
}) => Math.max(0, (row.reportedTotal ?? row.freight) + row.tde);
