export const romaneioFreightTotal = (values: number[]) => {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!valid.length) return 0;
  const rounded = valid.map((value) => Math.round((value + Number.EPSILON) * 100));
  // Alguns relatórios repetem o frete total do romaneio em cada linha/cidade.
  // Quando todos os valores são idênticos, trata-se de um total repetido, não
  // de parcelas independentes. Valores diferentes continuam sendo somados.
  if (rounded.every((value) => value === rounded[0])) return rounded[0] / 100;
  return rounded.reduce((sum, value) => sum + value, 0) / 100;
};

export const romaneioClosingInvoiceCount = (
  countedInvoices: number,
  backDocuments: number,
) => countedInvoices - backDocuments;
