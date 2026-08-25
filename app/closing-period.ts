type ClosingPeriodEntry = {
  date: string;
  deliveryDate: string;
  status: string;
  isRedelivery: boolean;
};

const normalizedStatus = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const isWithinSelectedPeriod = (
  value: string,
  dateFrom: string,
  dateTo: string,
) => {
  if (!dateFrom && !dateTo) return true;
  if (!value) return false;
  return (!dateFrom || value >= dateFrom) && (!dateTo || value <= dateTo);
};

export const ignoresDeliveryDateFilter = (entry: ClosingPeriodEntry) => {
  const status = normalizedStatus(entry.status);
  return (
    entry.isRedelivery ||
    ["re", "reentrega", "cf", "outros", "complemento de frete"].includes(
      status,
    )
  );
};

export const matchesNormalClosingPeriod = (
  entry: ClosingPeriodEntry,
  dateFrom: string,
  dateTo: string,
) =>
  isWithinSelectedPeriod(entry.date, dateFrom, dateTo) &&
  (ignoresDeliveryDateFilter(entry) ||
    isWithinSelectedPeriod(entry.deliveryDate, dateFrom, dateTo));

export const matchesMaexAdditionalCutoff = (
  emissionDate: string,
  dateTo: string,
) => !dateTo || Boolean(emissionDate && emissionDate <= dateTo);
