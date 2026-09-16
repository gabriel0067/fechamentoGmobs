"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  getCloudStateVersion,
  isHostedSite,
  loadCloudStateRecord,
  saveCloudState,
  type CloudStateKey,
} from "./cloud-storage";
import {
  commissionTotal,
  exportClosingXlsx,
  exportCoverDetailedPdf,
  exportCoverPdf,
  exportCoversReportXlsx,
  exportBillingPdf,
  exportFinancialPdf,
  exportDriverClosingPdf,
  exportMaexAdditionalXlsx,
  exportPajussaraMissingXlsx,
  normalizeCnpj,
  normalizeInvoiceKey,
  readBilledClosingFile,
  readClosingFile,
  readPajussaraClosingFile,
  readRomaneioFile,
  readTdeFile,
  type ImportedRomaneioRow,
  type DriverClosingDay,
  type DriverClosingDiscount,
  type DriverClosingExport,
  type CoverExport,
  type CoverDocumentExport,
  type PajussaraClosingDocument,
} from "./excel";
import {
  matchesMaexAdditionalCutoff,
  matchesNormalClosingPeriod,
} from "./closing-period";
import {
  BILLED_STORAGE_KEY,
  CLOSING_STORAGE_KEY,
  readBilledStorage,
  readClosingStorage,
  writeBilledStorage,
  writeClosingStorage,
  readCloudStateCache,
  writeCloudStateCache,
} from "./storage";

type Tab = "import" | "romaneios" | "covers" | "preview" | "export" | "adjustments" | "billing" | "collections" | "dedicated";
type CloudStatus = "local" | "loading" | "ready" | "saving" | "error";
type AuthStatus = "checking" | "signedIn" | "signedOut";
const cloudStatusText: Record<CloudStatus, string> = {
  local: "Dados salvos neste computador",
  loading: "Carregando dados do banco...",
  ready: "Dados salvos no banco",
  saving: "Gravando no banco...",
  error: "Banco indisponível · trabalho bloqueado",
};
type Entry = {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerRaw: string;
  partnerCnpj: string;
  status: string;
  date: string;
  deliveryDate: string;
  mde: string;
  cte: string;
  cteKey: string;
  invoice: string;
  sender: string;
  senderCnpj: string;
  recipient: string;
  recipientCnpj: string;
  city: string;
  observation: string;
  weight: number;
  volumes: number;
  merchandiseValue?: number;
  freight: number;
  partnerFreight: number;
  tde: number;
  tda: number;
  trt: number;
  redelivery: number;
  dedicated: number;
  adjustment: number;
  isRedelivery: boolean;
  reportedTotal?: number;
  sourceTde?: number;
  romaneioDocumentKey?: string;
  romaneioSourceStatus?: string;
  romaneioSavedAt?: string;
};
type RomaneioReferenceEntry = Entry & {
  sourceStatus: string;
  sourceEligible: boolean;
};
type ImportInfo = {
  file: string;
  imported: number;
  redeliveries: number;
  unidentified: number;
  excluded: number;
  duplicates?: number;
  latestEmissionDate?: string;
};
type CoverKind = "shipment" | "return" | "collection";
type ScanRecord = string | { scannedAt: string; scannedBy: string };
type TdeRateRecord = {
  id: string;
  clientName: string;
  cnpj: string;
  partnerId: string;
  partnerName: string;
  value: number;
  source: "file" | "manual";
};
type TdeImportInfo = {
  file: string;
  clients: number;
  rates: number;
};
type RomaneioEntry = ImportedRomaneioRow & {
  id: string;
  sourceFile: string;
};
type RomaneioImportedTotals = {
  freight: number;
  weight: number;
  deliveries: number;
  volumes: number;
};
type RomaneioImportInfo = {
  files: string[];
  imported: number;
  romaneios: number;
  importedAt: string;
  duplicates?: number;
};
type RomaneioSituation =
  | "delivered"
  | "back"
  | "return"
  | "retained"
  | "not-followed"
  | "driver-missing";
type RomaneioDocumentStatusRecord = {
  key: string;
  document: string;
  referenceType: "MD-e" | "CT-e" | "Documento";
  referenceNumber: string;
  situation: RomaneioSituation;
  sourceStatus?: string;
  operationalStatus?: "ET" | "OC";
  reason: string;
  savedAt: string;
  savedBy?: string;
  day: string;
  driver: string;
  romaneios: string[];
  routes: string[];
  sender: string;
  recipient: string;
  city: string;
  mde: string;
  cte: string;
  invoice: string;
  grossFreight: number;
  identifiers: string[];
  observation?: string;
};
type RomaneioDocumentDraft = {
  situation: RomaneioSituation | "";
  reason: string;
};
type RomaneioPendingAlert =
  | { kind: "change-romaneio" }
  | { kind: "save-with-pending"; groupKey: string; pendingCount: number };
type RomaneioMarkAllConfirmation = {
  groupKey: string;
  pendingCount: number;
};
type RomaneioPickupConfirmation = {
  groupKey: string;
  allowPending: boolean;
  quantity: string;
};
type ManualRomaneioFreight = {
  id: string;
  invoice: string;
  grossFreight: number;
};
type RomaneioSituationConfirmation = {
  groupKey: string;
  documentKey: string;
  situation: Exclude<RomaneioSituation, "delivered">;
  reference: string;
};
type RomaneioBatchSituationConfirmation = {
  groupKey: string;
  documentKeys: string[];
  situation: RomaneioSituation;
};
type RomaneioDailyDocument = {
  key: string;
  document: string;
  referenceType: "MD-e" | "CT-e" | "Documento";
  referenceNumber: string;
  linkedEntries: RomaneioReferenceEntry[];
  sourceStatus: string;
  sender: string;
  recipient: string;
  city: string;
  mde: string;
  cte: string;
  invoice: string;
  routes: string[];
  grossFreight: number;
  production: number;
  identifiers: string[];
};
type RomaneioDailyGroup = {
  key: string;
  day: string;
  emissionDate: string;
  driver: string;
  cpf: string;
  plates: string[];
  vehicleTypes: string[];
  romaneios: string[];
  routes: string[];
  freight: number;
  weight: number;
  deliveries: number;
  volumes: number;
  importedTotalsByRomaneio: Record<string, RomaneioImportedTotals>;
  documents: RomaneioDailyDocument[];
  sourceFiles: string[];
};
type DriverClosingSummary = {
  key: string;
  driver: string;
  cpf: string;
  plates: string[];
  vehicleTypes: string[];
  days: DriverClosingDay[];
  totalInvoices: number;
  totalFreight: number;
};
type DriverClosingDayEdit = {
  cityText: string;
  observation: string;
};
type DriverClosingPreviewReport = DriverClosingExport & {
  key: string;
};
type DriverClosingDiscountPlan = {
  id: string;
  driverKey: string;
  driver: string;
  totalAmount: number;
  installments: number;
  nextInstallment: number;
  createdAt: string;
};
type DriverClosingDiscountPrompt = {
  amount: string;
  installments: string;
};
type MaexAdditionalSender = {
  name: string;
  cnpj: string;
  markedAt: string;
};
type ManualClientOption = {
  name: string;
  cnpjs: string[];
  source: "Lista TDE" | "Cadastro manual" | "Relatório";
};
type PajussaraClosingInfo = {
  file: string;
  sheet: string;
  period: string;
  documents: PajussaraClosingDocument[];
};
type BillingScope = "normal" | "maex-additional";
type BilledDocumentRecord = {
  key: string;
  partnerId: string;
  partnerName: string;
  cte: string;
  invoice: string;
  sources: string[];
  markedAt: string;
  billingScope: BillingScope;
};
const ROMANEIO_STORAGE_KEY = "gmobs-romaneios-v1";
const GENERAL_IMPORT_INFO_STORAGE_KEY = "gmobs-general-import-info-v1";
const driverClosingDayEditKey = (driverKey: string, date: string) =>
  `${driverKey}|${date}`;

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const normalized = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const partnerAliases: Array<[string, string, string[]]> = [
  ["argius", "Argius", ["argius"]],
  ["fitlog", "Fitlog", ["fitlog"]],
  ["maex", "Maex", ["maex", "mardonio"]],
  ["lovato", "Lovato", ["lovato"]],
  ["displan", "Displan", ["displan"]],
  ["trd", "TRD", ["trd transporte", "trd"]],
  ["dy", "D&Y", ["d e y", "dey", "d y", "arc"]],
  [
    "pajucara",
    "PAJUÇARA",
    ["pajussara", "pajusara", "pajucar", "pajucara"],
  ],
  ["rio-vermelho", "Rio Vermelho", ["rio vermelho"]],
  [
    "tadex",
    "Tadex",
    [
      "simbax",
      "simb",
      "stx",
      "tadex",
      "tadlog",
      "essessao",
      "excessao",
      "excecao",
    ],
  ],
  ["ttjb", "TTJB", ["ttjb"]],
];
const billingPartners: Array<[string, string]> = [
  ...partnerAliases.map(([id, name]) => [id, name] as [string, string]),
  ["maex-moveis", "Maex Móveis"],
  ["barueri", "Barueri"],
];
const canonicalPartnerName = (partnerId: string, fallback: string) =>
  partnerAliases.find(([id]) => id === partnerId)?.[1] || fallback;
const pajussaraSenderMatches = (left: string, right: string) => {
  const a = normalized(left);
  const b = normalized(right);
  if (!a || !b) return true;
  return a.startsWith(b) || b.startsWith(a) || a.slice(0, 8) === b.slice(0, 8);
};
const comparePajussaraDocuments = (
  rows: Entry[],
  documents: PajussaraClosingDocument[],
) => {
  const available = documents.map((document) => ({ document, used: false }));
  const matched: Entry[] = [];
  const missing: Entry[] = [];
  rows.forEach((row) => {
    const invoiceKey = normalizeInvoiceKey(row.invoice);
    let matchIndex = available.findIndex(
      ({ document, used }) =>
        !used &&
        document.invoiceKey === invoiceKey &&
        pajussaraSenderMatches(row.sender, document.sender),
    );
    if (matchIndex < 0)
      matchIndex = available.findIndex(
        ({ document, used }) => !used && document.invoiceKey === invoiceKey,
      );
    if (invoiceKey && matchIndex >= 0) {
      available[matchIndex].used = true;
      matched.push(row);
    } else {
      missing.push(row);
    }
  });
  return {
    matched,
    missing,
    externalOnly: available
      .filter(({ used }) => !used)
      .map(({ document }) => document),
  };
};
const scanPartnerIds = new Set(["trd", "argius", "dy"]);
const scanKey = (value?: string) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
const matchesCoverDocumentSearch = (
  document: CoverDocumentExport,
  searchValue: string,
) => {
  const search = scanKey(searchValue);
  if (!search) return true;
  const invoiceSearch = normalizeInvoiceKey(searchValue);
  return (
    [document.invoice, document.cte, document.cteKey, document.mde, document.manualCoverNumber].some(
      (value) => scanKey(value) === search,
    ) ||
    Boolean(
      invoiceSearch && normalizeInvoiceKey(document.invoice) === invoiceSearch,
    )
  );
};
const coverDocumentIdentityKeys = (document: CoverDocumentExport) =>
  [
    scanKey(document.cteKey) ? `CHAVE:${scanKey(document.cteKey)}` : "",
    scanKey(document.cte) ? `CTE:${scanKey(document.cte)}` : "",
    normalizeInvoiceKey(document.invoice)
      ? `NF:${normalizeInvoiceKey(document.invoice)}`
      : "",
    scanKey(document.manualCoverNumber)
      ? `CAPA:${scanKey(document.manualCoverNumber)}`
      : "",
  ].filter(Boolean);
const coverDocumentsOverlap = (
  left: CoverDocumentExport,
  right: CoverDocumentExport,
) => {
  const rightKeys = new Set(coverDocumentIdentityKeys(right));
  return coverDocumentIdentityKeys(left).some((key) => rightKeys.has(key));
};
type ManualCoverDocumentDraft = {
  invoice: string;
  cte: string;
  sender: string;
  recipient: string;
  volumes: string;
  weight: string;
  value: string;
};
type ClosingAdditional = {
  id: string;
  sourceEntryId: string;
  partnerId: string;
  partnerName: string;
  invoice: string;
  cte: string;
  recipient: string;
  recipientKey: string;
  kind: "dedicated" | "tde" | "tda" | "cf";
  value: number;
  calculation: "direct" | "before-discounts";
  persistent: boolean;
  createdAt: string;
  createdBy: string;
};
type BillingInvoice = {
  id: string;
  partnerId: string;
  partnerName: string;
  value: number;
  period: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
};
type FinancialEntry = {
  id: string;
  accountName: string;
  value: number;
  paidAt: string;
  month: string;
  createdAt: string;
  createdBy: string;
};
type PickupRecord = {
  id: string;
  number: string;
  invoice?: string;
  partnerId: string;
  partnerName: string;
  clientName: string;
  volumes: number;
  driver: string;
  completedAt: string;
  status: "open" | "completed";
  createdAt: string;
  createdBy: string;
  completedBy?: string;
};
type DedicatedRecord = {
  id: string;
  trackingDate: string;
  invoice: string;
  cte: string;
  cteKey: string;
  sender: string;
  recipient: string;
  partnerId: string;
  partnerName: string;
  value?: number;
  driver: string;
  observation: string;
  paid: boolean;
  paidAt: string;
  createdAt: string;
  createdBy: string;
};
type DedicatedDraft = Omit<DedicatedRecord, "id" | "createdAt" | "createdBy" | "paid" | "paidAt" | "observation">;
const BILLING_ACCESS_CODE = "MVF2026";
const billingPeriodLabel = (period: string) => {
  const match = period.match(/^(\d{4})-(\d{2})-([12])$/);
  if (!match) return period;
  const [, year, month, half] = match;
  const monthName = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
  return `${half}ª quinzena de ${monthName} de ${year}`;
};
const emptyManualCoverDocument: ManualCoverDocumentDraft = {
  invoice: "",
  cte: "",
  sender: "",
  recipient: "",
  volumes: "",
  weight: "",
  value: "",
};
const numericDocumentId = (value?: string) => {
  const text = String(value ?? "").trim();
  const reference = text.match(/^[MC]\s*-\s*(\d+)(?:\s*-\s*\d+)?$/i);
  const withSeries = text.match(
    /^0*(\d{3,})\s*(?:-|\/|\s+s[eé]rie\s+|\s+)\s*0*\d{1,2}\s*$/i,
  );
  const digits = reference?.[1] || withSeries?.[1] || text.replace(/\D/g, "");
  return digits.replace(/^0+/, "") || (digits ? "0" : "");
};
const romaneioDocumentReference = (value: string) => {
  const match = value.trim().match(/^([MC])\s*-\s*(\d+)(?:\s*-\s*\d+)?$/i);
  if (!match) return null;
  return {
    type: match[1].toUpperCase() === "M" ? ("MD-e" as const) : ("CT-e" as const),
    number: match[2].replace(/^0+/, "") || "0",
  };
};
const romaneioDocumentKey = (value: string) => {
  const reference = romaneioDocumentReference(value);
  return reference
    ? `${reference.type}|${reference.number}`
    : `Documento|${normalized(value)}`;
};
const operationalIdentifier = (value?: string) => {
  const text = String(value ?? "").trim();
  const reference = romaneioDocumentReference(text);
  if (reference) return reference.number;
  const invoiceWithSeries = text.match(
    /^0*(\d{3,})\s*(?:-|\/|\s+s[eé]rie\s+|\s+)\s*0*\d{1,2}\s*$/i,
  );
  if (invoiceWithSeries) return invoiceWithSeries[1];
  const digits = text.replace(/\D/g, "");
  return digits.replace(/^0+/, "") || (digits ? "0" : "");
};
const cteNumberFromAccessKey = (value?: string) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 44) return "";
  return digits.slice(25, 34).replace(/^0+/, "") || "0";
};
const operationalIdentifiers = (value?: string) =>
  [
    operationalIdentifier(value),
    cteNumberFromAccessKey(value),
  ].filter(Boolean);
const entryOperationalIdentifiers = (entry: {
  mde?: string;
  cte?: string;
  cteKey?: string;
  invoice?: string;
  observation?: string;
}) =>
  {
    const observation = String(entry.observation || "");
    const observationKeys = observation.match(/\d{44}/g) || [];
    const observationDocuments = [
      ...observation.matchAll(/documento\s*:\s*0*(\d{3,})/gi),
    ].map((match) => match[1]);
    return [
      operationalIdentifier(entry.mde),
      operationalIdentifier(entry.cte),
      operationalIdentifier(entry.cteKey),
      cteNumberFromAccessKey(entry.cteKey),
      normalizeInvoiceKey(entry.invoice),
      operationalIdentifier(entry.invoice),
      ...observationKeys.flatMap((accessKey) => [
        operationalIdentifier(accessKey),
        cteNumberFromAccessKey(accessKey),
      ]),
      ...observationDocuments,
    ].filter(Boolean);
  };
const entryMatchesGlobalDocumentScan = (
  entry: {
    mde?: string;
    cte?: string;
    cteKey?: string;
    invoice?: string;
    observation?: string;
  },
  raw: string,
) => {
  const key = scanKey(raw);
  if (!key) return false;
  const invoiceKey = normalizeInvoiceKey(raw);
  const typedIdentifiers = new Set(operationalIdentifiers(raw));
  const rawFields = [
    entry.mde,
    entry.cte,
    entry.cteKey,
    entry.invoice,
    entry.observation,
  ];

  return (
    rawFields.some((value) => scanKey(value) === key) ||
    // Alguns relatórios trazem a chave do CT-e dentro da observação.
    rawFields.some((value) => scanKey(value).includes(key)) ||
    Boolean(
      invoiceKey && normalizeInvoiceKey(entry.invoice) === invoiceKey,
    ) ||
    entryOperationalIdentifiers(entry).some((identifier) =>
      typedIdentifiers.has(identifier),
    )
  );
};
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const entryStableIdentity = (entry: Pick<Entry, "partnerId" | "cteKey" | "cte" | "mde" | "invoice" | "sender" | "recipient">) => {
  const cteKey = scanKey(entry.cteKey);
  if (cteKey) return `CHAVE:${cteKey}`;
  const cte = numericDocumentId(entry.cte);
  if (cte) return `CTE:${entry.partnerId}:${cte}`;
  const mde = numericDocumentId(entry.mde);
  if (mde) return `MDE:${mde}`;
  return `NF:${entry.partnerId}:${normalizeInvoiceKey(entry.invoice)}:${normalized(entry.sender)}:${normalized(entry.recipient)}`;
};
const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const ROMANEIO_PRODUCTION_FACTOR = 0.87;
const MANUAL_ROMANEIO_FREIGHT_FACTOR = 0.32 * ROMANEIO_PRODUCTION_FACTOR;
const romaneioDaysElapsed = (day: string) => {
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - parsed.getTime()) / 86400000));
};
const romaneioSituationLabel: Record<RomaneioSituation, string> = {
  delivered: "Entregue (ET)",
  back: "Volta (OC)",
  return: "Retorno (OC)",
  retained: "Retido (OC)",
  "not-followed": "Não seguiu (OC)",
  "driver-missing": "Motorista não trouxe o documento",
};
const romaneioOperationalStatus = (
  situation: RomaneioSituation,
): "ET" | "OC" => (situation === "delivered" ? "ET" : "OC");
const romaneioStatusForDocument = (
  statuses: Record<string, RomaneioDocumentStatusRecord>,
  group: RomaneioDailyGroup,
  document: RomaneioDailyDocument,
) =>
  Object.values(statuses)
    .filter(
      (record) =>
        record.day === group.day &&
        record.romaneios.some((number) => group.romaneios.includes(number)) &&
        record.identifiers.some((identifier) => document.identifiers.includes(identifier)),
    )
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
const playRomaneioSuccessSound = () => {
  try {
    const context = new AudioContext();
    const start = context.currentTime;
    [0, 0.13, 0.26].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime([880, 1320, 1760][index], start + offset);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.34, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.11);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.12);
    });
    window.setTimeout(() => void context.close(), 650);
  } catch {
    /* a confirmação visual continua funcionando quando o navegador bloqueia áudio */
  }
};
const playRomaneioAttentionSound = () => {
  try {
    const context = new AudioContext();
    const start = context.currentTime;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(0.72, start + 0.012);
    master.gain.setValueAtTime(0.72, start + 0.2);
    master.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    master.connect(context.destination);
    [390, 465].forEach((frequency) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.32, start);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + 0.29);
    });
    window.setTimeout(() => void context.close(), 450);
  } catch {
    /* o alerta visual continua funcionando quando o navegador bloqueia áudio */
  }
};
const isMaexAdditionalBillingSource = (source: string) => {
  const value = normalized(source);
  return (
    value.includes("fechamento adicional maex") ||
    value.includes("maex adicional")
  );
};
const billedDocumentKey = (
  partnerId: string,
  cte?: string,
  billingScope: BillingScope = "normal",
) => {
  const key = scanKey(cte);
  if (!key) return "";
  return billingScope === "maex-additional"
    ? `maex-additional|${key}`
    : `${partnerId}|${key}`;
};
const mergeBilledDocuments = (
  current: Record<string, BilledDocumentRecord>,
  additions: BilledDocumentRecord[],
) => {
  const next = { ...current };
  additions.forEach((addition) => {
    const existing = next[addition.key];
    next[addition.key] = existing
      ? {
          ...existing,
          partnerName: addition.partnerName,
          invoice: existing.invoice || addition.invoice,
          sources: [...new Set([...existing.sources, ...addition.sources])],
          billingScope: addition.billingScope,
        }
      : addition;
  });
  return next;
};
const normalizeBilledDocuments = (
  saved: Record<string, BilledDocumentRecord>,
) => {
  let normalizedRecords: Record<string, BilledDocumentRecord> = {};
  Object.values(saved || {}).forEach((document) => {
    const sources = Array.isArray(document.sources) ? document.sources : [];
    const grouped = new Map<BillingScope, string[]>();
    if (!sources.length) {
      const scope =
        document.partnerId === "maex" &&
        document.billingScope === "maex-additional"
          ? "maex-additional"
          : "normal";
      grouped.set(scope, []);
    }
    sources.forEach((source) => {
      const scope =
        document.partnerId === "maex" &&
        (document.billingScope === "maex-additional" ||
          isMaexAdditionalBillingSource(source))
          ? "maex-additional"
          : "normal";
      grouped.set(scope, [...(grouped.get(scope) || []), source]);
    });
    grouped.forEach((scopeSources, billingScope) => {
      const key = billedDocumentKey(
        document.partnerId,
        document.cte,
        billingScope,
      );
      if (!key) return;
      normalizedRecords = mergeBilledDocuments(normalizedRecords, [
        {
          ...document,
          key,
          sources: [...new Set(scopeSources)],
          billingScope,
        },
      ]);
    });
  });
  return normalizedRecords;
};
function identifyPartner(raw: string) {
  const text = normalized(raw);
  const match = partnerAliases.find(([, , aliases]) =>
    aliases.some((alias) =>
      alias === "arc" ? text.split(" ").includes(alias) : text.includes(alias),
    ),
  );
  if (match) return { id: match[0], name: match[1] };
  if (!text) return { id: "unidentified", name: "Não identificado" };
  return { id: `custom-${text.replace(/\s+/g, "-")}`, name: raw.trim() };
}
const normalizeSavedEntries = (savedEntries: Entry[]) =>
  savedEntries.map((entry) => {
    const identified = identifyPartner(
      entry.partnerRaw || entry.partnerName || "",
    );
    const knownName = canonicalPartnerName(entry.partnerId, entry.partnerName);
    if (knownName !== entry.partnerName)
      return { ...entry, partnerName: knownName };
    const identifiedName = partnerAliases.find(
      ([id]) => id === identified.id,
    )?.[1];
    return identifiedName
      ? {
          ...entry,
          partnerId: identified.id,
          partnerName: identifiedName,
        }
      : entry;
  });
const asRomaneioReferenceEntry = (entry: Entry): RomaneioReferenceEntry => {
  const saved = entry as Entry & Partial<RomaneioReferenceEntry>;
  return {
    ...entry,
    sourceStatus:
      saved.sourceStatus || entry.romaneioSourceStatus || entry.status,
    sourceEligible: saved.sourceEligible ?? true,
  };
};
const normalizeRomaneioReferenceEntries = (
  savedEntries: RomaneioReferenceEntry[] | undefined,
  fallbackEntries: Entry[],
) =>
  (Array.isArray(savedEntries) &&
  savedEntries.every((entry) => typeof entry?.id === "string")
    ? savedEntries
    : fallbackEntries
  )
    .map(asRomaneioReferenceEntry)
    .filter((entry) => !entry.sourceEligible);
const unidentifiedKey = (entry: Entry) =>
  normalized(entry.partnerCnpj || entry.partnerRaw || entry.sender || "sem-dados");
const maexSenderKey = (entry: Entry) => {
  const cnpj = normalizeCnpj(entry.senderCnpj);
  if (cnpj) return `cnpj:${cnpj}`;
  const name = normalized(entry.sender);
  return name ? `nome:${name}` : "";
};
const totalOf = (entry: Entry) => commissionTotal(entry);
const formatCnpj = (cnpj: string) =>
  cnpj.length === 14
    ? cnpj.replace(
        /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
        "$1.$2.$3/$4-$5",
      )
    : cnpj;
const formatRomaneioDay = (value: string) => {
  if (!value) return "Sem data";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};
const parseMoney = (value: string) => {
  const raw = value.replace(/R\$/gi, "").replace(/\s/g, "");
  const normalizedValue = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalizedValue.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const manualFreightProduction = (grossFreight: number) =>
  roundMoney(grossFreight * MANUAL_ROMANEIO_FREIGHT_FACTOR);
const parseCnpjList = (value: string) => {
  const candidates =
    value.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{12,14}/g) ||
    [];
  return [
    ...new Set(candidates.map((candidate) => normalizeCnpj(candidate)).filter(Boolean)),
  ];
};
const effectiveTdeRates = (rates: TdeRateRecord[]) => {
  const map = new Map<string, number>();
  rates
    .filter((rate) => rate.source === "file")
    .forEach((rate) => map.set(`${rate.cnpj}|${rate.partnerId}`, rate.value));
  rates
    .filter((rate) => rate.source === "manual")
    .forEach((rate) => map.set(`${rate.cnpj}|${rate.partnerId}`, rate.value));
  return map;
};
const applyTdeRates = (entries: Entry[], rates: TdeRateRecord[]) => {
  const rateMap = effectiveTdeRates(rates);
  let changed = false;
  const updated = entries.map((entry) => {
    const sourceTde = entry.sourceTde ?? entry.tde;
    const cnpj = normalizeCnpj(entry.recipientCnpj);
    const matched = cnpj
      ? rateMap.get(`${cnpj}|${entry.partnerId}`)
      : undefined;
    const tde = matched ?? sourceTde;
    if (entry.sourceTde === sourceTde && entry.tde === tde) return entry;
    changed = true;
    return { ...entry, sourceTde, tde };
  });
  return changed ? updated : entries;
};
const periodName = (date: string) => {
  const value = new Date(
    `${date || new Date().toISOString().slice(0, 10)}T12:00:00`,
  );
  return `${value.getDate() <= 15 ? "1ª" : "2ª"} Quinzena de ${value.toLocaleDateString("pt-BR", { month: "long" })} de ${value.getFullYear()}`;
};
const writeLocalStorage = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};
const completeRowKey = (row: object) =>
  JSON.stringify(
    Object.entries(row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.trim() : value,
      ]),
  );
const romaneioCompleteRowKey = (
  row: ImportedRomaneioRow & Partial<Pick<RomaneioEntry, "id" | "sourceFile">>,
) =>
  completeRowKey(
    Object.fromEntries(
      Object.entries(row).filter(
        ([key]) => key !== "id" && key !== "sourceFile",
      ),
    ),
  );

type ScheduledBrowserWork = { kind: "idle" | "timeout"; id: number };
type BrowserWithIdleWork = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout?: number },
    ) => number;
    cancelIdleCallback?: (id: number) => void;
  };

const scheduleBrowserWork = (
  callback: () => void,
  timeout: number,
): ScheduledBrowserWork => {
  const browser = window as BrowserWithIdleWork;
  if (browser.requestIdleCallback)
    return {
      kind: "idle",
      id: browser.requestIdleCallback(callback, { timeout }),
    };
  return { kind: "timeout", id: window.setTimeout(callback, 0) };
};

const cancelScheduledBrowserWork = (work: ScheduledBrowserWork) => {
  const browser = window as BrowserWithIdleWork;
  if (work.kind === "idle" && browser.cancelIdleCallback) {
    browser.cancelIdleCallback(work.id);
    return;
  }
  window.clearTimeout(work.id);
};

function useCloudStateSync<T>(
  stateKey: CloudStateKey,
  value: T,
  enabled: boolean,
  skipSaveRef: { current: Set<CloudStateKey> },
  onQueue: () => void,
  onStart: () => void,
  onFinish: (
    stateKey: CloudStateKey,
    succeeded: boolean,
    version?: string,
  ) => void,
) {
  const enabledOnce = useRef(false);
  useEffect(() => {
    if (!enabled) {
      enabledOnce.current = false;
      return;
    }
    if (!enabledOnce.current) {
      enabledOnce.current = true;
      return;
    }
    if (skipSaveRef.current.delete(stateKey)) return;

    onQueue();
    let started = false;
    let cancelled = false;
    let queuedWork: ScheduledBrowserWork | null = null;
    const saveDelay =
      stateKey === "closing" || stateKey === "romaneios" || stateKey === "billed"
        ? 2_500
        : 900;
    const idleTimeout =
      stateKey === "closing" || stateKey === "romaneios" || stateKey === "billed"
        ? 8_000
        : 4_000;
    const timer = window.setTimeout(() => {
      queuedWork = scheduleBrowserWork(() => {
        if (cancelled) return;
        started = true;
        onStart();
        void saveCloudState(stateKey, value)
          .then((version) => {
            void writeCloudStateCache(stateKey, version, value).catch(() => undefined);
            onFinish(stateKey, true, version);
          })
          .catch(() => onFinish(stateKey, false));
      }, idleTimeout);
    }, saveDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (queuedWork && !started) cancelScheduledBrowserWork(queuedWork);
      if (!started) return;
    };
  }, [
    enabled,
    onFinish,
    onQueue,
    onStart,
    skipSaveRef,
    stateKey,
    value,
  ]);
}

function LoginGate({
  authStatus,
  cloudHosted,
  loginError,
  loggingIn,
  operatorNames,
  onLogin,
}: {
  authStatus: AuthStatus;
  cloudHosted: boolean;
  loginError: string;
  loggingIn: boolean;
  operatorNames: string[];
  onLogin: (credentials: {
    operator: string;
    username: string;
    password: string;
  }) => void;
}) {
  const [operator, setOperator] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const requiresCloudLogin = cloudHosted && authStatus === "signedOut";

  return (
    <main className="access-shell">
      <section className="access-card login-card">
        <div className="access-mark">GM</div>
        <small>ACESSO RESTRITO</small>
        <h1>Fechamentos GMOBS</h1>
        <p>Identifique quem está entrando para vincular as operações realizadas.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onLogin({ operator, username, password });
          }}
        >
          <label htmlFor="operator-name">Seu nome</label>
          <input
            id="operator-name"
            list="operator-names"
            value={operator}
            autoComplete="name"
            placeholder="Escolha ou digite um novo nome"
            onChange={(event) => setOperator(event.target.value)}
          />
          <datalist id="operator-names">
            {operatorNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {requiresCloudLogin && (
            <>
              <label htmlFor="login-username">Usuário</label>
              <input
                id="login-username"
                value={username}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
              />
              <label htmlFor="login-password">Senha</label>
              <input
                id="login-password"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </>
          )}
          {loginError && <div className="login-error">{loginError}</div>}
          <button
            type="submit"
            className="primary"
            disabled={
              loggingIn ||
              !operator.trim() ||
              (requiresCloudLogin && (!username.trim() || !password))
            }
          >
            {loggingIn ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}

async function loadCachedCloudStateRecord<T>(stateKey: CloudStateKey) {
  const version = await getCloudStateVersion(stateKey);
  const cached = await readCloudStateCache<T>(stateKey).catch(() => null);
  if (version && cached?.version === version)
    return { value: cached.value, version };
  const record = await loadCloudStateRecord<T>(stateKey);
  if (record)
    void writeCloudStateCache(stateKey, record.version, record.value).catch(() => undefined);
  return record;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("import");
  const [tabPending, startTabTransition] = useTransition();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [romaneioReferenceEntries, setRomaneioReferenceEntries] = useState<
    RomaneioReferenceEntry[]
  >([]);
  const [selectedPartner, setSelectedPartner] = useState("");
  const [selectedExports, setSelectedExports] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [importInfo, setImportInfo] = useState<ImportInfo | null>(null);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [romaneioPendingAlert, setRomaneioPendingAlert] =
    useState<RomaneioPendingAlert | null>(null);
  const [romaneioCancelConfirmation, setRomaneioCancelConfirmation] =
    useState(false);
  const [romaneioSituationConfirmation, setRomaneioSituationConfirmation] =
    useState<RomaneioSituationConfirmation | null>(null);
  const [
    romaneioBatchSituationConfirmation,
    setRomaneioBatchSituationConfirmation,
  ] = useState<RomaneioBatchSituationConfirmation | null>(null);
  const [romaneioMarkAllConfirmation, setRomaneioMarkAllConfirmation] =
    useState<RomaneioMarkAllConfirmation | null>(null);
  const [romaneioPickupConfirmation, setRomaneioPickupConfirmation] =
    useState<RomaneioPickupConfirmation | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingTde, setImportingTde] = useState(false);
  const [importingRomaneios, setImportingRomaneios] = useState(false);
  const [importingPajussara, setImportingPajussara] = useState(false);
  const [importingBilled, setImportingBilled] = useState(false);
  const [pajussaraClosing, setPajussaraClosing] =
    useState<PajussaraClosingInfo | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudHosted, setCloudHosted] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>("local");
  const [cloudRetry, setCloudRetry] = useState(0);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [activeOperator, setActiveOperator] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [assignmentChoices, setAssignmentChoices] = useState<
    Record<string, string>
  >({});
  const [newPartnerNames, setNewPartnerNames] = useState<
    Record<string, string>
  >({});
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [importingScanTxt, setImportingScanTxt] = useState(false);
  const [scannedCtes, setScannedCtes] = useState<
    Record<string, Record<string, ScanRecord>>
  >({});
  const [covers, setCovers] = useState<CoverExport[]>([]);
  const [coverGenerators, setCoverGenerators] = useState<string[]>([]);
  const [coverSection, setCoverSection] = useState<CoverKind | "report">("shipment");
  const [coverPartnerId, setCoverPartnerId] = useState("");
  const coverScanInputRef = useRef<HTMLInputElement>(null);
  const [coverNumberInput, setCoverNumberInput] = useState("");
  const [coverDrafts, setCoverDrafts] = useState<Record<string, CoverDocumentExport[]>>({});
  const coverDraftsRef = useRef<Record<string, CoverDocumentExport[]>>({});
  const [manualCoverDrafts, setManualCoverDrafts] = useState<Record<string, ManualCoverDocumentDraft>>({});
  const [editingCoverId, setEditingCoverId] = useState("");
  const [coverDeleteConfirmation, setCoverDeleteConfirmation] = useState(false);
  const [coverReportFrom, setCoverReportFrom] = useState("");
  const [coverReportTo, setCoverReportTo] = useState("");
  const [coverReportSearch, setCoverReportSearch] = useState("");
  const [selectedCoverReportIds, setSelectedCoverReportIds] = useState<string[]>([]);
  const [optionalScanPartnerIds, setOptionalScanPartnerIds] = useState<
    string[]
  >([]);
  const [tdeRates, setTdeRates] = useState<TdeRateRecord[]>([]);
  const [closingAdditionals, setClosingAdditionals] = useState<ClosingAdditional[]>([]);
  const [closingAdditionalSearch, setClosingAdditionalSearch] = useState("");
  const [closingAdditionalKind, setClosingAdditionalKind] = useState<ClosingAdditional["kind"]>("dedicated");
  const [closingAdditionalValue, setClosingAdditionalValue] = useState("");
  const [closingAdditionalCalculation, setClosingAdditionalCalculation] = useState<ClosingAdditional["calculation"]>("direct");
  const [closingAdditionalPersistent, setClosingAdditionalPersistent] = useState(false);
  const [billingInvoices, setBillingInvoices] = useState<BillingInvoice[]>([]);
  const [billingUnlocked, setBillingUnlocked] = useState(false);
  const [billingCode, setBillingCode] = useState("");
  const [billingCodeError, setBillingCodeError] = useState("");
  const [billingPartnerId, setBillingPartnerId] = useState("");
  const [billingValue, setBillingValue] = useState("");
  const [billingMonth, setBillingMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [billingHalf, setBillingHalf] = useState<"1" | "2">(new Date().getDate() <= 15 ? "1" : "2");
  const [billingFilter, setBillingFilter] = useState("all");
  const [editingBillingId, setEditingBillingId] = useState("");
  const [deletingBillingId, setDeletingBillingId] = useState("");
  const [billingSection, setBillingSection] = useState<"billing" | "financial">("billing");
  const [financialEntries, setFinancialEntries] = useState<FinancialEntry[]>([]);
  const [financialAccountNames, setFinancialAccountNames] = useState<string[]>([]);
  const [financialAccountName, setFinancialAccountName] = useState("");
  const [financialValue, setFinancialValue] = useState("");
  const [financialPaidAt, setFinancialPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [financialMonth, setFinancialMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [editingFinancialId, setEditingFinancialId] = useState("");
  const [deletingFinancialId, setDeletingFinancialId] = useState("");
  const [pickupRecords, setPickupRecords] = useState<PickupRecord[]>([]);
  const [pickupSection, setPickupSection] = useState<"panel" | "report">("panel");
  const [pickupNumber, setPickupNumber] = useState("");
  const [pickupInvoice, setPickupInvoice] = useState("");
  const [pickupPartnerId, setPickupPartnerId] = useState("");
  const [pickupClientName, setPickupClientName] = useState("");
  const [pickupVolumes, setPickupVolumes] = useState("");
  const [pickupPartnerFilter, setPickupPartnerFilter] = useState("all");
  const [pickupReportPartnerFilter, setPickupReportPartnerFilter] = useState("all");
  const [pickupReportDriverFilter, setPickupReportDriverFilter] = useState("");
  const [pickupReportFrom, setPickupReportFrom] = useState("");
  const [pickupReportTo, setPickupReportTo] = useState("");
  const [pickupCompletionDrafts, setPickupCompletionDrafts] = useState<Record<string, { driver: string; date: string }>>({});
  const [expandedPickupIds, setExpandedPickupIds] = useState<string[]>([]);
  const [dedicatedRecords, setDedicatedRecords] = useState<DedicatedRecord[]>([]);
  const [dedicatedSection, setDedicatedSection] = useState<"panel" | "report">("panel");
  const [dedicatedSearch, setDedicatedSearch] = useState("");
  const [dedicatedValue, setDedicatedValue] = useState("");
  const [dedicatedConfirmation, setDedicatedConfirmation] = useState<DedicatedDraft | null>(null);
  const [dedicatedReportSearch, setDedicatedReportSearch] = useState("");
  const [dedicatedPanelPartnerFilter, setDedicatedPanelPartnerFilter] = useState("all");
  const [dedicatedReportPartnerFilter, setDedicatedReportPartnerFilter] = useState("all");
  const [expandedDedicatedIds, setExpandedDedicatedIds] = useState<string[]>([]);
  const [romaneioEntries, setRomaneioEntries] = useState<RomaneioEntry[]>([]);
  const [romaneioImportInfo, setRomaneioImportInfo] =
    useState<RomaneioImportInfo | null>(null);
  const [romaneioDocumentStatuses, setRomaneioDocumentStatuses] = useState<
    Record<string, RomaneioDocumentStatusRecord>
  >({});
  const [romaneioRouteLabels, setRomaneioRouteLabels] = useState<
    Record<string, string>
  >({});
  const [romaneioGroupNotes, setRomaneioGroupNotes] = useState<
    Record<string, string>
  >({});
  const [manualRomaneioFreights, setManualRomaneioFreights] = useState<
    Record<string, ManualRomaneioFreight[]>
  >({});
  const manualRomaneioFreightInputRefs = useRef<
    Record<
      string,
      {
        invoice?: HTMLInputElement | null;
        grossFreight?: HTMLInputElement | null;
      }
    >
  >({});
  const romaneioReturnReasonRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const romaneioPickupQuantityRef = useRef<HTMLInputElement>(null);
  const [romaneioPickupQuantities, setRomaneioPickupQuantities] = useState<
    Record<string, number>
  >({});
  const [driverClosingDiscountPlans, setDriverClosingDiscountPlans] = useState<
    Record<string, DriverClosingDiscountPlan[]>
  >({});
  const [driverClosingDiscountPrompt, setDriverClosingDiscountPrompt] =
    useState<DriverClosingDiscountPrompt | null>(null);
  const [romaneioSearch, setRomaneioSearch] = useState("");
  const romaneioScanRef = useRef<HTMLInputElement>(null);
  const romaneioSearchTimerRef = useRef<number | null>(null);
  const [romaneioFullSearch, setRomaneioFullSearch] = useState("");
  const deferredRomaneioSearch = useDeferredValue(romaneioSearch);
  const deferredRomaneioFullSearch = useDeferredValue(romaneioFullSearch);
  const [romaneioListLimit, setRomaneioListLimit] = useState(40);
  const [romaneioFullListLimit, setRomaneioFullListLimit] = useState(40);
  const [focusedRomaneioKey, setFocusedRomaneioKey] = useState("");
  const [romaneioView, setRomaneioView] = useState<"operation" | "retained">(
    "operation",
  );
  const [retainedDriverFilter, setRetainedDriverFilter] = useState("");
  const [retainedPartnerFilter, setRetainedPartnerFilter] = useState("");
  const [retainedSection, setRetainedSection] = useState<"documents" | "ranking">("documents");
  const [romaneioSection, setRomaneioSection] = useState<
    "checking" | "closing" | "full"
  >("checking");
  const [driverClosingFrom, setDriverClosingFrom] = useState("");
  const [driverClosingTo, setDriverClosingTo] = useState("");
  const [selectedDriverClosings, setSelectedDriverClosings] = useState<
    string[]
  >([]);
  const [driverClosingPreviewOpen, setDriverClosingPreviewOpen] =
    useState(false);
  const [driverClosingDayEdits, setDriverClosingDayEdits] = useState<
    Record<string, DriverClosingDayEdit>
  >({});
  const [openRomaneios, setOpenRomaneios] = useState<Record<string, boolean>>(
    {},
  );
  const [romaneioDocumentDrafts, setRomaneioDocumentDrafts] = useState<
    Record<string, Record<string, RomaneioDocumentDraft>>
  >({});
  useEffect(() => {
    const continueWithEnter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA") return;

      const openDialog = document.querySelector<HTMLElement>(
        '.romaneio-alert-overlay [role="alertdialog"]',
      );
      if (openDialog) {
        const confirmButton = openDialog.querySelector<HTMLButtonElement>(
          "button.primary:not(:disabled)",
        );
        if (confirmButton) {
          event.preventDefault();
          confirmButton.click();
        }
        return;
      }

      if (target instanceof HTMLInputElement && !target.form) {
        const section = target.closest("section, article, .card");
        const actionButton = section?.querySelector<HTMLButtonElement>(
          "button.primary:not(:disabled)",
        );
        if (actionButton) {
          event.preventDefault();
          actionButton.click();
        }
      }
    };
    document.addEventListener("keydown", continueWithEnter);
    return () => document.removeEventListener("keydown", continueWithEnter);
  }, []);
  const [selectedRomaneioDocumentKeys, setSelectedRomaneioDocumentKeys] =
    useState<Record<string, string[]>>({});
  const [romaneioRouteDrafts, setRomaneioRouteDrafts] = useState<
    Record<string, string>
  >({});
  const [retainedScanInput, setRetainedScanInput] = useState("");
  const [retainedResolutionDrafts, setRetainedResolutionDrafts] = useState<
    Record<string, boolean>
  >({});
  const [maexAdditionalSenders, setMaexAdditionalSenders] = useState<
    Record<string, MaexAdditionalSender>
  >({});
  const [billedDocuments, setBilledDocuments] = useState<
    Record<string, BilledDocumentRecord>
  >({});
  const [tdeImportInfo, setTdeImportInfo] =
    useState<TdeImportInfo | null>(null);
  const [manualClientName, setManualClientName] = useState("");
  const [manualClientCnpj, setManualClientCnpj] = useState("");
  const [manualClientSuggestionsOpen, setManualClientSuggestionsOpen] =
    useState(false);
  const [manualPartnerId, setManualPartnerId] = useState("");
  const [manualTdeValue, setManualTdeValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tdeInputRef = useRef<HTMLInputElement>(null);
  const romaneioInputRef = useRef<HTMLInputElement>(null);
  const scanTxtInputRef = useRef<HTMLInputElement>(null);
  const pajussaraInputRef = useRef<HTMLInputElement>(null);
  const billedInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const cloudWritesRef = useRef(0);
  const cloudSaveFailedRef = useRef(false);
  const cloudVersionsRef = useRef<Partial<Record<CloudStateKey, string>>>({});
  const skipCloudSaveRef = useRef(new Set<CloudStateKey>());
  const lastLocalChangeRef = useRef(0);
  const lastUserInteractionRef = useRef(0);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => {
      setMessage("");
      setMessageIsError(false);
    }, messageIsError ? 1400 : 850);
    return () => window.clearTimeout(timer);
  }, [message, messageIsError]);
  useEffect(() => {
    coverDraftsRef.current = coverDrafts;
  }, [coverDrafts]);
  useEffect(() => {
    if (!activeOperator) return;
    setCoverGenerators((current) => {
      const names = current.some((name) => normalized(name) === normalized(activeOperator))
        ? current
        : [...current, activeOperator].sort((a, b) => a.localeCompare(b, "pt-BR"));
      try {
        localStorage.setItem("mvflog-operator-names", JSON.stringify(names));
      } catch {
        /* o nome continua válido durante a sessão */
      }
      return names;
    });
  }, [activeOperator, coverGenerators]);
  useEffect(() => {
    let cancelled = false;
    const restoreSavedData = async () => {
      try {
        try {
          const savedOperatorNames = JSON.parse(
            localStorage.getItem("mvflog-operator-names") || "[]",
          );
          if (Array.isArray(savedOperatorNames))
            setCoverGenerators(
              savedOperatorNames.filter((name): name is string => typeof name === "string" && Boolean(name.trim())),
            );
        } catch {
          /* começa sem nomes sugeridos se o navegador não tiver cadastro */
        }
        if (isHostedSite()) {
          if (!cancelled) {
            setCloudHosted(true);
            setCloudStatus("loading");
          }
          return;
        }
        setAuthStatus("signedIn");
        let savedClosing:
          | {
              entries: Entry[];
              referenceEntries?: RomaneioReferenceEntry[];
              covers?: CoverExport[];
              coverGenerators?: string[];
              closingAdditionals?: ClosingAdditional[];
              billingInvoices?: BillingInvoice[];
              pickupRecords?: PickupRecord[];
              dedicatedRecords?: DedicatedRecord[];
              financialEntries?: FinancialEntry[];
              financialAccountNames?: string[];
            }
          | null = null;
        let savedBilledDocuments: Record<string, BilledDocumentRecord> | null =
          null;
        try {
          const indexedClosing = await readClosingStorage<
            | Entry[]
            | {
                entries: Entry[];
                referenceEntries?: RomaneioReferenceEntry[];
                covers?: CoverExport[];
                coverGenerators?: string[];
                closingAdditionals?: ClosingAdditional[];
                billingInvoices?: BillingInvoice[];
                pickupRecords?: PickupRecord[];
                dedicatedRecords?: DedicatedRecord[];
                financialEntries?: FinancialEntry[];
                financialAccountNames?: string[];
              }
          >();
          if (Array.isArray(indexedClosing)) {
            savedClosing = { entries: indexedClosing };
          } else if (Array.isArray(indexedClosing?.entries)) {
            savedClosing = indexedClosing;
          }
          if (savedClosing) {
            try {
              localStorage.removeItem(CLOSING_STORAGE_KEY);
            } catch {
              /* a cópia principal já foi recuperada do IndexedDB */
            }
          }
        } catch {
          /* tenta o formato antigo logo abaixo */
        }

        if (savedClosing === null) {
          const saved = localStorage.getItem(CLOSING_STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              savedClosing = { entries: parsed };
            } else if (Array.isArray(parsed?.entries)) {
              savedClosing = parsed;
            }
            if (savedClosing) {
              try {
                await writeClosingStorage(savedClosing);
                localStorage.removeItem(CLOSING_STORAGE_KEY);
              } catch {
                /* mantém o formato antigo se a migração não estiver disponível */
              }
            }
          }
        }

        try {
          const indexedBilled = await readBilledStorage<
            Record<string, BilledDocumentRecord>
          >();
          if (indexedBilled && typeof indexedBilled === "object") {
            savedBilledDocuments = indexedBilled;
            try {
              localStorage.removeItem(BILLED_STORAGE_KEY);
            } catch {
              /* o histórico principal já foi recuperado do IndexedDB */
            }
          }
        } catch {
          /* tenta a cópia alternativa logo abaixo */
        }
        if (savedBilledDocuments === null) {
          const savedBilled = localStorage.getItem(BILLED_STORAGE_KEY);
          if (savedBilled) {
            const parsed = JSON.parse(savedBilled);
            if (parsed && typeof parsed === "object") {
              savedBilledDocuments = parsed;
              try {
                await writeBilledStorage(parsed);
                localStorage.removeItem(BILLED_STORAGE_KEY);
              } catch {
                /* mantém a cópia alternativa se a migração falhar */
              }
            }
          }
        }

        const savedScans = localStorage.getItem("gmobs-scanned-ctes-v1");
        const savedGeneralImportInfo = localStorage.getItem(
          GENERAL_IMPORT_INFO_STORAGE_KEY,
        );
        const savedTde = localStorage.getItem("gmobs-tde-rates-v1");
        const parsedTde = savedTde ? JSON.parse(savedTde) : null;
        const savedMaexAdditional = localStorage.getItem(
          "gmobs-maex-additional-senders-v1",
        );
        const parsedMaexAdditional = savedMaexAdditional
          ? JSON.parse(savedMaexAdditional)
          : null;
        const savedRomaneios = localStorage.getItem(ROMANEIO_STORAGE_KEY);
        const parsedRomaneios = savedRomaneios
          ? JSON.parse(savedRomaneios)
          : null;

        if (cancelled) return;
        if (savedClosing) {
          const normalizedEntries = normalizeSavedEntries(savedClosing.entries);
          setEntries(normalizedEntries);
          setRomaneioReferenceEntries(
            normalizeRomaneioReferenceEntries(
              savedClosing.referenceEntries,
              normalizedEntries,
            ),
          );
          if (Array.isArray(savedClosing.covers)) setCovers(savedClosing.covers);
          if (Array.isArray(savedClosing.coverGenerators))
            setCoverGenerators(savedClosing.coverGenerators);
          if (Array.isArray(savedClosing.closingAdditionals))
            setClosingAdditionals(savedClosing.closingAdditionals);
          if (Array.isArray(savedClosing.billingInvoices))
            setBillingInvoices(savedClosing.billingInvoices);
          if (Array.isArray(savedClosing.pickupRecords))
            setPickupRecords(savedClosing.pickupRecords);
          if (Array.isArray(savedClosing.dedicatedRecords))
            setDedicatedRecords(savedClosing.dedicatedRecords);
          if (Array.isArray(savedClosing.financialEntries)) setFinancialEntries(savedClosing.financialEntries);
          if (Array.isArray(savedClosing.financialAccountNames)) setFinancialAccountNames(savedClosing.financialAccountNames);
        }
        if (savedGeneralImportInfo) {
          const parsedGeneralImportInfo = JSON.parse(savedGeneralImportInfo);
          if (parsedGeneralImportInfo && typeof parsedGeneralImportInfo === "object")
            setImportInfo(parsedGeneralImportInfo);
        }
        if (savedScans) setScannedCtes(JSON.parse(savedScans));
        if (savedBilledDocuments)
          setBilledDocuments(normalizeBilledDocuments(savedBilledDocuments));
        if (savedTde) {
          if (Array.isArray(parsedTde?.rates))
            setTdeRates(
              parsedTde.rates.map((rate: TdeRateRecord) => ({
                ...rate,
                partnerName: canonicalPartnerName(
                  rate.partnerId,
                  rate.partnerName,
                ),
              })),
            );
          if (parsedTde?.importInfo) setTdeImportInfo(parsedTde.importInfo);
        }
        if (
          parsedMaexAdditional &&
          typeof parsedMaexAdditional === "object"
        )
          setMaexAdditionalSenders(parsedMaexAdditional);
        if (Array.isArray(parsedRomaneios?.entries))
          setRomaneioEntries(parsedRomaneios.entries);
        if (parsedRomaneios?.importInfo)
          setRomaneioImportInfo(parsedRomaneios.importInfo);
        if (
          parsedRomaneios?.documentStatuses &&
          typeof parsedRomaneios.documentStatuses === "object"
        )
          setRomaneioDocumentStatuses(parsedRomaneios.documentStatuses);
        if (
          parsedRomaneios?.routeLabels &&
          typeof parsedRomaneios.routeLabels === "object"
        )
          setRomaneioRouteLabels(parsedRomaneios.routeLabels);
        if (
          parsedRomaneios?.groupNotes &&
          typeof parsedRomaneios.groupNotes === "object"
        )
          setRomaneioGroupNotes(parsedRomaneios.groupNotes);
        if (
          parsedRomaneios?.manualFreights &&
          typeof parsedRomaneios.manualFreights === "object"
        )
          setManualRomaneioFreights(parsedRomaneios.manualFreights);
        if (
          parsedRomaneios?.pickupQuantities &&
          typeof parsedRomaneios.pickupQuantities === "object"
        )
          setRomaneioPickupQuantities(parsedRomaneios.pickupQuantities);
        if (
          parsedRomaneios?.driverDiscountPlans &&
          typeof parsedRomaneios.driverDiscountPlans === "object"
        )
          setDriverClosingDiscountPlans(parsedRomaneios.driverDiscountPlans);
      } catch {
        /* começa vazio se o armazenamento estiver inválido */
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    const timer = window.setTimeout(() => void restoreSavedData(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    if (!isHostedSite()) return;

    let cancelled = false;
    const restoreCloudData = async () => {
      try {
        await Promise.resolve();
        if (cancelled) return;
        setCloudReady(false);
        setCloudStatus("loading");
        const session = await fetch("/api/auth/session", { cache: "no-store" });
        if (session.status === 401) {
          if (!cancelled) {
            setAuthStatus("signedOut");
            setCloudStatus("loading");
          }
          return;
        }
        if (!session.ok) throw new Error("Não foi possível validar a sessão.");
        setAuthStatus("signedIn");

        const [
          closingRecord,
          scansRecord,
          tdeRecord,
          maexRecord,
          billedRecord,
          romaneiosRecord,
        ] = await Promise.all([
            loadCachedCloudStateRecord<{
              entries: Entry[];
              referenceEntries?: RomaneioReferenceEntry[];
              importInfo: ImportInfo | null;
              covers?: CoverExport[];
              coverGenerators?: string[];
              closingAdditionals?: ClosingAdditional[];
              billingInvoices?: BillingInvoice[];
              pickupRecords?: PickupRecord[];
              dedicatedRecords?: DedicatedRecord[];
              financialEntries?: FinancialEntry[];
              financialAccountNames?: string[];
            }>("closing"),
            loadCachedCloudStateRecord<Record<string, Record<string, ScanRecord>>>(
              "scans",
            ),
            loadCachedCloudStateRecord<{
            rates: TdeRateRecord[];
            importInfo: TdeImportInfo | null;
            }>("tde"),
            loadCachedCloudStateRecord<Record<string, MaexAdditionalSender>>("maex"),
            loadCachedCloudStateRecord<Record<string, BilledDocumentRecord>>("billed"),
            loadCachedCloudStateRecord<{
              entries: RomaneioEntry[];
              importInfo: RomaneioImportInfo | null;
              documentStatuses: Record<string, RomaneioDocumentStatusRecord>;
              routeLabels: Record<string, string>;
              groupNotes?: Record<string, string>;
              manualFreights?: Record<string, ManualRomaneioFreight[]>;
              pickupQuantities?: Record<string, number>;
              driverDiscountPlans?: Record<string, DriverClosingDiscountPlan[]>;
            }>("romaneios"),
          ]);
        if (cancelled) return;

        const closing = closingRecord?.value;
        if (closing?.entries && Array.isArray(closing.entries)) {
          const normalizedEntries = normalizeSavedEntries(closing.entries);
          setEntries(normalizedEntries);
          setRomaneioReferenceEntries(
            normalizeRomaneioReferenceEntries(
              closing.referenceEntries,
              normalizedEntries,
            ),
          );
          setImportInfo(closing.importInfo || null);
          setCovers(Array.isArray(closing.covers) ? closing.covers : []);
          setCoverGenerators(
            Array.isArray(closing.coverGenerators)
              ? closing.coverGenerators
              : [...new Set((closing.covers || []).map((cover) => cover.generatedBy).filter(Boolean) as string[])],
          );
          setClosingAdditionals(Array.isArray(closing.closingAdditionals) ? closing.closingAdditionals : []);
          setBillingInvoices(Array.isArray(closing.billingInvoices) ? closing.billingInvoices : []);
          setPickupRecords(Array.isArray(closing.pickupRecords) ? closing.pickupRecords : []);
          setDedicatedRecords(Array.isArray(closing.dedicatedRecords) ? closing.dedicatedRecords : []);
          setFinancialEntries(Array.isArray(closing.financialEntries) ? closing.financialEntries : []);
          setFinancialAccountNames(Array.isArray(closing.financialAccountNames) ? closing.financialAccountNames : []);
          cloudVersionsRef.current.closing = closingRecord?.version || "";
        } else {
          cloudVersionsRef.current.closing = await saveCloudState("closing", {
            entries: [],
            referenceEntries: [],
            importInfo: null,
            covers: [],
            coverGenerators: [],
            closingAdditionals: [],
            billingInvoices: [],
            pickupRecords: [],
            dedicatedRecords: [],
            financialEntries: [],
            financialAccountNames: [],
          });
        }
        const scans = scansRecord?.value;
        if (scans && typeof scans === "object") setScannedCtes(scans);
        else setScannedCtes({});
        cloudVersionsRef.current.scans =
          scansRecord?.version || (await saveCloudState("scans", {}));

        const tde = tdeRecord?.value;
        if (tde?.rates && Array.isArray(tde.rates)) {
          setTdeRates(
            tde.rates.map((rate) => ({
              ...rate,
              partnerName: canonicalPartnerName(rate.partnerId, rate.partnerName),
            })),
          );
          setTdeImportInfo(tde.importInfo || null);
        } else {
          setTdeRates([]);
          setTdeImportInfo(null);
        }
        cloudVersionsRef.current.tde =
          tdeRecord?.version ||
          (await saveCloudState("tde", { rates: [], importInfo: null }));

        const maex = maexRecord?.value;
        if (maex && typeof maex === "object") setMaexAdditionalSenders(maex);
        else setMaexAdditionalSenders({});
        cloudVersionsRef.current.maex =
          maexRecord?.version || (await saveCloudState("maex", {}));

        const billed = billedRecord?.value;
        if (billed && typeof billed === "object")
          setBilledDocuments(normalizeBilledDocuments(billed));
        else setBilledDocuments({});
        cloudVersionsRef.current.billed =
          billedRecord?.version || (await saveCloudState("billed", {}));

        const romaneios = romaneiosRecord?.value;
        if (Array.isArray(romaneios?.entries)) {
          setRomaneioEntries(romaneios.entries);
          setRomaneioImportInfo(romaneios.importInfo || null);
          setRomaneioDocumentStatuses(romaneios.documentStatuses || {});
          setRomaneioRouteLabels(romaneios.routeLabels || {});
          setRomaneioGroupNotes(romaneios.groupNotes || {});
          setManualRomaneioFreights(romaneios.manualFreights || {});
          setRomaneioPickupQuantities(romaneios.pickupQuantities || {});
          setDriverClosingDiscountPlans(romaneios.driverDiscountPlans || {});
        } else {
          setRomaneioEntries([]);
          setRomaneioImportInfo(null);
          setRomaneioDocumentStatuses({});
          setRomaneioRouteLabels({});
          setRomaneioGroupNotes({});
          setManualRomaneioFreights({});
          setRomaneioPickupQuantities({});
          setDriverClosingDiscountPlans({});
        }
        cloudVersionsRef.current.romaneios =
          romaneiosRecord?.version ||
          (await saveCloudState("romaneios", {
            entries: [],
            importInfo: null,
            documentStatuses: {},
            routeLabels: {},
            groupNotes: {},
            manualFreights: {},
            pickupQuantities: {},
            driverDiscountPlans: {},
          }));

        if (!cancelled) {
          cloudSaveFailedRef.current = false;
          setCloudReady(true);
          setCloudStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setCloudReady(false);
          setCloudStatus("error");
        }
      }
    };
    void restoreCloudData();
    return () => {
      cancelled = true;
    };
  }, [cloudRetry, hydrated]);
  useEffect(() => {
    if (!hydrated || isHostedSite()) return;
    let cancelled = false;
    void writeClosingStorage({ entries, referenceEntries: romaneioReferenceEntries, covers, closingAdditionals, billingInvoices, pickupRecords, dedicatedRecords, financialEntries, financialAccountNames })
      .then(() => {
        try {
          localStorage.removeItem(CLOSING_STORAGE_KEY);
        } catch {
          /* o relatório já está salvo no armazenamento de maior capacidade */
        }
      })
      .catch(() => {
        if (
          !writeLocalStorage(CLOSING_STORAGE_KEY, {
            entries,
            referenceEntries: romaneioReferenceEntries,
            closingAdditionals,
            billingInvoices,
            pickupRecords,
            dedicatedRecords,
            financialEntries,
            financialAccountNames,
          }) &&
          !cancelled
        )
          setMessage(
            "O relatório continua aberto, mas o navegador não conseguiu salvá-lo. Não recarregue a página antes de exportar.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [billingInvoices, closingAdditionals, covers, dedicatedRecords, entries, financialAccountNames, financialEntries, hydrated, pickupRecords, romaneioReferenceEntries]);
  useEffect(() => {
    if (!hydrated || isHostedSite() || !importInfo) return;
    if (writeLocalStorage(GENERAL_IMPORT_INFO_STORAGE_KEY, importInfo)) return;
    const timer = window.setTimeout(
      () =>
        setMessage(
          "O navegador não conseguiu salvar as informações do último relatório.",
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [hydrated, importInfo]);
  useEffect(() => {
    if (!hydrated || isHostedSite()) return;
    let cancelled = false;
    void writeBilledStorage(billedDocuments)
      .then(() => {
        try {
          localStorage.removeItem(BILLED_STORAGE_KEY);
        } catch {
          /* o histórico já está salvo no armazenamento principal */
        }
      })
      .catch(() => {
        if (
          !writeLocalStorage(BILLED_STORAGE_KEY, billedDocuments) &&
          !cancelled
        )
          setMessage(
            "O histórico continua ativo nesta sessão, mas o navegador não conseguiu salvá-lo. Não recarregue a página.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [billedDocuments, hydrated]);
  useEffect(() => {
    if (
      !hydrated ||
      isHostedSite() ||
      writeLocalStorage("gmobs-scanned-ctes-v1", scannedCtes)
    )
      return;
    const timer = window.setTimeout(
      () =>
        setMessage(
        "O navegador não conseguiu salvar a última alteração de bipagem.",
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [scannedCtes, hydrated]);
  useEffect(() => {
    if (!hydrated || isHostedSite()) return;
    if (
      writeLocalStorage("gmobs-tde-rates-v1", {
        rates: tdeRates,
        importInfo: tdeImportInfo,
      })
    )
      return;
    const timer = window.setTimeout(
      () =>
        setMessage("O navegador não conseguiu salvar a última alteração de TDE."),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [tdeRates, tdeImportInfo, hydrated]);
  useEffect(() => {
    if (!hydrated || isHostedSite()) return;
    if (
      writeLocalStorage(
        "gmobs-maex-additional-senders-v1",
        maexAdditionalSenders,
      )
    )
      return;
    const timer = window.setTimeout(
      () =>
        setMessage(
          "O navegador não conseguiu salvar a última marcação do adicional Maex.",
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [maexAdditionalSenders, hydrated]);
  useEffect(() => {
    if (!hydrated || isHostedSite()) return;
    if (
      writeLocalStorage(ROMANEIO_STORAGE_KEY, {
        entries: romaneioEntries,
        importInfo: romaneioImportInfo,
        documentStatuses: romaneioDocumentStatuses,
        routeLabels: romaneioRouteLabels,
        groupNotes: romaneioGroupNotes,
        manualFreights: manualRomaneioFreights,
        pickupQuantities: romaneioPickupQuantities,
        driverDiscountPlans: driverClosingDiscountPlans,
      })
    )
      return;
    const timer = window.setTimeout(
      () =>
        setMessage(
          "O navegador não conseguiu salvar a última importação de romaneios.",
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [
    hydrated,
    driverClosingDiscountPlans,
    manualRomaneioFreights,
    romaneioDocumentStatuses,
    romaneioEntries,
    romaneioGroupNotes,
    romaneioImportInfo,
    romaneioPickupQuantities,
    romaneioRouteLabels,
  ]);
  const closingCloudState = useMemo(
    () => ({ entries, referenceEntries: romaneioReferenceEntries, importInfo, covers, coverGenerators, closingAdditionals, billingInvoices, pickupRecords, dedicatedRecords, financialEntries, financialAccountNames }),
    [billingInvoices, closingAdditionals, coverGenerators, covers, dedicatedRecords, entries, financialAccountNames, financialEntries, importInfo, pickupRecords, romaneioReferenceEntries],
  );
  const tdeCloudState = useMemo(
    () => ({ rates: tdeRates, importInfo: tdeImportInfo }),
    [tdeImportInfo, tdeRates],
  );
  const romaneiosCloudState = useMemo(
    () => ({
      entries: romaneioEntries,
      importInfo: romaneioImportInfo,
      documentStatuses: romaneioDocumentStatuses,
      routeLabels: romaneioRouteLabels,
      groupNotes: romaneioGroupNotes,
      manualFreights: manualRomaneioFreights,
      pickupQuantities: romaneioPickupQuantities,
      driverDiscountPlans: driverClosingDiscountPlans,
    }),
    [
      driverClosingDiscountPlans,
      manualRomaneioFreights,
      romaneioDocumentStatuses,
      romaneioEntries,
      romaneioGroupNotes,
      romaneioImportInfo,
      romaneioPickupQuantities,
      romaneioRouteLabels,
    ],
  );
  const markCloudSaveStart = useCallback(() => {
    lastLocalChangeRef.current = Date.now();
    if (cloudWritesRef.current === 0) cloudSaveFailedRef.current = false;
    cloudWritesRef.current += 1;
    setCloudStatus("saving");
  }, []);
  const markCloudChangeQueued = useCallback(() => {
    lastLocalChangeRef.current = Date.now();
  }, []);
  const markCloudSaveFinish = useCallback(
    (stateKey: CloudStateKey, succeeded: boolean, version?: string) => {
      if (!succeeded) cloudSaveFailedRef.current = true;
      if (succeeded && version) cloudVersionsRef.current[stateKey] = version;
      cloudWritesRef.current = Math.max(0, cloudWritesRef.current - 1);
      if (cloudWritesRef.current === 0)
        setCloudStatus(cloudSaveFailedRef.current ? "error" : "ready");
    },
    [],
  );
  useCloudStateSync(
    "closing",
    closingCloudState,
    cloudReady,
    skipCloudSaveRef,
    markCloudChangeQueued,
    markCloudSaveStart,
    markCloudSaveFinish,
  );
  useCloudStateSync(
    "scans",
    scannedCtes,
    cloudReady,
    skipCloudSaveRef,
    markCloudChangeQueued,
    markCloudSaveStart,
    markCloudSaveFinish,
  );
  useCloudStateSync(
    "tde",
    tdeCloudState,
    cloudReady,
    skipCloudSaveRef,
    markCloudChangeQueued,
    markCloudSaveStart,
    markCloudSaveFinish,
  );
  useCloudStateSync(
    "maex",
    maexAdditionalSenders,
    cloudReady,
    skipCloudSaveRef,
    markCloudChangeQueued,
    markCloudSaveStart,
    markCloudSaveFinish,
  );
  useCloudStateSync(
    "billed",
    billedDocuments,
    cloudReady,
    skipCloudSaveRef,
    markCloudChangeQueued,
    markCloudSaveStart,
    markCloudSaveFinish,
  );
  useCloudStateSync(
    "romaneios",
    romaneiosCloudState,
    cloudReady,
    skipCloudSaveRef,
    markCloudChangeQueued,
    markCloudSaveStart,
    markCloudSaveFinish,
  );
  useEffect(() => {
    if (!cloudHosted || !cloudReady) return;
    const markInteraction = () => {
      lastUserInteractionRef.current = Date.now();
    };
    window.addEventListener("keydown", markInteraction, { capture: true });
    window.addEventListener("pointerdown", markInteraction, { capture: true });
    window.addEventListener("input", markInteraction, { capture: true });
    return () => {
      window.removeEventListener("keydown", markInteraction, { capture: true });
      window.removeEventListener("pointerdown", markInteraction, { capture: true });
      window.removeEventListener("input", markInteraction, { capture: true });
    };
  }, [cloudHosted, cloudReady]);
  const refreshCloudData = useCallback(async () => {
    const hasUnsavedRomaneioDrafts = Object.values(romaneioDocumentDrafts).some(
      (drafts) => Object.values(drafts).some((draft) => draft.situation),
    );
    if (
      !cloudReady ||
      cloudWritesRef.current > 0 ||
      cloudSaveFailedRef.current ||
      hasUnsavedRomaneioDrafts ||
      Date.now() - lastLocalChangeRef.current < 15_000 ||
      Date.now() - lastUserInteractionRef.current < 5_000 ||
      document.visibilityState !== "visible"
    )
      return;
    const keys: CloudStateKey[] = [
      "closing",
      "scans",
      "tde",
      "maex",
      "billed",
      "romaneios",
    ];
    try {
      const versions = await Promise.all(
        keys.map(async (key) => [key, await getCloudStateVersion(key)] as const),
      );
      if (
        cloudWritesRef.current > 0 ||
        Object.values(romaneioDocumentDrafts).some((drafts) =>
          Object.values(drafts).some((draft) => draft.situation),
        ) ||
        Date.now() - lastLocalChangeRef.current < 15_000 ||
        Date.now() - lastUserInteractionRef.current < 5_000
      )
        return;
      const changedKeys = versions
        .filter(
          ([key, version]) =>
            version !== undefined && version !== cloudVersionsRef.current[key],
        )
        .map(([key]) => key);
      if (!changedKeys.length) return;

      for (const key of changedKeys) {
        if (key === "closing") {
          const record = await loadCachedCloudStateRecord<{
            entries: Entry[];
            referenceEntries?: RomaneioReferenceEntry[];
            importInfo: ImportInfo | null;
            covers?: CoverExport[];
            coverGenerators?: string[];
            closingAdditionals?: ClosingAdditional[];
            billingInvoices?: BillingInvoice[];
            pickupRecords?: PickupRecord[];
            dedicatedRecords?: DedicatedRecord[];
            financialEntries?: FinancialEntry[];
            financialAccountNames?: string[];
          }>(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          const normalizedEntries = normalizeSavedEntries(
            record.value.entries || [],
          );
          setEntries(normalizedEntries);
          setRomaneioReferenceEntries(
            normalizeRomaneioReferenceEntries(
              record.value.referenceEntries,
              normalizedEntries,
            ),
          );
          setImportInfo(record.value.importInfo || null);
          setCovers(Array.isArray(record.value.covers) ? record.value.covers : []);
          setCoverGenerators(
            Array.isArray(record.value.coverGenerators)
              ? record.value.coverGenerators
              : [...new Set((record.value.covers || []).map((cover) => cover.generatedBy).filter(Boolean) as string[])],
          );
          setClosingAdditionals(Array.isArray(record.value.closingAdditionals) ? record.value.closingAdditionals : []);
          setBillingInvoices(Array.isArray(record.value.billingInvoices) ? record.value.billingInvoices : []);
          setPickupRecords(Array.isArray(record.value.pickupRecords) ? record.value.pickupRecords : []);
          setDedicatedRecords(Array.isArray(record.value.dedicatedRecords) ? record.value.dedicatedRecords : []);
          setFinancialEntries(Array.isArray(record.value.financialEntries) ? record.value.financialEntries : []);
          setFinancialAccountNames(Array.isArray(record.value.financialAccountNames) ? record.value.financialAccountNames : []);
        } else if (key === "scans") {
          const record = await loadCachedCloudStateRecord<
            Record<string, Record<string, ScanRecord>>
          >(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          setScannedCtes(record.value || {});
        } else if (key === "tde") {
          const record = await loadCachedCloudStateRecord<{
            rates: TdeRateRecord[];
            importInfo: TdeImportInfo | null;
          }>(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          setTdeRates(
            (record.value.rates || []).map((rate) => ({
              ...rate,
              partnerName: canonicalPartnerName(rate.partnerId, rate.partnerName),
            })),
          );
          setTdeImportInfo(record.value.importInfo || null);
        } else if (key === "maex") {
          const record = await loadCachedCloudStateRecord<
            Record<string, MaexAdditionalSender>
          >(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          setMaexAdditionalSenders(record.value || {});
        } else if (key === "billed") {
          const record = await loadCachedCloudStateRecord<
            Record<string, BilledDocumentRecord>
          >(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          setBilledDocuments(normalizeBilledDocuments(record.value || {}));
        } else if (key === "romaneios") {
          const record = await loadCachedCloudStateRecord<{
            entries: RomaneioEntry[];
            importInfo: RomaneioImportInfo | null;
            documentStatuses: Record<string, RomaneioDocumentStatusRecord>;
            routeLabels: Record<string, string>;
            groupNotes?: Record<string, string>;
            manualFreights?: Record<string, ManualRomaneioFreight[]>;
            pickupQuantities?: Record<string, number>;
            driverDiscountPlans?: Record<string, DriverClosingDiscountPlan[]>;
          }>(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          setRomaneioEntries(record.value.entries || []);
          setRomaneioImportInfo(record.value.importInfo || null);
          setRomaneioDocumentStatuses(record.value.documentStatuses || {});
          setRomaneioRouteLabels(record.value.routeLabels || {});
          setRomaneioGroupNotes(record.value.groupNotes || {});
          setManualRomaneioFreights(record.value.manualFreights || {});
          setRomaneioPickupQuantities(record.value.pickupQuantities || {});
          setDriverClosingDiscountPlans(record.value.driverDiscountPlans || {});
        }
      }
      setCloudStatus("ready");
    } catch {
      cloudSaveFailedRef.current = false;
      setCloudReady(false);
      setCloudStatus("error");
    }
  }, [cloudReady, romaneioDocumentDrafts]);
  useEffect(() => {
    if (!cloudHosted || !cloudReady || authStatus !== "signedIn") return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshCloudData();
    };
    const interval = window.setInterval(refreshWhenVisible, 20_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [authStatus, cloudHosted, cloudReady, refreshCloudData]);
  const entriesWithTde = useMemo(() => {
    const baseEntries = applyTdeRates(entries, tdeRates);
    const additionalEntries = closingAdditionals.flatMap((additional) => {
      const targets = additional.persistent
        ? baseEntries.filter(
            (entry) =>
              entry.partnerId === additional.partnerId &&
              normalized(entry.recipient) === additional.recipientKey,
          )
        : baseEntries.filter((entry) => entry.id === additional.sourceEntryId);
      return targets.map((entry): Entry => ({
        ...entry,
        id: `additional-${additional.id}-${entry.id}`,
        status: additional.kind === "cf" ? "CF" : `AD-${additional.kind.toUpperCase()}`,
        observation: `${additional.kind.toUpperCase()} lançado manualmente por ${additional.createdBy} · ${additional.calculation === "direct" ? "direto no fechamento" : "antes dos descontos"}`,
        freight: 0,
        reportedTotal: additional.kind === "tde" ? 0 : additional.value,
        tde: additional.kind === "tde" ? additional.value : 0,
        tda: additional.kind === "tda" ? additional.value : 0,
        trt: 0,
        dedicated: additional.kind === "dedicated" ? additional.value : 0,
        adjustment: 0,
        isRedelivery: false,
      }));
    });
    return [...baseEntries, ...additionalEntries];
  }, [closingAdditionals, entries, tdeRates]);
  const closingAdditionalMatch = useMemo(
    () => entries.find((entry) => entryMatchesGlobalDocumentScan(entry, closingAdditionalSearch)),
    [closingAdditionalSearch, entries],
  );
  const latestGeneralEmissionDate = useMemo(
    () =>
      entries.reduce((latest, entry) => {
        const date = String(entry.date || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return latest;
        return !latest || date > latest ? date : latest;
      }, ""),
    [entries],
  );
  const romaneioDocumentMatches = useMemo(() => {
    const mdes = new Map<string, RomaneioReferenceEntry[]>();
    const ctes = new Map<string, RomaneioReferenceEntry[]>();
    const references = [
      ...new Map(
        [
          ...entriesWithTde
            .filter((entry) => normalized(entry.status) !== "cf")
            .map(asRomaneioReferenceEntry),
          ...romaneioReferenceEntries,
        ].map((entry) => [entry.id, entry] as const),
      ).values(),
    ];
    references.forEach((entry) => {
      const mde = numericDocumentId(entry.mde);
      const cte = numericDocumentId(entry.cte);
      const cteFromKey = cteNumberFromAccessKey(entry.cteKey);
      if (mde) mdes.set(mde, [...(mdes.get(mde) || []), entry]);
      if (cte) ctes.set(cte, [...(ctes.get(cte) || []), entry]);
      if (cteFromKey) ctes.set(cteFromKey, [...(ctes.get(cteFromKey) || []), entry]);
    });
    const matches = new Map<
      string,
      {
        type: "MD-e" | "CT-e" | "Documento";
        number: string;
        found: boolean;
        entries: RomaneioReferenceEntry[];
      }
    >();
    romaneioEntries.forEach((row) =>
      row.documents.forEach((document) => {
        if (matches.has(document)) return;
        const reference = romaneioDocumentReference(document);
        const matchedEntries = reference
          ? reference.type === "MD-e"
            ? mdes.get(reference.number) || []
            : ctes.get(reference.number) || []
          : [];
        matches.set(document, {
          type: reference?.type || "Documento",
          number: reference?.number || document,
          found: matchedEntries.length > 0,
          entries: matchedEntries,
        });
      }),
    );
    return matches;
  }, [entriesWithTde, romaneioEntries, romaneioReferenceEntries]);
  const romaneioDailyGroups = useMemo(() => {
    const groups = new Map<string, RomaneioDailyGroup>();
    romaneioEntries.forEach((row) => {
      const day = row.emissionDate.slice(0, 10) || "sem-data";
      const driverIdentity = normalizeCnpj(row.cpf) || normalized(row.driver);
      const romaneioIdentity = normalized(row.romaneio) || `sem-romaneio-${row.id}`;
      const key = `${day}|${driverIdentity || "sem-motorista"}|${romaneioIdentity}`;
      const current = groups.get(key) || {
        key,
        day,
        emissionDate: row.emissionDate,
        driver: row.driver || "Motorista não informado",
        cpf: row.cpf,
        plates: [],
        vehicleTypes: [],
        romaneios: [],
        routes: [],
        freight: 0,
        weight: 0,
        deliveries: 0,
        volumes: 0,
        importedTotalsByRomaneio: {},
        documents: [],
        sourceFiles: [],
      };
      if (!current.driver && row.driver) current.driver = row.driver;
      if (!current.cpf && row.cpf) current.cpf = row.cpf;
      if (row.plate && !current.plates.includes(row.plate))
        current.plates.push(row.plate);
      if (
        row.vehicleType &&
        !current.vehicleTypes.includes(row.vehicleType)
      )
        current.vehicleTypes.push(row.vehicleType);
      if (!current.romaneios.includes(row.romaneio))
        current.romaneios.push(row.romaneio);
      if (row.route && !current.routes.includes(row.route))
        current.routes.push(row.route);
      if (!current.sourceFiles.includes(row.sourceFile))
        current.sourceFiles.push(row.sourceFile);
      const romaneioTotalKey = normalized(row.romaneio) || row.id;
      const previousTotal = current.importedTotalsByRomaneio[romaneioTotalKey];
      current.importedTotalsByRomaneio[romaneioTotalKey] = {
        freight: roundMoney((previousTotal?.freight || 0) + row.freight),
        weight: roundMoney((previousTotal?.weight || 0) + row.weight),
        deliveries: (previousTotal?.deliveries || 0) + row.deliveries,
        volumes: (previousTotal?.volumes || 0) + row.volumes,
      };

      row.documents.forEach((document) => {
        const documentKey = romaneioDocumentKey(document);
        const existing = current.documents.find(
          (candidate) => candidate.key === documentKey,
        );
        if (existing) {
          if (row.route && !existing.routes.includes(row.route))
            existing.routes.push(row.route);
          return;
        }
        const match = romaneioDocumentMatches.get(document);
        const linkedEntries = match?.entries || [];
        const linked =
          linkedEntries.find(
            (entry) =>
              entry.sender ||
              entry.recipient ||
              entry.city ||
              entry.reportedTotal ||
              entry.freight,
          ) || linkedEntries[0];
        const identifiers = [
          match?.number,
          ...linkedEntries.flatMap((entry) => [
            numericDocumentId(entry.mde),
            numericDocumentId(entry.cte),
            operationalIdentifier(entry.cteKey),
            cteNumberFromAccessKey(entry.cteKey),
            normalizeInvoiceKey(entry.invoice),
            operationalIdentifier(entry.invoice),
          ]),
        ].filter(Boolean) as string[];
        const grossFreight = linked?.reportedTotal ?? linked?.freight ?? 0;
        current.documents.push({
          key: documentKey,
          document,
          referenceType: match?.type || "Documento",
          referenceNumber: match?.number || document,
          linkedEntries,
          sourceStatus: linked?.sourceStatus || linked?.status || "",
          sender: linked?.sender || "",
          recipient: linked?.recipient || "",
          city: linked?.city || row.route || "",
          mde: linked?.mde || "",
          cte: linked?.cte || "",
          invoice: linked?.invoice || "",
          routes: row.route ? [row.route] : [],
          grossFreight,
          production: roundMoney(
            grossFreight * ROMANEIO_PRODUCTION_FACTOR,
          ),
          identifiers: [...new Set(identifiers)],
        });
      });
      groups.set(key, current);
    });
    return [...groups.values()]
      .map((group) => {
        const totals = Object.values(group.importedTotalsByRomaneio);
        return {
          ...group,
          documents: [...group.documents].sort((a, b) =>
            (a.recipient || a.sender || a.referenceNumber).localeCompare(
              b.recipient || b.sender || b.referenceNumber,
              "pt-BR",
            ),
          ),
          freight: roundMoney(
            totals.reduce((sum, total) => sum + total.freight, 0),
          ),
          weight: roundMoney(
            totals.reduce((sum, total) => sum + total.weight, 0),
          ),
          deliveries: totals.reduce((sum, total) => sum + total.deliveries, 0),
          volumes: totals.reduce((sum, total) => sum + total.volumes, 0),
        };
      })
      .sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        a.driver.localeCompare(b.driver, "pt-BR"),
    );
  }, [romaneioDocumentMatches, romaneioEntries]);
  const romaneioScanIndex = useMemo(() => {
    const index = new Map<string, { group: RomaneioDailyGroup; document: RomaneioDailyDocument; order: number }[]>();
    let order = 0;
    for (const group of romaneioDailyGroups) {
      for (const document of group.documents) {
        for (const identifier of document.identifiers) {
          const matches = index.get(identifier) || [];
          matches.push({ group, document, order });
          index.set(identifier, matches);
        }
        order++;
      }
    }
    return index;
  }, [romaneioDailyGroups]);
  function findRomaneioScanMatches(identifiers: string[]) {
    const found = new Map<string, { group: RomaneioDailyGroup; document: RomaneioDailyDocument; order: number }>();
    for (const identifier of identifiers)
      for (const match of romaneioScanIndex.get(identifier) || [])
        found.set(`${match.group.key}|${match.document.key}`, match);
    return [...found.values()]
      .sort((left, right) => left.order - right.order)
      .map(({ group, document }) => ({ group, document }));
  }
  const visibleRomaneioGroups = useMemo(() => {
    const term = normalized(deferredRomaneioSearch);
    return romaneioDailyGroups.filter((group) => {
      if (!term && focusedRomaneioKey) return group.key === focusedRomaneioKey;
      if (!term) return true;
      return normalized(
        [
          group.driver,
          group.cpf,
          ...group.romaneios,
          ...group.plates,
          ...group.vehicleTypes,
          ...group.routes,
          ...group.documents.flatMap((document) => [
            document.document,
            document.mde,
            document.cte,
            document.invoice,
            document.sender,
            document.recipient,
            document.city,
          ]),
        ].join(" "),
      ).includes(term);
    });
  }, [deferredRomaneioSearch, focusedRomaneioKey, romaneioDailyGroups]);
  const visibleFullRomaneioGroups = useMemo(() => {
    const term = normalized(deferredRomaneioFullSearch);
    if (!term) return romaneioDailyGroups;
    return romaneioDailyGroups.filter((group) =>
      normalized(
        [
          group.driver,
          group.cpf,
          group.day,
          formatRomaneioDay(group.day),
          ...group.romaneios,
          ...group.plates,
          ...group.vehicleTypes,
          ...group.routes,
          romaneioRouteLabels[group.key],
          romaneioGroupNotes[group.key],
          ...group.documents.flatMap((document) => [
            document.document,
            document.referenceNumber,
            document.sender,
            document.recipient,
            document.city,
            document.invoice,
            romaneioSituationLabel[
              romaneioStatusForDocument(romaneioDocumentStatuses, group, document)?.situation || "delivered"
            ],
          ]),
        ].join(" "),
      ).includes(term),
    );
  }, [
    romaneioDailyGroups,
    romaneioDocumentStatuses,
    deferredRomaneioFullSearch,
    romaneioGroupNotes,
    romaneioRouteLabels,
  ]);
  const displayedRomaneioGroups = useMemo(
    () => visibleRomaneioGroups.slice(0, romaneioListLimit),
    [romaneioListLimit, visibleRomaneioGroups],
  );
  const displayedFullRomaneioGroups = useMemo(
    () => visibleFullRomaneioGroups.slice(0, romaneioFullListLimit),
    [romaneioFullListLimit, visibleFullRomaneioGroups],
  );
  const retainedRomaneioDocuments = useMemo(
    () =>
      Object.values(romaneioDocumentStatuses)
        .filter(
          (record) =>
            record.situation === "retained" ||
            (record.situation === "driver-missing" &&
              romaneioDaysElapsed(record.day) >= 3),
        )
        .sort(
          (a, b) =>
            b.day.localeCompare(a.day) ||
            a.driver.localeCompare(b.driver, "pt-BR"),
        ),
    [romaneioDocumentStatuses],
  );
  const visibleRetainedRomaneioDocuments = useMemo(() => {
    const driver = normalized(retainedDriverFilter);
    const partner = normalized(retainedPartnerFilter);
    return retainedRomaneioDocuments.filter((record) => {
      const currentDocument = romaneioDailyGroups
        .flatMap((group) => group.documents)
        .find((document) =>
          document.identifiers.some((identifier) => record.identifiers.includes(identifier)),
        );
      const partnerNames = currentDocument?.linkedEntries.map((entry) => entry.partnerName).join(" ") || "";
      return (!driver || normalized(record.driver).includes(driver)) &&
        (!partner || normalized(partnerNames).includes(partner));
    });
  }, [retainedDriverFilter, retainedPartnerFilter, retainedRomaneioDocuments, romaneioDailyGroups]);
  const retainedDriverRanking = useMemo(() => {
    const drivers = new Map<string, { driver: string; ctes: Set<string> }>();
    retainedRomaneioDocuments.forEach((record) => {
      const driver = record.driver?.trim() || "Motorista não informado";
      const driverKey = normalized(driver) || "motorista-nao-informado";
      const current = drivers.get(driverKey) || { driver, ctes: new Set<string>() };
      const cte = scanKey(record.cte) ||
        (record.referenceType === "CT-e" ? scanKey(record.referenceNumber) : "") ||
        record.key;
      current.ctes.add(cte);
      drivers.set(driverKey, current);
    });
    return Array.from(drivers.values())
      .map((item) => ({ driver: item.driver, count: item.ctes.size }))
      .sort((a, b) => b.count - a.count || a.driver.localeCompare(b.driver, "pt-BR"));
  }, [retainedRomaneioDocuments]);
  const missingDocumentsByDriver = useMemo(() => {
    const records = new Map<string, RomaneioDocumentStatusRecord[]>();
    Object.values(romaneioDocumentStatuses)
      .filter((record) => record.situation === "driver-missing")
      .forEach((record) => {
        const driverKey = normalized(record.driver);
        records.set(driverKey, [...(records.get(driverKey) || []), record]);
      });
    return records;
  }, [romaneioDocumentStatuses]);
  const savedRomaneioProduction = useCallback(
    (group: RomaneioDailyGroup) => {
      const manualProduction = (manualRomaneioFreights[group.key] || []).reduce(
        (sum, item) => sum + manualFreightProduction(item.grossFreight),
        0,
      );
      const payableDocuments = group.documents.filter((document) => {
        const situation = romaneioStatusForDocument(romaneioDocumentStatuses, group, document)?.situation;
        return situation === "delivered" || situation === "retained";
      });
      const documentProduction = payableDocuments.reduce(
        (sum, document) => sum + document.production,
        0,
      );
      if (documentProduction > 0)
        return roundMoney(documentProduction + manualProduction);
      return payableDocuments.length
        ? roundMoney(group.freight * ROMANEIO_PRODUCTION_FACTOR + manualProduction)
        : roundMoney(manualProduction);
    },
    [manualRomaneioFreights, romaneioDocumentStatuses],
  );
  const romaneioOperationalDocumentCount = useCallback(
    (group: RomaneioDailyGroup) =>
      group.documents.length +
      (manualRomaneioFreights[group.key]?.length || 0) +
      (romaneioPickupQuantities[group.key] || 0),
    [manualRomaneioFreights, romaneioPickupQuantities],
  );
  const driverClosingProductionForGroup = useCallback(
    (group: RomaneioDailyGroup) => {
      const deliveredDocuments = group.documents.filter(
        (document) =>
          romaneioStatusForDocument(romaneioDocumentStatuses, group, document)?.situation === "delivered",
      );
      const manualProduction = (manualRomaneioFreights[group.key] || []).reduce(
        (sum, item) => sum + manualFreightProduction(item.grossFreight),
        0,
      );
      const documentProduction = deliveredDocuments.reduce(
        (sum, document) => sum + document.production,
        0,
      );
      if (documentProduction > 0)
        return roundMoney(documentProduction + manualProduction);
      return deliveredDocuments.length
        ? roundMoney(group.freight * ROMANEIO_PRODUCTION_FACTOR + manualProduction)
        : roundMoney(manualProduction);
    },
    [manualRomaneioFreights, romaneioDocumentStatuses],
  );
  const currentDriverClosingDiscounts = useCallback(
    (
      driverKey: string,
      plans: Record<string, DriverClosingDiscountPlan[]> =
        driverClosingDiscountPlans,
    ): DriverClosingDiscount[] =>
      (plans[driverKey] || [])
        .filter((plan) => plan.nextInstallment <= plan.installments)
        .map((plan) => ({
          description: "DESCONTO",
          amount: roundMoney(plan.totalAmount / plan.installments),
          installment: plan.nextInstallment,
          installments: plan.installments,
        })),
    [driverClosingDiscountPlans],
  );
  const driverClosingSummaries = useMemo<DriverClosingSummary[]>(() => {
    const withinPeriod = (day: string) =>
      (!driverClosingFrom || day >= driverClosingFrom) &&
      (!driverClosingTo || day <= driverClosingTo);
    const drivers = new Map<
      string,
      {
        key: string;
        driver: string;
        cpf: Set<string>;
        plates: Set<string>;
        vehicleTypes: Set<string>;
        days: Map<
          string,
          {
            cities: Set<string>;
            invoices: Set<string>;
            freight: number;
            romaneios: Set<string>;
            observations: Set<string>;
          }
        >;
      }
    >();
    romaneioDailyGroups
      .filter((group) => withinPeriod(group.day))
      .forEach((group) => {
        const key = normalized(group.driver) || "motorista-nao-informado";
        const current = drivers.get(key) || {
          key,
          driver: group.driver || "Motorista não informado",
          cpf: new Set<string>(),
          plates: new Set<string>(),
          vehicleTypes: new Set<string>(),
          days: new Map(),
        };
        if (group.cpf) current.cpf.add(group.cpf);
        group.plates.filter(Boolean).forEach((plate) => current.plates.add(plate));
        group.vehicleTypes
          .filter(Boolean)
          .forEach((vehicle) => current.vehicleTypes.add(vehicle));
        drivers.set(key, current);
      });
    romaneioDailyGroups
      .filter((group) => withinPeriod(group.day))
      .forEach((group) => {
        const countedDocuments = group.documents.filter((document) => {
          const situation = romaneioStatusForDocument(romaneioDocumentStatuses, group, document)?.situation;
          return situation === "delivered" || situation === "return";
        });
        const manualCount = manualRomaneioFreights[group.key]?.length || 0;
        const pickupCount = romaneioPickupQuantities[group.key] || 0;
        if (!countedDocuments.length && !manualCount && !pickupCount) return;
        const driverKey = normalized(group.driver) || "motorista-nao-informado";
        const driver = drivers.get(driverKey);
        if (!driver) return;
        const day = driver.days.get(group.day) || {
          cities: new Set<string>(),
          invoices: new Set<string>(),
          freight: 0,
          romaneios: new Set<string>(),
          observations: new Set<string>(),
        };
        const routeLabel =
          romaneioRouteLabels[group.key] || group.routes.join(" · ");
        const groupNote = (romaneioGroupNotes[group.key] || "").trim();
        group.romaneios.forEach((romaneio) => day.romaneios.add(romaneio));
        if (groupNote) day.observations.add(groupNote);
        countedDocuments.forEach((document) => {
          if (document.city) day.cities.add(document.city);
          day.invoices.add(
            normalizeInvoiceKey(document.invoice) || `documento:${document.key}`,
          );
        });
        (manualRomaneioFreights[group.key] || []).forEach((item) =>
          day.invoices.add(
            normalizeInvoiceKey(item.invoice) || `manual:${item.id}`,
          ),
        );
        if (!day.cities.size && routeLabel) day.cities.add(routeLabel);
        day.freight = roundMoney(
          day.freight + driverClosingProductionForGroup(group),
        );
        for (let index = 0; index < (romaneioPickupQuantities[group.key] || 0); index++)
          day.invoices.add(`coleta:${group.key}:${index}`);
        driver.days.set(group.day, day);
      });
    return [...drivers.values()]
      .map((driver) => {
        const days = [...driver.days.entries()]
          .map(
            ([date, day]): DriverClosingDay => ({
              date,
              cities: [...day.cities].sort((a, b) =>
                a.localeCompare(b, "pt-BR"),
              ),
              romaneios: [...day.romaneios].sort(),
              observation: [...day.observations].join(" · "),
              invoiceCount: day.invoices.size,
              freight: day.freight,
            }),
          )
          .sort((a, b) => a.date.localeCompare(b.date));
        return {
          key: driver.key,
          driver: driver.driver,
          cpf: [...driver.cpf].join(" · "),
          plates: [...driver.plates].sort(),
          vehicleTypes: [...driver.vehicleTypes].sort(),
          days,
          totalInvoices: days.reduce((sum, day) => sum + day.invoiceCount, 0),
          totalFreight: roundMoney(
            days.reduce((sum, day) => sum + day.freight, 0),
          ),
        };
      })
      .sort((a, b) => a.driver.localeCompare(b.driver, "pt-BR"));
  }, [
    driverClosingFrom,
    driverClosingTo,
    romaneioDailyGroups,
    romaneioDocumentStatuses,
    romaneioGroupNotes,
    romaneioRouteLabels,
    manualRomaneioFreights,
    romaneioPickupQuantities,
    driverClosingProductionForGroup,
  ]);
  const selectedDriverClosingReports = useMemo(
    () =>
      driverClosingSummaries
        .filter((driver) => selectedDriverClosings.includes(driver.key))
        .map(
          (driver): DriverClosingPreviewReport => ({
            key: driver.key,
            driver: driver.driver,
            cpf: driver.cpf,
            plates: driver.plates,
            vehicleTypes: driver.vehicleTypes,
            periodFrom: driverClosingFrom,
            periodTo: driverClosingTo,
            discounts: currentDriverClosingDiscounts(driver.key),
            days: driver.days.map((day) => {
              const edit =
                driverClosingDayEdits[
                  driverClosingDayEditKey(driver.key, day.date)
                ];
              return {
                ...day,
                cityText:
                  edit?.cityText !== undefined
                    ? edit.cityText
                    : day.cities.join(" · "),
                observation: edit?.observation || "",
              };
            }),
          }),
        ),
    [
      driverClosingDayEdits,
      driverClosingFrom,
      driverClosingSummaries,
      driverClosingTo,
      currentDriverClosingDiscounts,
      selectedDriverClosings,
    ],
  );
  const currentRomaneioDocumentsByKey = useMemo(() => {
    const documents = new Map<string, RomaneioDailyDocument>();
    romaneioDailyGroups.forEach((group) =>
      group.documents.forEach((document) => {
        if (!documents.has(document.key)) documents.set(document.key, document);
      }),
    );
    return documents;
  }, [romaneioDailyGroups]);
  const reportFallbackIdentifiersByIdentifier = useMemo(() => {
    const matches = new Map<string, Set<string>>();
    entriesWithTde.forEach((entry) => {
      if (normalized(entry.status) === "cf") return;
      const identifiers = entryOperationalIdentifiers(entry);
      identifiers.forEach((identifier) => {
        const current = matches.get(identifier) || new Set<string>();
        identifiers.forEach((linkedIdentifier) => current.add(linkedIdentifier));
        matches.set(identifier, current);
      });
    });
    return matches;
  }, [entriesWithTde]);
  const retainedRomaneioByIdentifier = useMemo(() => {
    const matches = new Map<string, RomaneioDocumentStatusRecord>();
    retainedRomaneioDocuments.forEach((record) => {
      record.identifiers.forEach((identifier) => {
        if (!matches.has(identifier)) matches.set(identifier, record);
      });
    });
    return matches;
  }, [retainedRomaneioDocuments]);
  const manualClientOptions = useMemo(() => {
    const options = new Map<string, ManualClientOption>();
    const addOption = (
      nameValue: string,
      cnpjValue: string,
      source: ManualClientOption["source"],
    ) => {
      const name = nameValue.trim();
      if (!name) return;
      const key = normalized(name);
      const cnpj = normalizeCnpj(cnpjValue);
      const current = options.get(key) || { name, cnpjs: [], source };
      if (cnpj && !current.cnpjs.includes(cnpj)) current.cnpjs.push(cnpj);
      if (source === "Lista TDE" || current.source === "Relatório")
        current.source = source;
      options.set(key, current);
    };
    tdeRates.forEach((rate) => {
      addOption(
        rate.clientName,
        rate.cnpj,
        rate.source === "file" ? "Lista TDE" : "Cadastro manual",
      );
    });
    entriesWithTde.forEach((entry) => {
      addOption(entry.recipient, entry.recipientCnpj, "Relatório");
    });
    return [...options.values()];
  }, [entriesWithTde, tdeRates]);
  const manualClientSuggestions = useMemo(() => {
    const term = normalized(manualClientName);
    const digits = manualClientName.replace(/\D/g, "");
    if (term.length < 2 && digits.length < 3) return [];
    return manualClientOptions
      .filter(
        (client) =>
          normalized(client.name).includes(term) ||
          Boolean(
            digits && client.cnpjs.some((cnpj) => cnpj.includes(digits)),
          ),
      )
      .sort((a, b) => {
        const aStarts = normalized(a.name).startsWith(term) ? 0 : 1;
        const bStarts = normalized(b.name).startsWith(term) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name, "pt-BR");
      })
      .slice(0, 8);
  }, [manualClientName, manualClientOptions]);
  const normalBilledKeys = useMemo(
    () =>
      new Set(
        Object.values(billedDocuments)
          .filter((document) => document.billingScope === "normal")
          .map((document) => document.key),
      ),
    [billedDocuments],
  );
  const maexAdditionalBilledKeys = useMemo(
    () =>
      new Set(
        Object.values(billedDocuments)
          .filter(
            (document) => document.billingScope === "maex-additional",
          )
          .map((document) => document.key),
      ),
    [billedDocuments],
  );
  const currentBilledEntries = useMemo(
    () =>
      entriesWithTde.filter((entry) => {
        const normalKey = billedDocumentKey(entry.partnerId, entry.cte);
        const additionalKey = billedDocumentKey(
          entry.partnerId,
          entry.cte,
          "maex-additional",
        );
        return (
          normalBilledKeys.has(normalKey) ||
          (entry.partnerId === "maex" &&
            maexAdditionalBilledKeys.has(additionalKey))
        );
      }),
    [entriesWithTde, maexAdditionalBilledKeys, normalBilledKeys],
  );
  const periodFiltered = useMemo(
    () =>
      entriesWithTde.filter(
        (entry) => matchesNormalClosingPeriod(entry, dateFrom, dateTo),
      ),
    [entriesWithTde, dateFrom, dateTo],
  );
  const billedInPeriod = useMemo(
    () =>
      periodFiltered.filter((entry) =>
        normalBilledKeys.has(billedDocumentKey(entry.partnerId, entry.cte)),
      ),
    [normalBilledKeys, periodFiltered],
  );
  const filtered = useMemo(
    () =>
      periodFiltered.filter(
        (entry) =>
          !normalBilledKeys.has(billedDocumentKey(entry.partnerId, entry.cte)),
      ),
    [normalBilledKeys, periodFiltered],
  );
  const maexAdditionalOpenRows = useMemo(
    () =>
      entriesWithTde.filter(
        (entry) =>
          entry.partnerId === "maex" &&
          matchesMaexAdditionalCutoff(entry.date, dateTo) &&
          !maexAdditionalBilledKeys.has(
            billedDocumentKey("maex", entry.cte, "maex-additional"),
          ),
      ),
    [dateTo, entriesWithTde, maexAdditionalBilledKeys],
  );
  const billedSources = useMemo(() => {
    const sources = new Map<
      string,
      { name: string; keys: Set<string>; partners: Set<string> }
    >();
    Object.values(billedDocuments).forEach((document) => {
      document.sources.forEach((source) => {
        const current = sources.get(source) || {
          name: source,
          keys: new Set<string>(),
          partners: new Set<string>(),
        };
        current.keys.add(document.key);
        current.partners.add(
          document.billingScope === "maex-additional"
            ? "Maex (somente adicional)"
            : document.partnerName,
        );
        sources.set(source, current);
      });
    });
    return [...sources.values()]
      .map((source) => ({
        name: source.name,
        count: source.keys.size,
        partners: [...source.partners].sort((a, b) =>
          a.localeCompare(b, "pt-BR"),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [billedDocuments]);
  const partners = useMemo(() => {
    const map = new Map<string, { id: string; name: string; rows: Entry[] }>();
    filtered.forEach((entry) => {
      const current = map.get(entry.partnerId) || {
        id: entry.partnerId,
        name: canonicalPartnerName(entry.partnerId, entry.partnerName),
        rows: [],
      };
      current.rows.push(entry);
      map.set(entry.partnerId, current);
    });
    if (maexAdditionalOpenRows.length && !map.has("maex"))
      map.set("maex", { id: "maex", name: "Maex", rows: [] });
    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
  }, [filtered, maexAdditionalOpenRows.length]);
  const pajussaraComparison = useMemo(() => {
    if (!pajussaraClosing) return null;
    const rows = partners.find((partner) => partner.id === "pajucara")?.rows || [];
    return comparePajussaraDocuments(rows, pajussaraClosing.documents);
  }, [pajussaraClosing, partners]);
  const active = partners.find((p) => p.id === selectedPartner) || partners[0];
  const scannedLookupByPartner = useMemo(() => {
    const lookup = new Map<string, Set<string>>();
    Object.entries(scannedCtes).forEach(([partnerId, scans]) => {
      lookup.set(partnerId, new Set(Object.keys(scans || {})));
    });
    return lookup;
  }, [scannedCtes]);
  const coverPartners = useMemo(() => {
    return partnerAliases
      .filter(([id]) => id !== "unidentified")
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, []);
  const effectiveCoverPartnerId = coverPartnerId || coverPartners[0]?.id || "";
  const effectiveCoverGenerator = activeOperator;
  const coverDraftKey = `${coverSection}|${effectiveCoverPartnerId}`;
  const currentCoverDraft = coverDrafts[coverDraftKey] || [];
  const reportCovers = useMemo(
    () => covers.filter((cover) => {
      const day = cover.createdAt.slice(0, 10);
      const dateMatches = (!coverReportFrom || day >= coverReportFrom) && (!coverReportTo || day <= coverReportTo);
      const search = scanKey(coverReportSearch);
      const coverMatches = !search || scanKey(cover.id).includes(search) || String(cover.sequenceNumber || "").includes(search);
      const documentMatches = cover.documents.some((document) => matchesCoverDocumentSearch(document, coverReportSearch));
      return dateMatches && (coverMatches || documentMatches);
    }),
    [coverReportFrom, coverReportSearch, coverReportTo, covers],
  );
  const selectedReportCovers = reportCovers.filter((cover) =>
    selectedCoverReportIds.includes(cover.id),
  );
  const allIds = partners.map((p) => p.id);
  const assignmentPartners = useMemo(() => {
    const options = new Map<string, string>();
    partnerAliases.forEach(([id, name]) => options.set(id, name));
    partners
      .filter((partner) => partner.id !== "unidentified")
      .forEach((partner) => options.set(partner.id, partner.name));
    return [...options].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [partners]);
  const tdePartnerOptions = useMemo(() => {
    const options = new Map<string, string>();
    partnerAliases.forEach(([id, name]) => options.set(id, name));
    partners
      .filter((partner) => partner.id !== "unidentified")
      .forEach((partner) => options.set(partner.id, partner.name));
    tdeRates.forEach((rate) =>
      options.set(
        rate.partnerId,
        canonicalPartnerName(rate.partnerId, rate.partnerName),
      ),
    );
    return [...options].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [partners, tdeRates]);
  const manualTdeRates = useMemo(
    () =>
      tdeRates
        .filter((rate) => rate.source === "manual")
        .sort((a, b) =>
          a.clientName.localeCompare(b.clientName, "pt-BR") ||
          a.partnerName.localeCompare(b.partnerName, "pt-BR"),
        ),
    [tdeRates],
  );
  const manualTdeGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        clientName: string;
        partnerName: string;
        value: number;
        cnpjs: string[];
        ids: string[];
      }
    >();
    manualTdeRates.forEach((rate) => {
      const key = `${normalized(rate.clientName)}|${rate.partnerId}|${rate.value}`;
      const current = groups.get(key) || {
        key,
        clientName: rate.clientName,
        partnerName: canonicalPartnerName(rate.partnerId, rate.partnerName),
        value: rate.value,
        cnpjs: [],
        ids: [],
      };
      if (!current.cnpjs.includes(rate.cnpj)) current.cnpjs.push(rate.cnpj);
      current.ids.push(rate.id);
      groups.set(key, current);
    });
    return [...groups.values()].sort((a, b) =>
      a.clientName.localeCompare(b.clientName, "pt-BR") ||
      a.partnerName.localeCompare(b.partnerName, "pt-BR"),
    );
  }, [manualTdeRates]);
  const unidentifiedGroups = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    filtered
      .filter((entry) => entry.partnerId === "unidentified")
      .forEach((entry) => {
        const key = unidentifiedKey(entry);
        groups.set(key, [...(groups.get(key) || []), entry]);
      });
    return [...groups].map(([key, rows]) => ({ key, rows }));
  }, [filtered]);

  function assignUnidentified(key: string) {
    const choice = assignmentChoices[key];
    const newName = (newPartnerNames[key] || "").trim();
    const partnerId =
      choice === "__new__"
        ? `custom-${normalized(newName).replace(/\s+/g, "-")}`
        : choice;
    const partnerName =
      choice === "__new__"
        ? newName
        : assignmentPartners.find(([id]) => id === partnerId)?.[1];
    if (!partnerId || !partnerName) return;
    setEntries((current) =>
      current.map((entry) =>
        entry.partnerId === "unidentified" && unidentifiedKey(entry) === key
          ? { ...entry, partnerId, partnerName }
          : entry,
      ),
    );
    const quantity = entries.filter(
      (entry) =>
        entry.partnerId === "unidentified" && unidentifiedKey(entry) === key,
    ).length;
    setImportInfo((current) =>
      current
        ? { ...current, unidentified: Math.max(0, current.unidentified - quantity) }
        : current,
    );
    setMessage(`${quantity} registro(s) identificado(s) como ${partnerName}.`);
  }

  function registerScan(partnerId: string) {
    const raw = scanInputRef.current?.value || "";
    const key = scanKey(raw);
    if (!key) return;
    const partner = partners.find((item) => item.id === partnerId);
    const isAccessKey = /^\d{44}$/.test(key);
    const matching =
      partner?.rows.filter((entry) =>
        isAccessKey
          ? scanKey(entry.cteKey) === key
          : scanKey(entry.cte) === key,
      ) || [];
    setScannedCtes((current) => ({
      ...current,
      [partnerId]: {
        ...(current[partnerId] || {}),
        [key]: { scannedAt: new Date().toISOString(), scannedBy: activeOperator },
      },
    }));
    if (scanInputRef.current) scanInputRef.current.value = "";
    if (matching.length) {
      setMessage(
        `${matching.length} registro(s) do CTE ${matching[0].cte} marcado(s) com OK.`,
      );
    } else {
      setMessage(
        `CTE ${raw.trim()} guardado. Ele entrará automaticamente quando aparecer em ${partner?.name || "esta transportadora"}.`,
      );
    }
  }

  async function importScanTxt(
    event: ChangeEvent<HTMLInputElement>,
    partnerId: string,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportingScanTxt(true);
    try {
      const readings = [
        ...new Set(
          (await file.text())
            .split(/[\s,;|\t]+/)
            .map(scanKey)
            .filter((key) => /^\d{1,44}$/.test(key)),
        ),
      ];
      if (!readings.length) {
        setMessage(
          "Não encontrei números de CTE válidos no TXT. Coloque um CTE por linha ou separe por vírgula.",
        );
        return;
      }
      const partner = partners.find((item) => item.id === partnerId);
      const found = readings.filter((key) =>
        partner?.rows.some((entry) =>
          key.length === 44
            ? scanKey(entry.cteKey) === key
            : scanKey(entry.cte) === key,
        ),
      ).length;
      const importedAt = new Date().toISOString();
      setScannedCtes((current) => ({
        ...current,
        [partnerId]: {
          ...(current[partnerId] || {}),
          ...Object.fromEntries(readings.map((key) => [key, { scannedAt: importedAt, scannedBy: activeOperator }])),
        },
      }));
      setMessage(
        `${readings.length} CTE(s) importado(s) do TXT para ${partner?.name || "a transportadora"}: ${found} encontrado(s) e ${readings.length - found} aguardando o relatório.`,
      );
    } catch {
      setMessage("Não foi possível ler o arquivo TXT de CTEs.");
    } finally {
      setImportingScanTxt(false);
    }
  }

  function markEntryScanned(entry: Entry) {
    const key = scanKey(entry.cte) || scanKey(entry.cteKey);
    if (!key) {
      setMessage("Este documento não possui CTE nem chave para receber o OK.");
      return;
    }
    setScannedCtes((current) => ({
      ...current,
      [entry.partnerId]: {
        ...(current[entry.partnerId] || {}),
        [key]: { scannedAt: new Date().toISOString(), scannedBy: activeOperator },
      },
    }));
    setMessage(
      `CTE ${entry.cte || entry.cteKey} marcado manualmente com OK.`,
    );
  }

  function removeScan(partnerId: string, cte: string) {
    const key = scanKey(cte);
    setScannedCtes((current) => {
      const partnerScans = { ...(current[partnerId] || {}) };
      delete partnerScans[key];
      return { ...current, [partnerId]: partnerScans };
    });
  }

  const matchedScanKey = useCallback(
    (entry: Entry) => {
      const partnerScans = scannedLookupByPartner.get(entry.partnerId);
      if (!partnerScans) return undefined;
      return [scanKey(entry.cteKey), scanKey(entry.cte)].find(
        (key) => key && partnerScans.has(key),
      );
    },
    [scannedLookupByPartner],
  );
  const isScanned = useCallback(
    (entry: Entry) =>
      normalized(entry.status) === "cf" || Boolean(matchedScanKey(entry)),
    [matchedScanKey],
  );
  const usesScanForPartner = useCallback(
    (partnerId: string) =>
      scanPartnerIds.has(partnerId) ||
      optionalScanPartnerIds.includes(partnerId),
    [optionalScanPartnerIds],
  );
  const closingRowsByPartner = useMemo(() => {
    const rows = new Map<string, Entry[]>();
    partners.forEach((partner) => {
      rows.set(
        partner.id,
        usesScanForPartner(partner.id)
          ? partner.rows.filter(isScanned)
          : partner.rows,
      );
    });
    return rows;
  }, [isScanned, partners, usesScanForPartner]);
  const closingTotalsByPartner = useMemo(() => {
    const totals = new Map<string, { count: number; total: number }>();
    closingRowsByPartner.forEach((rows, partnerId) => {
      totals.set(partnerId, {
        count: rows.length,
        total: rows.reduce((sum, row) => sum + totalOf(row), 0),
      });
    });
    return totals;
  }, [closingRowsByPartner]);
  const rowsForClosing = useCallback(
    (partner: { id: string; rows: Entry[] }) =>
      closingRowsByPartner.get(partner.id) || [],
    [closingRowsByPartner],
  );
  const activeScanState = useMemo(() => {
    if (!active)
      return {
        scannedRows: [] as Entry[],
        missingRows: [] as Entry[],
        pendingKeys: [] as string[],
      };
    const presentKeys = new Set<string>();
    const scannedRows: Entry[] = [];
    const missingRows: Entry[] = [];
    active.rows.forEach((entry) => {
      const entryKeys = [scanKey(entry.cteKey), scanKey(entry.cte)].filter(
        Boolean,
      ) as string[];
      entryKeys.forEach((key) => presentKeys.add(key));
      if (isScanned(entry)) scannedRows.push(entry);
      else missingRows.push(entry);
    });
    const pendingKeys = [...(scannedLookupByPartner.get(active.id) || [])].filter(
      (key) => !presentKeys.has(key),
    );
    return { scannedRows, missingRows, pendingKeys };
  }, [active, isScanned, scannedLookupByPartner]);

  function toggleOptionalPartnerScan(partnerId: string, enabled: boolean) {
    const partner = partners.find((item) => item.id === partnerId);
    setOptionalScanPartnerIds((current) =>
      enabled
        ? [...new Set([...current, partnerId])]
        : current.filter((id) => id !== partnerId),
    );
    setMessage(
      enabled
        ? `Pagamento por bipagem ativado para ${partner?.name || "esta transportadora"}. A soma e a exportação considerarão as notas bipadas aqui ou na aba Capas.`
        : `Bipagem opcional desativada para ${partner?.name || "esta transportadora"}. A exportação voltou a considerar todos os documentos.`,
    );
  }
  const activeClosingRows = useMemo(
    () => (active ? rowsForClosing(active) : []),
    [active, rowsForClosing],
  );
  const activeClosingAudit = useMemo(
    () =>
      activeClosingRows.reduce(
        (audit, entry) => {
          const status = normalized(entry.status);
          const baseFreight = Math.max(0, entry.reportedTotal ?? entry.freight);
          const tdaValue = Math.max(0, entry.tda || entry.trt || 0);
          const isComplement = status === "cf";
          const isRedelivery = entry.isRedelivery || status === "re";
          audit.total += totalOf(entry);
          audit.baseFreight += baseFreight;
          audit.weight += entry.weight || 0;
          audit.volumes += entry.volumes || 0;
          if (entry.invoice) audit.invoices.add(normalizeInvoiceKey(entry.invoice));
          if (entry.cte) audit.ctes.add(scanKey(entry.cte));
          if (isComplement) {
            audit.complements.count += 1;
            audit.complements.value += baseFreight;
          } else if (isRedelivery) {
            audit.redeliveries.count += 1;
            audit.redeliveries.value += totalOf(entry);
          } else {
            audit.deliveries.count += 1;
            audit.deliveries.value += totalOf(entry);
          }
          if (entry.tde) {
            audit.tde.count += 1;
            audit.tde.value += entry.tde;
          }
          if (tdaValue) {
            audit.tda.count += 1;
            audit.tda.value += tdaValue;
          }
          if (!isComplement && entry.dedicated) {
            audit.dedicated.count += 1;
            audit.dedicated.value += entry.dedicated;
          }
          if (entry.partnerFreight) {
            audit.partnerFreight.count += 1;
            audit.partnerFreight.value += entry.partnerFreight;
          }
          return audit;
        },
        {
          total: 0,
          baseFreight: 0,
          weight: 0,
          volumes: 0,
          invoices: new Set<string>(),
          ctes: new Set<string>(),
          deliveries: { count: 0, value: 0 },
          redeliveries: { count: 0, value: 0 },
          complements: { count: 0, value: 0 },
          tde: { count: 0, value: 0 },
          tda: { count: 0, value: 0 },
          dedicated: { count: 0, value: 0 },
          partnerFreight: { count: 0, value: 0 },
        },
      ),
    [activeClosingRows],
  );

  function setRomaneioDraft(
    groupKey: string,
    documentKey: string,
    situation: RomaneioSituation | "",
  ) {
    setRomaneioDocumentDrafts((current) => ({
      ...current,
      [groupKey]: {
        ...(current[groupKey] || {}),
        [documentKey]: {
          situation,
          reason: current[groupKey]?.[documentKey]?.reason || "",
        },
      },
    }));
  }

  function requestRomaneioSituation(
    groupKey: string,
    document: RomaneioDailyDocument,
    situation: RomaneioSituation | "",
  ) {
    if (!situation || situation === "delivered") {
      setRomaneioDraft(groupKey, document.key, situation);
      return;
    }
    setRomaneioSituationConfirmation({
      groupKey,
      documentKey: document.key,
      situation,
      reference: `${document.referenceType} ${document.referenceNumber}`,
    });
    playRomaneioAttentionSound();
  }

  function toggleRomaneioDocumentSelection(
    groupKey: string,
    documentKey: string,
    checked: boolean,
  ) {
    setSelectedRomaneioDocumentKeys((current) => {
      const selected = current[groupKey] || [];
      return {
        ...current,
        [groupKey]: checked
          ? [...new Set([...selected, documentKey])]
          : selected.filter((key) => key !== documentKey),
      };
    });
  }

  function requestBatchRomaneioSituation(
    group: RomaneioDailyGroup,
    situation: RomaneioSituation | "",
  ) {
    if (!situation) return;
    const selected = selectedRomaneioDocumentKeys[group.key] || [];
    if (!selected.length) {
      setMessageIsError(true);
      setMessage("Selecione ao menos um documento para lançar a ocorrência.");
      playRomaneioAttentionSound();
      return;
    }
    if (situation === "delivered") {
      setRomaneioDocumentDrafts((current) => {
        const currentDrafts = current[group.key] || {};
        const nextDrafts = { ...currentDrafts };
        selected.forEach((documentKey) => {
          nextDrafts[documentKey] = { situation: "delivered", reason: "" };
        });
        return { ...current, [group.key]: nextDrafts };
      });
      setSelectedRomaneioDocumentKeys((current) => ({
        ...current,
        [group.key]: [],
      }));
      setMessageIsError(false);
      setMessage(`${selected.length} documento(s) marcados como Entregue.`);
      playRomaneioSuccessSound();
      return;
    }
    setRomaneioBatchSituationConfirmation({
      groupKey: group.key,
      documentKeys: selected,
      situation,
    });
    playRomaneioAttentionSound();
  }

  function confirmBatchRomaneioSituation() {
    const confirmation = romaneioBatchSituationConfirmation;
    if (!confirmation) return;
    setRomaneioDocumentDrafts((current) => {
      const currentDrafts = current[confirmation.groupKey] || {};
      const nextDrafts = { ...currentDrafts };
      confirmation.documentKeys.forEach((documentKey) => {
        nextDrafts[documentKey] = {
          situation: confirmation.situation,
          reason:
            confirmation.situation === "return"
              ? currentDrafts[documentKey]?.reason || ""
              : "",
        };
      });
      return { ...current, [confirmation.groupKey]: nextDrafts };
    });
    setSelectedRomaneioDocumentKeys((current) => ({
      ...current,
      [confirmation.groupKey]: [],
    }));
    setRomaneioBatchSituationConfirmation(null);
    setMessageIsError(false);
    setMessage(
      `${confirmation.documentKeys.length} documento(s) preparados como ${romaneioSituationLabel[confirmation.situation]}.`,
    );
  }

  function undoRomaneioDocumentStatus(documentKey: string) {
    const savedRecord = romaneioDocumentStatuses[documentKey];
    setRomaneioDocumentStatuses((current) => {
      const next = { ...current };
      delete next[documentKey];
      return next;
    });
    setEntries((current) =>
      current.filter((entry) => {
        if (entry.romaneioDocumentKey === documentKey) return false;
        if (!savedRecord || !entry.romaneioDocumentKey) return true;
        return !entryOperationalIdentifiers(entry).some((identifier) =>
          savedRecord.identifiers.includes(identifier),
        );
      }),
    );
    setMessageIsError(false);
    setMessage("Situação desfeita. O documento voltou para conferência.");
    playRomaneioAttentionSound();
  }

  function requestMarkAllRomaneioDelivered(group: RomaneioDailyGroup) {
    const drafts = romaneioDocumentDrafts[group.key] || {};
    const pendingCount = group.documents.filter((document) => {
      if (romaneioStatusForDocument(romaneioDocumentStatuses, group, document)) return false;
      const draft = drafts[document.key];
      return !draft?.situation;
    }).length;
    if (!pendingCount) {
      setMessageIsError(true);
      setMessage("Este romaneio não possui documentos pendentes para marcar.");
      playRomaneioAttentionSound();
      return;
    }
    setRomaneioMarkAllConfirmation({ groupKey: group.key, pendingCount });
    playRomaneioAttentionSound();
  }

  function markAllRomaneioDelivered(groupKey: string) {
    const group = romaneioDailyGroups.find((item) => item.key === groupKey);
    if (!group) return;
    setRomaneioDocumentDrafts((current) => {
      const currentDrafts = current[group.key] || {};
      const nextDrafts = { ...currentDrafts };
      group.documents.forEach((document) => {
        if (romaneioStatusForDocument(romaneioDocumentStatuses, group, document)) return;
        if (nextDrafts[document.key]?.situation) return;
        nextDrafts[document.key] = { situation: "delivered", reason: "" };
      });
      return { ...current, [group.key]: nextDrafts };
    });
    setRomaneioMarkAllConfirmation(null);
    setMessageIsError(false);
    setMessage(
      `Documentos pendentes de ${group.driver} preparados como Entregue. Clique em Gravar conferência para confirmar.`,
    );
    playRomaneioSuccessSound();
  }

  function addManualRomaneioFreight(groupKey: string) {
    const inputs = manualRomaneioFreightInputRefs.current[groupKey] || {};
    const invoice = (inputs.invoice?.value || "").trim();
    const grossFreight = parseMoney(inputs.grossFreight?.value || "");
    if (!invoice) {
      setMessageIsError(true);
      setMessage("Informe a nota fiscal manual.");
      playRomaneioAttentionSound();
      return;
    }
    if (!grossFreight || grossFreight <= 0) {
      setMessageIsError(true);
      setMessage("Informe um valor bruto de frete válido para a nota manual.");
      playRomaneioAttentionSound();
      return;
    }
    setManualRomaneioFreights((current) => ({
      ...current,
      [groupKey]: [
        ...(current[groupKey] || []),
        { id: newId(), invoice, grossFreight },
      ],
    }));
    if (inputs.invoice) inputs.invoice.value = "";
    if (inputs.grossFreight) inputs.grossFreight.value = "";
    setMessageIsError(false);
    setMessage("Nota fiscal manual adicionada ao romaneio.");
  }

  function removeManualRomaneioFreight(groupKey: string, id: string) {
    setManualRomaneioFreights((current) => ({
      ...current,
      [groupKey]: (current[groupKey] || []).filter((item) => item.id !== id),
    }));
  }

  function releaseRomaneioDocumentToClosing(
    documentKey: string,
    situation: RomaneioSituation,
    day: string,
    savedAt: string,
  ): Entry[] {
    const document = currentRomaneioDocumentsByKey.get(documentKey);
    if (!document) return [];
    const operationalStatus = romaneioOperationalStatus(situation);
    const promoted = document.linkedEntries
      .filter((entry) =>
        ["lt", "rm"].includes(normalized(entry.sourceStatus || entry.status)),
      )
      .map(
        (entry): Entry => ({
          ...entry,
          status: operationalStatus,
          deliveryDate: day || entry.deliveryDate,
          romaneioDocumentKey: documentKey,
          romaneioSourceStatus: entry.sourceStatus || entry.status,
          romaneioSavedAt: savedAt,
        }),
      );
    if (!promoted.length) return [];
    const promotedIds = new Set(promoted.map((entry) => entry.id));
    setEntries((current) => [
      ...current.filter(
        (entry) =>
          entry.romaneioDocumentKey !== documentKey &&
          !promotedIds.has(entry.id),
      ),
      ...promoted,
    ]);
    return promoted;
  }

  function releaseRomaneioDocumentsToClosing(
    releases: Array<{
      documentKey: string;
      situation: RomaneioSituation;
      day: string;
      savedAt: string;
    }>,
  ) {
    const promotedEntries = releases.flatMap(
      ({ documentKey, situation, day, savedAt }) => {
        const document = currentRomaneioDocumentsByKey.get(documentKey);
        if (!document) return [];
        const operationalStatus = romaneioOperationalStatus(situation);
        return document.linkedEntries
          .filter((entry) =>
            ["lt", "rm"].includes(normalized(entry.sourceStatus || entry.status)),
          )
          .map(
            (entry): Entry => ({
              ...entry,
              status: operationalStatus,
              deliveryDate: day || entry.deliveryDate,
              romaneioDocumentKey: documentKey,
              romaneioSourceStatus: entry.sourceStatus || entry.status,
              romaneioSavedAt: savedAt,
            }),
          );
      },
    );
    if (!promotedEntries.length) return;
    const promotedIds = new Set(promotedEntries.map((entry) => entry.id));
    const documentKeys = new Set(releases.map((release) => release.documentKey));
    setEntries((current) => [
      ...current.filter(
        (entry) =>
          !documentKeys.has(entry.romaneioDocumentKey || "") &&
          !promotedIds.has(entry.id),
      ),
      ...promotedEntries,
    ]);
  }

  function clearRomaneioSearch() {
    if (romaneioSearchTimerRef.current !== null) {
      window.clearTimeout(romaneioSearchTimerRef.current);
      romaneioSearchTimerRef.current = null;
    }
    if (romaneioScanRef.current) romaneioScanRef.current.value = "";
    setRomaneioSearch("");
  }

  function showPendingRomaneioAlert() {
    clearRomaneioSearch();
    setMessage("");
    setRomaneioPendingAlert({ kind: "change-romaneio" });
    playRomaneioAttentionSound();
  }

  function scanOrSearchRomaneio() {
    const typed = romaneioScanRef.current?.value.trim() || "";
    const typedIdentifiers = operationalIdentifiers(typed);
    if (!typedIdentifiers.length) {
      setMessageIsError(true);
      setMessage(
        "Digite um motorista para pesquisar ou bipe um MD-e, CT-e Parceiro, chave da AK ou NF válida.",
      );
      playRomaneioAttentionSound();
      return;
    }

    const unsavedGroupKeys = Object.entries(romaneioDocumentDrafts)
      .filter(([, drafts]) =>
        Object.values(drafts).some((draft) => draft.situation),
      )
      .map(([groupKey]) => groupKey);

    const retained = typedIdentifiers.reduce<
      RomaneioDocumentStatusRecord | undefined
    >(
      (found, item) => found || retainedRomaneioByIdentifier.get(item),
      undefined,
    );
    let matches = findRomaneioScanMatches(typedIdentifiers);
    const pendingNewTrip = matches.some(
      ({ group, document }) =>
        !romaneioStatusForDocument(romaneioDocumentStatuses, group, document),
    );
    if (retained && !pendingNewTrip) {
      const retainedGroup = romaneioDailyGroups.find((group) =>
        group.documents.some((document) => document.key === retained.key),
      );
      if (
        unsavedGroupKeys.length &&
        (!retainedGroup || !unsavedGroupKeys.includes(retainedGroup.key))
      ) {
        showPendingRomaneioAlert();
        return;
      }
      const savedAt = new Date().toISOString();
      setRomaneioDocumentStatuses((current) => ({
        ...current,
        [retained.key]: {
          ...retained,
          situation: "delivered",
          operationalStatus: "ET",
          reason: "",
          savedAt,
          savedBy: activeOperator,
        },
      }));
      releaseRomaneioDocumentToClosing(
        retained.key,
        "delivered",
        retained.day,
        savedAt,
      );
      setRetainedResolutionDrafts((current) => {
        const next = { ...current };
        delete next[retained.key];
        return next;
      });
      clearRomaneioSearch();
      setMessageIsError(false);
      setMessage(
        `Documento retido localizado: ${retained.referenceType} ${retained.referenceNumber} já foi retirado do relatório de Retidos e gravado como Entregue.`,
      );
      playRomaneioSuccessSound();
      return;
    }

    if (!matches.length) {
      const fallbackIdentifiers = new Set<string>();
      typedIdentifiers.forEach((identifier) => {
        (reportFallbackIdentifiersByIdentifier.get(identifier) || []).forEach(
          (linkedIdentifier) => fallbackIdentifiers.add(linkedIdentifier),
        );
      });
      if (fallbackIdentifiers.size)
        matches = findRomaneioScanMatches([...fallbackIdentifiers]);
    }
    const pendingMatch = matches.find(
      ({ group, document }) =>
        !romaneioStatusForDocument(romaneioDocumentStatuses, group, document) &&
        !romaneioDocumentDrafts[group.key]?.[document.key]?.situation,
    );
    const match = pendingMatch || matches[0];
    if (!match) {
      clearRomaneioSearch();
      setMessageIsError(true);
      setMessage(
        `Documento não encontrado: ${typed} não foi localizado nos romaneios nem no relatório de Retidos.`,
      );
      playRomaneioAttentionSound();
      return;
    }

    const { group, document } = match;
    if (
      unsavedGroupKeys.length &&
      !unsavedGroupKeys.includes(group.key)
    ) {
      showPendingRomaneioAlert();
      return;
    }
    setFocusedRomaneioKey(group.key);
    setOpenRomaneios((current) => ({ ...current, [group.key]: true }));
    if (!pendingMatch) {
      clearRomaneioSearch();
      setMessageIsError(true);
      setMessage(
        `${document.referenceType} ${document.referenceNumber} já possui uma situação marcada. O romaneio vinculado foi aberto.`,
      );
      playRomaneioAttentionSound();
      return;
    }
    setRomaneioDraft(group.key, document.key, "delivered");
    clearRomaneioSearch();
    setMessageIsError(false);
    setMessage(
      `${document.referenceType} ${document.referenceNumber} localizado no romaneio ${group.romaneios.join(" · ")} e marcado como Entregue. Clique em Gravar conferência para confirmar.`,
    );
    playRomaneioSuccessSound();
  }

  function saveRomaneioGroup(
    group: RomaneioDailyGroup,
    allowPending = false,
    pickupConfirmed = false,
    pickupQuantityOverride?: number,
  ) {
    const drafts = romaneioDocumentDrafts[group.key] || {};
    const selectedDrafts = Object.entries(drafts)
      .filter(([, draft]) => draft.situation)
      .map(([documentKey, draft]) => [
        documentKey,
        {
          ...draft,
          reason:
            draft.situation === "return"
              ? romaneioReturnReasonRefs.current[`${group.key}|${documentKey}`]
                  ?.value || draft.reason
              : draft.reason,
        },
      ] as const);
    const missingReason = selectedDrafts.some(
      ([, draft]) =>
        draft.situation === "return" && !draft.reason.trim(),
    );
    if (missingReason) {
      setMessageIsError(true);
      setMessage("Informe o motivo de todos os documentos marcados como Retorno.");
      playRomaneioAttentionSound();
      return;
    }
    const pendingCount = group.documents.filter((document) => {
      if (romaneioStatusForDocument(romaneioDocumentStatuses, group, document)) return false;
      const draft = drafts[document.key];
      if (!draft?.situation) return true;
      if (draft.situation !== "return") return false;
      const reason =
        romaneioReturnReasonRefs.current[`${group.key}|${document.key}`]?.value ||
        draft.reason;
      return !reason.trim();
    }).length;
    if (pendingCount && !allowPending) {
      setMessage("");
      setRomaneioPendingAlert({
        kind: "save-with-pending",
        groupKey: group.key,
        pendingCount,
      });
      playRomaneioAttentionSound();
      return;
    }
    const defaultRoutes = group.routes.join(" · ");
    const routeLabel =
      romaneioRouteDrafts[group.key] ??
      romaneioRouteLabels[group.key] ??
      defaultRoutes;
    const routeChanged =
      routeLabel.trim() !==
      (romaneioRouteLabels[group.key] || defaultRoutes).trim();
    const note = (romaneioGroupNotes[group.key] || "").trim();
    const existingSavedNote = Object.values(romaneioDocumentStatuses).find(
      (record) => record.day === group.day && record.driver === group.driver,
    )?.observation;
    const noteChanged = note !== (existingSavedNote || "");
    const pickupChanged =
      pickupQuantityOverride !== undefined &&
      pickupQuantityOverride !== (romaneioPickupQuantities[group.key] || 0);
    if (!pickupConfirmed) {
      setRomaneioPickupConfirmation({
        groupKey: group.key,
        allowPending,
        quantity: String(romaneioPickupQuantities[group.key] || ""),
      });
      playRomaneioAttentionSound();
      return;
    }
    if (!selectedDrafts.length && !routeChanged && !noteChanged && !pickupChanged) {
      setMessageIsError(true);
      setMessage(
        "Selecione ao menos uma situação, edite a rota, escreva uma observação ou informe coleta antes de gravar.",
      );
      playRomaneioAttentionSound();
      return;
    }

    const savedAt = new Date().toISOString();
    const groupDocumentsByKey = new Map(
      group.documents.map((document) => [document.key, document] as const),
    );
    if (selectedDrafts.length)
      setRomaneioDocumentStatuses((current) => {
        const next = { ...current };
        selectedDrafts.forEach(([documentKey, draft]) => {
          const document = groupDocumentsByKey.get(documentKey);
          if (!document || !draft.situation) return;
          const statusKey = `${group.key}|${document.key}`;
          next[statusKey] = {
            key: statusKey,
            document: document.document,
            referenceType: document.referenceType,
            referenceNumber: document.referenceNumber,
            situation: draft.situation,
            sourceStatus: document.sourceStatus,
            operationalStatus: romaneioOperationalStatus(draft.situation),
            reason: draft.situation === "return" ? draft.reason.trim() : "",
            savedAt,
            savedBy: activeOperator,
            day: group.day,
            driver: group.driver,
            romaneios: [...group.romaneios],
            routes: routeLabel
              .split(/[·,;]+/)
              .map((route) => route.trim())
              .filter(Boolean),
            sender: document.sender,
            recipient: document.recipient,
            city: document.city,
            mde: document.mde,
            cte: document.cte,
            invoice: document.invoice,
            grossFreight: document.grossFreight,
            identifiers: [...document.identifiers],
            observation: note,
          };
        });
        return next;
      });
    if (!selectedDrafts.length && noteChanged)
      setRomaneioDocumentStatuses((current) => {
        const next = { ...current };
        Object.values(next).forEach((record) => {
          if (record.day === group.day && record.driver === group.driver)
            next[record.key] = { ...record, observation: note };
        });
        return next;
      });
    releaseRomaneioDocumentsToClosing(
      selectedDrafts
        .filter(
          ([, draft]) =>
            Boolean(draft.situation) && draft.situation !== "driver-missing",
        )
        .map(([documentKey, draft]) => ({
          documentKey,
          situation: draft.situation as RomaneioSituation,
          day: group.day,
          savedAt,
        })),
    );
    if (routeChanged || romaneioRouteDrafts[group.key] !== undefined)
      setRomaneioRouteLabels((current) => ({
        ...current,
        [group.key]: routeLabel.trim(),
      }));
    setRomaneioDocumentDrafts((current) => {
      const next = { ...current };
      delete next[group.key];
      return next;
    });
    setRomaneioRouteDrafts((current) => {
      const next = { ...current };
      delete next[group.key];
      return next;
    });
    setMessage(
      `${selectedDrafts.length} documento(s) gravado(s) para ${group.driver}.${routeChanged ? " A rota editada também foi salva." : ""}${noteChanged ? " A observação também foi salva." : ""}${pickupChanged ? " A coleta também foi salva." : ""}`,
    );
    setMessageIsError(false);
  }

  function scanRetainedDocument() {
    const typedIdentifiers = operationalIdentifiers(retainedScanInput);
    if (!typedIdentifiers.length) {
      setMessageIsError(true);
      setMessage("Digite ou bipe um MD-e ou CT-e Parceiro válido.");
      playRomaneioAttentionSound();
      return;
    }
    const matching = typedIdentifiers.reduce<
      RomaneioDocumentStatusRecord | undefined
    >(
      (found, item) => found || retainedRomaneioByIdentifier.get(item),
      undefined,
    );
    if (!matching) {
      setMessageIsError(true);
      setMessage(
        `${retainedScanInput.trim()} não foi encontrado no relatório de retidos.`,
      );
      playRomaneioAttentionSound();
      return;
    }
    setRetainedResolutionDrafts((current) => ({
      ...current,
      [matching.key]: true,
    }));
    setRetainedScanInput("");
    setMessageIsError(false);
    setMessage(
      `${matching.referenceType} ${matching.referenceNumber} localizado. Clique em Gravar baixas para confirmar a entrega.`,
    );
    playRomaneioSuccessSound();
  }

  function saveRetainedResolutions() {
    const selectedKeys = Object.keys(retainedResolutionDrafts).filter(
      (key) => retainedResolutionDrafts[key],
    );
    if (!selectedKeys.length) {
      setMessageIsError(true);
      setMessage("Selecione ou bipe ao menos um documento retido.");
      playRomaneioAttentionSound();
      return;
    }
    const savedAt = new Date().toISOString();
    setRomaneioDocumentStatuses((current) => {
      const next = { ...current };
      selectedKeys.forEach((key) => {
        if (next[key])
          next[key] = {
            ...next[key],
            situation: "delivered",
            operationalStatus: "ET",
            reason: "",
            savedAt,
            savedBy: activeOperator,
          };
      });
      return next;
    });
    releaseRomaneioDocumentsToClosing(
      selectedKeys.map((key) => ({
        documentKey: key,
        situation: "delivered",
        day: romaneioDocumentStatuses[key]?.day || "",
        savedAt,
      })),
    );
    setRetainedResolutionDrafts({});
    setMessage(
      `${selectedKeys.length} documento(s) retirado(s) dos retidos e gravado(s) como Entregue.`,
    );
  }

  const isMaexAdditional = (entry: Entry) => {
    const key = maexSenderKey(entry);
    return Boolean(key && maexAdditionalSenders[key]);
  };

  function toggleMaexAdditional(entry: Entry) {
    const key = maexSenderKey(entry);
    if (!key) {
      setMessage(
        "Este documento não possui CNPJ nem nome do remetente para salvar a marcação.",
      );
      return;
    }
    const wasMarked = Boolean(maexAdditionalSenders[key]);
    setMaexAdditionalSenders((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else
        next[key] = {
          name: entry.sender || "Remetente sem nome",
          cnpj: normalizeCnpj(entry.senderCnpj),
          markedAt: new Date().toISOString(),
        };
      return next;
    });
    const affected = entriesWithTde.filter(
      (candidate) =>
        candidate.partnerId === "maex" && maexSenderKey(candidate) === key,
    ).length;
    setMessage(
      wasMarked
        ? `${entry.sender || "Remetente"} removido do MAEX ADICIONAL.`
        : `${entry.sender || "Remetente"} salvo no MAEX ADICIONAL. ${affected} documento(s) atual(is) marcado(s), e os próximos serão reconhecidos automaticamente.`,
    );
  }

  async function importTdeExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportingTde(true);
    setMessage("");
    try {
      const result = await readTdeFile(file);
      const imported = new Map<string, TdeRateRecord>();
      result.clients.forEach((client) => {
        client.rates.forEach((rate) => {
          const partner = identifyPartner(rate.partner);
          if (partner.id === "unidentified") return;
          const key = `${client.cnpj}|${partner.id}`;
          imported.set(key, {
            id: `file-${key}`,
            clientName: client.name || "Cliente sem nome",
            cnpj: client.cnpj,
            partnerId: partner.id,
            partnerName: partner.name,
            value: rate.value,
            source: "file",
          });
        });
      });
      const nextRates = [
        ...imported.values(),
        ...tdeRates.filter((rate) => rate.source === "manual"),
      ];
      const rateMap = effectiveTdeRates(nextRates);
      const matchedRows = entries.filter((entry) => {
        const cnpj = normalizeCnpj(entry.recipientCnpj);
        return cnpj && rateMap.has(`${cnpj}|${entry.partnerId}`);
      }).length;
      setTdeRates(nextRates);
      setTdeImportInfo({
        file: file.name,
        clients: result.clients.length,
        rates: imported.size,
      });
      setMessage(
        `${result.clients.length} clientes de TDE importados. ${matchedRows} registro(s) do relatório atual receberam a taxa pelo CNPJ.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível ler a lista de TDE.",
      );
    } finally {
      setImportingTde(false);
    }
  }

  async function importPajussaraClosing(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportingPajussara(true);
    setMessage("");
    try {
      const result = await readPajussaraClosingFile(file);
      const info: PajussaraClosingInfo = {
        file: file.name,
        sheet: result.sheet,
        period: result.period,
        documents: result.documents,
      };
      setPajussaraClosing(info);
      const currentRows =
        partners.find((partner) => partner.id === "pajucara")?.rows || [];
      const comparison = comparePajussaraDocuments(
        currentRows,
        result.documents,
      );
      setMessage(
        `${result.documents.length} documentos lidos no fechamento da Pajuçara. ${comparison.matched.length} encontrados e ${comparison.missing.length} faltantes no arquivo deles para o período selecionado.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível ler o fechamento da Pajuçara.",
      );
    } finally {
      setImportingPajussara(false);
    }
  }

  function registerManualTde(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = manualClientName.trim();
    const cnpjs = parseCnpjList(manualClientCnpj);
    const value = parseMoney(manualTdeValue);
    const partnerName = tdePartnerOptions.find(
      ([id]) => id === manualPartnerId,
    )?.[1];
    if (!name)
      return setMessage("Informe o nome ou a razão social do cliente.");
    if (!cnpjs.length)
      return setMessage(
        "Informe ao menos um CNPJ válido. Para vários, separe por vírgula ou coloque um por linha.",
      );
    if (!manualPartnerId || !partnerName)
      return setMessage("Selecione a transportadora da taxa TDE.");
    if (value === null || value < 0)
      return setMessage("Informe um valor de TDE válido.");

    const cnpjSet = new Set(cnpjs);
    const records: TdeRateRecord[] = cnpjs.map((cnpj) => ({
      id: `manual-${cnpj}|${manualPartnerId}`,
      clientName: name,
      cnpj,
      partnerId: manualPartnerId,
      partnerName,
      value,
      source: "manual",
    }));
    setTdeRates((current) => [
      ...current.filter(
        (rate) =>
          !(
            rate.source === "manual" &&
            cnpjSet.has(rate.cnpj) &&
            rate.partnerId === manualPartnerId
          ),
      ),
      ...records,
    ]);
    const affected = entries.filter(
      (entry) =>
        cnpjSet.has(normalizeCnpj(entry.recipientCnpj)) &&
        entry.partnerId === manualPartnerId,
    ).length;
    setManualClientName("");
    setManualClientCnpj("");
    setManualClientSuggestionsOpen(false);
    setManualTdeValue("");
    setMessage(
      `${name} cadastrado com ${cnpjs.length} CNPJ(s) para ${partnerName}. ${affected} registro(s) atual(is) receberam a taxa.`,
    );
  }

  function selectManualClient(client: ManualClientOption) {
    setManualClientName(client.name);
    setManualClientCnpj(
      client.cnpjs.map((cnpj) => formatCnpj(cnpj)).join("\n"),
    );
    setManualClientSuggestionsOpen(false);
  }

  function removeManualTde(ids: string[]) {
    const idSet = new Set(ids);
    setTdeRates((current) => current.filter((rate) => !idSet.has(rate.id)));
    setMessage(
      `${ids.length} CNPJ(s) removido(s) do cadastro manual. A taxa da lista importada volta a valer, se existir.`,
    );
  }

  async function importBilledClosings(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    setImportingBilled(true);
    setMessage("");
    const additions = new Map<string, BilledDocumentRecord>();
    const errors: string[] = [];
    let validFiles = 0;
    const markedAt = new Date().toISOString();

    for (const file of files) {
      try {
        const result = await readBilledClosingFile(file);
        const partner = identifyPartner(result.partner);
        if (partner.id === "unidentified")
          throw new Error("transportadora não identificada");
        const billingScope: BillingScope =
          partner.id === "maex" && isMaexAdditionalBillingSource(file.name)
            ? "maex-additional"
            : "normal";
        result.documents.forEach((document) => {
          const key = billedDocumentKey(
            partner.id,
            document.cte,
            billingScope,
          );
          if (!key) return;
          const existing = additions.get(key);
          additions.set(key, {
            key,
            partnerId: partner.id,
            partnerName: partner.name,
            cte: document.cte,
            invoice: existing?.invoice || document.invoice,
            sources: [
              ...new Set([...(existing?.sources || []), file.name]),
            ],
            markedAt: existing?.markedAt || markedAt,
            billingScope,
          });
        });
        validFiles++;
      } catch (error) {
        errors.push(
          `${file.name}: ${error instanceof Error ? error.message : "não foi possível ler"}`,
        );
      }
    }

    if (additions.size) {
      const allKeys = new Set([
        ...Object.keys(billedDocuments),
        ...additions.keys(),
      ]);
      const matchedCurrent = entriesWithTde.filter((entry) =>
        allKeys.has(billedDocumentKey(entry.partnerId, entry.cte)) ||
        (entry.partnerId === "maex" &&
          allKeys.has(
            billedDocumentKey("maex", entry.cte, "maex-additional"),
          )),
      ).length;
      const newDocuments = [...additions.keys()].filter(
        (key) => !billedDocuments[key],
      ).length;
      setBilledDocuments((current) =>
        mergeBilledDocuments(current, [...additions.values()]),
      );
      setMessage(
        `${validFiles} arquivo(s) validado(s). ${newDocuments} documento(s) novo(s) marcado(s) no histórico. ${matchedCurrent} registro(s) do relatório atual conferido(s). Arquivos do MAEX ADICIONAL afetam somente o adicional e não retiram documentos do fechamento normal.${
          errors.length ? ` ${errors.length} arquivo(s) não puderam ser lidos.` : ""
        }`,
      );
    } else {
      setMessage(
        errors.length
          ? `Nenhum arquivo foi importado. ${errors.slice(0, 2).join(" | ")}`
          : "Não encontrei documentos válidos nos arquivos selecionados.",
      );
    }
    setImportingBilled(false);
  }

  function removeBilledSource(source: string) {
    const sourceInfo = billedSources.find((item) => item.name === source);
    const isAdditionalSource = isMaexAdditionalBillingSource(source);
    setBilledDocuments((current) => {
      const next: Record<string, BilledDocumentRecord> = {};
      Object.values(current).forEach((document) => {
        const sources = document.sources.filter((item) => item !== source);
        if (sources.length) next[document.key] = { ...document, sources };
      });
      return next;
    });
    setMessage(
      isAdditionalSource
        ? `${sourceInfo?.count || 0} documento(s) de ${source} retirado(s) somente do histórico do MAEX ADICIONAL. O fechamento normal não foi alterado.`
        : `${sourceInfo?.count || 0} documento(s) de ${source} retirado(s) do histórico normal. Se também estiverem em outro arquivo, continuam marcados.`,
    );
  }

  function downloadBackup() {
    const backup = {
      product: "Fechamentos GMOBS",
      version: 1,
      exportedAt: new Date().toISOString(),
      closing: {
        entries,
        referenceEntries: romaneioReferenceEntries,
        importInfo,
        covers,
        coverGenerators,
      },
      scans: scannedCtes,
      tde: { rates: tdeRates, importInfo: tdeImportInfo },
      maex: maexAdditionalSenders,
      billed: billedDocuments,
      romaneios: {
        entries: romaneioEntries,
        importInfo: romaneioImportInfo,
        documentStatuses: romaneioDocumentStatuses,
        routeLabels: romaneioRouteLabels,
        groupNotes: romaneioGroupNotes,
        manualFreights: manualRomaneioFreights,
        pickupQuantities: romaneioPickupQuantities,
        driverDiscountPlans: driverClosingDiscountPlans,
      },
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `Backup Fechamentos GMOBS - ${new Date()
      .toLocaleDateString("pt-BR")
      .replaceAll("/", "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(
      "Backup baixado. Guarde esse arquivo em local seguro, pois ele contém dados operacionais.",
    );
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportingBackup(true);
    try {
      const backup = JSON.parse(await file.text()) as {
        product?: string;
        version?: number;
        closing?: {
          entries?: Entry[];
          referenceEntries?: RomaneioReferenceEntry[];
          importInfo?: ImportInfo | null;
          covers?: CoverExport[];
          coverGenerators?: string[];
          closingAdditionals?: ClosingAdditional[];
        };
        scans?: Record<string, Record<string, ScanRecord>>;
        tde?: {
          rates?: TdeRateRecord[];
          importInfo?: TdeImportInfo | null;
        };
        maex?: Record<string, MaexAdditionalSender>;
        billed?: Record<string, BilledDocumentRecord>;
        romaneios?: {
          entries?: RomaneioEntry[];
          importInfo?: RomaneioImportInfo | null;
          documentStatuses?: Record<string, RomaneioDocumentStatusRecord>;
          routeLabels?: Record<string, string>;
          groupNotes?: Record<string, string>;
          manualFreights?: Record<string, ManualRomaneioFreight[]>;
          pickupQuantities?: Record<string, number>;
          driverDiscountPlans?: Record<string, DriverClosingDiscountPlan[]>;
        };
      };
      if (
        backup.product !== "Fechamentos GMOBS" ||
        backup.version !== 1 ||
        !Array.isArray(backup.closing?.entries)
      )
        throw new Error("Este arquivo não é um backup válido do Fechamentos GMOBS.");

      const normalizedEntries = normalizeSavedEntries(backup.closing.entries);
      setEntries(normalizedEntries);
      setRomaneioReferenceEntries(
        normalizeRomaneioReferenceEntries(
          backup.closing.referenceEntries,
          normalizedEntries,
        ),
      );
      setOptionalScanPartnerIds([]);
      setImportInfo(backup.closing.importInfo || null);
      setCovers(Array.isArray(backup.closing.covers) ? backup.closing.covers : []);
      setCoverGenerators(
        Array.isArray(backup.closing.coverGenerators)
          ? backup.closing.coverGenerators
          : [...new Set((backup.closing.covers || []).map((cover) => cover.generatedBy).filter(Boolean) as string[])],
      );
      setScannedCtes(backup.scans || {});
      setTdeRates(Array.isArray(backup.tde?.rates) ? backup.tde.rates : []);
      setTdeImportInfo(backup.tde?.importInfo || null);
      setMaexAdditionalSenders(backup.maex || {});
      setBilledDocuments(normalizeBilledDocuments(backup.billed || {}));
      setRomaneioEntries(
        Array.isArray(backup.romaneios?.entries)
          ? backup.romaneios.entries
          : [],
      );
      setRomaneioImportInfo(backup.romaneios?.importInfo || null);
      setRomaneioDocumentStatuses(
        backup.romaneios?.documentStatuses || {},
      );
      setRomaneioRouteLabels(backup.romaneios?.routeLabels || {});
      setRomaneioGroupNotes(backup.romaneios?.groupNotes || {});
      setManualRomaneioFreights(backup.romaneios?.manualFreights || {});
      setRomaneioPickupQuantities(backup.romaneios?.pickupQuantities || {});
      setDriverClosingDiscountPlans(
        backup.romaneios?.driverDiscountPlans || {},
      );
      setSelectedExports([]);
      setMessage(
        cloudHosted
          ? "Backup restaurado. Os dados estão sendo gravados no banco automaticamente."
          : "Backup restaurado neste computador.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível restaurar o backup.",
      );
    } finally {
      setImportingBackup(false);
    }
  }

  async function importRomaneios(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    setImportingRomaneios(true);
    setMessage("");
    const additions: RomaneioEntry[] = [];
    const errors: string[] = [];
    const seen = new Set(romaneioEntries.map(romaneioCompleteRowKey));
    let duplicates = 0;

    for (const file of files) {
      try {
        const result = await readRomaneioFile(file);
        result.rows.forEach((row) => {
          const key = romaneioCompleteRowKey(row);
          if (seen.has(key)) {
            duplicates++;
            return;
          }
          seen.add(key);
          additions.push({
            ...row,
            id: newId(),
            sourceFile: file.name,
          });
        });
      } catch (error) {
        errors.push(
          `${file.name}: ${error instanceof Error ? error.message : "não foi possível ler"}`,
        );
      }
    }

    if (additions.length) {
      const combinedEntries = [...romaneioEntries, ...additions];
      const distinctRomaneios = new Set(
        combinedEntries.map((row) => `${row.filial}|${row.romaneio}`),
      ).size;
      const successfulFiles = files
        .filter((file) =>
          additions.some((entry) => entry.sourceFile === file.name),
        )
        .map((file) => file.name);
      setRomaneioEntries(combinedEntries);
      setRomaneioImportInfo({
        files: [
          ...new Set([
            ...(romaneioImportInfo?.files || []),
            ...successfulFiles,
          ]),
        ],
        imported: combinedEntries.length,
        romaneios: distinctRomaneios,
        importedAt: new Date().toISOString(),
        duplicates,
      });
      clearRomaneioSearch();
      setTab("romaneios");
      setMessage(
        `${additions.length} linha(s) nova(s) adicionada(s). Agora há ${distinctRomaneios} romaneio(s) e ${combinedEntries.length} linha(s) salvas.${duplicates ? ` ${duplicates} linha(s) completamente repetida(s) foram ignoradas.` : ""}${errors.length ? ` ${errors.length} arquivo(s) não puderam ser lidos.` : ""}`,
      );
    } else if (duplicates) {
      setTab("romaneios");
      setMessage(
        `${duplicates} linha(s) já estavam salvas e não foram duplicadas.${errors.length ? ` ${errors.length} arquivo(s) não puderam ser lidos.` : ""}`,
      );
    } else {
      setMessage(
        errors.length
          ? errors.slice(0, 2).join(" | ")
          : "Não encontrei romaneios válidos nos arquivos selecionados.",
      );
    }
    setImportingRomaneios(false);
  }

  async function importExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setMessage("");
    try {
      const result = await readClosingFile(file);
      const seen = new Set<string>();
      const completeRows = new Set<string>();
      const tdeMap = effectiveTdeRates(tdeRates);
      let duplicates = 0;
      const uniqueReferenceRows = result.referenceRows.filter((row) => {
        const key = completeRowKey(row);
        if (completeRows.has(key)) {
          if (row.eligible && (row.cte || row.invoice)) duplicates++;
          return false;
        }
        completeRows.add(key);
        return true;
      });
      const referenceEntries = uniqueReferenceRows.map(
        (row): RomaneioReferenceEntry => {
        const partner = identifyPartner(row.partner);
        const key = `${partner.id}|${row.cte}|${row.invoice}`.toLowerCase();
        const repeated = seen.has(key);
        seen.add(key);
        const isRedelivery = row.isRedelivery || repeated;
        const recipientCnpj = normalizeCnpj(row.recipientCnpj);
        const tde = recipientCnpj
          ? tdeMap.get(`${recipientCnpj}|${partner.id}`) ?? row.tde
          : row.tde;
        const mde = numericDocumentId(row.mde);
        const cte = numericDocumentId(row.cte);
        const savedOperation = mde
          ? romaneioDocumentStatuses[`MD-e|${mde}`]
          : cte
            ? romaneioDocumentStatuses[`CT-e|${cte}`]
            : undefined;
        const sourceStatus = String(row.status || "").trim();
        const canBeReleasedByRomaneio = ["lt", "rm"].includes(
          normalized(sourceStatus),
        );
        const operationalStatus =
          canBeReleasedByRomaneio && savedOperation
            ? savedOperation.operationalStatus ||
              romaneioOperationalStatus(savedOperation.situation)
            : "";
        return {
          id: newId(),
          partnerId: partner.id,
          partnerName: partner.name,
          partnerRaw: row.partner,
          partnerCnpj: row.partnerCnpj,
          status: operationalStatus || sourceStatus,
          date: row.date,
          deliveryDate:
            operationalStatus && savedOperation?.day
              ? savedOperation.day
              : row.deliveryDate,
          mde: row.mde,
          cte: row.cte,
          cteKey: row.cteKey,
          invoice: row.invoice,
          sender: row.sender,
          senderCnpj: row.senderCnpj,
          recipient: row.recipient,
          recipientCnpj: row.recipientCnpj,
          city: row.city,
          observation: row.observation,
          weight: row.weight,
          volumes: row.volumes,
          merchandiseValue: row.merchandiseValue,
          freight: row.freight,
          partnerFreight: row.partnerFreight,
          tde,
          sourceTde: row.tde,
          tda: row.tda,
          trt: row.trt,
          redelivery: row.redelivery,
          dedicated: row.dedicated,
          adjustment: row.adjustment,
          isRedelivery,
          reportedTotal: row.reportedTotal,
          romaneioDocumentKey: operationalStatus
            ? savedOperation?.key
            : undefined,
          romaneioSourceStatus: operationalStatus ? sourceStatus : undefined,
          romaneioSavedAt: operationalStatus
            ? savedOperation?.savedAt
            : undefined,
          sourceStatus,
          sourceEligible: row.eligible && Boolean(row.cte || row.invoice),
        };
      },
      );
      const importedCandidates = referenceEntries.filter(
        (entry) => entry.sourceEligible || Boolean(entry.romaneioDocumentKey),
      );
      const existingKeys = new Set(
        [...entries, ...romaneioReferenceEntries].map(entryStableIdentity),
      );
      const additions = importedCandidates.filter((entry) => {
        const key = entryStableIdentity(entry);
        if (existingKeys.has(key)) {
          duplicates++;
          return false;
        }
        existingKeys.add(key);
        return true;
      });
      const redeliveries = additions.filter(
        (entry) => entry.isRedelivery,
      ).length;
      const unidentified = additions.filter(
        (entry) => entry.partnerId === "unidentified",
      ).length;
      const releasedByRomaneio = additions.filter(
        (entry) => entry.romaneioDocumentKey,
      ).length;
      setEntries((current) => [...current, ...additions]);
      const referenceAdditions = referenceEntries.filter(
        (entry) => !entry.sourceEligible && !existingKeys.has(entryStableIdentity(entry)),
      );
      setRomaneioReferenceEntries((current) => [...current, ...referenceAdditions]);
      setImportInfo({
        file: file.name,
        imported: additions.length,
        redeliveries,
        unidentified,
        excluded: Math.max(0, result.excluded - releasedByRomaneio),
        duplicates,
        latestEmissionDate: result.latestEmissionDate,
      });
      setSelectedExports([]);
      const romaneioOnly = Math.max(
        0,
        referenceEntries.length - additions.length,
      );
      setMessage(
        `${additions.length} documento(s) novo(s) acrescentado(s) ao sistema.${romaneioOnly ? ` ${romaneioOnly} documento(s) em outros status ficaram disponíveis somente para consulta e conferência nos Romaneios.` : ""}${duplicates ? ` ${duplicates} documento(s) que já existiam foram mantidos sem duplicar.` : ""}`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível ler a planilha.",
      );
    } finally {
      setImporting(false);
    }
  }

  const toExportRow = (entry: Entry, partnerName: string) => ({
    partner: partnerName,
    partnerCnpj: entry.partnerCnpj,
    occurrence: entry.status || (entry.isRedelivery ? "RE" : ""),
    status: entry.status || (entry.isRedelivery ? "RE" : "ET"),
    statusDescription:
      normalized(entry.status || "") === "cf"
        ? "COMPLEMENTO DE FRETE"
        : entry.isRedelivery
          ? "REENTREGA"
          : "ENTREGUE",
    eligible: true,
    isRedelivery: entry.isRedelivery,
    date: entry.date,
    deliveryDate: entry.deliveryDate,
    mde: entry.mde || "",
    cte: entry.cte,
    cteKey: entry.cteKey,
    invoice: entry.invoice,
    sender: entry.sender,
    senderCnpj: entry.senderCnpj,
    recipient: entry.recipient,
    recipientCnpj: entry.recipientCnpj,
    city: entry.city,
    observation: entry.observation,
    weight: entry.weight || 0,
    volumes: entry.volumes || 0,
    merchandiseValue: entry.merchandiseValue || 0,
    freight: entry.freight,
    partnerFreight: entry.partnerFreight,
    tde: entry.tde,
    tda: entry.tda,
    trt: entry.trt,
    redelivery: entry.redelivery,
    dedicated: entry.dedicated,
    adjustment: entry.adjustment,
    reportedTotal: entry.reportedTotal,
    total: totalOf(entry),
  });

  function exportPajussaraMissing() {
    if (!pajussaraClosing || !pajussaraComparison?.missing.length)
      return setMessage(
        "Não há documentos faltantes da Pajuçara para exportar.",
      );
    exportPajussaraMissingXlsx(
      pajussaraComparison.missing.map((entry) =>
        toExportRow(entry, "Pajuçara"),
      ),
      pajussaraClosing.file,
    );
    setMessage(
      `${pajussaraComparison.missing.length} documento(s) faltante(s) exportado(s).`,
    );
  }

  function openDriverClosingPreview() {
    if (!selectedDriverClosingReports.length) {
      setMessageIsError(true);
      setMessage("Selecione ao menos um motorista para abrir a prévia.");
      playRomaneioAttentionSound();
      return;
    }
    setDriverClosingPreviewOpen(true);
    setMessageIsError(false);
    setMessage("Prévia aberta. Confira cidades e observações antes de baixar o PDF.");
  }

  function updateDriverClosingDayEdit(
    driverKey: string,
    date: string,
    field: keyof DriverClosingDayEdit,
    value: string,
  ) {
    setDriverClosingDayEdits((current) => ({
      ...current,
      [driverClosingDayEditKey(driverKey, date)]: {
        cityText:
          field === "cityText"
            ? value
            : current[driverClosingDayEditKey(driverKey, date)]?.cityText ??
              driverClosingSummaries
                .find((driver) => driver.key === driverKey)
                ?.days.find((day) => day.date === date)
                ?.cities.join(" · ") ??
              "",
        observation:
          field === "observation"
            ? value
            : current[driverClosingDayEditKey(driverKey, date)]?.observation ??
              "",
      },
    }));
  }

  function exportSelectedDriverClosings() {
    if (!selectedDriverClosingReports.length) {
      setMessageIsError(true);
      setMessage("Selecione ao menos um motorista para exportar.");
      playRomaneioAttentionSound();
      return;
    }
    setDriverClosingDiscountPrompt({ amount: "", installments: "1" });
    playRomaneioAttentionSound();
  }

  function finishDriverClosingExport(withDiscount: boolean) {
    if (!selectedDriverClosingReports.length) {
      setDriverClosingDiscountPrompt(null);
      return;
    }
    const discountAmount = withDiscount
      ? parseMoney(driverClosingDiscountPrompt?.amount || "")
      : 0;
    const installments = withDiscount
      ? Math.max(
          1,
          Math.floor(Number(driverClosingDiscountPrompt?.installments || 1)),
        )
      : 1;
    if (withDiscount && discountAmount <= 0) {
      setMessageIsError(true);
      setMessage("Informe o valor do desconto antes de gerar o PDF.");
      playRomaneioAttentionSound();
      return;
    }
    const safeInstallments = Number.isFinite(installments) ? installments : 1;
    const installmentAmount = roundMoney(discountAmount / safeInstallments);
    const reports = selectedDriverClosingReports.map((driver) => {
      const discounts = [...(driver.discounts || [])];
      if (withDiscount) {
        discounts.push({
          description: "DESCONTO",
          amount: installmentAmount,
          installment: 1,
          installments: safeInstallments,
        });
      }
      return { ...driver, discounts };
    });
    reports.forEach((driver) => exportDriverClosingPdf(driver));
    setDriverClosingDiscountPlans((current) => {
      const next = { ...current };
      selectedDriverClosingReports.forEach((driver) => {
        const advanced = (next[driver.key] || [])
          .map((plan) => ({
            ...plan,
            nextInstallment: plan.nextInstallment + 1,
          }))
          .filter((plan) => plan.nextInstallment <= plan.installments);
        if (withDiscount && safeInstallments > 1) {
          advanced.push({
            id: newId(),
            driverKey: driver.key,
            driver: driver.driver,
            totalAmount: discountAmount,
            installments: safeInstallments,
            nextInstallment: 2,
            createdAt: new Date().toISOString(),
          });
        }
        next[driver.key] = advanced;
      });
      return next;
    });
    setDriverClosingDiscountPrompt(null);
    setMessageIsError(false);
    setMessage(
      `${selectedDriverClosingReports.length} fechamento(s) em PDF gerado(s) em arquivos separados.${withDiscount ? " O desconto foi aplicado e as parcelas futuras ficaram salvas." : ""}`,
    );
  }

  function registerCoverScan() {
    if (coverSection === "report" || !effectiveCoverPartnerId) return;
    const raw = (coverScanInputRef.current?.value || "").trim();
    const key = scanKey(raw);
    if (!key) {
      setMessageIsError(true);
      setMessage("Bipe ou digite uma NF, um CT-e ou uma chave válida.");
      playRomaneioAttentionSound();
      return;
    }
    const completeReferenceBase = [
      ...new Map(
        [...entriesWithTde, ...romaneioReferenceEntries].map((entry) => [entry.id, entry] as const),
      ).values(),
    ];
    const matches = completeReferenceBase.filter((entry) =>
      entryMatchesGlobalDocumentScan(entry, raw),
    );
    if (!matches.length) {
      setMessageIsError(true);
      setMessage(`Não encontrei a nota ou CTE ${raw} no relatório importado.`);
      playRomaneioAttentionSound();
      return;
    }
    const scannedAt = new Date().toISOString();
    const existing = coverDraftsRef.current[coverDraftKey] || [];
    const savedDocuments = covers
      .filter((cover) => cover.id !== editingCoverId)
      .flatMap((cover) => cover.documents);
    const additions = matches.map((entry): CoverDocumentExport => ({
          scannedAt,
          invoice: entry.invoice,
          invoiceKey: normalizeInvoiceKey(entry.invoice),
          cte: cteNumberFromAccessKey(raw) || entry.cte,
          cteKey: /^\d{44}$/.test(key) ? key : entry.cteKey,
          mde: entry.mde,
          sender: entry.sender,
          recipient: entry.recipient,
          city: entry.city,
          date: entry.date,
          deliveryDate: entry.deliveryDate,
          status: entry.status,
          volumes: entry.volumes,
          weight: entry.weight,
          merchandiseValue: entry.merchandiseValue,
        }));
    const alreadyScanned = additions.some((document) =>
      [...existing, ...savedDocuments].some((item) =>
        coverDocumentsOverlap(document, item),
      ),
    );
    if (alreadyScanned) {
      if (coverScanInputRef.current) coverScanInputRef.current.value = "";
      setMessageIsError(true);
      setMessage(`A nota ou CTE ${raw} já foi bipado e não será repetido.`);
      playRomaneioAttentionSound();
      return;
    }
    const nextDrafts = {
      ...coverDraftsRef.current,
      [coverDraftKey]: [...existing, ...additions],
    };
    coverDraftsRef.current = nextDrafts;
    setCoverDrafts(nextDrafts);
    setScannedCtes((current) => {
      const next = { ...current };
      matches.forEach((entry) => {
        const scan = scanKey(entry.cte) || scanKey(entry.cteKey);
        if (!scan) return;
        next[entry.partnerId] = {
          ...(next[entry.partnerId] || {}),
          [scan]: { scannedAt, scannedBy: activeOperator },
        };
      });
      return next;
    });
    if (coverScanInputRef.current) coverScanInputRef.current.value = "";
    setMessageIsError(false);
    setMessage(`${additions.length} registro(s) incluído(s) na capa e disponibilizado(s) para o fechamento por bipagem.`);
    playRomaneioSuccessSound();
  }

  function undoRomaneioDraft(groupKey: string, documentKey: string) {
    setRomaneioDocumentDrafts((current) => {
      const groupDrafts = { ...(current[groupKey] || {}) };
      delete groupDrafts[documentKey];
      return { ...current, [groupKey]: groupDrafts };
    });
    setSelectedRomaneioDocumentKeys((current) => ({
      ...current,
      [groupKey]: (current[groupKey] || []).filter((key) => key !== documentKey),
    }));
    setMessageIsError(false);
    setMessage("Bipagem desfeita. O documento voltou ao status original.");
  }

  function removeCoverDraftDocument(index: number) {
    const next = {
      ...coverDraftsRef.current,
      [coverDraftKey]: (coverDraftsRef.current[coverDraftKey] || []).filter((_, itemIndex) => itemIndex !== index),
    };
    coverDraftsRef.current = next;
    setCoverDrafts(next);
  }

  function addManualCoverNumber() {
    if (coverSection !== "return") return;
    const raw = coverNumberInput.trim();
    if (!raw) return;
    const existing = coverDraftsRef.current[coverDraftKey] || [];
    const manualDocument: CoverDocumentExport = {
        scannedAt: new Date().toISOString(),
        invoice: "",
        invoiceKey: "",
        cte: raw,
        cteKey: "",
        mde: "",
        sender: "",
        recipient: "",
        city: "",
        date: "",
        deliveryDate: "",
        status: "CAPA MANUAL",
        manualCoverNumber: raw,
        manualEntry: true,
      };
    const savedDocuments = covers
      .filter((cover) => cover.id !== editingCoverId)
      .flatMap((cover) => cover.documents);
    if ([...existing, ...savedDocuments].some((document) => coverDocumentsOverlap(document, manualDocument))) {
      setCoverNumberInput("");
      setMessageIsError(true);
      setMessage(`A capa manual ${raw} já foi adicionada e não será repetida.`);
      playRomaneioAttentionSound();
      return;
    }
    const next = {
      ...coverDraftsRef.current,
      [coverDraftKey]: [...existing, manualDocument],
    };
    coverDraftsRef.current = next;
    setCoverDrafts(next);
    setCoverNumberInput("");
    setMessageIsError(false);
    setMessage(`Número de capa ${raw} adicionado manualmente ao documento atual.`);
    playRomaneioSuccessSound();
  }

  function addManualCoverDocument() {
    if (coverSection !== "shipment" && coverSection !== "collection") return;
    const draft = manualCoverDrafts[coverDraftKey] || emptyManualCoverDocument;
    const invoice = draft.invoice.trim();
    const cte = draft.cte.trim();
    const volumes = Number(draft.volumes.replace(",", "."));
    const weight = Number(draft.weight.replace(/\./g, "").replace(",", "."));
    const value = Number(draft.value.replace(/\./g, "").replace(",", "."));
    if (!invoice || !cte || !draft.sender.trim() || !draft.recipient.trim() || !Number.isFinite(volumes) || volumes <= 0 || !Number.isFinite(weight) || weight < 0 || !Number.isFinite(value) || value < 0) {
      setMessageIsError(true);
      setMessage("Preencha NF, CTE, remetente, destinatário, volumes, peso e valor corretamente.");
      playRomaneioAttentionSound();
      return;
    }
    const document: CoverDocumentExport = {
      scannedAt: new Date().toISOString(),
      invoice,
      invoiceKey: normalizeInvoiceKey(invoice),
      cte,
      cteKey: "",
      mde: "",
      sender: draft.sender.trim(),
      recipient: draft.recipient.trim(),
      city: "",
      date: "",
      deliveryDate: "",
      status: "INCLUSÃO MANUAL",
      volumes: Math.floor(volumes),
      weight,
      merchandiseValue: value,
      manualEntry: true,
    };
    const existing = coverDraftsRef.current[coverDraftKey] || [];
    const savedDocuments = covers
      .filter((cover) => cover.id !== editingCoverId)
      .flatMap((cover) => cover.documents);
    if ([...existing, ...savedDocuments].some((item) => coverDocumentsOverlap(item, document))) {
      setMessageIsError(true);
      setMessage(`A nota fiscal ${invoice} já foi adicionada e não será repetida.`);
      playRomaneioAttentionSound();
      return;
    }
    const next = {
      ...coverDraftsRef.current,
      [coverDraftKey]: [...existing, document],
    };
    coverDraftsRef.current = next;
    setCoverDrafts(next);
    setManualCoverDrafts((current) => ({ ...current, [coverDraftKey]: emptyManualCoverDocument }));
    setMessageIsError(false);
    setMessage(`Nota fiscal ${invoice} adicionada manualmente.`);
    playRomaneioSuccessSound();
  }

  function startEditingCover(cover: CoverExport) {
    const partnerId = cover.partnerId || coverPartners.find((partner) => partner.name === cover.partnerName)?.id || effectiveCoverPartnerId;
    const key = `${cover.kind}|${partnerId}`;
    const next = { ...coverDraftsRef.current, [key]: [...cover.documents] };
    coverDraftsRef.current = next;
    setCoverDrafts(next);
    setCoverSection(cover.kind);
    setCoverPartnerId(partnerId);
    setEditingCoverId(cover.id);
    setSelectedCoverReportIds([]);
    setMessageIsError(false);
    setMessage(`${cover.id} aberta para edição. Adicione ou remova itens e salve novamente.`);
  }

  function addClosingAdditional() {
    if (!closingAdditionalMatch) {
      setMessageIsError(true);
      setMessage("Localize primeiro uma nota fiscal ou CTE existente no sistema.");
      return;
    }
    const value = parseMoney(closingAdditionalValue);
    if (!value || value <= 0) {
      setMessageIsError(true);
      setMessage("Informe um valor válido para o adicional.");
      return;
    }
    const additional: ClosingAdditional = {
      id: newId(),
      sourceEntryId: closingAdditionalMatch.id,
      partnerId: closingAdditionalMatch.partnerId,
      partnerName: closingAdditionalMatch.partnerName,
      invoice: closingAdditionalMatch.invoice,
      cte: closingAdditionalMatch.cte,
      recipient: closingAdditionalMatch.recipient,
      recipientKey: normalized(closingAdditionalMatch.recipient),
      kind: closingAdditionalKind,
      value,
      calculation: closingAdditionalCalculation,
      persistent: closingAdditionalPersistent,
      createdAt: new Date().toISOString(),
      createdBy: activeOperator,
    };
    setClosingAdditionals((current) => [...current, additional]);
    setClosingAdditionalValue("");
    setMessageIsError(false);
    setMessage(`${closingAdditionalKind.toUpperCase()} adicionado ao fechamento${closingAdditionalPersistent ? ` e salvo para ${closingAdditionalMatch.recipient}` : ""}.`);
  }

  function removeClosingAdditional(id: string) {
    setClosingAdditionals((current) => current.filter((item) => item.id !== id));
    setMessageIsError(false);
    setMessage("Adicional removido do fechamento.");
  }

  const billingPeriods = useMemo(
    () => [...new Set(billingInvoices.map((invoice) => invoice.period))].sort().reverse(),
    [billingInvoices],
  );
  const visibleBillingInvoices = useMemo(
    () => billingInvoices
      .filter((invoice) => billingFilter === "all" || invoice.period === billingFilter)
      .sort((a, b) => b.period.localeCompare(a.period) || a.partnerName.localeCompare(b.partnerName, "pt-BR")),
    [billingFilter, billingInvoices],
  );
  const billingTotal = useMemo(
    () => visibleBillingInvoices.reduce((total, invoice) => total + invoice.value, 0),
    [visibleBillingInvoices],
  );

  function unlockBilling(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (billingCode.trim().toUpperCase() !== BILLING_ACCESS_CODE) {
      setBillingCodeError("Código incorreto. Solicite o acesso ao responsável.");
      return;
    }
    setBillingUnlocked(true);
    setBillingCode("");
    setBillingCodeError("");
  }

  function saveBillingInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = parseMoney(billingValue);
    const partner = billingPartners.find(([id]) => id === billingPartnerId);
    if (!partner || !value || value <= 0 || !billingMonth) {
      setMessageIsError(true);
      setMessage("Escolha a parceira, a quinzena e informe um valor válido.");
      return;
    }
    const now = new Date().toISOString();
    const period = `${billingMonth}-${billingHalf}`;
    if (editingBillingId) {
      setBillingInvoices((current) => current.map((invoice) => invoice.id === editingBillingId ? {
        ...invoice,
        partnerId: partner[0],
        partnerName: partner[1],
        value,
        period,
        updatedAt: now,
        updatedBy: activeOperator,
      } : invoice));
      setMessage("Valor da fatura atualizado.");
    } else {
      setBillingInvoices((current) => [...current, {
        id: newId(),
        partnerId: partner[0],
        partnerName: partner[1],
        value,
        period,
        createdAt: now,
        createdBy: activeOperator,
      }]);
      setMessage("Fatura lançada com sucesso.");
    }
    setMessageIsError(false);
    setBillingPartnerId("");
    setBillingValue("");
    setEditingBillingId("");
    setBillingFilter(period);
  }

  function editBillingInvoice(invoice: BillingInvoice) {
    const match = invoice.period.match(/^(\d{4}-\d{2})-([12])$/);
    setBillingPartnerId(invoice.partnerId);
    setBillingValue(invoice.value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    if (match) {
      setBillingMonth(match[1]);
      setBillingHalf(match[2] as "1" | "2");
    }
    setEditingBillingId(invoice.id);
    setDeletingBillingId("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteBillingInvoice(id: string) {
    setBillingInvoices((current) => current.filter((invoice) => invoice.id !== id));
    setDeletingBillingId("");
    if (editingBillingId === id) setEditingBillingId("");
    setMessageIsError(false);
    setMessage("Valor da fatura excluído.");
  }

  const visibleFinancialEntries = useMemo(
    () => financialEntries.filter((entry) => entry.month === financialMonth).sort((a, b) => a.accountName.localeCompare(b.accountName, "pt-BR")),
    [financialEntries, financialMonth],
  );
  const financialTotal = useMemo(
    () => visibleFinancialEntries.reduce((total, entry) => total + entry.value, 0),
    [visibleFinancialEntries],
  );

  function saveFinancialEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = parseMoney(financialValue);
    const accountName = financialAccountName.trim();
    if (!accountName || !value || value <= 0 || !financialPaidAt || !financialMonth) {
      setMessageIsError(true);
      setMessage("Preencha o nome da conta, o valor e a data do pagamento.");
      return;
    }
    const wasEditing = Boolean(editingFinancialId);
    const entry: FinancialEntry = {
      id: editingFinancialId || newId(),
      accountName,
      value,
      paidAt: financialPaidAt,
      month: financialMonth,
      createdAt: new Date().toISOString(),
      createdBy: activeOperator,
    };
    setFinancialEntries((current) => editingFinancialId ? current.map((item) => item.id === editingFinancialId ? entry : item) : [...current, entry]);
    setFinancialAccountNames((current) => current.some((name) => normalized(name) === normalized(accountName)) ? current : [...current, accountName].sort((a, b) => a.localeCompare(b, "pt-BR")));
    setFinancialAccountName("");
    setFinancialValue("");
    setEditingFinancialId("");
    setMessageIsError(false);
    setMessage(wasEditing ? "Conta atualizada." : "Conta lançada no financeiro.");
  }

  function editFinancialEntry(entry: FinancialEntry) {
    setFinancialAccountName(entry.accountName);
    setFinancialValue(entry.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    setFinancialPaidAt(entry.paidAt);
    setFinancialMonth(entry.month);
    setEditingFinancialId(entry.id);
    setDeletingFinancialId("");
  }

  function deleteFinancialEntry(id: string) {
    setFinancialEntries((current) => current.filter((entry) => entry.id !== id));
    setDeletingFinancialId("");
    if (editingFinancialId === id) setEditingFinancialId("");
    setMessageIsError(false);
    setMessage("Conta removida deste mês. O nome continuará disponível para os próximos lançamentos.");
  }

  function generateBillingPdf() {
    if (billingFilter === "all" || !visibleBillingInvoices.length) return;
    exportBillingPdf(billingPeriodLabel(billingFilter), visibleBillingInvoices.map((invoice) => ({ partner: invoice.partnerName, value: invoice.value, createdBy: invoice.createdBy || "Não informado" })));
  }

  function generateFinancialPdf() {
    if (!visibleFinancialEntries.length) return;
    const monthLabel = new Date(`${financialMonth}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    exportFinancialPdf(monthLabel, visibleFinancialEntries.map((entry) => ({ account: entry.accountName, value: entry.value, paidAt: entry.paidAt })));
  }

  const openPickupRecords = useMemo(
    () => pickupRecords
      .filter((record) => record.status === "open" && (pickupPartnerFilter === "all" || record.partnerId === pickupPartnerFilter))
      .sort((a, b) => a.partnerName.localeCompare(b.partnerName, "pt-BR") || a.clientName.localeCompare(b.clientName, "pt-BR")),
    [pickupPartnerFilter, pickupRecords],
  );
  const completedPickupRecords = useMemo(() => {
    const driver = normalized(pickupReportDriverFilter);
    return pickupRecords
      .filter((record) => record.status === "completed")
      .filter((record) => pickupReportPartnerFilter === "all" || record.partnerId === pickupReportPartnerFilter)
      .filter((record) => !driver || normalized(record.driver).includes(driver))
      .filter((record) => !pickupReportFrom || record.completedAt >= pickupReportFrom)
      .filter((record) => !pickupReportTo || record.completedAt <= pickupReportTo)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.partnerName.localeCompare(b.partnerName, "pt-BR"));
  }, [pickupRecords, pickupReportDriverFilter, pickupReportFrom, pickupReportPartnerFilter, pickupReportTo]);

  function addPickup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const partner = partnerAliases.find(([id]) => id === pickupPartnerId);
    const volumes = Number(pickupVolumes.replace(/\D/g, ""));
    if (!pickupNumber.trim() || !partner || !pickupClientName.trim() || !Number.isFinite(volumes) || volumes <= 0) {
      setMessageIsError(true);
      setMessage("Preencha o número da coleta, a parceira, o cliente e a quantidade de volumes.");
      return;
    }
    setPickupRecords((current) => [...current, {
      id: newId(),
      number: pickupNumber.trim(),
      invoice: pickupInvoice.trim(),
      partnerId: partner[0],
      partnerName: partner[1],
      clientName: pickupClientName.trim(),
      volumes,
      driver: "",
      completedAt: "",
      status: "open",
      createdAt: new Date().toISOString(),
      createdBy: activeOperator,
    }]);
    setPickupNumber("");
    setPickupInvoice("");
    setPickupPartnerId("");
    setPickupClientName("");
    setPickupVolumes("");
    setMessageIsError(false);
    setMessage("Coleta lançada no painel.");
  }

  function completePickup(record: PickupRecord) {
    const draft = pickupCompletionDrafts[record.id] || { driver: "", date: "" };
    if (!draft.driver.trim() || !draft.date) {
      setMessageIsError(true);
      setMessage("Informe o motorista e a data realizada antes de dar baixa.");
      return;
    }
    setPickupRecords((current) => current.map((item) => item.id === record.id ? {
      ...item,
      driver: draft.driver.trim(),
      completedAt: draft.date,
      completedBy: activeOperator,
      status: "completed",
    } : item));
    setPickupCompletionDrafts((current) => {
      const next = { ...current };
      delete next[record.id];
      return next;
    });
    setMessageIsError(false);
    setMessage(`Coleta ${record.number} concluída e enviada ao relatório.`);
  }

  const openDedicatedRecords = useMemo(
    () => dedicatedRecords
      .filter((record) => !record.paid && (dedicatedPanelPartnerFilter === "all" || record.partnerId === dedicatedPanelPartnerFilter))
      .sort((a, b) => b.trackingDate.localeCompare(a.trackingDate)),
    [dedicatedPanelPartnerFilter, dedicatedRecords],
  );
  const visibleDedicatedRecords = useMemo(() => {
    const search = normalized(dedicatedReportSearch);
    return dedicatedRecords
      .filter((record) => dedicatedReportPartnerFilter === "all" || record.partnerId === dedicatedReportPartnerFilter)
      .filter((record) => !search || normalized([record.invoice, record.cte, record.sender, record.recipient, record.driver, record.partnerName, record.observation].join(" ")).includes(search))
      .sort((a, b) => b.trackingDate.localeCompare(a.trackingDate));
  }, [dedicatedRecords, dedicatedReportPartnerFilter, dedicatedReportSearch]);

  function prepareDedicated(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = dedicatedSearch.trim();
    const matched = [...entries, ...romaneioReferenceEntries].find((entry) => entryMatchesGlobalDocumentScan(entry, raw));
    if (!matched) {
      setMessageIsError(true);
      setMessage("Não encontrei essa nota fiscal ou CT-e nos relatórios importados.");
      playRomaneioAttentionSound();
      return;
    }
    const parsedValue = dedicatedValue.trim() ? parseMoney(dedicatedValue) : undefined;
    if (dedicatedValue.trim() && (parsedValue === null || parsedValue < 0)) {
      setMessageIsError(true);
      setMessage("Informe um valor válido ou deixe o valor do dedicado em branco.");
      return;
    }
    const identifiers = new Set(entryOperationalIdentifiers(matched));
    const matchedGroup = [...romaneioDailyGroups]
      .sort((a, b) => b.day.localeCompare(a.day))
      .find((group) => group.documents.some((document) =>
        document.linkedEntries.some((entry) => entry.id === matched.id) ||
        document.identifiers.some((identifier) => identifiers.has(identifier)),
      ));
    setDedicatedConfirmation({
      trackingDate: new Date().toISOString().slice(0, 10),
      invoice: matched.invoice || "",
      cte: matched.cte || "",
      cteKey: matched.cteKey || "",
      sender: matched.sender || "",
      recipient: matched.recipient || "",
      partnerId: matched.partnerId || "",
      partnerName: matched.partnerName || "Não identificado",
      value: parsedValue === null ? undefined : parsedValue,
      driver: matchedGroup?.driver || "",
    });
    setMessage("");
    playRomaneioAttentionSound();
  }

  function confirmDedicated() {
    if (!dedicatedConfirmation) return;
    setDedicatedRecords((current) => [...current, {
      ...dedicatedConfirmation,
      id: newId(),
      observation: "",
      paid: false,
      paidAt: "",
      createdAt: new Date().toISOString(),
      createdBy: activeOperator,
    }]);
    setDedicatedConfirmation(null);
    setDedicatedSearch("");
    setDedicatedValue("");
    setMessageIsError(false);
    setMessage("Dedicado confirmado e adicionado ao painel.");
    playRomaneioSuccessSound();
  }

  function updateDedicated(id: string, changes: Partial<DedicatedRecord>) {
    setDedicatedRecords((current) => current.map((record) => record.id === id ? { ...record, ...changes } : record));
  }

  function toggleDedicatedPaid(record: DedicatedRecord, paid: boolean) {
    if (paid && !record.paidAt) {
      setMessageIsError(true);
      setMessage("Informe a data do pagamento antes de marcar como pago.");
      return;
    }
    updateDedicated(record.id, { paid });
    setMessageIsError(false);
    setMessage(paid ? "Dedicado marcado como pago." : "Dedicado reaberto como pendente.");
  }

  function renderDedicatedCard(record: DedicatedRecord) {
    const expanded = expandedDedicatedIds.includes(record.id);
    return <article className={`dedicated-card ${record.paid ? "paid" : "open"} ${expanded ? "expanded" : "compact"}`} key={record.id}>
      <div className="dedicated-card-heading"><span><small>{record.paid ? "PAGO" : "PENDENTE"}</small><strong>{record.invoice ? `NF ${record.invoice}` : "Sem NF"}</strong></span><div className="dedicated-card-summary"><span><small>CT-e</small><strong>{record.cte || "Não informado"}</strong></span><span><small>Parceiro</small><strong>{record.partnerName}</strong></span><span><small>Motorista</small><strong>{record.driver || "Aguardando romaneio"}</strong></span><span><small>Data</small><strong>{formatRomaneioDay(record.trackingDate)}</strong></span></div><label className="dedicated-compact-value"><small>VALOR</small><input key={`compact-${record.id}-${record.value}`} defaultValue={record.value === undefined ? "" : record.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} inputMode="decimal" placeholder="R$ 0,00" onBlur={(event) => { const value = event.target.value.trim() ? parseMoney(event.target.value) : undefined; if (value !== null) updateDedicated(record.id, { value }); }} /></label><button type="button" onClick={() => setExpandedDedicatedIds((current) => current.includes(record.id) ? current.filter((id) => id !== record.id) : [...current, record.id])}>{expanded ? "Fechar detalhes" : "Editar detalhes"}</button></div>
      {expanded && <>
      <div className="dedicated-edit-grid">
        <label>Data do acompanhamento<input type="date" value={record.trackingDate} onChange={(event) => updateDedicated(record.id, { trackingDate: event.target.value })} /></label>
        <label>Nota fiscal<input value={record.invoice} onChange={(event) => updateDedicated(record.id, { invoice: event.target.value })} /></label>
        <label>CT-e<input value={record.cte} onChange={(event) => updateDedicated(record.id, { cte: event.target.value })} /></label>
        <label>Valor do dedicado<input key={`${record.id}-${record.value}`} defaultValue={record.value === undefined ? "" : record.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} inputMode="decimal" placeholder="Opcional" onBlur={(event) => { const value = event.target.value.trim() ? parseMoney(event.target.value) : undefined; if (value !== null) updateDedicated(record.id, { value }); }} /></label>
        <label>Remetente<input value={record.sender} onChange={(event) => updateDedicated(record.id, { sender: event.target.value })} /></label>
        <label>Destinatário<input value={record.recipient} onChange={(event) => updateDedicated(record.id, { recipient: event.target.value })} /></label>
        <label>Parceiro<input value={record.partnerName} onChange={(event) => updateDedicated(record.id, { partnerName: event.target.value })} /></label>
        <label>Motorista<input value={record.driver} onChange={(event) => updateDedicated(record.id, { driver: event.target.value })} placeholder="Preenchido pelo romaneio ou manualmente" /></label>
      </div>
      {record.cteKey && <p className="dedicated-key"><small>CHAVE DO CT-e</small>{record.cteKey}</p>}
      <label className="dedicated-observation">Observação<textarea value={record.observation} onChange={(event) => updateDedicated(record.id, { observation: event.target.value })} placeholder="Escreva qualquer acompanhamento necessário" /></label>
      <div className="dedicated-payment">
        <label>Data do pagamento<input type="date" value={record.paidAt} onChange={(event) => updateDedicated(record.id, { paidAt: event.target.value })} /></label>
        <label className="dedicated-paid-check"><input type="checkbox" checked={record.paid} onChange={(event) => toggleDedicatedPaid(record, event.target.checked)} /><span>{record.paid ? "Pagamento confirmado" : "Marcar que foi pago"}</span></label>
      </div>
      </>}
    </article>;
  }

  function selectCoverPartner(partnerId: string) {
    if (editingCoverId && partnerId !== effectiveCoverPartnerId) {
      const oldKey = coverDraftKey;
      const nextKey = `${coverSection}|${partnerId}`;
      const documents = coverDraftsRef.current[oldKey] || [];
      const nextDrafts = { ...coverDraftsRef.current, [nextKey]: documents };
      delete nextDrafts[oldKey];
      coverDraftsRef.current = nextDrafts;
      setCoverDrafts(nextDrafts);
    }
    setCoverPartnerId(partnerId);
  }

  function cancelCoverEdit() {
    const next = { ...coverDraftsRef.current, [coverDraftKey]: [] };
    coverDraftsRef.current = next;
    setCoverDrafts(next);
    setEditingCoverId("");
    setMessage("Edição cancelada. A capa salva não foi alterada.");
  }

  function deleteSelectedCovers() {
    const selected = new Set(selectedCoverReportIds);
    setCovers((current) => current.filter((cover) => !selected.has(cover.id)));
    if (selected.has(editingCoverId)) setEditingCoverId("");
    setSelectedCoverReportIds([]);
    setCoverDeleteConfirmation(false);
    setMessageIsError(false);
    setMessage(`${selected.size} capa(s) excluída(s) do relatório.`);
  }

  function exportCurrentCoverDetails() {
    if (!currentCoverDraft.length) return;
    const editing = covers.find((cover) => cover.id === editingCoverId);
    const partnerName = coverPartners.find((partner) => partner.id === effectiveCoverPartnerId)?.name || editing?.partnerName || "Transportadora";
    exportCoverDetailedPdf({
      id: editing?.id || "RASCUNHO",
      sequenceNumber: editing?.sequenceNumber,
      partnerId: effectiveCoverPartnerId,
      partnerName,
      kind: coverSection as CoverKind,
      createdAt: editing?.createdAt || new Date().toISOString(),
      generatedBy: activeOperator,
      documents: currentCoverDraft,
    });
  }

  function generateCover() {
    if (coverSection === "report" || !currentCoverDraft.length) {
      setMessage("Bipe ao menos uma nota fiscal antes de gerar a capa.");
      return;
    }
    if (!effectiveCoverGenerator) {
      setMessageIsError(true);
      setMessage("A sessão não possui um operador identificado. Saia e informe o nome novamente.");
      return;
    }
    const partnerName = coverPartners.find((partner) => partner.id === effectiveCoverPartnerId)?.name || "Transportadora";
    const editing = covers.find((cover) => cover.id === editingCoverId);
    const sequenceNumber = editing?.sequenceNumber || Math.max(
      9999,
      ...covers.map((savedCover) => savedCover.sequenceNumber || 0),
    ) + 1;
    const prefix = coverSection === "shipment" ? "E" : coverSection === "collection" ? "CO" : "CA";
    const cover: CoverExport = {
      id: editing?.id || `${prefix}-${sequenceNumber}`,
      sequenceNumber,
      partnerId: effectiveCoverPartnerId,
      partnerName,
      kind: coverSection,
      createdAt: editing?.createdAt || new Date().toISOString(),
      generatedBy: effectiveCoverGenerator,
      documents: currentCoverDraft,
    };
    setCovers((current) => editing
      ? current.map((savedCover) => savedCover.id === editing.id ? cover : savedCover)
      : [cover, ...current]);
    const next = { ...coverDraftsRef.current, [coverDraftKey]: [] };
    coverDraftsRef.current = next;
    setCoverDrafts(next);
    setEditingCoverId("");
    exportCoverPdf(cover);
    setMessageIsError(false);
    const kindLabel = coverSection === "shipment" ? "embarque" : coverSection === "collection" ? "coleta" : "capas";
    setMessage(`${cover.id} de ${kindLabel} ${editing ? "atualizada" : "gerada"} por ${effectiveCoverGenerator} e salva no relatório.`);
    playRomaneioSuccessSound();
  }

  function exportSelected() {
    const chosen = partners.filter(
      (p) => selectedExports.includes(p.id) && p.id !== "unidentified",
    );
    if (!chosen.length)
      return setMessage("Selecione ao menos uma transportadora identificada.");
    const lastDate =
      dateTo ||
      filtered
        .map((r) => r.date)
        .filter(Boolean)
        .sort()
        .at(-1) ||
      "";
    const period = periodName(lastDate);
    let generated = 0;
    const skipped: string[] = [];
    let maexAdditionalGenerated = false;
    let maexSelectedWithoutAdditional = false;
    const exportedDocuments = new Map<string, BilledDocumentRecord>();
    const exportedAt = new Date().toISOString();
    chosen.forEach((partner) => {
      const exportRows = rowsForClosing(partner);
      const additionalRows =
        partner.id === "maex"
          ? maexAdditionalOpenRows.filter(isMaexAdditional)
          : [];
      if (!exportRows.length && !additionalRows.length) {
        skipped.push(partner.name);
        if (partner.id === "maex") maexSelectedWithoutAdditional = true;
        return;
      }
      if (exportRows.length) {
        generated += exportClosingXlsx(
          exportRows.map((entry) => toExportRow(entry, partner.name)),
          partner.name,
          period,
        );
        const source = `Fechamento ${partner.name} - ${period} (gerado pelo sistema)`;
        exportRows.forEach((entry) => {
          const key = billedDocumentKey(partner.id, entry.cte);
          if (!key) return;
          const existing = exportedDocuments.get(key);
          exportedDocuments.set(key, {
            key,
            partnerId: partner.id,
            partnerName: partner.name,
            cte: entry.cte,
            invoice: existing?.invoice || entry.invoice,
            sources: [...new Set([...(existing?.sources || []), source])],
            markedAt: existing?.markedAt || exportedAt,
            billingScope: "normal",
          });
        });
      }
      if (partner.id === "maex" && additionalRows.length) {
        exportMaexAdditionalXlsx(
          additionalRows.map((entry) => toExportRow(entry, partner.name)),
          period,
        );
        const additionalSource = `Fechamento Adicional Maex - ${period} (gerado pelo sistema)`;
        additionalRows.forEach((entry) => {
          const key = billedDocumentKey(
            "maex",
            entry.cte,
            "maex-additional",
          );
          if (!key) return;
          const existing = exportedDocuments.get(key);
          exportedDocuments.set(key, {
            key,
            partnerId: "maex",
            partnerName: partner.name,
            cte: entry.cte,
            invoice: existing?.invoice || entry.invoice,
            sources: [
              ...new Set([...(existing?.sources || []), additionalSource]),
            ],
            markedAt: existing?.markedAt || exportedAt,
            billingScope: "maex-additional",
          });
        });
        generated++;
        maexAdditionalGenerated = true;
      } else if (partner.id === "maex") {
        maexSelectedWithoutAdditional = true;
      }
    });
    if (exportedDocuments.size) {
      setBilledDocuments((current) =>
        mergeBilledDocuments(current, [...exportedDocuments.values()]),
      );
      setSelectedExports((current) =>
        current.filter((id) => !chosen.some((partner) => partner.id === id)),
      );
    }
    setMessage(
      `${generated} arquivo(s) gerado(s). ${exportedDocuments.size} documento(s) marcado(s) automaticamente como enviados ao faturamento.${
        skipped.length
          ? ` Sem documentos bipados: ${skipped.join(", ")}.`
          : ""
      }${
        maexAdditionalGenerated
          ? " O MAEX ADICIONAL foi gerado somente com os documentos marcados."
          : maexSelectedWithoutAdditional
            ? " Nenhum documento marcado para o MAEX ADICIONAL neste período."
            : ""
      }`,
    );
  }

  async function login({
    operator,
    username,
    password,
  }: {
    operator: string;
    username: string;
    password: string;
  }) {
    setLoggingIn(true);
    setLoginError("");
    try {
      const operatorName = operator.trim();
      if (!operatorName) throw new Error("Informe o nome de quem está entrando.");
      if (cloudHosted && authStatus === "signedOut") {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: username.trim(),
            password,
          }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok)
          throw new Error(result.error || "Usuário ou senha incorretos.");
        setAuthStatus("checking");
        setCloudReady(false);
        setCloudStatus("loading");
        setCloudRetry((current) => current + 1);
      }
      setActiveOperator(operatorName);
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Não foi possível entrar.",
      );
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    if (!cloudHosted) {
      setActiveOperator("");
      setLoginError("");
      return;
    }
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setActiveOperator("");
      setAuthStatus("signedOut");
      setCloudReady(false);
      setEntries([]);
      setRomaneioReferenceEntries([]);
      setOptionalScanPartnerIds([]);
      setImportInfo(null);
      setScannedCtes({});
      setTdeRates([]);
      setTdeImportInfo(null);
      setMaexAdditionalSenders({});
      setBilledDocuments({});
      setBillingInvoices([]);
      setBillingUnlocked(false);
      setPickupRecords([]);
      setDedicatedRecords([]);
      setFinancialEntries([]);
      setFinancialAccountNames([]);
      setRomaneioEntries([]);
      setRomaneioImportInfo(null);
      setRomaneioDocumentStatuses({});
      setRomaneioRouteLabels({});
      cloudVersionsRef.current = {};
    }
  }

  async function retryCloudAccess() {
    if (!cloudReady || !cloudSaveFailedRef.current) {
      setCloudStatus("loading");
      setCloudRetry((current) => current + 1);
      return;
    }

    setCloudStatus("loading");
    try {
      const versions = await Promise.all([
        saveCloudState("closing", closingCloudState),
        saveCloudState("scans", scannedCtes),
        saveCloudState("tde", tdeCloudState),
        saveCloudState("maex", maexAdditionalSenders),
        saveCloudState("billed", billedDocuments),
        saveCloudState("romaneios", romaneiosCloudState),
      ]);
      ([
        "closing",
        "scans",
        "tde",
        "maex",
        "billed",
        "romaneios",
      ] as CloudStateKey[])
        .forEach((key, index) => {
          cloudVersionsRef.current[key] = versions[index];
        });
      cloudSaveFailedRef.current = false;
      setCloudStatus("ready");
    } catch {
      setCloudStatus("error");
    }
  }

  function navigateTab(nextTab: Tab) {
    setMessage("");
    startTabTransition(() => setTab(nextTab));
  }

  if (!hydrated)
    return (
      <main className="access-shell">
        <section className="access-card loading">
          <div className="access-mark">GM</div>
          <small>FECHAMENTOS GMOBS</small>
          <h1>Preparando o sistema...</h1>
        </section>
      </main>
    );

  if (
    (cloudHosted && authStatus === "signedOut") ||
    (authStatus === "signedIn" && !activeOperator)
  )
    return (
      <LoginGate
        authStatus={authStatus}
        cloudHosted={cloudHosted}
        loginError={loginError}
        loggingIn={loggingIn}
        operatorNames={coverGenerators}
        onLogin={login}
      />
    );

  if (
    cloudHosted &&
    (!cloudReady || cloudStatus === "loading" || cloudStatus === "error")
  )
    return (
      <main className="access-shell">
        <section className={`access-card ${cloudStatus}`}>
          <div className="access-mark">GM</div>
          <small>BANCO CENTRAL</small>
          <h1>
            {cloudStatus === "error"
              ? "Não foi possível acessar o banco"
              : "Carregando os dados compartilhados..."}
          </h1>
          <p>
            {cloudStatus === "error"
              ? "Para evitar informações diferentes entre computadores, o sistema fica bloqueado até a conexão voltar."
              : "Aguarde. Nenhum dado local será usado no lugar do banco."}
          </p>
          {cloudStatus === "error" && (
            <button type="button" className="primary" onClick={retryCloudAccess}>
              Tentar novamente
            </button>
          )}
        </section>
      </main>
    );

  return (
    <main className="shell">
      <header className="header">
        <div>
          <span>GMOBS</span>
          <h1>Fechamentos</h1>
        </div>
        <div className="header-actions">
          <p className="active-operator">Operador: <strong>{activeOperator}</strong></p>
          <p className={`storage-status ${cloudStatus}`}>
            <span aria-hidden="true" />
            {cloudStatusText[cloudStatus]}
          </p>
          <button type="button" onClick={logout}>Sair</button>
        </div>
      </header>
      <nav className={`tabs ${tabPending ? "switching" : ""}`} aria-label="Etapas do fechamento" aria-busy={tabPending}>
        <button
          className={tab === "import" ? "active" : ""}
          onClick={() => navigateTab("import")}
        >
          <b>1</b>Importar
        </button>
        <button
          className={tab === "romaneios" ? "active" : ""}
          onClick={() => navigateTab("romaneios")}
        >
          <b>2</b>Romaneios
        </button>
        <button
          className={tab === "covers" ? "active" : ""}
          onClick={() => navigateTab("covers")}
        >
          <b>3</b>Capas
        </button>
        <button
          className={tab === "preview" || tab === "export" || tab === "adjustments" ? "active" : ""}
          onClick={() => navigateTab("preview")}
        >
          <b>4</b>Fechamento parceiros
        </button>
        <button
          className={tab === "billing" ? "active" : ""}
          onClick={() => navigateTab("billing")}
        >
          <b>5</b>Faturamento
        </button>
        <button
          className={tab === "collections" ? "active" : ""}
          onClick={() => navigateTab("collections")}
        >
          <b>6</b>Coletas
        </button>
        <button
          className={tab === "dedicated" ? "active" : ""}
          onClick={() => navigateTab("dedicated")}
        >
          <b>7</b>Acompanhamento de dedicados
        </button>
      </nav>
      <section className="panel">
        {tab === "import" && (
          <div className="import-view">
            <div className="intro">
              <small>PASSO 1</small>
              <h2>Importe os relatórios e dados de apoio</h2>
              <p>
                O relatório traz as entregas. A tabela de TDE procura o CNPJ do
                destinatário, os fechamentos antigos evitam duplicidade e os
                romaneios ficam organizados em uma tela separada.
              </p>
            </div>
            <div className="import-grid">
              <section className="import-card">
                <div className="import-card-title">
                  <span>1</span>
                  <div>
                    <strong>Relatório geral</strong>
                    <small>Entregas, reentregas e CF</small>
                  </div>
                </div>
                <input
                  ref={inputRef}
                  hidden
                  type="file"
                  accept=".xls,.xlsx,.csv"
                  onChange={importExcel}
                />
                <button
                  type="button"
                  className="upload compact"
                  disabled={importing}
                  onClick={() => inputRef.current?.click()}
                >
                  <span>↑</span>
                  <strong>
                    {importing
                      ? "Lendo o relatório..."
                      : "Selecionar relatório"}
                  </strong>
                  <small>Excel .xls, .xlsx ou .csv</small>
                </button>
                {entries.length > 0 && (
                  <div className="general-date-summary">
                    <div>
                      <small>ÚLTIMA DATA DE EMISSÃO IMPORTADA</small>
                      <strong>
                        {importInfo?.latestEmissionDate || latestGeneralEmissionDate
                          ? formatRomaneioDay(
                              importInfo?.latestEmissionDate ||
                                latestGeneralEmissionDate,
                            )
                          : "Não encontrada"}
                      </strong>
                    </div>
                    <p>Maior data localizada na coluna F do relatório geral.</p>
                  </div>
                )}
                {importInfo && (
                  <div className="import-summary">
                    <div>
                      <small>ÚLTIMO RELATÓRIO</small>
                      <strong>{importInfo.file}</strong>
                    </div>
                    <dl>
                      <div>
                        <dt>Importadas</dt>
                        <dd>{importInfo.imported}</dd>
                      </div>
                      <div>
                        <dt>Reentregas</dt>
                        <dd>{importInfo.redeliveries}</dd>
                      </div>
                      <div>
                        <dt>Fora</dt>
                        <dd>{importInfo.excluded}</dd>
                      </div>
                      <div>
                        <dt>Sem parceira</dt>
                        <dd>{importInfo.unidentified}</dd>
                      </div>
                      <div>
                        <dt>Duplicadas ignoradas</dt>
                        <dd>{importInfo.duplicates || 0}</dd>
                      </div>
                    </dl>
                  </div>
                )}
              </section>

              <section className="import-card tde-card">
                <div className="import-card-title">
                  <span>2</span>
                  <div>
                    <strong>Lista de TDE</strong>
                    <small>CNPJ × taxa da transportadora</small>
                  </div>
                </div>
                <input
                  ref={tdeInputRef}
                  hidden
                  type="file"
                  accept=".xls,.xlsx,.csv"
                  onChange={importTdeExcel}
                />
                <button
                  type="button"
                  className="upload compact"
                  disabled={importingTde}
                  onClick={() => tdeInputRef.current?.click()}
                >
                  <span>↕</span>
                  <strong>
                    {importingTde
                      ? "Lendo a lista de TDE..."
                      : "Selecionar lista de TDE"}
                  </strong>
                  <small>Colunas NOME, CNPJ e uma taxa por parceira</small>
                </button>
                {tdeImportInfo && (
                  <div className="tde-file-summary">
                    <small>LISTA ATIVA</small>
                    <strong>{tdeImportInfo.file}</strong>
                    <p>
                      {tdeImportInfo.clients} clientes · {tdeImportInfo.rates}{" "}
                      combinações de taxa
                    </p>
                  </div>
                )}
              </section>

              <section className="import-card billed-card">
                <div className="import-card-title">
                  <span>3</span>
                  <div>
                    <strong>Já enviados ao faturamento</strong>
                    <small>Histórico por transportadora e CTE</small>
                  </div>
                </div>
                <input
                  ref={billedInputRef}
                  hidden
                  multiple
                  type="file"
                  accept=".xls,.xlsx"
                  onChange={importBilledClosings}
                />
                <button
                  type="button"
                  className="upload compact"
                  disabled={importingBilled}
                  onClick={() => billedInputRef.current?.click()}
                >
                  <span>✓</span>
                  <strong>
                    {importingBilled
                      ? "Validando os fechamentos..."
                      : "Selecionar fechamentos antigos"}
                  </strong>
                  <small>Selecione vários arquivos de uma vez</small>
                </button>
                <div className="billed-summary">
                  <div>
                    <small>DOCUMENTOS NO HISTÓRICO</small>
                    <strong>{Object.keys(billedDocuments).length}</strong>
                  </div>
                  <div>
                    <small>ENCONTRADOS NO RELATÓRIO ATUAL</small>
                    <strong>{currentBilledEntries.length}</strong>
                  </div>
                </div>
                {billedSources.length > 0 && (
                  <div className="billed-file-list">
                    {billedSources.map((source) => (
                      <div key={source.name}>
                        <span>
                          <strong>{source.name}</strong>
                          <small>
                            {source.partners.join(", ")} · {source.count}{" "}
                            documento(s)
                          </small>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeBilledSource(source.name)}
                        >
                          Desfazer
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="import-card romaneio-import-card">
                <div className="import-card-title">
                  <span>4</span>
                  <div>
                    <strong>Relatórios de romaneios</strong>
                    <small>Motoristas, veículos, rotas e documentos</small>
                  </div>
                </div>
                <input
                  ref={romaneioInputRef}
                  hidden
                  multiple
                  type="file"
                  accept=".xls,.xlsx,.csv"
                  onChange={importRomaneios}
                />
                <button
                  type="button"
                  className="upload compact"
                  disabled={importingRomaneios}
                  onClick={() => romaneioInputRef.current?.click()}
                >
                  <span>⇧</span>
                  <strong>
                    {importingRomaneios
                      ? "Lendo os romaneios..."
                      : "Selecionar romaneios"}
                  </strong>
                  <small>Selecione um ou vários relatórios</small>
                </button>
                {romaneioImportInfo && (
                  <div className="romaneio-file-summary">
                    <small>ROMANEIOS ATIVOS</small>
                    <strong>
                      {romaneioImportInfo.files.length === 1
                        ? romaneioImportInfo.files[0]
                        : `${romaneioImportInfo.files.length} arquivos`}
                    </strong>
                    <p>
                      {romaneioImportInfo.romaneios} romaneios ·{" "}
                      {romaneioImportInfo.imported} linhas de rota
                      {romaneioImportInfo.duplicates
                        ? ` · ${romaneioImportInfo.duplicates} repetidas ignoradas`
                        : ""}
                    </p>
                  </div>
                )}
              </section>
            </div>

            <section className="cloud-backup">
              <div>
                <small>BACKUP E TROCA DE COMPUTADOR</small>
                <h3>Leve todos os dados com segurança</h3>
                <p>
                  O backup inclui relatório, romaneios, bipagens, TDE,
                  remetentes da Maex e documentos já enviados ao faturamento.
                </p>
              </div>
              <input
                ref={backupInputRef}
                hidden
                type="file"
                accept=".json,application/json"
                onChange={restoreBackup}
              />
              <div className="cloud-backup-actions">
                <button type="button" onClick={downloadBackup} disabled={!hydrated}>
                  Baixar backup completo
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    importingBackup ||
                    !hydrated ||
                    (cloudHosted && cloudStatus === "loading")
                  }
                  onClick={() => backupInputRef.current?.click()}
                >
                  {importingBackup ? "Restaurando..." : "Restaurar backup"}
                </button>
              </div>
            </section>

            <section className="manual-tde">
              <div className="manual-tde-heading">
                <div>
                  <small>CADASTRO MANUAL</small>
                  <h3>Adicionar ou corrigir um cliente</h3>
                  <p>
                    O cadastro manual tem prioridade sobre a lista importada
                    para o mesmo CNPJ e transportadora.
                  </p>
                </div>
                <b>{manualTdeGroups.length} cadastro(s) manual(is)</b>
              </div>
              <form className="manual-tde-form" onSubmit={registerManualTde}>
                <div className="manual-client-field">
                  <label htmlFor="manual-client-name">
                    Cliente / Razão social
                  </label>
                  <input
                    id="manual-client-name"
                    type="text"
                    value={manualClientName}
                    placeholder="Digite para procurar o cliente"
                    autoComplete="off"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={manualClientSuggestionsOpen}
                    aria-controls="manual-client-suggestions"
                    onFocus={() => setManualClientSuggestionsOpen(true)}
                    onBlur={() =>
                      window.setTimeout(
                        () => setManualClientSuggestionsOpen(false),
                        120,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape")
                        setManualClientSuggestionsOpen(false);
                    }}
                    onChange={(event) => {
                      setManualClientName(event.target.value);
                      setManualClientSuggestionsOpen(true);
                    }}
                  />
                  {manualClientSuggestionsOpen &&
                    manualClientSuggestions.length > 0 && (
                      <div
                        className="manual-client-suggestions"
                        id="manual-client-suggestions"
                        role="listbox"
                      >
                        {manualClientSuggestions.map((client) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected="false"
                            key={normalized(client.name)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectManualClient(client)}
                          >
                            <span>
                              <strong>{client.name}</strong>
                              <small>
                                {client.cnpjs.length > 1
                                  ? `${client.cnpjs.length} CNPJs encontrados`
                                  : client.cnpjs.length === 1
                                    ? formatCnpj(client.cnpjs[0])
                                    : "CNPJ não informado"}
                              </small>
                            </span>
                            <b>{client.source}</b>
                          </button>
                        ))}
                      </div>
                    )}
                </div>
                <label>
                  CNPJ(s)
                  <textarea
                    rows={2}
                    inputMode="numeric"
                    value={manualClientCnpj}
                    placeholder="Cole um ou vários CNPJs, separados por vírgula ou linha"
                    onChange={(event) =>
                      setManualClientCnpj(event.target.value)
                    }
                  />
                </label>
                <label>
                  Transportadora
                  <select
                    value={manualPartnerId}
                    onChange={(event) =>
                      setManualPartnerId(event.target.value)
                    }
                  >
                    <option value="">Selecione...</option>
                    {tdePartnerOptions.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Valor TDE
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualTdeValue}
                    placeholder="R$ 0,00"
                    onChange={(event) => setManualTdeValue(event.target.value)}
                  />
                </label>
                <button className="primary">Salvar cliente</button>
              </form>
              {manualTdeGroups.length > 0 && (
                <div className="manual-tde-list">
                  {manualTdeGroups.map((group) => (
                    <div key={group.key}>
                      <span>{group.clientName.slice(0, 2).toUpperCase()}</span>
                      <p>
                        <strong>{group.clientName}</strong>
                        <small
                          title={group.cnpjs.map(formatCnpj).join(", ")}
                        >
                          {group.cnpjs.length === 1
                            ? formatCnpj(group.cnpjs[0])
                            : `${group.cnpjs.length} CNPJs`} ·{" "}
                          {group.partnerName}
                        </small>
                      </p>
                      <b>{money(group.value)}</b>
                      <button
                        type="button"
                        onClick={() => removeManualTde(group.ids)}
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
        {tab === "romaneios" && (
          <div className="romaneio-view">
            <input
              ref={romaneioInputRef}
              hidden
              multiple
              type="file"
              accept=".xls,.xlsx,.csv"
              onChange={importRomaneios}
            />

            <div className="romaneio-subtabs romaneio-main-subtabs">
              <button
                type="button"
                className={romaneioSection === "checking" ? "active" : ""}
                onClick={() => setRomaneioSection("checking")}
              >
                Ticagem
              </button>
              <button
                type="button"
                className={romaneioSection === "closing" ? "active" : ""}
                onClick={() => setRomaneioSection("closing")}
              >
                Fechamento
              </button>
              <button
                type="button"
                className={romaneioSection === "full" ? "active" : ""}
                onClick={() => setRomaneioSection("full")}
              >
                Romaneio completo
              </button>
            </div>

            {romaneioSection === "checking" ? (
              <>
            <div className="romaneio-subtabs romaneio-inner-subtabs">
              <button
                type="button"
                className={romaneioView === "operation" ? "active" : ""}
                onClick={() => setRomaneioView("operation")}
              >
                Operação por motorista
              </button>
              <button
                type="button"
                className={romaneioView === "retained" ? "active" : ""}
                onClick={() => setRomaneioView("retained")}
              >
                Relatório de Retidos
                <b>{retainedRomaneioDocuments.length}</b>
              </button>
            </div>

            {romaneioView === "operation" ? (
              <>
                <form
                  className="romaneio-scan romaneio-global-scan"
                  onSubmit={(event) => {
                    event.preventDefault();
                    scanOrSearchRomaneio();
                  }}
                >
                  <div>
                    <small>PROCURAR E CONFERIR</small>
                  <strong>Bipe ou digite MD-e, CT-e Parceiro, chave da AK ou NF</strong>
                    <p>
                      A primeira leitura abre o romaneio e prepara o documento
                      como Entregue. Também é possível procurar por motorista,
                      rota ou romaneio.
                    </p>
                  </div>
                  <input
                    ref={romaneioScanRef}
                    type="search"
                    placeholder="MD-e, CT-e Parceiro, chave AK, NF, motorista ou romaneio"
                    onChange={(event) => {
                      const value = event.target.value;
                      if (romaneioSearchTimerRef.current !== null)
                        window.clearTimeout(romaneioSearchTimerRef.current);
                      // O leitor envia muitos caracteres seguidos; não redesenhe os romaneios a cada dígito.
                      if (!/[a-zA-ZÀ-ÿ]/.test(value)) {
                        if (romaneioSearch) setRomaneioSearch("");
                        return;
                      }
                      romaneioSearchTimerRef.current = window.setTimeout(() => {
                        setRomaneioSearch(value);
                        romaneioSearchTimerRef.current = null;
                      }, 300);
                    }}
                  />
                  <button className="primary">
                    Localizar / marcar Entregue
                  </button>
                  {focusedRomaneioKey && !romaneioSearch.trim() && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setFocusedRomaneioKey("")}
                    >
                      Mostrar todos
                    </button>
                  )}
                  <button
                    type="button"
                    className="romaneio-cancel-scan"
                    disabled={!Object.values(romaneioDocumentDrafts).some((drafts) => Object.keys(drafts).length)}
                    onClick={() => setRomaneioCancelConfirmation(true)}
                  >
                    Cancelar ticagem
                  </button>
                </form>

                {!romaneioDailyGroups.length ? (
                  <div className="empty romaneio-empty">
                    <span>▤</span>
                    <h3>Nenhum romaneio importado</h3>
                    <p>Use o campo da aba Importar para selecionar o relatório.</p>
                  </div>
                ) : !visibleRomaneioGroups.length ? (
                  <div className="empty romaneio-empty">
                    <span>⌕</span>
                    <h3>Nenhum resultado encontrado</h3>
                    <p>Altere a procura ou faça uma nova leitura.</p>
                  </div>
                ) : (
                  <div className="romaneio-list daily-list">
                    {visibleRomaneioGroups.length > romaneioListLimit && <div className="progressive-list-control"><span>Mostrando {displayedRomaneioGroups.length} de {visibleRomaneioGroups.length} romaneios para manter a tela rápida.</span><button type="button" onClick={() => setRomaneioListLimit((current) => current + 40)}>Mostrar mais 40</button></div>}
                    {displayedRomaneioGroups.map((group) => {
                      const drafts = romaneioDocumentDrafts[group.key] || {};
                      const previousMissingDocuments = (
                        missingDocumentsByDriver.get(normalized(group.driver)) || []
                      ).filter((record) => record.day < group.day);
                      const visibleDocuments = group.documents.filter(
                        (document) => !romaneioStatusForDocument(romaneioDocumentStatuses, group, document),
                      );
                      const pendingDocuments = visibleDocuments.filter(
                        (document) => !drafts[document.key]?.situation,
                      );
                      const savedProduction = savedRomaneioProduction(group);
                      const operationalDocumentCount =
                        romaneioOperationalDocumentCount(group);
                      const routeLabel =
                        romaneioRouteDrafts[group.key] ??
                        romaneioRouteLabels[group.key] ??
                        group.routes.join(" · ");
                      const draftCount = Object.values(drafts).filter(
                        (draft) => draft.situation,
                      ).length;
                      const selectedDocumentKeys =
                        selectedRomaneioDocumentKeys[group.key] || [];
                      const hasInvalidReturn = Object.values(drafts).some(
                        (draft) =>
                          draft.situation === "return" && !draft.reason.trim(),
                      );
                      return (
                        <details
                          className="romaneio-card daily-card"
                          key={group.key}
                          open={Boolean(openRomaneios[group.key])}
                          onToggle={(event) => {
                            const isOpen = event.currentTarget.open;
                            setOpenRomaneios((current) =>
                              current[group.key] === isOpen
                                ? current
                                : { ...current, [group.key]: isOpen },
                            );
                          }}
                        >
                          <summary>
                            <span className="romaneio-number">
                              <small>EMISSÃO</small>
                              <strong>{formatRomaneioDay(group.day)}</strong>
                            </span>
                            <span>
                              <small>MOTORISTA</small>
                              <strong>{group.driver}</strong>
                              <em>{group.plates.join(", ") || "Sem placa"} · {group.vehicleTypes.join(", ") || "Veículo não informado"}</em>
                            </span>
                            <span>
                              <small>Nº ROMANEIO</small>
                              <strong>{group.romaneios.join(" · ")}</strong>
                            </span>
                            <span>
                              <small>EM ROTA</small>
                              <strong>{routeLabel || "Sem rota"}</strong>
                            </span>
                            <span className={pendingDocuments.length ? "waiting" : "linked"}>
                              <small>PENDENTES</small>
                              <strong>{pendingDocuments.length} de {operationalDocumentCount}</strong>
                            </span>
                            <span className="daily-production">
                              <small>PRODUÇÃO</small>
                              <strong>{money(savedProduction)}</strong>
                            </span>
                            <b aria-hidden="true">⌄</b>
                          </summary>
                          {openRomaneios[group.key] && (
                            <div className="romaneio-detail daily-detail">
                              <div className="romaneio-detail-info daily-info">
                                <span><small>Nº ROMANEIO</small><strong>{group.romaneios.join(" · ")}</strong></span>
                                <span><small>EMISSÃO</small><strong>{formatRomaneioDay(group.day)}</strong></span>
                                <span><small>MOTORISTA</small><strong>{group.driver}</strong></span>
                                <span className="route-edit"><small>EM ROTA — PODE EDITAR</small><input value={routeLabel} onChange={(event) => setRomaneioRouteDrafts((current) => ({...current, [group.key]: event.target.value}))} /></span>
                                <span><small>QUANTIDADE DE ENTREGAS</small><strong>{operationalDocumentCount.toLocaleString("pt-BR")}</strong></span>
                                <span><small>PESO TOTAL</small><strong>{group.weight.toLocaleString("pt-BR")} kg</strong></span>
                                <span><small>FRETE TOTAL DO ROMANEIO</small><strong>{money(group.freight)}</strong></span>
                                <span className="production"><small>PRODUÇÃO GRAVADA (-13%)</small><strong>{money(savedProduction)}</strong></span>
                              </div>

                              <div className="romaneio-bulk-actions">
                                <button type="button" onClick={() => requestMarkAllRomaneioDelivered(group)}>
                                  Marcar todos como Entregue
                                </button>
                                <small>Use apenas quando todos os documentos pendentes deste romaneio foram realmente entregues.</small>
                              </div>

                              {previousMissingDocuments.length > 0 && (
                                <div className="romaneio-missing-warning" role="alert">
                                  <strong>⚠ Documento(s) não apresentado(s) anteriormente</strong>
                                  <span>
                                    {previousMissingDocuments.map((record) =>
                                      `${record.referenceType} ${record.referenceNumber} (${formatRomaneioDay(record.day)})`,
                                    ).join(" · ")}
                                  </span>
                                  <small>Confirme com o motorista. Após três dias, o documento passa automaticamente para o Relatório de Retidos.</small>
                                </div>
                              )}

                              {visibleDocuments.length ? (
                                <>
                                  <div className="romaneio-batch-actions">
                                    <label>
                                      <input
                                        type="checkbox"
                                        checked={
                                          pendingDocuments.length > 0 &&
                                          selectedDocumentKeys.length ===
                                            pendingDocuments.length
                                        }
                                        onChange={(event) =>
                                          setSelectedRomaneioDocumentKeys(
                                            (current) => ({
                                              ...current,
                                              [group.key]: event.target.checked
                                                ? pendingDocuments.map(
                                                    (document) => document.key,
                                                  )
                                                : [],
                                            }),
                                          )
                                        }
                                      />
                                      Selecionar todos visíveis
                                    </label>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        requestBatchRomaneioSituation(
                                          group,
                                          event.target.value as
                                            | RomaneioSituation
                                            | "",
                                        );
                                        event.currentTarget.value = "";
                                      }}
                                    >
                                      <option value="">Lançar ocorrência nos selecionados...</option>
                                      <option value="delivered">Entregue (ET)</option>
                                      <option value="back">Volta (OC)</option>
                                      <option value="return">Retorno (OC)</option>
                                      <option value="retained">Retido (OC)</option>
                                      <option value="not-followed">Não seguiu (OC)</option>
                                      <option value="driver-missing">Motorista não trouxe o documento</option>
                                    </select>
                                    <small>
                                      {selectedDocumentKeys.length} selecionado(s)
                                    </small>
                                  </div>
                                  <div className="daily-document-list">
                                    <div className="daily-document-head">
                                      <span>DOCUMENTO</span><span>REMETENTE</span><span>DESTINATÁRIO / CIDADE</span><span>FRETE DO RELATÓRIO / PRODUÇÃO</span><span>SITUAÇÃO</span>
                                    </div>
                                    {visibleDocuments.map((document) => {
                                      const draft = drafts[document.key] || {situation: "", reason: ""};
                                      return (
                                        <div className={`daily-document-row${draft.situation === "delivered" ? " scanned-delivered" : draft.situation ? " marked-occurrence" : ""}`} key={document.key}>
                                          <span className="document-id">
                                            <label className="romaneio-row-check">
                                              <input
                                                type="checkbox"
                                                checked={selectedDocumentKeys.includes(
                                                  document.key,
                                                )}
                                                onChange={(event) =>
                                                  toggleRomaneioDocumentSelection(
                                                    group.key,
                                                    document.key,
                                                    event.target.checked,
                                                  )
                                                }
                                              />
                                              <span>Selecionar</span>
                                            </label>
                                            <strong>{document.referenceType} {document.referenceNumber}</strong>
                                            <small>{document.document}{document.cte ? ` · CT-e ${document.cte}` : ""}{document.invoice ? ` · NF ${document.invoice}` : ""}{document.sourceStatus ? ` · Origem ${document.sourceStatus}` : ""}</small>
                                          </span>
                                          <span><strong>{document.sender || "Aguardando relatório"}</strong></span>
                                          <span><strong>{document.recipient || "Aguardando relatório"}</strong><small>{document.city || "Cidade não localizada"}</small></span>
                                          <span className="document-values"><strong>{document.grossFreight ? money(document.grossFreight) : "Sem frete"}</strong><small>{document.grossFreight ? `${money(document.production)} após -13%` : "PROCV pendente"}</small></span>
                                          <span className="document-situation">
                                            <select value={draft.situation} onChange={(event) => requestRomaneioSituation(group.key, document, event.target.value as RomaneioSituation | "")}>
                                              <option value="">Selecione...</option>
                                              <option value="delivered">Entregue (ET)</option>
                                              <option value="back">Volta (OC)</option>
                                              <option value="return">Retorno (OC)</option>
                                              <option value="retained">Retido (OC)</option>
                                              <option value="not-followed">Não seguiu (OC)</option>
                                              <option value="driver-missing">Motorista não trouxe o documento</option>
                                            </select>
                                            {draft.situation === "return" && (
                                              <input
                                                className="return-reason"
                                                required
                                                defaultValue={draft.reason}
                                                placeholder="Motivo obrigatório"
                                                ref={(input) => {
                                                  romaneioReturnReasonRefs.current[
                                                    `${group.key}|${document.key}`
                                                  ] = input;
                                                }}
                                              />
                                            )}
                                            {draft.situation && (
                                              <button type="button" className="undo-romaneio-scan" onClick={() => undoRomaneioDraft(group.key, document.key)}>
                                                Desfazer
                                              </button>
                                            )}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </>
                              ) : (
                                <div className="daily-complete"><span>✓</span><div><strong>{draftCount ? "Documentos conferidos aguardando gravação" : "Todos os documentos foram gravados"}</strong><small>{draftCount ? "Clique em Gravar conferência para confirmar as situações e atualizar a produção." : "A produção e as situações continuam salvas."}</small></div></div>
                              )}

                              <div className="manual-romaneio-freight">
                                <div>
                                  <small>NOTA MANUAL</small>
                                  <strong>Adicionar NF e frete bruto</strong>
                                  <p>O sistema soma 32% do frete bruto com desconto de 13% antes de entrar na produção.</p>
                                </div>
                                <label>
                                  Nota fiscal
                                  <input
                                    placeholder="NF"
                                    ref={(input) => {
                                      manualRomaneioFreightInputRefs.current[group.key] = {
                                        ...(manualRomaneioFreightInputRefs.current[group.key] || {}),
                                        invoice: input,
                                      };
                                    }}
                                  />
                                </label>
                                <label>
                                  Frete bruto
                                  <input
                                    inputMode="decimal"
                                    placeholder="R$ 0,00"
                                    ref={(input) => {
                                      manualRomaneioFreightInputRefs.current[group.key] = {
                                        ...(manualRomaneioFreightInputRefs.current[group.key] || {}),
                                        grossFreight: input,
                                      };
                                    }}
                                  />
                                </label>
                                <button type="button" onClick={() => addManualRomaneioFreight(group.key)}>
                                  Adicionar nota
                                </button>
                                {manualRomaneioFreights[group.key]?.length ? (
                                  <div className="manual-romaneio-freight-list">
                                    {manualRomaneioFreights[group.key].map((item) => (
                                      <span key={item.id}>
                                        <b>NF {item.invoice}</b>
                                        <small>
                                          {money(item.grossFreight)} bruto · {money(manualFreightProduction(item.grossFreight))} na produção
                                        </small>
                                        <button type="button" onClick={() => removeManualRomaneioFreight(group.key, item.id)}>
                                          Remover
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>

                              <label className="romaneio-group-note">
                                <small>OBSERVAÇÃO DA CONFERÊNCIA</small>
                                <textarea
                                  value={romaneioGroupNotes[group.key] || ""}
                                  placeholder="Escreva uma observação geral deste dia, se necessário"
                                  onChange={(event) =>
                                    setRomaneioGroupNotes((current) => ({
                                      ...current,
                                      [group.key]: event.target.value,
                                    }))
                                  }
                                />
                              </label>
                              <div className="romaneio-save-bar">
                                <span><strong>{draftCount} alteração(ões) aguardando gravação</strong><small>{hasInvalidReturn ? "Informe o motivo obrigatório do Retorno." : "Entregues e Retidos entram na produção."}</small></span>
                                <button type="button" className="primary" onClick={() => saveRomaneioGroup(group)}>Gravar conferência</button>
                              </div>
                              <p className="romaneio-source">Arquivo(s): {group.sourceFiles.join(", ")}</p>
                            </div>
                          )}
                        </details>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="retained-view">
                <div className="retained-heading">
                  <div><small>RELATÓRIO SEPARADO</small><h3>Documentos Retidos</h3><p>Ao bipar ou digitar um documento retido, ele será preparado para baixa como Entregue.</p></div>
                  <b>{visibleRetainedRomaneioDocuments.length} de {retainedRomaneioDocuments.length} retido(s)</b>
                </div>
                <div className="retained-view-tabs" role="tablist" aria-label="Visualização dos retidos">
                  <button type="button" role="tab" aria-selected={retainedSection === "documents"} className={retainedSection === "documents" ? "active" : ""} onClick={() => setRetainedSection("documents")}>Documentos retidos</button>
                  <button type="button" role="tab" aria-selected={retainedSection === "ranking"} className={retainedSection === "ranking" ? "active" : ""} onClick={() => setRetainedSection("ranking")}>Ranking de motoristas</button>
                </div>
                {retainedSection === "ranking" ? (
                  <div className="retained-ranking">
                    <div className="retained-ranking-summary">
                      <span><small>RANKING ATUAL</small><strong>CT-es retidos por motorista</strong></span>
                      <b>{retainedDriverRanking.length} motorista(s)</b>
                    </div>
                    {retainedDriverRanking.length ? retainedDriverRanking.map((item, index) => (
                      <article className={index < 3 ? `top-${index + 1}` : ""} key={normalized(item.driver)}>
                        <span className="retained-ranking-position">{index + 1}º</span>
                        <span className="retained-ranking-driver"><strong>{item.driver}</strong><small>{item.count === 1 ? "1 CT-e retido" : `${item.count} CT-es retidos`}</small></span>
                        <b>{item.count}</b>
                      </article>
                    )) : (
                      <div className="empty romaneio-empty"><span>✓</span><h3>Nenhum motorista com CT-e retido</h3><p>O ranking aparecerá automaticamente quando houver documentos retidos.</p></div>
                    )}
                  </div>
                ) : (
                  <>
                <form className="retained-scan" onSubmit={(event) => {event.preventDefault(); scanRetainedDocument();}}>
                  <input value={retainedScanInput} placeholder="Bipe ou digite o MD-e ou CT-e Parceiro" inputMode="numeric" onChange={(event) => setRetainedScanInput(event.target.value)} />
                  <button className="primary" disabled={!retainedScanInput.trim()}>Localizar retido</button>
                </form>
                <div className="retained-filters">
                  <label>Motorista<input type="search" value={retainedDriverFilter} onChange={(event) => setRetainedDriverFilter(event.target.value)} placeholder="Filtrar por motorista" /></label>
                  <label>Parceira<input type="search" value={retainedPartnerFilter} onChange={(event) => setRetainedPartnerFilter(event.target.value)} placeholder="Ex.: Tadex, Fitlog, Displan" /></label>
                </div>
                {visibleRetainedRomaneioDocuments.length ? (
                  <div className="retained-list">
                    {visibleRetainedRomaneioDocuments.map((record) => {
                      const currentDocument = currentRomaneioDocumentsByKey.get(record.key);
                      const grossFreight = currentDocument?.grossFreight || record.grossFreight;
                      const sender =
                        currentDocument?.sender ||
                        record.sender ||
                        "Aguardando relatório geral";
                      const recipient =
                        currentDocument?.recipient ||
                        record.recipient ||
                        "Aguardando relatório geral";
                      const city =
                        currentDocument?.city ||
                        record.city ||
                        record.routes.join(" · ") ||
                        "Sem cidade";
                      return (
                        <label className={retainedResolutionDrafts[record.key] ? "selected" : ""} key={record.key}>
                          <input type="checkbox" checked={Boolean(retainedResolutionDrafts[record.key])} onChange={(event) => setRetainedResolutionDrafts((current) => ({...current, [record.key]: event.target.checked}))} />
                          <span className="document-id"><strong>{record.referenceType} {record.referenceNumber}</strong><small>{record.romaneios.join(" · ")} · {formatRomaneioDay(record.day)}</small></span>
                          <span><strong>{record.driver}</strong><small>{record.routes.join(" · ") || "Sem rota"}</small></span>
                          <span><strong>{sender}</strong><small>{recipient} · {city}</small></span>
                          <span className="document-values"><strong>{grossFreight ? money(grossFreight) : "Sem frete"}</strong><small>{grossFreight ? `${money(roundMoney(grossFreight * ROMANEIO_PRODUCTION_FACTOR))} após -13%` : "PROCV pendente"}</small></span>
                          <b>{retainedResolutionDrafts[record.key] ? "Baixar como entregue" : romaneioSituationLabel[record.situation]}</b>
                        </label>
                      );
                    })}
                    <div className="romaneio-save-bar retained-save"><span><strong>{Object.values(retainedResolutionDrafts).filter(Boolean).length} baixa(s) selecionada(s)</strong><small>É obrigatório gravar para retirar do relatório de Retidos.</small></span><button type="button" className="primary" disabled={!Object.values(retainedResolutionDrafts).some(Boolean)} onClick={saveRetainedResolutions}>Gravar baixas</button></div>
                  </div>
                ) : (
                  <div className="empty romaneio-empty"><span>✓</span><h3>Nenhum documento retido encontrado</h3><p>Altere os filtros ou aguarde novos documentos retidos.</p></div>
                )}
                  </>
                )}
              </div>
            )}
              </>
            ) : romaneioSection === "full" ? (
              <div className="romaneio-full-view">
                <div className="toolbar driver-closing-toolbar">
                  <div>
                    <small>CONSULTA DE ROMANEIOS</small>
                    <h2>Romaneio completo</h2>
                    <p>Consulte por motorista, data ou número do romaneio e veja a situação atual de cada documento.</p>
                  </div>
                  <label>
                    Procurar
                    <input
                      type="search"
                      value={romaneioFullSearch}
                      placeholder="Motorista, data, nº romaneio, cidade ou documento"
                      onChange={(event) => setRomaneioFullSearch(event.target.value)}
                    />
                  </label>
                </div>
                {!visibleFullRomaneioGroups.length ? (
                  <div className="empty romaneio-empty">
                    <span>⌕</span>
                    <h3>Nenhum romaneio encontrado</h3>
                    <p>Altere a busca ou importe os relatórios de romaneio.</p>
                  </div>
                ) : (
                  <div className="romaneio-full-list">
                    {visibleFullRomaneioGroups.length > romaneioFullListLimit && <div className="progressive-list-control"><span>Mostrando {displayedFullRomaneioGroups.length} de {visibleFullRomaneioGroups.length} romaneios para manter a tela rápida.</span><button type="button" onClick={() => setRomaneioFullListLimit((current) => current + 40)}>Mostrar mais 40</button></div>}
                    {displayedFullRomaneioGroups.map((group) => {
                      const routeLabel =
                        romaneioRouteLabels[group.key] ||
                        group.routes.join(" · ") ||
                        "Sem rota";
                      const savedProduction = savedRomaneioProduction(group);
                      const operationalDocumentCount =
                        romaneioOperationalDocumentCount(group);
                      const pendingCount = group.documents.filter(
                        (document) =>
                          !romaneioStatusForDocument(romaneioDocumentStatuses, group, document) &&
                          !romaneioDocumentDrafts[group.key]?.[document.key]?.situation,
                      ).length;
                      return (
                        <details className="romaneio-card romaneio-full-card" key={group.key}>
                          <summary>
                            <span>
                              <small>EMISSÃO</small>
                              <strong>{formatRomaneioDay(group.day)}</strong>
                            </span>
                            <span>
                              <small>MOTORISTA</small>
                              <strong>{group.driver}</strong>
                              <em>{group.plates.join(", ") || "Sem placa"}</em>
                            </span>
                            <span>
                              <small>Nº ROMANEIO</small>
                              <strong>{group.romaneios.join(" · ")}</strong>
                            </span>
                            <span className={pendingCount ? "romaneio-summary-open" : "romaneio-summary-closed"}>
                              <small>SITUAÇÃO</small>
                              <strong>{pendingCount ? `${pendingCount} aberto(s)` : "Conferido"}</strong>
                            </span>
                            <span className="daily-production">
                              <small>PRODUÇÃO</small>
                              <strong>{money(savedProduction)}</strong>
                            </span>
                            <b aria-hidden="true">⌄</b>
                          </summary>
                          <div className="romaneio-detail daily-detail">
                            <div className="romaneio-detail-info daily-info">
                              <span><small>Nº ROMANEIO</small><strong>{group.romaneios.join(" · ")}</strong></span>
                              <span><small>EMISSÃO</small><strong>{formatRomaneioDay(group.day)}</strong></span>
                              <span><small>MOTORISTA</small><strong>{group.driver}</strong></span>
                              <span><small>EM ROTA</small><strong>{routeLabel}</strong></span>
                              <span><small>ENTREGAS</small><strong>{operationalDocumentCount.toLocaleString("pt-BR")}</strong></span>
                              <span><small>PESO TOTAL</small><strong>{group.weight.toLocaleString("pt-BR")} kg</strong></span>
                              <span><small>FRETE TOTAL DO ROMANEIO</small><strong>{money(group.freight)}</strong></span>
                              <span className="production"><small>PRODUÇÃO GRAVADA (-13%)</small><strong>{money(savedProduction)}</strong></span>
                            </div>
                            {romaneioGroupNotes[group.key] && (
                              <div className="romaneio-full-note">
                                <small>OBSERVAÇÃO DA CONFERÊNCIA</small>
                                <p>{romaneioGroupNotes[group.key]}</p>
                              </div>
                            )}
                            {(manualRomaneioFreights[group.key]?.length ||
                              romaneioPickupQuantities[group.key]) && (
                              <div className="romaneio-full-note">
                                <small>AJUSTES MANUAIS</small>
                                <p>
                                  {(manualRomaneioFreights[group.key] || [])
                                    .map(
                                      (item) =>
                                        `NF ${item.invoice}: ${money(
                                          manualFreightProduction(
                                            item.grossFreight,
                                          ),
                                        )}`,
                                    )
                                    .join(" · ") || "Sem nota manual"}
                                  {romaneioPickupQuantities[group.key]
                                    ? ` · ${romaneioPickupQuantities[group.key]} coleta(s)`
                                    : ""}
                                </p>
                              </div>
                            )}
                            <div className="daily-document-list">
                              <div className="daily-document-head">
                                <span>DOCUMENTO</span><span>REMETENTE</span><span>DESTINATÁRIO / CIDADE</span><span>FRETE / PRODUÇÃO</span><span>SITUAÇÃO</span>
                              </div>
                              {group.documents.map((document) => {
                                const saved = romaneioStatusForDocument(romaneioDocumentStatuses, group, document);
                                const city = document.city || routeLabel;
                                return (
                                  <div className="daily-document-row" key={document.key}>
                                    <span className="document-id">
                                      <strong>{document.referenceType} {document.referenceNumber}</strong>
                                      <small>{document.document}{document.cte ? ` · CT-e ${document.cte}` : ""}{document.invoice ? <> · <mark>NF {document.invoice}</mark></> : ""}</small>
                                    </span>
                                    <span><strong>{document.sender || saved?.sender || "Aguardando relatório geral"}</strong></span>
                                    <span><strong>{document.recipient || saved?.recipient || "Aguardando relatório geral"}</strong><small>{city || saved?.city || "Sem cidade"}</small></span>
                                    <span className="document-values"><strong>{document.grossFreight ? money(document.grossFreight) : "Sem frete individual"}</strong><small>{document.grossFreight ? `${money(document.production)} após -13%` : "Usa frete total quando gravado"}</small></span>
                                    <span className="document-saved-status">
                                      <b className={saved ? `status-closed status-${saved.situation}` : "status-open"}>
                                        {saved ? romaneioSituationLabel[saved.situation] : "Aberto"}
                                      </b>
                                      {saved?.reason ? <small>Motivo: {saved.reason}</small> : null}
                                      {saved ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            undoRomaneioDocumentStatus(saved.key)
                                          }
                                        >
                                          Desfazer
                                        </button>
                                      ) : null}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="romaneio-source">Arquivo(s): {group.sourceFiles.join(", ")}</p>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="driver-closing-view">
                <div className="toolbar driver-closing-toolbar">
                  <div>
                    <small>FECHAMENTO DOS MOTORISTAS</small>
                    <h2>Produção entregue por período</h2>
                    <p>Escolha livremente as datas, confira os totais e exporte um arquivo separado para cada motorista selecionado.</p>
                  </div>
                  <label>
                    De
                    <input type="date" value={driverClosingFrom} onChange={(event) => setDriverClosingFrom(event.target.value)} />
                  </label>
                  <label>
                    Até
                    <input type="date" value={driverClosingTo} onChange={(event) => setDriverClosingTo(event.target.value)} />
                  </label>
                </div>
                <div className="driver-closing-summary">
                  <span><small>MOTORISTAS NO PERÍODO</small><strong>{driverClosingSummaries.length}</strong></span>
                  <span><small>SELECIONADOS</small><strong>{driverClosingSummaries.filter((driver) => selectedDriverClosings.includes(driver.key)).length}</strong></span>
                  <span><small>NOTAS ENTREGUES</small><strong>{driverClosingSummaries.reduce((sum, driver) => sum + driver.totalInvoices, 0).toLocaleString("pt-BR")}</strong></span>
                  <span><small>PRODUÇÃO GRAVADA</small><strong>{money(driverClosingSummaries.reduce((sum, driver) => sum + driver.totalFreight, 0))}</strong></span>
                </div>
                <div className="selection-head driver-selection-head">
                  <p>{selectedDriverClosings.length} motorista(s) marcado(s)</p>
                  <div>
                    <button type="button" onClick={() => setSelectedDriverClosings(driverClosingSummaries.map((driver) => driver.key))}>Selecionar todos</button>
                    <button type="button" onClick={() => setSelectedDriverClosings([])}>Limpar</button>
                  </div>
                </div>
                {driverClosingSummaries.length ? (
                  <div className="driver-closing-list">
                    {driverClosingSummaries.map((driver) => (
                      <label key={driver.key} className={selectedDriverClosings.includes(driver.key) ? "selected" : ""}>
                        <input
                          type="checkbox"
                          checked={selectedDriverClosings.includes(driver.key)}
                          onChange={(event) => setSelectedDriverClosings((current) =>
                            event.target.checked
                              ? [...new Set([...current, driver.key])]
                              : current.filter((key) => key !== driver.key),
                          )}
                        />
                        <span className="driver-avatar">{driver.driver.slice(0, 2).toUpperCase()}</span>
                        <div>
                          <strong>{driver.driver}</strong>
                          <small>{driver.cpf || "CPF não informado"} · {driver.plates.join(", ") || "Sem placa"}</small>
                        </div>
                        <span><small>DIAS</small><strong>{driver.days.length}</strong></span>
                        <span><small>NOTAS</small><strong>{driver.totalInvoices}</strong></span>
                        <span><small>PRODUÇÃO</small><strong>{money(driver.totalFreight)}</strong></span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="empty romaneio-empty"><span>□</span><h3>Nenhum motorista no período</h3><p>Altere as datas ou importe os relatórios de romaneio correspondentes.</p></div>
                )}
                <div className="driver-closing-export">
                  <div><strong>Prévia antes do PDF</strong><small>Confira os dias, ajuste cidades e inclua observações antes de gerar um arquivo PDF por motorista.</small></div>
                  <button type="button" className="primary" onClick={openDriverClosingPreview}>Abrir prévia</button>
                </div>
                {driverClosingPreviewOpen && (
                  <div className="driver-closing-preview">
                    <div className="driver-closing-preview-head">
                      <div>
                        <small>PRÉVIA DO PDF</small>
                        <h3>Conferir fechamento de motorista</h3>
                        <p>As alterações feitas aqui valem para o PDF gerado agora e não mudam os dados originais dos romaneios.</p>
                      </div>
                      <button type="button" className="primary" onClick={exportSelectedDriverClosings}>Baixar PDF(s)</button>
                    </div>
                    {selectedDriverClosingReports.map((report) => {
                      return (
                        <section key={report.key} className="driver-pdf-preview-card">
                          <div className="driver-pdf-preview-title">
                            <div>
                              <strong>{report.driver || "Motorista não informado"}</strong>
                              <small>{report.cpf || "CPF não informado"} · {report.plates.join(", ") || "Sem placa"}</small>
                            </div>
                            <span><small>TOTAL</small><b>{money(report.days.reduce((sum, day) => sum + day.freight, 0))}</b></span>
                          </div>
                          {report.days.length ? (
                            <div className="driver-pdf-days">
                              <div className="driver-pdf-day-head">
                                <span>Data</span>
                                <span>Cidade do dia</span>
                                <span>Notas</span>
                                <span>Produção</span>
                                <span>Observação</span>
                              </div>
                              {report.days.map((day) => {
                                const editKey = driverClosingDayEditKey(
                                  report.key,
                                  day.date,
                                );
                                const edit = driverClosingDayEdits[editKey];
                                return (
                                  <div className="driver-pdf-day-row" key={day.date}>
                                    <span><strong>{formatRomaneioDay(day.date)}</strong></span>
                                    <input
                                      value={edit?.cityText ?? day.cityText ?? day.cities.join(" · ")}
                                      onChange={(event) =>
                                        updateDriverClosingDayEdit(
                                          report.key,
                                          day.date,
                                          "cityText",
                                          event.target.value,
                                        )
                                      }
                                      aria-label={`Cidade de ${formatRomaneioDay(day.date)}`}
                                    />
                                    <span><strong>{day.invoiceCount}</strong></span>
                                    <span><strong>{money(day.freight)}</strong></span>
                                    <input
                                      value={edit?.observation ?? day.observation ?? ""}
                                      onChange={(event) =>
                                        updateDriverClosingDayEdit(
                                          report.key,
                                          day.date,
                                          "observation",
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Observação do dia"
                                      aria-label={`Observação de ${formatRomaneioDay(day.date)}`}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="driver-pdf-empty">Nenhum dia entregue gravado para este motorista no período.</p>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {tab === "covers" && (
          <div className="covers-view">
            <div className="intro cover-intro">
              <div>
                <small>CAPAS DE TRANSPORTADORAS</small>
                <h2>Embarque, capas, coleta e histórico</h2>
                <p>Bipe a nota fiscal, o CTE ou a chave. A capa será gerada com os CTEs encontrados e ficará registrada para consulta.</p>
              </div>
              {coverSection !== "report" && (
                <div className="cover-top-actions">
                  <button type="button" disabled={!currentCoverDraft.length} onClick={exportCurrentCoverDetails}>PDF completo</button>
                  {editingCoverId && <button type="button" onClick={cancelCoverEdit}>Cancelar edição</button>}
                  <button type="button" className="primary cover-generate" disabled={!currentCoverDraft.length} onClick={generateCover}>
                    {editingCoverId ? `Salvar ${editingCoverId}` : "Gerar capa"} ({currentCoverDraft.length})
                  </button>
                </div>
              )}
            </div>
            <div className="romaneio-subtabs cover-subtabs">
              <button type="button" className={coverSection === "shipment" ? "active" : ""} onClick={() => setCoverSection("shipment")}>Embarque</button>
              <button type="button" className={coverSection === "return" ? "active" : ""} onClick={() => setCoverSection("return")}>Capas</button>
              <button type="button" className={coverSection === "collection" ? "active" : ""} onClick={() => setCoverSection("collection")}>Coleta</button>
              <button type="button" className={coverSection === "report" ? "active" : ""} onClick={() => setCoverSection("report")}>Relatório</button>
            </div>
            {coverSection !== "report" ? (
              <div className="cover-workspace">
                <section className="cover-scan-card">
                  <div className="cover-partner-heading">
                    <small>1. ESCOLHA A PARCEIRA</small>
                    <strong>Para quem será esta capa?</strong>
                  </div>
                  <span className="cover-partner-label">Parceira / transportadora</span>
                  <div className="cover-partner-options" role="radiogroup" aria-label="Parceira ou transportadora">
                    {coverPartners.map((partner) => (
                      <button
                        key={partner.id}
                        type="button"
                        role="radio"
                        aria-checked={effectiveCoverPartnerId === partner.id}
                        className={effectiveCoverPartnerId === partner.id ? "active" : ""}
                        onClick={() => selectCoverPartner(partner.id)}
                      >
                        {partner.name}
                      </button>
                    ))}
                  </div>
                  <form className="cover-scan-form" onSubmit={(event) => { event.preventDefault(); registerCoverScan(); }}>
                    <label htmlFor="cover-scan">2. Bipe as notas desta parceira</label>
                    <div>
                      <input id="cover-scan" ref={coverScanInputRef} autoFocus inputMode="numeric" required placeholder="Bipe a NF, CTE ou chave" />
                      <button className="primary">Adicionar</button>
                    </div>
                  </form>
                  {coverSection === "return" && <>
                    <div className="cover-input-divider"><span>ou</span></div>
                    <form className="cover-scan-form cover-number-form" onSubmit={(event) => { event.preventDefault(); addManualCoverNumber(); }}>
                      <label htmlFor="cover-number">Adicionar número de capa manual</label>
                      <div>
                        <input id="cover-number" value={coverNumberInput} onChange={(event) => setCoverNumberInput(event.target.value)} placeholder="Digite o número informado pela parceira" />
                        <button type="submit" disabled={!coverNumberInput.trim()}>Adicionar capa</button>
                      </div>
                      <small>Este número será incluído diretamente na capa e no relatório; ele não procura notas no sistema.</small>
                    </form>
                  </>}
                  {(coverSection === "shipment" || coverSection === "collection") && <>
                    <div className="cover-input-divider"><span>ou preencha manualmente</span></div>
                    <form className="cover-manual-document-form" onSubmit={(event) => { event.preventDefault(); addManualCoverDocument(); }}>
                      <label>Nota fiscal<input value={(manualCoverDrafts[coverDraftKey] || emptyManualCoverDocument).invoice} onChange={(event) => setManualCoverDrafts((current) => ({ ...current, [coverDraftKey]: { ...(current[coverDraftKey] || emptyManualCoverDocument), invoice: event.target.value } }))} placeholder="Número da NF" /></label>
                      <label>CTE<input value={(manualCoverDrafts[coverDraftKey] || emptyManualCoverDocument).cte} onChange={(event) => setManualCoverDrafts((current) => ({ ...current, [coverDraftKey]: { ...(current[coverDraftKey] || emptyManualCoverDocument), cte: event.target.value } }))} placeholder="Número do CTE" /></label>
                      <label>Remetente<input value={(manualCoverDrafts[coverDraftKey] || emptyManualCoverDocument).sender} onChange={(event) => setManualCoverDrafts((current) => ({ ...current, [coverDraftKey]: { ...(current[coverDraftKey] || emptyManualCoverDocument), sender: event.target.value } }))} placeholder="Nome do remetente" /></label>
                      <label>Destinatário<input value={(manualCoverDrafts[coverDraftKey] || emptyManualCoverDocument).recipient} onChange={(event) => setManualCoverDrafts((current) => ({ ...current, [coverDraftKey]: { ...(current[coverDraftKey] || emptyManualCoverDocument), recipient: event.target.value } }))} placeholder="Nome do destinatário" /></label>
                      <div>
                        <label>Volumes<input inputMode="numeric" value={(manualCoverDrafts[coverDraftKey] || emptyManualCoverDocument).volumes} onChange={(event) => setManualCoverDrafts((current) => ({ ...current, [coverDraftKey]: { ...(current[coverDraftKey] || emptyManualCoverDocument), volumes: event.target.value } }))} placeholder="0" /></label>
                        <label>Peso (kg)<input inputMode="decimal" value={(manualCoverDrafts[coverDraftKey] || emptyManualCoverDocument).weight} onChange={(event) => setManualCoverDrafts((current) => ({ ...current, [coverDraftKey]: { ...(current[coverDraftKey] || emptyManualCoverDocument), weight: event.target.value } }))} placeholder="0,00" /></label>
                      </div>
                      <label>Valor da mercadoria (R$)<input inputMode="decimal" value={(manualCoverDrafts[coverDraftKey] || emptyManualCoverDocument).value} onChange={(event) => setManualCoverDrafts((current) => ({ ...current, [coverDraftKey]: { ...(current[coverDraftKey] || emptyManualCoverDocument), value: event.target.value } }))} placeholder="0,00" /></label>
                      <button type="submit">Adicionar nota manual</button>
                    </form>
                  </>}
                  <p className="cover-shared-scan-note">Toda nota localizada aqui também fica disponível na prévia da parceira. Se você ativar “Pagar somente notas bipadas”, ela entrará na soma mensal.</p>
                </section>
                <section className="cover-list-card">
                  <div className="cover-list-heading"><div><small>ITENS DA CAPA</small><h3>{coverSection === "shipment" ? "Para embarque" : coverSection === "collection" ? "Para coleta" : "CTEs e capas manuais"}</h3></div><b>{currentCoverDraft.length}</b></div>
                  <div className="cover-document-list">
                    {currentCoverDraft.length ? currentCoverDraft.map((document, index) => (
                      <div key={`${document.cteKey}-${document.cte}-${document.invoice}-${index}`}>
                        <span>{index + 1}</span>
                        <div><strong>{document.manualCoverNumber ? `Capa manual ${document.manualCoverNumber}` : `NF ${document.invoice || "não informada"}`}</strong><small>{document.manualCoverNumber ? "Número informado manualmente" : `CTE ${document.cte || "não informado"} · ${document.recipient || document.sender || "sem descrição"}${document.volumes !== undefined ? ` · ${document.volumes} volume(s) · ${document.weight || 0} kg` : ""}`}</small></div>
                        <button type="button" onClick={() => removeCoverDraftDocument(index)}>Remover</button>
                      </div>
                    )) : <p className="cover-empty">Nenhum documento bipado nesta capa.</p>}
                  </div>
                </section>
              </div>
            ) : (
              <div className="cover-report">
                <section className="cover-report-filters">
                  <div><small>HISTÓRICO DE CAPAS</small><h3>Filtre, selecione a capa e gere o relatório</h3></div>
                  <label>De<input type="date" value={coverReportFrom} onChange={(event) => setCoverReportFrom(event.target.value)} /></label>
                  <label>Até<input type="date" value={coverReportTo} onChange={(event) => setCoverReportTo(event.target.value)} /></label>
                  <button type="button" className="primary" disabled={!selectedReportCovers.length} onClick={() => exportCoversReportXlsx(selectedReportCovers, coverReportFrom, coverReportTo)}>Gerar relatório ({selectedReportCovers.length})</button>
                  <button type="button" className="danger" disabled={!selectedReportCovers.length} onClick={() => setCoverDeleteConfirmation(true)}>Excluir selecionadas</button>
                </section>
                <section className="cover-report-search">
                  <label htmlFor="cover-report-search">Localizar por identificador da capa ou documento</label>
                  <div>
                    <input id="cover-report-search" value={coverReportSearch} onChange={(event) => setCoverReportSearch(event.target.value)} placeholder="Ex.: 10000, E-10000, NF, MD-e, CTE ou chave" />
                    {coverReportSearch && <button type="button" onClick={() => setCoverReportSearch("")}>Limpar</button>}
                  </div>
                  <small>{coverReportSearch ? `${reportCovers.length} capa(s) encontrada(s).` : "A busca mostra a capa pelo número, identificador ou documento incluído."}</small>
                </section>
                <div className="cover-history">
                  {reportCovers.length ? reportCovers.map((cover) => (
                    <div className={selectedCoverReportIds.includes(cover.id) ? "selected" : ""} key={cover.id}>
                      <input type="checkbox" aria-label={`Selecionar capa ${cover.id}`} checked={selectedCoverReportIds.includes(cover.id)} onChange={(event) => setSelectedCoverReportIds((current) => event.target.checked ? [...new Set([...current, cover.id])] : current.filter((id) => id !== cover.id))} />
                      <span className={`cover-kind ${cover.kind}`}>{cover.kind === "shipment" ? "Embarque" : cover.kind === "collection" ? "Coleta" : "Capas"}</span>
                      <div><strong>{cover.partnerName}</strong><small>{new Date(cover.createdAt).toLocaleDateString("pt-BR")} · {cover.documents.length} item(ns) · {cover.id} · Gerado por {cover.generatedBy || "não informado"}</small>{coverReportSearch && cover.documents.filter((document) => matchesCoverDocumentSearch(document, coverReportSearch)).map((document, index) => <small className="cover-match" key={`${cover.id}-match-${index}`}>{document.manualCoverNumber ? `Encontrado: capa manual ${document.manualCoverNumber}` : `Encontrado: NF ${document.invoice || "-"} · CTE ${document.cte || "-"} · Minuta ${document.mde || "-"}`}</small>)}</div>
                      <div className="cover-history-actions">
                        <button type="button" onClick={() => startEditingCover(cover)}>Editar</button>
                        <button type="button" onClick={() => exportCoversReportXlsx([cover], cover.createdAt.slice(0, 10), cover.createdAt.slice(0, 10))}>Gerar Excel</button>
                        <button type="button" onClick={() => exportCoverPdf(cover)}>Baixar capa</button>
                      </div>
                    </div>
                  )) : <p className="cover-empty">Nenhuma capa salva neste período.</p>}
                </div>
              </div>
            )}
          </div>
        )}
        {tab === "billing" && (
          <div className="billing-view">
            {!billingUnlocked ? (
              <section className="billing-access-card">
                <span className="billing-lock" aria-hidden="true">▣</span>
                <small>ACESSO RESTRITO</small>
                <h2>Faturamento</h2>
                <p>Informe o código de liberação para consultar ou lançar valores.</p>
                <form onSubmit={unlockBilling}>
                  <label>Código de acesso<input type="password" autoFocus value={billingCode} onChange={(event) => { setBillingCode(event.target.value); setBillingCodeError(""); }} placeholder="Digite o código" /></label>
                  {billingCodeError && <span className="billing-code-error">{billingCodeError}</span>}
                  <button type="submit" className="primary" disabled={!billingCode.trim()}>Liberar faturamento</button>
                </form>
              </section>
            ) : (
              <>
                <div className="intro billing-intro">
                  <div><small>GUIA 5 · ACESSO LIBERADO</small><h2>{billingSection === "billing" ? "Faturamento por quinzena" : "Financeiro mensal"}</h2><p>{billingSection === "billing" ? "Lance os valores recebidos de cada parceira e acompanhe o total automaticamente." : "Registre as contas pagas e acompanhe o total do mês selecionado."}</p></div>
                  <button type="button" onClick={() => { setBillingUnlocked(false); setBillingCode(""); }}>Bloquear guia</button>
                </div>
                <div className="romaneio-subtabs billing-subtabs">
                  <button type="button" className={billingSection === "billing" ? "active" : ""} onClick={() => setBillingSection("billing")}>Faturamento</button>
                  <button type="button" className={billingSection === "financial" ? "active" : ""} onClick={() => setBillingSection("financial")}>Financeiro</button>
                </div>
                {billingSection === "billing" ? (
                <div className="billing-workspace">
                  <form className="billing-form" onSubmit={saveBillingInvoice}>
                    <div className="billing-form-heading"><small>{editingBillingId ? "EDITANDO LANÇAMENTO" : "NOVO LANÇAMENTO"}</small><h3>{editingBillingId ? "Alterar valor da fatura" : "Adicionar valor da fatura"}</h3></div>
                    <span className="cover-partner-label">Parceira oficial</span>
                    <div className="cover-partner-options billing-partners" role="radiogroup" aria-label="Parceira da fatura">
                      {billingPartners.map(([id, name]) => <button key={id} type="button" role="radio" aria-checked={billingPartnerId === id} className={billingPartnerId === id ? "active" : ""} onClick={() => setBillingPartnerId(id)}>{name}</button>)}
                    </div>
                    <label>Valor da fatura<input type="text" inputMode="decimal" value={billingValue} onChange={(event) => setBillingValue(event.target.value)} placeholder="R$ 0,00" /></label>
                    <div className="billing-period-fields">
                      <label>Mês de referência<input type="month" value={billingMonth} onChange={(event) => setBillingMonth(event.target.value)} /></label>
                      <label>Quinzena<select value={billingHalf} onChange={(event) => setBillingHalf(event.target.value as "1" | "2")}><option value="1">1ª quinzena</option><option value="2">2ª quinzena</option></select></label>
                    </div>
                    <div className="billing-form-actions">
                      {editingBillingId && <button type="button" onClick={() => { setEditingBillingId(""); setBillingPartnerId(""); setBillingValue(""); }}>Cancelar edição</button>}
                      <button type="submit" className="primary">{editingBillingId ? "Salvar alteração" : "Lançar fatura"}</button>
                    </div>
                  </form>
                  <section className="billing-history">
                    <div className="billing-history-heading">
                      <div><small>VALORES LANÇADOS</small><h3>Histórico de faturas</h3></div>
                      <div className="billing-history-controls"><label>Filtrar por quinzena<select value={billingFilter} onChange={(event) => setBillingFilter(event.target.value)}><option value="all">Todas as quinzenas</option>{billingPeriods.map((period) => <option key={period} value={period}>{billingPeriodLabel(period)}</option>)}</select></label><button type="button" disabled={billingFilter === "all" || !visibleBillingInvoices.length} onClick={generateBillingPdf}>Gerar PDF</button></div>
                    </div>
                    <div className="billing-total"><span><small>{billingFilter === "all" ? "TOTAL DE TODAS AS QUINZENAS" : billingPeriodLabel(billingFilter).toUpperCase()}</small><strong>{visibleBillingInvoices.length} lançamento(s)</strong></span><b>{money(billingTotal)}</b></div>
                    {visibleBillingInvoices.length ? <div className="billing-list">{visibleBillingInvoices.map((invoice) => (
                      <article key={invoice.id}>
                        <span><strong>{invoice.partnerName}</strong><small>{billingPeriodLabel(invoice.period)} · lançado por {invoice.createdBy || "Não informado"}</small></span>
                        <b>{money(invoice.value)}</b>
                        <div className="billing-row-actions">
                          <button type="button" onClick={() => editBillingInvoice(invoice)}>Editar</button>
                          {deletingBillingId === invoice.id ? <><button type="button" className="danger" onClick={() => deleteBillingInvoice(invoice.id)}>Confirmar exclusão</button><button type="button" onClick={() => setDeletingBillingId("")}>Voltar</button></> : <button type="button" className="danger-link" onClick={() => setDeletingBillingId(invoice.id)}>Excluir</button>}
                        </div>
                      </article>
                    ))}</div> : <div className="empty billing-empty"><span>R$</span><h3>Nenhuma fatura nesta seleção</h3><p>Faça um lançamento ou altere o filtro de quinzena.</p></div>}
                  </section>
                </div>
                ) : (
                  <div className="financial-workspace">
                    <form className="financial-form" onSubmit={saveFinancialEntry}>
                      <div><small>{editingFinancialId ? "EDITANDO CONTA" : "LANÇAR CONTA"}</small><h3>{editingFinancialId ? "Alterar pagamento" : "Novo pagamento"}</h3></div>
                      <label>Nome da conta<input list="financial-account-names" value={financialAccountName} onChange={(event) => setFinancialAccountName(event.target.value)} placeholder="Ex.: Energia, aluguel..." /></label>
                      <datalist id="financial-account-names">{financialAccountNames.map((name) => <option key={name} value={name} />)}</datalist>
                      <label>Valor<input value={financialValue} inputMode="decimal" onChange={(event) => setFinancialValue(event.target.value)} placeholder="R$ 0,00" /></label>
                      <label>Data do pagamento<input type="date" value={financialPaidAt} onChange={(event) => { setFinancialPaidAt(event.target.value); if (event.target.value) setFinancialMonth(event.target.value.slice(0, 7)); }} /></label>
                      <div className="financial-form-actions">{editingFinancialId && <button type="button" onClick={() => { setEditingFinancialId(""); setFinancialAccountName(""); setFinancialValue(""); }}>Cancelar edição</button>}<button type="submit" className="primary">{editingFinancialId ? "Salvar alteração" : "Lançar conta"}</button></div>
                    </form>
                    <section className="financial-history">
                      <div className="financial-heading"><div><small>CONTAS DO MÊS</small><h3>Financeiro mensal</h3></div><div className="financial-heading-controls"><label>Mês<input type="month" value={financialMonth} onChange={(event) => setFinancialMonth(event.target.value)} /></label><button type="button" disabled={!visibleFinancialEntries.length} onClick={generateFinancialPdf}>Gerar PDF</button></div></div>
                      <div className="billing-total"><span><small>TOTAL DO MÊS</small><strong>{visibleFinancialEntries.length} conta(s)</strong></span><b>{money(financialTotal)}</b></div>
                      {visibleFinancialEntries.length ? <div className="financial-list">{visibleFinancialEntries.map((entry) => <article key={entry.id}><span><strong>{entry.accountName}</strong><small>Pago em {formatRomaneioDay(entry.paidAt)} · lançado por {entry.createdBy || "Não informado"}</small></span><b>{money(entry.value)}</b><div>{deletingFinancialId === entry.id ? <><button type="button" className="danger" onClick={() => deleteFinancialEntry(entry.id)}>Confirmar exclusão</button><button type="button" onClick={() => setDeletingFinancialId("")}>Voltar</button></> : <><button type="button" onClick={() => editFinancialEntry(entry)}>Editar</button><button type="button" className="danger-link" onClick={() => setDeletingFinancialId(entry.id)}>Excluir deste mês</button></>}</div></article>)}</div> : <div className="empty billing-empty"><span>R$</span><h3>Nenhuma conta neste mês</h3><p>Os nomes já usados continuam disponíveis para facilitar o próximo lançamento.</p></div>}
                    </section>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {tab === "collections" && (
          <div className="pickups-view">
            <div className="intro pickups-intro">
              <div><small>GUIA 6</small><h2>Controle de coletas</h2><p>Lance as solicitações, informe a saída com o motorista e dê baixa quando a coleta for realizada.</p></div>
            </div>
            <div className="romaneio-subtabs pickup-subtabs">
              <button type="button" className={pickupSection === "panel" ? "active" : ""} onClick={() => setPickupSection("panel")}>Painel de coletas <b>{pickupRecords.filter((record) => record.status === "open").length}</b></button>
              <button type="button" className={pickupSection === "report" ? "active" : ""} onClick={() => setPickupSection("report")}>Relatório <b>{pickupRecords.filter((record) => record.status === "completed").length}</b></button>
            </div>
            {pickupSection === "panel" ? (
              <div className="pickup-workspace">
                <form className="pickup-launch-form" onSubmit={addPickup}>
                  <div><small>LANÇAR COLETA</small><h3>Nova solicitação</h3></div>
                  <label>Número da coleta<input value={pickupNumber} onChange={(event) => setPickupNumber(event.target.value)} placeholder="Digite o número" /></label>
                  <label>Número da nota fiscal <small className="optional-field">Opcional — pode deixar em branco</small><input value={pickupInvoice} onChange={(event) => setPickupInvoice(event.target.value)} placeholder="Digite a NF, se houver" /></label>
                  <span className="cover-partner-label">Parceiro oficial</span>
                  <div className="cover-partner-options pickup-partners" role="radiogroup" aria-label="Parceiro da coleta">
                    {partnerAliases.map(([id, name]) => <button key={id} type="button" role="radio" aria-checked={pickupPartnerId === id} className={pickupPartnerId === id ? "active" : ""} onClick={() => setPickupPartnerId(id)}>{name}</button>)}
                  </div>
                  <label>Nome do cliente<input value={pickupClientName} onChange={(event) => setPickupClientName(event.target.value)} placeholder="Cliente da coleta" /></label>
                  <label>Quantidade de volumes<input type="number" min="1" inputMode="numeric" value={pickupVolumes} onChange={(event) => setPickupVolumes(event.target.value)} placeholder="0" /></label>
                  <button type="submit" className="primary">Lançar coleta</button>
                </form>
                <section className="pickup-panel">
                  <div className="pickup-panel-heading"><div><small>COLETAS EM ABERTO</small><h3>Painel de coleta</h3></div><label>Filtrar por parceiro<select value={pickupPartnerFilter} onChange={(event) => setPickupPartnerFilter(event.target.value)}><option value="all">Todos os parceiros</option>{partnerAliases.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
                  {openPickupRecords.length ? <div className="pickup-cards">{openPickupRecords.map((record) => {
                    const draft = pickupCompletionDrafts[record.id] || { driver: "", date: "" };
                    const expanded = expandedPickupIds.includes(record.id);
                    return <article className={expanded ? "expanded" : "compact"} key={record.id}>
                      <div className="pickup-card-title"><span><small>PENDENTE · COLETA</small><strong>{record.number}</strong><small className="pickup-created-by">Lançado por {record.createdBy || "Não informado"}</small></span><div className="pickup-compact-summary"><span><small>PARCEIRO</small><strong>{record.partnerName}</strong></span><span><small>CLIENTE</small><strong>{record.clientName}</strong></span><span><small>NOTA FISCAL</small><strong>{record.invoice || "Sem nota"}</strong></span><span><small>VOLS</small><strong>{record.volumes}</strong></span><span><small>INSERIDA EM</small><strong>{formatRomaneioDay(record.createdAt)}</strong></span></div><button type="button" onClick={() => setExpandedPickupIds((current) => current.includes(record.id) ? current.filter((id) => id !== record.id) : [...current, record.id])}>{expanded ? "Fechar detalhes" : "Abrir detalhes"}</button></div>
                      {expanded && <>
                      <div className="pickup-completion-fields">
                        <label>Motorista<input value={draft.driver} onChange={(event) => setPickupCompletionDrafts((current) => ({ ...current, [record.id]: { ...draft, driver: event.target.value } }))} placeholder="Com qual motorista saiu?" /></label>
                        <label>Data realizada<input type="date" value={draft.date} onChange={(event) => setPickupCompletionDrafts((current) => ({ ...current, [record.id]: { ...draft, date: event.target.value } }))} /></label>
                        <label className="pickup-check"><input type="checkbox" checked={false} onChange={(event) => { if (event.target.checked) completePickup(record); }} /><span>Marcar como realizada e dar baixa</span></label>
                      </div>
                      </>}
                    </article>;
                  })}</div> : <div className="empty pickup-empty"><span>✓</span><h3>Nenhuma coleta em aberto</h3><p>Altere o filtro ou lance uma nova coleta.</p></div>}
                </section>
              </div>
            ) : (
              <section className="pickup-report">
                <div className="pickup-report-heading"><div><small>HISTÓRICO SALVO</small><h3>Coletas realizadas</h3></div><b>{completedPickupRecords.length} registro(s)</b></div>
                <div className="pickup-report-filters">
                  <label>De<input type="date" value={pickupReportFrom} onChange={(event) => setPickupReportFrom(event.target.value)} /></label>
                  <label>Até<input type="date" value={pickupReportTo} onChange={(event) => setPickupReportTo(event.target.value)} /></label>
                  <label>Parceiro<select value={pickupReportPartnerFilter} onChange={(event) => setPickupReportPartnerFilter(event.target.value)}><option value="all">Todos os parceiros</option>{partnerAliases.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                  <label>Motorista<input type="search" value={pickupReportDriverFilter} onChange={(event) => setPickupReportDriverFilter(event.target.value)} placeholder="Filtrar por motorista" /></label>
                </div>
                {completedPickupRecords.length ? <div className="pickup-report-list">{completedPickupRecords.map((record) => <article key={record.id}>
                  <span><small>COLETA</small><strong>{record.number}</strong></span><span><small>NOTA FISCAL</small><strong>{record.invoice || "Sem nota"}</strong></span><span><small>PARCEIRO</small><strong>{record.partnerName}</strong></span><span><small>CLIENTE</small><strong>{record.clientName}</strong></span><span><small>VOLUMES</small><strong>{record.volumes}</strong></span><span><small>INSERIDA EM</small><strong>{formatRomaneioDay(record.createdAt)}</strong></span><span><small>MOTORISTA</small><strong>{record.driver}</strong></span><span><small>REALIZADA EM</small><strong>{formatRomaneioDay(record.completedAt)}</strong></span><span><small>BAIXA POR</small><strong>{record.completedBy || "Não informado"}</strong></span>
                </article>)}</div> : <div className="empty pickup-empty"><span>⌕</span><h3>Nenhuma coleta realizada encontrada</h3><p>Altere os filtros ou dê baixa em uma coleta do painel.</p></div>}
              </section>
            )}
          </div>
        )}
        {tab === "dedicated" && (
          <div className="dedicated-view">
            <div className="intro dedicated-intro"><div><small>GUIA 7</small><h2>Acompanhamento de dedicados</h2><p>Localize a entrega, confirme os dados e acompanhe o pagamento do dedicado.</p></div></div>
            <div className="romaneio-subtabs dedicated-subtabs">
              <button type="button" className={dedicatedSection === "panel" ? "active" : ""} onClick={() => setDedicatedSection("panel")}>Dedicados em aberto <b>{openDedicatedRecords.length}</b></button>
              <button type="button" className={dedicatedSection === "report" ? "active" : ""} onClick={() => setDedicatedSection("report")}>Relatório <b>{dedicatedRecords.length}</b></button>
            </div>
            {dedicatedSection === "panel" ? <>
              <form className="dedicated-launch" onSubmit={prepareDedicated}>
                <div><small>LANÇAR DEDICADO</small><h3>Busque pelos relatórios já importados</h3><p>Digite a NF, o CT-e ou bipe a chave do CT-e. Antes de inserir, os dados serão mostrados para confirmação.</p></div>
                <label>Nota fiscal, CT-e ou chave<input value={dedicatedSearch} autoFocus onChange={(event) => setDedicatedSearch(event.target.value)} placeholder="Bipe ou digite o documento" /></label>
                <label>Valor do dedicado <small>Opcional</small><input value={dedicatedValue} inputMode="decimal" onChange={(event) => setDedicatedValue(event.target.value)} placeholder="Pode deixar em branco" /></label>
                <button type="submit" className="primary" disabled={!dedicatedSearch.trim()}>Localizar e conferir</button>
              </form>
              <div className="dedicated-panel-heading"><div><small>PENDENTES DE CONFIRMAÇÃO</small><h3>Painel de dedicados em aberto</h3></div><div className="dedicated-heading-controls"><label>Parceiro<select value={dedicatedPanelPartnerFilter} onChange={(event) => setDedicatedPanelPartnerFilter(event.target.value)}><option value="all">Todos os parceiros</option>{partnerAliases.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><b>{openDedicatedRecords.length} pendente(s)</b></div></div>
              {openDedicatedRecords.length ? <div className="dedicated-list">{openDedicatedRecords.map(renderDedicatedCard)}</div> : <div className="empty dedicated-empty"><span>✓</span><h3>Nenhum dedicado pendente</h3><p>Os novos lançamentos aparecerão aqui até a confirmação do pagamento.</p></div>}
            </> : <>
              <div className="dedicated-report-heading"><div><small>HISTÓRICO COMPLETO</small><h3>Relatório de dedicados</h3></div><div className="dedicated-heading-controls"><label>Parceiro<select value={dedicatedReportPartnerFilter} onChange={(event) => setDedicatedReportPartnerFilter(event.target.value)}><option value="all">Todos os parceiros</option>{partnerAliases.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Procurar<input type="search" value={dedicatedReportSearch} onChange={(event) => setDedicatedReportSearch(event.target.value)} placeholder="NF, CT-e, cliente, motorista..." /></label></div></div>
              {visibleDedicatedRecords.length ? <div className="dedicated-list">{visibleDedicatedRecords.map(renderDedicatedCard)}</div> : <div className="empty dedicated-empty"><span>⌕</span><h3>Nenhum dedicado encontrado</h3><p>Altere a busca ou faça um novo lançamento.</p></div>}
            </>}
          </div>
        )}
        {dedicatedConfirmation && (
          <div className="confirmation-backdrop" role="presentation">
            <section className="confirmation-dialog dedicated-confirmation" role="dialog" aria-modal="true" aria-labelledby="dedicated-confirmation-title">
              <small>CONFIRA ANTES DE INSERIR</small>
              <h3 id="dedicated-confirmation-title">Os dados desta entrega estão corretos?</h3>
              <p>Revise as informações encontradas. Você pode corrigi-las agora antes de adicionar o dedicado.</p>
              <div className="dedicated-confirm-grid">
                <label>Nota fiscal<input value={dedicatedConfirmation.invoice} onChange={(event) => setDedicatedConfirmation({ ...dedicatedConfirmation, invoice: event.target.value })} /></label>
                <label>CT-e<input value={dedicatedConfirmation.cte} onChange={(event) => setDedicatedConfirmation({ ...dedicatedConfirmation, cte: event.target.value })} /></label>
                <label>Remetente<input value={dedicatedConfirmation.sender} onChange={(event) => setDedicatedConfirmation({ ...dedicatedConfirmation, sender: event.target.value })} /></label>
                <label>Destinatário<input value={dedicatedConfirmation.recipient} onChange={(event) => setDedicatedConfirmation({ ...dedicatedConfirmation, recipient: event.target.value })} /></label>
                <label>Parceiro<input value={dedicatedConfirmation.partnerName} onChange={(event) => setDedicatedConfirmation({ ...dedicatedConfirmation, partnerName: event.target.value })} /></label>
                <label>Motorista do romaneio<input value={dedicatedConfirmation.driver} onChange={(event) => setDedicatedConfirmation({ ...dedicatedConfirmation, driver: event.target.value })} placeholder="Ainda não manifestado" /></label>
              </div>
              <div className="confirmation-actions"><button type="button" onClick={() => setDedicatedConfirmation(null)}>Voltar</button><button type="button" className="primary" onClick={confirmDedicated}>Confirmar e inserir</button></div>
            </section>
          </div>
        )}
        {(tab === "preview" || tab === "export" || tab === "adjustments") && (
          <>
            <div className="romaneio-subtabs partner-closing-subtabs">
              <button type="button" className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>Prévia</button>
              <button type="button" className={tab === "adjustments" ? "active" : ""} onClick={() => setTab("adjustments")}>Adicionais por NF</button>
              <button type="button" className={tab === "export" ? "active" : ""} onClick={() => setTab("export")}>Exportar</button>
            </div>
            <div className="toolbar">
              <div>
                <small>PERÍODO DO FECHAMENTO</small>
                <h2>
                  {tab === "preview"
                    ? "Prévia por transportadora"
                    : tab === "adjustments"
                      ? "Lançar adicionais por nota fiscal"
                      : "Escolha o que deseja exportar"}
                </h2>
              </div>
              <label>
                De
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </label>
              <label>
                Até
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </label>
            </div>
            {billedInPeriod.length > 0 && (
              <div className="billed-period-notice">
                <span>✓</span>
                <p>
                  <strong>{billedInPeriod.length} registro(s) já enviado(s)</strong>
                  <small>
                    Eles foram conferidos pelo histórico e não aparecem neste
                    fechamento.
                  </small>
                </p>
              </div>
            )}
            {tab === "adjustments" ? (
              <div className="closing-additional-workspace">
                <section className="closing-additional-form">
                  <label>NF, CTE ou chave<input type="search" value={closingAdditionalSearch} onChange={(event) => setClosingAdditionalSearch(event.target.value)} placeholder="Digite ou bipe para localizar" /></label>
                  {closingAdditionalSearch && (
                    <div className={closingAdditionalMatch ? "closing-additional-found" : "closing-additional-not-found"}>
                      {closingAdditionalMatch ? <><strong>NF {closingAdditionalMatch.invoice || "-"} · CTE {closingAdditionalMatch.cte || "-"}</strong><span>{closingAdditionalMatch.sender} → {closingAdditionalMatch.recipient}</span><small>{closingAdditionalMatch.partnerName} · {closingAdditionalMatch.city}</small></> : <strong>Nenhuma nota encontrada.</strong>}
                    </div>
                  )}
                  <div className="closing-additional-options">
                    {(["dedicated", "tde", "tda", "cf"] as ClosingAdditional["kind"][]).map((kind) => <button type="button" key={kind} className={closingAdditionalKind === kind ? "active" : ""} onClick={() => setClosingAdditionalKind(kind)}>{kind === "dedicated" ? "Dedicado" : kind.toUpperCase()}</button>)}
                  </div>
                  <label>Valor do adicional<input inputMode="decimal" value={closingAdditionalValue} onChange={(event) => setClosingAdditionalValue(event.target.value)} placeholder="R$ 0,00" /></label>
                  <label>Forma de cálculo<select value={closingAdditionalCalculation} onChange={(event) => setClosingAdditionalCalculation(event.target.value as ClosingAdditional["calculation"])}><option value="direct">Somar direto, sem desconto</option><option value="before-discounts">Somar antes dos descontos</option></select></label>
                  <label className="closing-additional-check"><input type="checkbox" checked={closingAdditionalPersistent} onChange={(event) => setClosingAdditionalPersistent(event.target.checked)} /><span><strong>Repetir para este destinatário</strong><small>Aplica automaticamente às próximas entregas da mesma parceira para este destinatário.</small></span></label>
                  <button type="button" className="primary" disabled={!closingAdditionalMatch || !closingAdditionalValue.trim()} onClick={addClosingAdditional}>Adicionar ao fechamento</button>
                </section>
                <section className="closing-additional-list">
                  <h3>Adicionais salvos</h3>
                  {closingAdditionals.length ? closingAdditionals.map((item) => <div key={item.id}><span><strong>{item.kind === "dedicated" ? "Dedicado" : item.kind.toUpperCase()} · {money(item.value)}</strong><small>NF {item.invoice || "-"} · {item.partnerName} · {item.recipient}{item.persistent ? " · automático para o destinatário" : ""}</small></span><button type="button" onClick={() => removeClosingAdditional(item.id)}>Remover</button></div>) : <p>Nenhum adicional lançado.</p>}
                </section>
              </div>
            ) : !partners.length ? (
              <div className="empty">
                <span>□</span>
                <h3>Nenhum dado para mostrar</h3>
                <p>
                  {billedInPeriod.length
                    ? "Todos os documentos deste período já foram enviados ao faturamento."
                    : "Importe uma planilha ou altere o período selecionado."}
                </p>
              </div>
            ) : tab === "preview" ? (
              <div className="preview-layout">
                <div className="partner-list">
                  {partners.map((partner) => (
                    <button
                      key={partner.id}
                      className={
                        selectedPartner === partner.id ? "selected" : ""
                      }
                      onClick={() => setSelectedPartner(partner.id)}
                    >
                      <span>{partner.name.slice(0, 2).toUpperCase()}</span>
                      <div>
                        <strong>{partner.name}</strong>
                        <small>{partner.rows.length} entregas</small>
                      </div>
                      <b>›</b>
                    </button>
                  ))}
                </div>
                {active && (
                  <div className="partner-preview">
                    <div className="preview-title">
                      <span>{active.name.slice(0, 2).toUpperCase()}</span>
                      <div>
                        <small>FECHAMENTO DA PARCEIRA</small>
                        <h3>{active.name}</h3>
                      </div>
                      {!scanPartnerIds.has(active.id) && (
                        <div className="optional-scan-toggle">
                          <input
                            id={`optional-scan-${active.id}`}
                            type="checkbox"
                            aria-label="Pagar somente notas bipadas"
                            checked={optionalScanPartnerIds.includes(active.id)}
                            onChange={(event) =>
                              toggleOptionalPartnerScan(
                                active.id,
                                event.target.checked,
                              )
                            }
                          />
                          <label htmlFor={`optional-scan-${active.id}`}>
                            <strong>Pagar somente notas bipadas</strong>
                            <small>
                              Marcado: soma e exporta somente notas bipadas aqui ou em Capas.
                            </small>
                          </label>
                        </div>
                      )}
                    </div>
                    {usesScanForPartner(active.id) && (
                      <div className="scan-panel">
                        <div className="scan-heading">
                          <div>
                            <small>CONFERÊNCIA POR BIPAGEM</small>
                            <strong>Bipe o CTE da transportadora</strong>
                            <p>
                              Somente os documentos com OK entrarão no fechamento.
                            </p>
                          </div>
                          <b>
                            {activeScanState.scannedRows.length} de{" "}
                            {active.rows.length} liberados
                            {activeScanState.pendingKeys.length
                              ? ` · ${activeScanState.pendingKeys.length} aguardando`
                              : ""}
                          </b>
                        </div>
                        <form
                          className="scan-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            registerScan(active.id);
                          }}
                        >
                          <input
                            ref={scanInputRef}
                            type="text"
                            inputMode="numeric"
                            required
                            placeholder="Bipe ou digite o CTE"
                          />
                          <button className="primary">
                            Marcar OK
                          </button>
                        </form>
                        <input
                          ref={scanTxtInputRef}
                          hidden
                          type="file"
                          accept=".txt,text/plain"
                          onChange={(event) =>
                            importScanTxt(event, active.id)
                          }
                        />
                        <div className="scan-import-row">
                          <button
                            type="button"
                            disabled={importingScanTxt}
                            onClick={() => scanTxtInputRef.current?.click()}
                          >
                            {importingScanTxt
                              ? "Lendo arquivo..."
                              : "Importar lista TXT"}
                          </button>
                          <small>
                            Use um CTE por linha. Chaves de 44 dígitos procuram
                            em AK; as demais procuram em AJ.
                          </small>
                        </div>
                        <div className="scan-list">
                          {activeScanState.scannedRows.length ? (
                            activeScanState.scannedRows.map((entry) => (
                              <div key={entry.id}>
                                <span className="scan-ok">{normalized(entry.status) === "cf" ? "CF DIRETO" : "OK"}</span>
                                <strong>CTE {entry.cte}</strong>
                                <small>NF {entry.invoice || "não informada"}</small>
                                {normalized(entry.status) !== "cf" && <button
                                    type="button"
                                    onClick={() =>
                                      removeScan(
                                        active.id,
                                        matchedScanKey(entry) || entry.cte,
                                      )
                                    }
                                  >
                                    Desmarcar
                                  </button>}
                              </div>
                            ))
                          ) : !activeScanState.pendingKeys.length ? (
                            <p>Nenhum documento bipado neste período.</p>
                          ) : null}
                          {activeScanState.pendingKeys.map((key) => (
                            <div className="scan-pending" key={`pending-${key}`}>
                              <span>AGUARDANDO</span>
                              <strong>CTE {key}</strong>
                              <small>Ainda não apareceu no relatório</small>
                              <button
                                type="button"
                                onClick={() => removeScan(active.id, key)}
                              >
                                Remover
                              </button>
                            </div>
                          ))}
                        </div>
                        {activeScanState.missingRows.length > 0 && (
                          <div className="scan-missing">
                            <div className="scan-missing-heading">
                              <div>
                                <small>FALTARAM NA BIPAGEM</small>
                                <strong>Selecione manualmente se necessário</strong>
                              </div>
                              <b>
                                {
                                  activeScanState.missingRows.length
                                }{" "}
                                sem OK
                              </b>
                            </div>
                            <div className="scan-checklist">
                              {activeScanState.missingRows
                                .map((entry) => (
                                  <label
                                    aria-label={`Marcar CTE ${entry.cte || entry.cteKey || "não informado"} com OK`}
                                    key={`missing-${entry.id}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={false}
                                      disabled={
                                        !scanKey(entry.cte) &&
                                        !scanKey(entry.cteKey)
                                      }
                                      onChange={() => markEntryScanned(entry)}
                                    />
                                    <span>
                                      <strong>
                                        CTE {entry.cte || "não informado"}
                                      </strong>
                                      <small>
                                        NF {entry.invoice || "não informada"}
                                      </small>
                                    </span>
                                    <span>
                                      <strong>
                                        {entry.recipient || "Sem destinatário"}
                                      </strong>
                                      <small>
                                        {entry.city || "Cidade não informada"}
                                      </small>
                                    </span>
                                  </label>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {active.id === "pajucara" && (
                      <div className="pajussara-validation">
                        <input
                          ref={pajussaraInputRef}
                          hidden
                          type="file"
                          accept=".xls,.xlsx"
                          onChange={importPajussaraClosing}
                        />
                        <div className="pajussara-validation-heading">
                          <div>
                            <small>CONFERÊNCIA DO FECHAMENTO RECEBIDO</small>
                            <strong>Validar arquivo da Pajuçara</strong>
                            <p>
                              A comparação usa a NF e considera a série do nosso
                              relatório automaticamente.
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={importingPajussara}
                            onClick={() => pajussaraInputRef.current?.click()}
                          >
                            {importingPajussara
                              ? "Lendo fechamento..."
                              : pajussaraClosing
                                ? "Trocar arquivo"
                                : "Importar fechamento deles"}
                          </button>
                        </div>
                        {!pajussaraClosing ? (
                          <div className="pajussara-validation-empty">
                            Importe o arquivo com as abas Extrato e MAPA para
                            descobrir quais documentos do período ficaram fora.
                          </div>
                        ) : (
                          pajussaraComparison && (
                            <>
                              <div className="pajussara-validation-file">
                                <strong>{pajussaraClosing.file}</strong>
                                <small>
                                  Aba {pajussaraClosing.sheet} ·{" "}
                                  {pajussaraClosing.documents.length} documentos
                                  {pajussaraClosing.period
                                    ? ` · ${pajussaraClosing.period}`
                                    : ""}
                                </small>
                              </div>
                              <div className="pajussara-validation-stats">
                                <article>
                                  <small>NOSSO RELATÓRIO</small>
                                  <strong>{active.rows.length}</strong>
                                </article>
                                <article className="matched">
                                  <small>ENCONTRADOS</small>
                                  <strong>
                                    {pajussaraComparison.matched.length}
                                  </strong>
                                </article>
                                <article className="missing">
                                  <small>FALTARAM NO DELES</small>
                                  <strong>
                                    {pajussaraComparison.missing.length}
                                  </strong>
                                </article>
                                <article>
                                  <small>SÓ NO ARQUIVO DELES</small>
                                  <strong>
                                    {pajussaraComparison.externalOnly.length}
                                  </strong>
                                </article>
                              </div>
                              {pajussaraComparison.missing.length ? (
                                <div className="pajussara-missing-block">
                                  <div className="pajussara-missing-heading">
                                    <div>
                                      <small>PENDÊNCIAS</small>
                                      <strong>
                                        Documentos que não entraram no fechamento
                                        deles
                                      </strong>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={exportPajussaraMissing}
                                    >
                                      Baixar faltantes
                                    </button>
                                  </div>
                                  <div className="pajussara-missing-list">
                                    {pajussaraComparison.missing.map((entry) => (
                                      <div key={`pajussara-missing-${entry.id}`}>
                                        <span>
                                          <strong>
                                            CTE {entry.cte || "não informado"}
                                          </strong>
                                          <small>
                                            NF {entry.invoice || "não informada"}
                                          </small>
                                        </span>
                                        <span>
                                          <strong>
                                            {entry.sender || "Remetente não informado"}
                                          </strong>
                                          <small>
                                            {entry.recipient ||
                                              "Destinatário não informado"}
                                          </small>
                                        </span>
                                        <span>
                                          <strong>
                                            {entry.city || "Cidade não informada"}
                                          </strong>
                                          <small>{money(totalOf(entry))}</small>
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="pajussara-validation-success">
                                  Tudo certo: todos os documentos do nosso relatório
                                  foram encontrados no fechamento da Pajuçara.
                                </div>
                              )}
                            </>
                          )
                        )}
                      </div>
                    )}
                    {active.id === "maex" && (
                      <div className="maex-additional-panel">
                        <div className="maex-additional-heading">
                          <div>
                            <small>FECHAMENTO DE MÓVEIS</small>
                            <strong>MAEX ADICIONAL</strong>
                            <p>
                              Marque um documento uma vez. O remetente fica salvo e
                              os documentos atuais e futuros dele serão marcados
                              automaticamente. O histórico adicional é independente
                              do fechamento normal, inclusive quando ainda não há
                              data de entrega.
                            </p>
                          </div>
                          <b>
                            {maexAdditionalOpenRows.filter(isMaexAdditional).length}{" "}
                            de {maexAdditionalOpenRows.length} documentos em aberto
                          </b>
                        </div>
                        <div className="maex-additional-list">
                          {maexAdditionalOpenRows.map((entry) => {
                            const senderKey = maexSenderKey(entry);
                            const marked = isMaexAdditional(entry);
                            return (
                              <label
                                className={marked ? "marked" : ""}
                                key={entry.id}
                              >
                                <input
                                  type="checkbox"
                                  checked={marked}
                                  disabled={!senderKey}
                                  onChange={() => toggleMaexAdditional(entry)}
                                />
                                <span>
                                  <strong>
                                    MDe {entry.mde || "não informado"}
                                  </strong>
                                  <small>
                                    CTE {entry.cte || "não informado"} · NF{" "}
                                    {entry.invoice || "não informada"}
                                  </small>
                                </span>
                                <span>
                                  <strong>{entry.sender || "Sem remetente"}</strong>
                                  <small>
                                    {entry.recipient || "Destinatário não informado"}
                                    {entry.city ? ` · ${entry.city}` : ""}
                                  </small>
                                </span>
                                <b>{marked ? "SALVO" : "MARCAR"}</b>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {active.id === "unidentified" && (
                      <div className="unidentified-panel">
                        <div className="unidentified-intro">
                          <strong>Identificar transportadora</strong>
                          <p>
                            Confira os dados do relatório e atribua cada grupo à
                            transportadora correta.
                          </p>
                        </div>
                        {unidentifiedGroups.map(({ key, rows }) => {
                          const first = rows[0];
                          const senders = [
                            ...new Set(rows.map((row) => row.sender).filter(Boolean)),
                          ].slice(0, 3);
                          const cities = [
                            ...new Set(rows.map((row) => row.city).filter(Boolean)),
                          ].slice(0, 4);
                          const documents = rows
                            .slice(0, 3)
                            .map((row) => row.cte || row.invoice)
                            .filter(Boolean);
                          return (
                            <article className="unidentified-card" key={key}>
                              <div className="identity-details">
                                <div>
                                  <small>RAZÃO SOCIAL / NOME RECEBIDO</small>
                                  <strong>
                                    {first.partnerRaw || "Não informado"}
                                  </strong>
                                </div>
                                <div>
                                  <small>CNPJ DO REDESPACHO</small>
                                  <strong>
                                    {first.partnerCnpj || "Não informado"}
                                  </strong>
                                </div>
                                <p>
                                  <b>{rows.length} registro(s)</b>
                                  {senders.length
                                    ? ` · Remetentes: ${senders.join(", ")}`
                                    : ""}
                                </p>
                                <p>
                                  {cities.length
                                    ? `Cidades: ${cities.join(", ")}`
                                    : "Cidade não informada"}
                                  {documents.length
                                    ? ` · CTE/NF: ${documents.join(", ")}`
                                    : ""}
                                </p>
                              </div>
                              <div className="identity-action">
                                <label htmlFor={`identify-${key}`}>
                                  Esta transportadora é
                                </label>
                                <select
                                  id={`identify-${key}`}
                                  value={assignmentChoices[key] || ""}
                                  onChange={(event) =>
                                    setAssignmentChoices((current) => ({
                                      ...current,
                                      [key]: event.target.value,
                                    }))
                                  }
                                >
                                  <option value="">Selecione...</option>
                                  {assignmentPartners.map(([id, name]) => (
                                    <option key={id} value={id}>
                                      {name}
                                    </option>
                                  ))}
                                  <option value="__new__">
                                    + Cadastrar nova transportadora
                                  </option>
                                </select>
                                {assignmentChoices[key] === "__new__" && (
                                  <input
                                    type="text"
                                    value={newPartnerNames[key] || ""}
                                    placeholder="Nome da transportadora"
                                    onChange={(event) =>
                                      setNewPartnerNames((current) => ({
                                        ...current,
                                        [key]: event.target.value,
                                      }))
                                    }
                                  />
                                )}
                                <button
                                  className="primary"
                                  disabled={
                                    !assignmentChoices[key] ||
                                    (assignmentChoices[key] === "__new__" &&
                                      !newPartnerNames[key]?.trim())
                                  }
                                  onClick={() => assignUnidentified(key)}
                                >
                                  Confirmar identificação
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                    <div className="metrics">
                      <article>
                        <small>Notas</small>
                        <strong>
                          {
                            new Set(
                              activeClosingRows
                                .map((r) => r.invoice)
                                .filter(Boolean),
                            ).size
                          }
                        </strong>
                      </article>
                      <article>
                        <small>Minutas / CTEs</small>
                        <strong>
                          {
                            new Set(
                              activeClosingRows
                                .map((r) => r.cte)
                                .filter(Boolean),
                            ).size
                          }
                        </strong>
                      </article>
                      <article>
                        <small>Reentregas</small>
                        <strong>
                          {activeClosingRows.filter((r) => r.isRedelivery).length}
                        </strong>
                      </article>
                    </div>
                    <div className="grand-total">
                      <small>VALOR DO FECHAMENTO</small>
                      <strong>
                        {money(
                          activeClosingRows.reduce(
                            (sum, row) => sum + totalOf(row),
                            0,
                          ),
                        )}
                      </strong>
                      <p>Valor do Frete + TDE</p>
                    </div>
                    <section className="closing-audit">
                      <div className="closing-audit-heading">
                        <div>
                          <small>CONTROLE TEMPORÁRIO DA PRÉVIA</small>
                          <h3>O que está entrando neste fechamento</h3>
                          <p>Os números abaixo usam exatamente os mesmos documentos da soma e da exportação.</p>
                        </div>
                        <span>{activeClosingRows.length} linhas</span>
                      </div>
                      <div className="closing-audit-grid">
                        <article><small>NOTAS FISCAIS</small><strong>{activeClosingAudit.invoices.size}</strong><p>{money(activeClosingAudit.total)} no fechamento</p></article>
                        <article><small>ENTREGAS NORMAIS</small><strong>{activeClosingAudit.deliveries.count}</strong><p>{money(activeClosingAudit.deliveries.value)}</p></article>
                        <article><small>REENTREGAS (RE)</small><strong>{activeClosingAudit.redeliveries.count}</strong><p>{money(activeClosingAudit.redeliveries.value)}</p></article>
                        <article className="audit-highlight"><small>COMPLEMENTOS (CF)</small><strong>{activeClosingAudit.complements.count}</strong><p>{money(activeClosingAudit.complements.value)} integral</p></article>
                        <article><small>TDE</small><strong>{activeClosingAudit.tde.count}</strong><p>{money(activeClosingAudit.tde.value)}</p></article>
                        <article><small>TDA / TRT</small><strong>{activeClosingAudit.tda.count}</strong><p>{money(activeClosingAudit.tda.value)}</p></article>
                        <article><small>DEDICADOS FORA DO CF</small><strong>{activeClosingAudit.dedicated.count}</strong><p>{money(activeClosingAudit.dedicated.value)}</p></article>
                        <article><small>FRETE DA PARCEIRA</small><strong>{activeClosingAudit.partnerFreight.count}</strong><p>{money(activeClosingAudit.partnerFreight.value)}</p></article>
                        <article><small>FRETE BASE (BA)</small><strong>{money(activeClosingAudit.baseFreight)}</strong><p>{activeClosingAudit.ctes.size} CTEs únicos</p></article>
                        <article><small>PESO / VOLUMES</small><strong>{activeClosingAudit.weight.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg</strong><p>{activeClosingAudit.volumes.toLocaleString("pt-BR")} volumes</p></article>
                        {usesScanForPartner(active.id) && <article><small>FORA POR FALTA DE BIPAGEM</small><strong>{activeScanState.missingRows.length}</strong><p>não entram na soma</p></article>}
                      </div>
                      <details className="closing-audit-details">
                        <summary>Ver nota por nota e todos os valores</summary>
                        <div className="closing-audit-table-wrap">
                          <table>
                            <thead><tr><th>NF</th><th>CTE</th><th>Status</th><th>Destinatário</th><th>Cidade</th><th>Frete base</th><th>TDE</th><th>TDA/TRT</th><th>Dedicado</th><th>Total que entra</th></tr></thead>
                            <tbody>
                              {activeClosingRows.map((entry) => {
                                const isComplement = normalized(entry.status) === "cf";
                                const baseFreight = Math.max(0, entry.reportedTotal ?? entry.freight);
                                return <tr className={isComplement ? "cf-row" : ""} key={`audit-${entry.id}`}>
                                  <td>{entry.invoice || "-"}</td><td>{entry.cte || "-"}</td><td>{isComplement ? "CF" : entry.isRedelivery || normalized(entry.status) === "re" ? "RE" : entry.status || "ET"}</td><td>{entry.recipient || "-"}</td><td>{entry.city || "-"}</td><td>{money(baseFreight)}</td><td>{money(entry.tde || 0)}</td><td>{money(entry.tda || entry.trt || 0)}</td><td>{money(isComplement ? baseFreight : entry.dedicated || 0)}</td><td><strong>{money(totalOf(entry))}</strong></td>
                                </tr>;
                              })}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </section>
                  </div>
                )}
              </div>
            ) : (
              <div className="export-view">
                <div className="selection-head">
                  <p>
                    {selectedExports.length} de{" "}
                    {partners.filter((p) => p.id !== "unidentified").length}{" "}
                    selecionadas
                  </p>
                  <div>
                    <button
                      onClick={() =>
                        setSelectedExports(
                          allIds.filter((id) => id !== "unidentified"),
                        )
                      }
                    >
                      Selecionar todas
                    </button>
                    <button onClick={() => setSelectedExports([])}>
                      Limpar
                    </button>
                  </div>
                </div>
                <div className="check-list">
                  {partners.map((partner) => {
                    const closingTotal = closingTotalsByPartner.get(partner.id);
                    return (
                      <label
                        key={partner.id}
                        className={
                          partner.id === "unidentified" ? "disabled" : ""
                        }
                      >
                        <input
                          type="checkbox"
                          disabled={partner.id === "unidentified"}
                          checked={selectedExports.includes(partner.id)}
                          onChange={() =>
                            setSelectedExports((current) =>
                              current.includes(partner.id)
                                ? current.filter((id) => id !== partner.id)
                                : [...current, partner.id],
                            )
                          }
                        />
                        <span>{partner.name.slice(0, 2).toUpperCase()}</span>
                        <div>
                          <strong>{partner.name}</strong>
                          <small>
                            {closingTotal?.count || 0} registros ·{" "}
                            {money(closingTotal?.total || 0)}
                          </small>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="export-footer">
                  <div>
                    <small>TOTAL SELECIONADO</small>
                    <strong>
                      {money(
                        partners
                          .filter((p) => selectedExports.includes(p.id))
                          .reduce(
                            (sum, partner) =>
                              sum +
                              (closingTotalsByPartner.get(partner.id)?.total ||
                                0),
                            0,
                          ),
                      )}
                    </strong>
                  </div>
                  <button className="primary" onClick={exportSelected}>
                    Exportar selecionadas
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {romaneioSituationConfirmation && (
          <div className="romaneio-alert-overlay">
            <div
              className="romaneio-alert-dialog situation-confirmation"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="situation-confirmation-title"
            >
              <span className="romaneio-alert-icon" aria-hidden="true">?</span>
              <div className="romaneio-alert-copy">
                <small>CONFIRMAÇÃO OBRIGATÓRIA</small>
                <h2 id="situation-confirmation-title">Tem certeza desta situação?</h2>
                <p>
                  Você está marcando <strong>{romaneioSituationConfirmation.reference}</strong> como <strong>{romaneioSituationLabel[romaneioSituationConfirmation.situation]}</strong>.
                </p>
              </div>
              <div className="romaneio-alert-actions">
                <button type="button" className="secondary" onClick={() => setRomaneioSituationConfirmation(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const confirmation = romaneioSituationConfirmation;
                    setRomaneioDraft(
                      confirmation.groupKey,
                      confirmation.documentKey,
                      confirmation.situation,
                    );
                    setRomaneioSituationConfirmation(null);
                  }}
                >
                  Sim, confirmar
                </button>
              </div>
            </div>
          </div>
        )}
        {romaneioBatchSituationConfirmation && (
          <div className="romaneio-alert-overlay">
            <div
              className="romaneio-alert-dialog situation-confirmation"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="batch-situation-confirmation-title"
            >
              <span className="romaneio-alert-icon" aria-hidden="true">!</span>
              <div className="romaneio-alert-copy">
                <small>CONFIRMAÇÃO OBRIGATÓRIA</small>
                <h2 id="batch-situation-confirmation-title">Lançar ocorrência em lote?</h2>
                <p>
                  Você está marcando <strong>{romaneioBatchSituationConfirmation.documentKeys.length} documento(s)</strong> como <strong>{romaneioSituationLabel[romaneioBatchSituationConfirmation.situation]}</strong>.
                </p>
              </div>
              <div className="romaneio-alert-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRomaneioBatchSituationConfirmation(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={confirmBatchRomaneioSituation}
                >
                  Sim, lançar
                </button>
              </div>
            </div>
          </div>
        )}
        {romaneioMarkAllConfirmation && (
          <div className="romaneio-alert-overlay">
            <div
              className="romaneio-alert-dialog situation-confirmation"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="mark-all-confirmation-title"
            >
              <span className="romaneio-alert-icon" aria-hidden="true">!</span>
              <div className="romaneio-alert-copy">
                <small>CONFIRMAÇÃO OBRIGATÓRIA</small>
                <h2 id="mark-all-confirmation-title">Marcar todos como Entregue?</h2>
                <p>
                  Esta ação vai preparar <strong>{romaneioMarkAllConfirmation.pendingCount} documento(s)</strong> pendente(s) deste romaneio como <strong>Entregue (ET)</strong>. A gravação definitiva ainda acontece no botão Gravar conferência.
                </p>
              </div>
              <div className="romaneio-alert-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRomaneioMarkAllConfirmation(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    markAllRomaneioDelivered(
                      romaneioMarkAllConfirmation.groupKey,
                    )
                  }
                >
                  Sim, marcar todos
                </button>
              </div>
            </div>
          </div>
        )}
        {driverClosingDiscountPrompt && (
          <div className="romaneio-alert-overlay">
            <div
              className="romaneio-alert-dialog driver-discount-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="driver-discount-title"
            >
              <span className="romaneio-alert-icon" aria-hidden="true">!</span>
              <div className="romaneio-alert-copy">
                <small>ANTES DE EXPORTAR</small>
                <h2 id="driver-discount-title">Houve desconto?</h2>
                <p>
                  Se houver desconto para o fechamento selecionado, informe o valor total e em quantas vezes será descontado.
                </p>
                <div className="driver-discount-fields">
                  <label>
                    Valor do desconto
                    <input
                      inputMode="decimal"
                      value={driverClosingDiscountPrompt.amount}
                      placeholder="R$ 0,00"
                      onChange={(event) =>
                        setDriverClosingDiscountPrompt((current) =>
                          current
                            ? { ...current, amount: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                  <label>
                    Quantas vezes
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={driverClosingDiscountPrompt.installments}
                      onChange={(event) =>
                        setDriverClosingDiscountPrompt((current) =>
                          current
                            ? { ...current, installments: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="romaneio-alert-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => finishDriverClosingExport(false)}
                >
                  Não houve desconto
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => finishDriverClosingExport(true)}
                >
                  Aplicar e gerar PDF
                </button>
              </div>
            </div>
          </div>
        )}
        {romaneioPickupConfirmation && (
          <div className="romaneio-alert-overlay">
            <div
              className="romaneio-alert-dialog pickup-confirmation"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="pickup-confirmation-title"
            >
              <span className="romaneio-alert-icon" aria-hidden="true">?</span>
              <div className="romaneio-alert-copy">
                <small>ANTES DE GRAVAR</small>
                <h2 id="pickup-confirmation-title">Houve coleta?</h2>
                <p>
                  Se houve coleta neste romaneio, informe a quantidade. Ela será somada à quantidade de documentos no fechamento.
                </p>
                <label className="pickup-quantity-field">
                  Quantidade de coletas
                  <input
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={romaneioPickupConfirmation.quantity}
                    placeholder="0"
                    ref={romaneioPickupQuantityRef}
                  />
                </label>
              </div>
              <div className="romaneio-alert-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const confirmation = romaneioPickupConfirmation;
                    if (!confirmation) return;
                    setRomaneioPickupQuantities((current) => ({
                      ...current,
                      [confirmation.groupKey]: 0,
                    }));
                    setRomaneioPickupConfirmation(null);
                    const group = romaneioDailyGroups.find(
                      (candidate) => candidate.key === confirmation.groupKey,
                    );
                    if (group)
                      saveRomaneioGroup(group, confirmation.allowPending, true, 0);
                  }}
                >
                  Não houve coleta
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const confirmation = romaneioPickupConfirmation;
                    if (!confirmation) return;
                    const quantity = Math.max(
                      0,
                      Math.floor(
                        Number(
                          romaneioPickupQuantityRef.current?.value ||
                            confirmation.quantity ||
                            0,
                        ),
                      ),
                    );
                    const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
                    setRomaneioPickupQuantities((current) => ({
                      ...current,
                      [confirmation.groupKey]: safeQuantity,
                    }));
                    setRomaneioPickupConfirmation(null);
                    const group = romaneioDailyGroups.find(
                      (candidate) => candidate.key === confirmation.groupKey,
                    );
                    if (group)
                      saveRomaneioGroup(
                        group,
                        confirmation.allowPending,
                        true,
                        safeQuantity,
                      );
                  }}
                >
                  Confirmar e gravar
                </button>
              </div>
            </div>
          </div>
        )}
        {romaneioPendingAlert && (
          <div className="romaneio-alert-overlay">
            <div
              className="romaneio-alert-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="romaneio-alert-title"
            >
              <span className="romaneio-alert-icon" aria-hidden="true">
                !
              </span>
              <div className="romaneio-alert-copy">
                <small>ATENÇÃO — CONFERÊNCIA PENDENTE</small>
                <h2 id="romaneio-alert-title">
                  {romaneioPendingAlert.kind === "change-romaneio"
                    ? "Grave o romaneio antes de continuar"
                    : `Ainda faltam ${romaneioPendingAlert.pendingCount} documento(s)`}
                </h2>
                <p>
                  {romaneioPendingAlert.kind === "change-romaneio"
                    ? "Você tentou bipar um documento de outro romaneio. As marcações atuais ainda não foram gravadas."
                    : "Esses documentos ainda não receberam uma situação. Você pode voltar e conferir tudo ou gravar somente o que já marcou, deixando o restante em aberto para continuar depois."}
                </p>
              </div>
              <div className="romaneio-alert-actions">
                {romaneioPendingAlert.kind === "save-with-pending" && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      const alert = romaneioPendingAlert;
                      setRomaneioPendingAlert(null);
                      const group = romaneioDailyGroups.find(
                        (candidate) => candidate.key === alert.groupKey,
                      );
                      if (group) saveRomaneioGroup(group, true);
                    }}
                  >
                    Gravar marcados e deixar restantes em aberto
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  onClick={() => setRomaneioPendingAlert(null)}
                >
                  Voltar e conferir
                </button>
              </div>
            </div>
          </div>
        )}
        {romaneioCancelConfirmation && (
          <div className="romaneio-alert-overlay">
            <div className="romaneio-alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="romaneio-cancel-title">
              <span className="romaneio-alert-icon" aria-hidden="true">!</span>
              <div className="romaneio-alert-copy">
                <small>CONFIRMAR CANCELAMENTO</small>
                <h2 id="romaneio-cancel-title">Cancelar a ticagem atual?</h2>
                <p>As marcações ainda não gravadas serão desfeitas. Depois você poderá começar outra ticagem do zero.</p>
              </div>
              <div className="romaneio-alert-actions">
                <button type="button" className="secondary" onClick={() => setRomaneioCancelConfirmation(false)}>Voltar</button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setRomaneioDocumentDrafts({});
                    setSelectedRomaneioDocumentKeys({});
                    clearRomaneioSearch();
                    setRomaneioPendingAlert(null);
                    setRomaneioCancelConfirmation(false);
                    setMessageIsError(false);
                    setMessage("Ticagem cancelada. Você pode começar novamente.");
                  }}
                >
                  Sim, cancelar ticagem
                </button>
              </div>
            </div>
          </div>
        )}
        {coverDeleteConfirmation && (
          <div className="romaneio-alert-overlay">
            <div className="romaneio-alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cover-delete-title">
              <span className="romaneio-alert-icon" aria-hidden="true">!</span>
              <div className="romaneio-alert-copy">
                <small>EXCLUSÃO DE CAPA</small>
                <h2 id="cover-delete-title">Excluir {selectedReportCovers.length} capa(s)?</h2>
                <p>As capas selecionadas e seus itens serão retirados do relatório compartilhado.</p>
              </div>
              <div className="romaneio-alert-actions">
                <button type="button" className="secondary" onClick={() => setCoverDeleteConfirmation(false)}>Cancelar</button>
                <button type="button" className="primary" onClick={deleteSelectedCovers}>Sim, excluir</button>
              </div>
            </div>
          </div>
        )}
        {message && (
          <div
            className={`message ${messageIsError ? "message-error" : "message-info"}`}
            role="status"
            aria-live="polite"
          >
            {message}
          </div>
        )}
      </section>
    </main>
  );
}
