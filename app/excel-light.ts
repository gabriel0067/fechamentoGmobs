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

export const uniqueFitlogExportRows = <T extends {
  cte: unknown;
  cteKey?: unknown;
  invoice: unknown;
  status?: unknown;
  date?: unknown;
  deliveryDate?: unknown;
  sender?: unknown;
  recipient?: unknown;
  observation?: unknown;
  freight?: unknown;
  reportedTotal?: unknown;
  tde?: unknown;
}>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const accessKey = String(row.cteKey ?? "").replace(/\D/g, "");
    const cte = String(row.cte ?? "").replace(/\D/g, "").replace(/^0+/, "");
    const invoice = normalizeInvoiceKey(row.invoice);
    const fallback = [row.sender, row.recipient]
      .map((value) => String(value ?? "").trim().toLocaleLowerCase("pt-BR"))
      .join("|");
    const documentKey = accessKey
      ? `chave:${accessKey}|nf:${invoice}`
      : cte
        ? `cte:${cte}|nf:${invoice}`
        : `nf:${invoice}|${fallback}`;
    const status = String(row.status ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    const isSeparateEvent = status === "re" || status === "cf";
    const eventDetails = isSeparateEvent
      ? [
          row.date,
          row.deliveryDate,
          row.sender,
          row.recipient,
          row.observation,
          row.reportedTotal ?? row.freight,
          row.tde,
        ]
          .map((value) => String(value ?? "").trim().toLocaleLowerCase("pt-BR"))
          .join("|")
      : "";
    // RE e CF são cobranças independentes da entrega original, mesmo quando
    // repetem CT-e e NF. Somente uma repetição completa do mesmo evento sai.
    const key = isSeparateEvent
      ? `evento:${status}|${documentKey}|${eventDetails}`
      : documentKey;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
