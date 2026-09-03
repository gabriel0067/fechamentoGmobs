"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
} from "./storage";

type Tab = "import" | "romaneios" | "preview" | "export";
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
  linkWarning: string;
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
    "PAJUSSARA",
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
const numericDocumentId = (value?: string) => {
  const text = String(value ?? "").trim();
  const reference = text.match(/^[MC]\s*-\s*(\d+)(?:\s*-\s*\d+)?$/i);
  const digits = reference?.[1] || text.replace(/\D/g, "");
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
  const invoiceWithSeries = text.match(/^0*(\d+)\s*-\s*\d+$/);
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
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
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
    master.gain.exponentialRampToValueAtTime(0.8, start + 0.04);
    master.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
    master.connect(context.destination);
    [220, 294].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.linearRampToValueAtTime(frequency * 0.86, start + 0.4);
      oscillator.detune.setValueAtTime(index ? 7 : -7, start);
      gain.gain.setValueAtTime(index ? 0.32 : 0.48, start);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + 0.43);
    });
    window.setTimeout(() => void context.close(), 700);
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
const romaneioReferenceMergeKey = (entry: RomaneioReferenceEntry) =>
  [
    numericDocumentId(entry.mde),
    numericDocumentId(entry.cte),
    scanKey(entry.cteKey),
    normalizeInvoiceKey(entry.invoice),
    normalized(entry.sender),
    normalized(entry.recipient),
  ].join("|");
const romaneioReferenceScore = (entry: RomaneioReferenceEntry) =>
  [
    entry.sender,
    entry.recipient,
    entry.city,
    entry.mde,
    entry.cte,
    entry.cteKey,
    entry.invoice,
  ].filter(Boolean).length +
  (entry.reportedTotal || entry.freight ? 2 : 0);
const romaneioReferenceIdentifiers = (entry: RomaneioReferenceEntry) =>
  [
    numericDocumentId(entry.mde),
    numericDocumentId(entry.cte),
    operationalIdentifier(entry.cteKey),
    cteNumberFromAccessKey(entry.cteKey),
    normalizeInvoiceKey(entry.invoice),
  ].filter(Boolean);
const expandRomaneioScanIdentifiers = (
  identifiers: string[],
  references: RomaneioReferenceEntry[],
) => {
  const expanded = new Set(identifiers);
  references.forEach((entry) => {
    const entryIdentifiers = romaneioReferenceIdentifiers(entry);
    if (!entryIdentifiers.some((identifier) => expanded.has(identifier))) return;
    entryIdentifiers.forEach((identifier) => expanded.add(identifier));
  });
  return [...expanded];
};
const uniqueRomaneioReferences = (entries: RomaneioReferenceEntry[]) => [
  ...new Map(entries.map((entry) => [entry.id, entry] as const)).values(),
];
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

function useCloudStateSync<T>(
  stateKey: CloudStateKey,
  value: T,
  enabled: boolean,
  skipSaveRef: { current: Set<CloudStateKey> },
  onStart: () => void,
  onCancel: () => void,
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

    onStart();
    let requested = false;
    const timer = window.setTimeout(() => {
      requested = true;
      void saveCloudState(stateKey, value)
        .then((version) => onFinish(stateKey, true, version))
        .catch(() => onFinish(stateKey, false));
    }, 600);
    return () => {
      window.clearTimeout(timer);
      if (!requested) onCancel();
    };
  }, [
    enabled,
    onCancel,
    onFinish,
    onStart,
    skipSaveRef,
    stateKey,
    value,
  ]);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("import");
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
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [assignmentChoices, setAssignmentChoices] = useState<
    Record<string, string>
  >({});
  const [newPartnerNames, setNewPartnerNames] = useState<
    Record<string, string>
  >({});
  const [scanInput, setScanInput] = useState("");
  const [importingScanTxt, setImportingScanTxt] = useState(false);
  const [scannedCtes, setScannedCtes] = useState<
    Record<string, Record<string, string>>
  >({});
  const [optionalScanPartnerIds, setOptionalScanPartnerIds] = useState<
    string[]
  >([]);
  const [tdeRates, setTdeRates] = useState<TdeRateRecord[]>([]);
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
  const [manualRomaneioFreightDrafts, setManualRomaneioFreightDrafts] =
    useState<Record<string, { invoice: string; grossFreight: string }>>({});
  const [romaneioPickupQuantities, setRomaneioPickupQuantities] = useState<
    Record<string, number>
  >({});
  const [driverClosingDiscountPlans, setDriverClosingDiscountPlans] = useState<
    Record<string, DriverClosingDiscountPlan[]>
  >({});
  const [driverClosingDiscountPrompt, setDriverClosingDiscountPrompt] =
    useState<DriverClosingDiscountPrompt | null>(null);
  const [romaneioSearch, setRomaneioSearch] = useState("");
  const [romaneioFullSearch, setRomaneioFullSearch] = useState("");
  const [focusedRomaneioKey, setFocusedRomaneioKey] = useState("");
  const [romaneioView, setRomaneioView] = useState<"operation" | "retained">(
    "operation",
  );
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
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => {
      setMessage("");
      setMessageIsError(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    let cancelled = false;
    const restoreSavedData = async () => {
      try {
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
            loadCloudStateRecord<{
              entries: Entry[];
              referenceEntries?: RomaneioReferenceEntry[];
              importInfo: ImportInfo | null;
            }>("closing"),
            loadCloudStateRecord<Record<string, Record<string, string>>>(
              "scans",
            ),
            loadCloudStateRecord<{
            rates: TdeRateRecord[];
            importInfo: TdeImportInfo | null;
            }>("tde"),
            loadCloudStateRecord<Record<string, MaexAdditionalSender>>("maex"),
            loadCloudStateRecord<Record<string, BilledDocumentRecord>>("billed"),
            loadCloudStateRecord<{
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
          cloudVersionsRef.current.closing = closingRecord?.version || "";
        } else {
          cloudVersionsRef.current.closing = await saveCloudState("closing", {
            entries: [],
            referenceEntries: [],
            importInfo: null,
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
    void writeClosingStorage({ entries, referenceEntries: romaneioReferenceEntries })
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
  }, [entries, hydrated, romaneioReferenceEntries]);
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
    () => ({ entries, referenceEntries: romaneioReferenceEntries, importInfo }),
    [entries, importInfo, romaneioReferenceEntries],
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
    if (cloudWritesRef.current === 0) cloudSaveFailedRef.current = false;
    cloudWritesRef.current += 1;
    setCloudStatus("saving");
  }, []);
  const markCloudSaveCancel = useCallback(() => {
    cloudWritesRef.current = Math.max(0, cloudWritesRef.current - 1);
    if (cloudWritesRef.current === 0)
      setCloudStatus(cloudSaveFailedRef.current ? "error" : "ready");
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
    markCloudSaveStart,
    markCloudSaveCancel,
    markCloudSaveFinish,
  );
  useCloudStateSync(
    "scans",
    scannedCtes,
    cloudReady,
    skipCloudSaveRef,
    markCloudSaveStart,
    markCloudSaveCancel,
    markCloudSaveFinish,
  );
  useCloudStateSync(
    "tde",
    tdeCloudState,
    cloudReady,
    skipCloudSaveRef,
    markCloudSaveStart,
    markCloudSaveCancel,
    markCloudSaveFinish,
  );
  useCloudStateSync(
    "maex",
    maexAdditionalSenders,
    cloudReady,
    skipCloudSaveRef,
    markCloudSaveStart,
    markCloudSaveCancel,
    markCloudSaveFinish,
  );
  useCloudStateSync(
    "billed",
    billedDocuments,
    cloudReady,
    skipCloudSaveRef,
    markCloudSaveStart,
    markCloudSaveCancel,
    markCloudSaveFinish,
  );
  useCloudStateSync(
    "romaneios",
    romaneiosCloudState,
    cloudReady,
    skipCloudSaveRef,
    markCloudSaveStart,
    markCloudSaveCancel,
    markCloudSaveFinish,
  );
  const refreshCloudData = useCallback(async () => {
    if (
      !cloudReady ||
      cloudWritesRef.current > 0 ||
      cloudSaveFailedRef.current ||
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
      if (cloudWritesRef.current > 0) return;
      const changedKeys = versions
        .filter(
          ([key, version]) =>
            version !== undefined && version !== cloudVersionsRef.current[key],
        )
        .map(([key]) => key);
      if (!changedKeys.length) return;

      setCloudStatus("loading");
      for (const key of changedKeys) {
        if (key === "closing") {
          const record = await loadCloudStateRecord<{
            entries: Entry[];
            referenceEntries?: RomaneioReferenceEntry[];
            importInfo: ImportInfo | null;
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
        } else if (key === "scans") {
          const record = await loadCloudStateRecord<
            Record<string, Record<string, string>>
          >(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          setScannedCtes(record.value || {});
        } else if (key === "tde") {
          const record = await loadCloudStateRecord<{
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
          const record = await loadCloudStateRecord<
            Record<string, MaexAdditionalSender>
          >(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          setMaexAdditionalSenders(record.value || {});
        } else if (key === "billed") {
          const record = await loadCloudStateRecord<
            Record<string, BilledDocumentRecord>
          >(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          setBilledDocuments(normalizeBilledDocuments(record.value || {}));
        } else if (key === "romaneios") {
          const record = await loadCloudStateRecord<{
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
  }, [cloudReady]);
  useEffect(() => {
    if (!cloudHosted || !cloudReady || authStatus !== "signedIn") return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshCloudData();
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [authStatus, cloudHosted, cloudReady, refreshCloudData]);
  const entriesWithTde = useMemo(
    () => applyTdeRates(entries, tdeRates),
    [entries, tdeRates],
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
    const invoices = new Map<string, RomaneioReferenceEntry[]>();
    const references = [
      ...new Map(
        [
          ...entriesWithTde.map(asRomaneioReferenceEntry),
          ...romaneioReferenceEntries,
        ].map((entry) => [entry.id, entry] as const),
      ).values(),
    ];
    references.forEach((entry) => {
      const mde = numericDocumentId(entry.mde);
      const cte = numericDocumentId(entry.cte);
      const cteFromKey = cteNumberFromAccessKey(entry.cteKey);
      const invoice = normalizeInvoiceKey(entry.invoice);
      if (mde) mdes.set(mde, [...(mdes.get(mde) || []), entry]);
      if (cte) ctes.set(cte, [...(ctes.get(cte) || []), entry]);
      if (cteFromKey) ctes.set(cteFromKey, [...(ctes.get(cteFromKey) || []), entry]);
      if (invoice) invoices.set(invoice, [...(invoices.get(invoice) || []), entry]);
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
        const documentKey = romaneioDocumentKey(document);
        if (matches.has(documentKey)) return;
        const reference = romaneioDocumentReference(document);
        const matchedEntries = reference
          ? reference.type === "MD-e"
            ? uniqueRomaneioReferences([
                ...(mdes.get(reference.number) || []),
                ...(invoices.get(reference.number) || []),
              ])
            : uniqueRomaneioReferences([
                ...(ctes.get(reference.number) || []),
                ...(invoices.get(reference.number) || []),
              ])
          : [];
        matches.set(documentKey, {
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
      const key = `${day}|${driverIdentity || "sem-motorista"}`;
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
        const match = romaneioDocumentMatches.get(documentKey);
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
          ]),
        ].filter(Boolean) as string[];
        const grossFreight = linked?.reportedTotal ?? linked?.freight ?? 0;
        const linkWarning = linkedEntries.length
          ? linked?.sender || linked?.recipient || linked?.city || grossFreight
            ? `Vinculado pelo relatório. Status de origem ${linked?.sourceStatus || linked?.status || "não informado"} usado só como referência.`
            : "Vinculado, mas o relatório não trouxe remetente, destinatário, cidade ou frete para preencher a linha."
          : `${match?.type || "Documento"} ${match?.number || document} não encontrado nos relatórios carregados. O status não bloqueia o vínculo; falta esse número de MD-e/CT-e na base.`;
        current.documents.push({
          key: documentKey,
          document,
          referenceType: match?.type || "Documento",
          referenceNumber: match?.number || document,
          linkedEntries,
          linkWarning,
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
  const visibleRomaneioGroups = useMemo(() => {
    const term = normalized(romaneioSearch);
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
  }, [focusedRomaneioKey, romaneioDailyGroups, romaneioSearch]);
  const visibleFullRomaneioGroups = useMemo(() => {
    const term = normalized(romaneioFullSearch);
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
              romaneioDocumentStatuses[document.key]?.situation || "delivered"
            ],
          ]),
        ].join(" "),
      ).includes(term),
    );
  }, [
    romaneioDailyGroups,
    romaneioDocumentStatuses,
    romaneioFullSearch,
    romaneioGroupNotes,
    romaneioRouteLabels,
  ]);
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
        const situation = romaneioDocumentStatuses[document.key]?.situation;
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
          romaneioDocumentStatuses[document.key]?.situation === "delivered",
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
          const situation = romaneioDocumentStatuses[document.key]?.situation;
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
    const key = scanKey(scanInput);
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
        [key]: new Date().toISOString(),
      },
    }));
    setScanInput("");
    if (matching.length) {
      setMessage(
        `${matching.length} registro(s) do CTE ${matching[0].cte} marcado(s) com OK.`,
      );
    } else {
      setMessage(
        `CTE ${scanInput.trim()} guardado. Ele entrará automaticamente quando aparecer em ${partner?.name || "esta transportadora"}.`,
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
          ...Object.fromEntries(readings.map((key) => [key, importedAt])),
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
        [key]: new Date().toISOString(),
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

  const matchedScanKey = (entry: Entry) => {
    const partnerScans = scannedCtes[entry.partnerId] || {};
    return [scanKey(entry.cteKey), scanKey(entry.cte)].find(
      (key) => key && partnerScans[key],
    );
  };
  const isScanned = (entry: Entry) => Boolean(matchedScanKey(entry));
  const usesScanForPartner = (partnerId: string) =>
    scanPartnerIds.has(partnerId) || optionalScanPartnerIds.includes(partnerId);
  const rowsForClosing = (partner: { id: string; rows: Entry[] }) =>
    usesScanForPartner(partner.id)
      ? partner.rows.filter(isScanned)
      : partner.rows;
  const pendingScanKeys = (partner: { id: string; rows: Entry[] }) =>
    Object.keys(scannedCtes[partner.id] || {}).filter(
      (key) =>
        !partner.rows.some(
          (entry) =>
            scanKey(entry.cteKey) === key || scanKey(entry.cte) === key,
        ),
    );

  function toggleOptionalPartnerScan(partnerId: string, enabled: boolean) {
    const partner = partners.find((item) => item.id === partnerId);
    setOptionalScanPartnerIds((current) =>
      enabled
        ? [...new Set([...current, partnerId])]
        : current.filter((id) => id !== partnerId),
    );
    setMessage(
      enabled
        ? `Bipagem opcional ativada para ${partner?.name || "esta transportadora"}. Somente documentos com OK entrarão na exportação.`
        : `Bipagem opcional desativada para ${partner?.name || "esta transportadora"}. A exportação voltou a considerar todos os documentos.`,
    );
  }

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
    setRomaneioDocumentStatuses((current) => {
      const next = { ...current };
      delete next[documentKey];
      return next;
    });
    setEntries((current) =>
      current.filter((entry) => entry.romaneioDocumentKey !== documentKey),
    );
    setMessageIsError(false);
    setMessage("Situação desfeita. O documento voltou para conferência.");
    playRomaneioAttentionSound();
  }

  function setRomaneioReturnReason(
    groupKey: string,
    documentKey: string,
    reason: string,
  ) {
    setRomaneioDocumentDrafts((current) => ({
      ...current,
      [groupKey]: {
        ...(current[groupKey] || {}),
        [documentKey]: {
          situation:
            current[groupKey]?.[documentKey]?.situation || "return",
          reason,
        },
      },
    }));
  }

  function requestMarkAllRomaneioDelivered(group: RomaneioDailyGroup) {
    const drafts = romaneioDocumentDrafts[group.key] || {};
    const pendingCount = group.documents.filter((document) => {
      if (romaneioDocumentStatuses[document.key]) return false;
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
        if (romaneioDocumentStatuses[document.key]) return;
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
    const draft = manualRomaneioFreightDrafts[groupKey] || {
      invoice: "",
      grossFreight: "",
    };
    const invoice = draft.invoice.trim();
    const grossFreight = parseMoney(draft.grossFreight);
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
    setManualRomaneioFreightDrafts((current) => ({
      ...current,
      [groupKey]: { invoice: "", grossFreight: "" },
    }));
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
  ) {
    const document = currentRomaneioDocumentsByKey.get(documentKey);
    if (!document) return;
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
    if (!promoted.length) return;
    const promotedIds = new Set(promoted.map((entry) => entry.id));
    setEntries((current) => [
      ...current.filter(
        (entry) =>
          entry.romaneioDocumentKey !== documentKey &&
          !promotedIds.has(entry.id),
      ),
      ...promoted,
    ]);
  }

  function showPendingRomaneioAlert() {
    setRomaneioSearch("");
    setMessage("");
    setRomaneioPendingAlert({ kind: "change-romaneio" });
    playRomaneioAttentionSound();
  }

  function scanOrSearchRomaneio() {
    const typed = romaneioSearch.trim();
    const typedIdentifiers = expandRomaneioScanIdentifiers(
      operationalIdentifiers(typed),
      [
        ...entriesWithTde.map(asRomaneioReferenceEntry),
        ...romaneioReferenceEntries,
      ],
    );
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

    const retained = retainedRomaneioDocuments.find((record) =>
      typedIdentifiers.some((item) => record.identifiers.includes(item)),
    );
    if (retained) {
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
      setRomaneioSearch("");
      setMessageIsError(false);
      setMessage(
        `Documento retido localizado: ${retained.referenceType} ${retained.referenceNumber} já foi retirado do relatório de Retidos e gravado como Entregue.`,
      );
      playRomaneioSuccessSound();
      return;
    }

    const matches = romaneioDailyGroups.flatMap((group) =>
      group.documents
        .filter((document) =>
          typedIdentifiers.some((item) => document.identifiers.includes(item)),
        )
        .map((document) => ({ group, document })),
    );
    const pendingMatch = matches.find(
      ({ group, document }) =>
        !romaneioDocumentStatuses[document.key] &&
        !romaneioDocumentDrafts[group.key]?.[document.key]?.situation,
    );
    const match = pendingMatch || matches[0];
    if (!match) {
      setRomaneioSearch("");
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
      setRomaneioSearch("");
      setMessageIsError(true);
      setMessage(
        `${document.referenceType} ${document.referenceNumber} já possui uma situação marcada. O romaneio vinculado foi aberto.`,
      );
      playRomaneioAttentionSound();
      return;
    }
    setRomaneioDraft(group.key, document.key, "delivered");
    setRomaneioSearch("");
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
    const selectedDrafts = Object.entries(drafts).filter(
      ([, draft]) => draft.situation,
    );
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
      if (romaneioDocumentStatuses[document.key]) return false;
      const draft = drafts[document.key];
      if (!draft?.situation) return true;
      return draft.situation === "return" && !draft.reason.trim();
    }).length;
    if (pendingCount) {
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
    if (selectedDrafts.length)
      setRomaneioDocumentStatuses((current) => {
        const next = { ...current };
        selectedDrafts.forEach(([documentKey, draft]) => {
          const document = group.documents.find(
            (candidate) => candidate.key === documentKey,
          );
          if (!document || !draft.situation) return;
          next[documentKey] = {
            key: document.key,
            document: document.document,
            referenceType: document.referenceType,
            referenceNumber: document.referenceNumber,
            situation: draft.situation,
            sourceStatus: document.sourceStatus,
            operationalStatus: romaneioOperationalStatus(draft.situation),
            reason: draft.situation === "return" ? draft.reason.trim() : "",
            savedAt,
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
    selectedDrafts.forEach(([documentKey, draft]) => {
      if (!draft.situation || draft.situation === "driver-missing") return;
      releaseRomaneioDocumentToClosing(
        documentKey,
        draft.situation,
        group.day,
        savedAt,
      );
    });
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
    const typedIdentifiers = expandRomaneioScanIdentifiers(
      operationalIdentifiers(retainedScanInput),
      [
        ...entriesWithTde.map(asRomaneioReferenceEntry),
        ...romaneioReferenceEntries,
      ],
    );
    if (!typedIdentifiers.length) {
      setMessageIsError(true);
      setMessage("Digite ou bipe um MD-e ou CT-e Parceiro válido.");
      playRomaneioAttentionSound();
      return;
    }
    const matching = retainedRomaneioDocuments.find((record) =>
      typedIdentifiers.some((item) => record.identifiers.includes(item)),
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
          };
      });
      return next;
    });
    selectedKeys.forEach((key) => {
      const record = romaneioDocumentStatuses[key];
      releaseRomaneioDocumentToClosing(
        key,
        "delivered",
        record?.day || "",
        savedAt,
      );
    });
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
        `${result.documents.length} documentos lidos no fechamento da Pajussara. ${comparison.matched.length} encontrados e ${comparison.missing.length} faltantes no arquivo deles para o período selecionado.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível ler o fechamento da Pajussara.",
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
        };
        scans?: Record<string, Record<string, string>>;
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
      setRomaneioSearch("");
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
          sourceEligible:
            !result.referenceOnly && row.eligible && Boolean(row.cte || row.invoice),
        };
      },
      );
      const additions = referenceEntries.filter(
        (entry) => entry.sourceEligible || Boolean(entry.romaneioDocumentKey),
      );
      const redeliveries = additions.filter(
        (entry) => entry.isRedelivery,
      ).length;
      const unidentified = additions.filter(
        (entry) => entry.partnerId === "unidentified",
      ).length;
      const releasedByRomaneio = additions.filter(
        (entry) => entry.romaneioDocumentKey,
      ).length;
      if (result.referenceOnly) {
        const merged = new Map<string, RomaneioReferenceEntry>();
        [...romaneioReferenceEntries, ...referenceEntries].forEach((entry) => {
          const key = romaneioReferenceMergeKey(entry);
          if (!key.replace(/\|/g, "")) return;
          const current = merged.get(key);
          if (!current || romaneioReferenceScore(entry) > romaneioReferenceScore(current))
            merged.set(key, entry);
        });
        const previousKeys = new Set(
          romaneioReferenceEntries.map(romaneioReferenceMergeKey),
        );
        const addedReferences = [...merged.keys()].filter(
          (key) => !previousKeys.has(key),
        ).length;
        const updatedReferences = [...merged.entries()].filter(([key, entry]) => {
          const previous = romaneioReferenceEntries.find(
            (candidate) => romaneioReferenceMergeKey(candidate) === key,
          );
          return previous && romaneioReferenceScore(entry) > romaneioReferenceScore(previous);
        }).length;
        setRomaneioReferenceEntries([...merged.values()]);
        setMessage(
          `${addedReferences} documento(s) novo(s) e ${updatedReferences} documento(s) atualizado(s) do relatório complementar ficaram disponíveis para localizar nos Romaneios.${duplicates ? ` ${duplicates} linha(s) completamente repetida(s) foram ignoradas.` : ""}`,
        );
        return;
      }
      setEntries(additions);
      setRomaneioReferenceEntries(
        referenceEntries.filter((entry) => !entry.sourceEligible),
      );
      setOptionalScanPartnerIds([]);
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
        `${additions.length} documento(s) liberado(s) para o fechamento.${romaneioOnly ? ` ${romaneioOnly} documento(s) em outros status ficaram disponíveis somente para consulta e conferência nos Romaneios.` : ""}${duplicates ? ` ${duplicates} linha(s) completamente repetida(s) foram ignoradas.` : ""}`,
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
        "Não há documentos faltantes da Pajussara para exportar.",
      );
    exportPajussaraMissingXlsx(
      pajussaraComparison.missing.map((entry) =>
        toExportRow(entry, "Pajussara"),
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

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || "Usuário ou senha incorretos.");
      setLoginPassword("");
      setAuthStatus("checking");
      setCloudReady(false);
      setCloudStatus("loading");
      setCloudRetry((current) => current + 1);
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Não foi possível entrar.",
      );
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
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

  if (cloudHosted && authStatus === "signedOut")
    return (
      <main className="access-shell">
        <section className="access-card login-card">
          <div className="access-mark">GM</div>
          <small>ACESSO RESTRITO</small>
          <h1>Fechamentos GMOBS</h1>
          <p>Entre para acessar os relatórios e o histórico compartilhado.</p>
          <form onSubmit={login}>
            <label htmlFor="login-username">Usuário</label>
            <input
              id="login-username"
              value={loginUsername}
              autoComplete="username"
              onChange={(event) => setLoginUsername(event.target.value)}
            />
            <label htmlFor="login-password">Senha</label>
            <input
              id="login-password"
              type="password"
              value={loginPassword}
              autoComplete="current-password"
              onChange={(event) => setLoginPassword(event.target.value)}
            />
            {loginError && <div className="login-error">{loginError}</div>}
            <button
              type="submit"
              className="primary"
              disabled={loggingIn || !loginUsername.trim() || !loginPassword}
            >
              {loggingIn ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </section>
      </main>
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
          <p className={`storage-status ${cloudStatus}`}>
            <span aria-hidden="true" />
            {cloudStatusText[cloudStatus]}
          </p>
          {cloudHosted && (
            <button type="button" onClick={logout}>
              Sair
            </button>
          )}
        </div>
      </header>
      <nav className="tabs" aria-label="Etapas do fechamento">
        <button
          className={tab === "import" ? "active" : ""}
          onClick={() => {
            setTab("import");
            setMessage("");
          }}
        >
          <b>1</b>Importar
        </button>
        <button
          className={tab === "romaneios" ? "active" : ""}
          onClick={() => {
            setTab("romaneios");
            setMessage("");
          }}
        >
          <b>2</b>Romaneios
        </button>
        <button
          className={tab === "preview" || tab === "export" ? "active" : ""}
          onClick={() => {
            setTab("preview");
            setMessage("");
          }}
        >
          <b>3</b>Fechamento parceiros
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
                    type="search"
                    value={romaneioSearch}
                    placeholder="MD-e, CT-e Parceiro, chave AK, NF, motorista ou romaneio"
                    onChange={(event) => setRomaneioSearch(event.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={!romaneioSearch.trim()}
                  >
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
                    {visibleRomaneioGroups.map((group) => {
                      const drafts = romaneioDocumentDrafts[group.key] || {};
                      const previousMissingDocuments = (
                        missingDocumentsByDriver.get(normalized(group.driver)) || []
                      ).filter((record) => record.day < group.day);
                      const pendingDocuments = group.documents.filter(
                        (document) => {
                          if (romaneioDocumentStatuses[document.key]) return false;
                          const draft = drafts[document.key];
                          if (!draft?.situation) return true;
                          return draft.situation === "return";
                        },
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

                              {pendingDocuments.length ? (
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
                                    {pendingDocuments.map((document) => {
                                      const draft = drafts[document.key] || {situation: "", reason: ""};
                                      return (
                                        <div className="daily-document-row" key={document.key}>
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
                                            <small className={document.linkedEntries.length ? "link-ok" : "link-warning"}>
                                              Aviso temporario: {document.linkWarning}
                                            </small>
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
                                              <input className="return-reason" required value={draft.reason} placeholder="Motivo obrigatório" onChange={(event) => setRomaneioReturnReason(group.key, document.key, event.target.value)} />
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
                                    value={manualRomaneioFreightDrafts[group.key]?.invoice || ""}
                                    placeholder="NF"
                                    onChange={(event) =>
                                      setManualRomaneioFreightDrafts((current) => ({
                                        ...current,
                                        [group.key]: {
                                          invoice: event.target.value,
                                          grossFreight:
                                            current[group.key]?.grossFreight || "",
                                        },
                                      }))
                                    }
                                  />
                                </label>
                                <label>
                                  Frete bruto
                                  <input
                                    inputMode="decimal"
                                    value={manualRomaneioFreightDrafts[group.key]?.grossFreight || ""}
                                    placeholder="R$ 0,00"
                                    onChange={(event) =>
                                      setManualRomaneioFreightDrafts((current) => ({
                                        ...current,
                                        [group.key]: {
                                          invoice: current[group.key]?.invoice || "",
                                          grossFreight: event.target.value,
                                        },
                                      }))
                                    }
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
                  <b>{retainedRomaneioDocuments.length} retido(s)</b>
                </div>
                <form className="retained-scan" onSubmit={(event) => {event.preventDefault(); scanRetainedDocument();}}>
                  <input value={retainedScanInput} placeholder="Bipe ou digite o MD-e ou CT-e Parceiro" inputMode="numeric" onChange={(event) => setRetainedScanInput(event.target.value)} />
                  <button className="primary" disabled={!retainedScanInput.trim()}>Localizar retido</button>
                </form>
                {retainedRomaneioDocuments.length ? (
                  <div className="retained-list">
                    {retainedRomaneioDocuments.map((record) => {
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
                  <div className="empty romaneio-empty"><span>✓</span><h3>Nenhum documento retido</h3><p>Os documentos marcados como Retido aparecerão aqui automaticamente.</p></div>
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
                    {visibleFullRomaneioGroups.map((group) => {
                      const routeLabel =
                        romaneioRouteLabels[group.key] ||
                        group.routes.join(" · ") ||
                        "Sem rota";
                      const savedProduction = savedRomaneioProduction(group);
                      const operationalDocumentCount =
                        romaneioOperationalDocumentCount(group);
                      const pendingCount = group.documents.filter(
                        (document) => !romaneioDocumentStatuses[document.key],
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
                            <span>
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
                                const saved = romaneioDocumentStatuses[document.key];
                                const city = document.city || routeLabel;
                                return (
                                  <div className="daily-document-row" key={document.key}>
                                    <span className="document-id">
                                      <strong>{document.referenceType} {document.referenceNumber}</strong>
                                      <small>{document.document}{document.cte ? ` · CT-e ${document.cte}` : ""}{document.invoice ? ` · NF ${document.invoice}` : ""}</small>
                                      <small className={document.linkedEntries.length ? "link-ok" : "link-warning"}>
                                        Aviso temporario: {document.linkWarning}
                                      </small>
                                    </span>
                                    <span><strong>{document.sender || saved?.sender || "Aguardando relatório geral"}</strong></span>
                                    <span><strong>{document.recipient || saved?.recipient || "Aguardando relatório geral"}</strong><small>{city || saved?.city || "Sem cidade"}</small></span>
                                    <span className="document-values"><strong>{document.grossFreight ? money(document.grossFreight) : "Sem frete individual"}</strong><small>{document.grossFreight ? `${money(document.production)} após -13%` : "Usa frete total quando gravado"}</small></span>
                                    <span className="document-saved-status">
                                      <b className={saved ? "status-closed" : "status-open"}>
                                        {saved ? romaneioSituationLabel[saved.situation] : "Aberto"}
                                      </b>
                                      {saved?.reason ? <small>Motivo: {saved.reason}</small> : null}
                                      {saved ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            undoRomaneioDocumentStatus(document.key)
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
        {(tab === "preview" || tab === "export") && (
          <>
            <div className="romaneio-subtabs partner-closing-subtabs">
              <button type="button" className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>Prévia</button>
              <button type="button" className={tab === "export" ? "active" : ""} onClick={() => setTab("export")}>Exportar</button>
            </div>
            <div className="toolbar">
              <div>
                <small>PERÍODO DO FECHAMENTO</small>
                <h2>
                  {tab === "preview"
                    ? "Prévia por transportadora"
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
            {!partners.length ? (
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
                            aria-label="Exportar apenas documentos bipados"
                            checked={optionalScanPartnerIds.includes(active.id)}
                            onChange={(event) =>
                              toggleOptionalPartnerScan(
                                active.id,
                                event.target.checked,
                              )
                            }
                          />
                          <label htmlFor={`optional-scan-${active.id}`}>
                            <strong>Exportar apenas documentos bipados</strong>
                            <small>
                              Desmarcado: exporta normalmente, sem exigir bipagem.
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
                            {active.rows.filter(isScanned).length} de{" "}
                            {active.rows.length} com OK
                            {pendingScanKeys(active).length
                              ? ` · ${pendingScanKeys(active).length} aguardando`
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
                            type="text"
                            inputMode="numeric"
                            value={scanInput}
                            placeholder="Bipe ou digite o CTE"
                            onChange={(event) => setScanInput(event.target.value)}
                          />
                          <button className="primary" disabled={!scanInput.trim()}>
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
                          {active.rows.filter(isScanned).length ? (
                            active.rows.filter(isScanned).map((entry) => (
                              <div key={entry.id}>
                                <span className="scan-ok">OK</span>
                                <strong>CTE {entry.cte}</strong>
                                <small>NF {entry.invoice || "não informada"}</small>
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeScan(
                                      active.id,
                                      matchedScanKey(entry) || entry.cte,
                                    )
                                  }
                                >
                                  Desmarcar
                                </button>
                              </div>
                            ))
                          ) : !pendingScanKeys(active).length ? (
                            <p>Nenhum documento bipado neste período.</p>
                          ) : null}
                          {pendingScanKeys(active).map((key) => (
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
                        {active.rows.some((entry) => !isScanned(entry)) && (
                          <div className="scan-missing">
                            <div className="scan-missing-heading">
                              <div>
                                <small>FALTARAM NA BIPAGEM</small>
                                <strong>Selecione manualmente se necessário</strong>
                              </div>
                              <b>
                                {
                                  active.rows.filter(
                                    (entry) => !isScanned(entry),
                                  ).length
                                }{" "}
                                sem OK
                              </b>
                            </div>
                            <div className="scan-checklist">
                              {active.rows
                                .filter((entry) => !isScanned(entry))
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
                            <strong>Validar arquivo da Pajussara</strong>
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
                                  foram encontrados no fechamento da Pajussara.
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
                              rowsForClosing(active)
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
                              rowsForClosing(active)
                                .map((r) => r.cte)
                                .filter(Boolean),
                            ).size
                          }
                        </strong>
                      </article>
                      <article>
                        <small>Reentregas</small>
                        <strong>
                          {rowsForClosing(active).filter((r) => r.isRedelivery).length}
                        </strong>
                      </article>
                    </div>
                    <div className="grand-total">
                      <small>VALOR DO FECHAMENTO</small>
                      <strong>
                        {money(
                          rowsForClosing(active).reduce(
                            (sum, row) => sum + totalOf(row),
                            0,
                          ),
                        )}
                      </strong>
                      <p>Valor do Frete + TDE</p>
                    </div>
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
                  {partners.map((partner) => (
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
                          {rowsForClosing(partner).length} registros ·{" "}
                          {money(
                            rowsForClosing(partner).reduce(
                              (sum, row) => sum + totalOf(row),
                              0,
                            ),
                          )}
                        </small>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="export-footer">
                  <div>
                    <small>TOTAL SELECIONADO</small>
                    <strong>
                      {money(
                        partners
                          .filter((p) => selectedExports.includes(p.id))
                          .flatMap(rowsForClosing)
                          .reduce((sum, row) => sum + totalOf(row), 0),
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
                    value={romaneioPickupConfirmation.quantity}
                    placeholder="0"
                    onChange={(event) =>
                      setRomaneioPickupConfirmation((current) =>
                        current
                          ? { ...current, quantity: event.target.value }
                          : current,
                      )
                    }
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
                      Math.floor(Number(confirmation.quantity || 0)),
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
                    : "Esses documentos ainda não receberam uma situação. Todos precisam estar como Entregue ou com ocorrência antes de gravar."}
                </p>
              </div>
              <div className="romaneio-alert-actions">
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
        {message && (
          <button
            className={`message ${messageIsError ? "message-error" : "message-info"}`}
            onClick={() => {
              setMessage("");
              setMessageIsError(false);
            }}
          >
            {message}
            <span>×</span>
          </button>
        )}
      </section>
    </main>
  );
}
