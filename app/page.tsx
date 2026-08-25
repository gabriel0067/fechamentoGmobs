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
  exportMaexAdditionalXlsx,
  exportPajussaraMissingXlsx,
  normalizeCnpj,
  normalizeInvoiceKey,
  readBilledClosingFile,
  readClosingFile,
  readPajussaraClosingFile,
  readTdeFile,
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

type Tab = "import" | "preview" | "export";
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
};
type ImportInfo = {
  file: string;
  imported: number;
  redeliveries: number;
  unidentified: number;
  excluded: number;
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
const parseMoney = (value: string) => {
  const raw = value.replace(/R\$/gi, "").replace(/\s/g, "");
  const normalizedValue = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalizedValue.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
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
  const [selectedPartner, setSelectedPartner] = useState("");
  const [selectedExports, setSelectedExports] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [importInfo, setImportInfo] = useState<ImportInfo | null>(null);
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [importingTde, setImportingTde] = useState(false);
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
  const [tdeRates, setTdeRates] = useState<TdeRateRecord[]>([]);
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
  const scanTxtInputRef = useRef<HTMLInputElement>(null);
  const pajussaraInputRef = useRef<HTMLInputElement>(null);
  const billedInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const cloudWritesRef = useRef(0);
  const cloudSaveFailedRef = useRef(false);
  const cloudVersionsRef = useRef<Partial<Record<CloudStateKey, string>>>({});
  const skipCloudSaveRef = useRef(new Set<CloudStateKey>());

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
        let savedEntries: Entry[] | null = null;
        let savedBilledDocuments: Record<string, BilledDocumentRecord> | null =
          null;
        try {
          const indexedEntries = await readClosingStorage<Entry[]>();
          if (Array.isArray(indexedEntries)) {
            savedEntries = indexedEntries;
            try {
              localStorage.removeItem(CLOSING_STORAGE_KEY);
            } catch {
              /* a cópia principal já foi recuperada do IndexedDB */
            }
          }
        } catch {
          /* tenta o formato antigo logo abaixo */
        }

        if (savedEntries === null) {
          const saved = localStorage.getItem(CLOSING_STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              savedEntries = parsed;
              try {
                await writeClosingStorage(parsed);
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
        const savedTde = localStorage.getItem("gmobs-tde-rates-v1");
        const parsedTde = savedTde ? JSON.parse(savedTde) : null;
        const savedMaexAdditional = localStorage.getItem(
          "gmobs-maex-additional-senders-v1",
        );
        const parsedMaexAdditional = savedMaexAdditional
          ? JSON.parse(savedMaexAdditional)
          : null;

        if (cancelled) return;
        if (savedEntries) setEntries(normalizeSavedEntries(savedEntries));
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

        const [closingRecord, scansRecord, tdeRecord, maexRecord, billedRecord] =
          await Promise.all([
            loadCloudStateRecord<{
              entries: Entry[];
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
          ]);
        if (cancelled) return;

        const closing = closingRecord?.value;
        if (closing?.entries && Array.isArray(closing.entries)) {
          setEntries(normalizeSavedEntries(closing.entries));
          setImportInfo(closing.importInfo || null);
          cloudVersionsRef.current.closing = closingRecord.version;
        } else {
          cloudVersionsRef.current.closing = await saveCloudState("closing", {
            entries: [],
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
    void writeClosingStorage(entries)
      .then(() => {
        try {
          localStorage.removeItem(CLOSING_STORAGE_KEY);
        } catch {
          /* o relatório já está salvo no armazenamento de maior capacidade */
        }
      })
      .catch(() => {
        if (!writeLocalStorage(CLOSING_STORAGE_KEY, entries) && !cancelled)
          setMessage(
            "O relatório continua aberto, mas o navegador não conseguiu salvá-lo. Não recarregue a página antes de exportar.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [entries, hydrated]);
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
  const closingCloudState = useMemo(
    () => ({ entries, importInfo }),
    [entries, importInfo],
  );
  const tdeCloudState = useMemo(
    () => ({ rates: tdeRates, importInfo: tdeImportInfo }),
    [tdeImportInfo, tdeRates],
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
            importInfo: ImportInfo | null;
          }>(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          setEntries(normalizeSavedEntries(record.value.entries || []));
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
        } else {
          const record = await loadCloudStateRecord<
            Record<string, BilledDocumentRecord>
          >(key);
          if (!record) continue;
          skipCloudSaveRef.current.add(key);
          cloudVersionsRef.current[key] = record.version;
          setBilledDocuments(normalizeBilledDocuments(record.value || {}));
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
  const rowsForClosing = (partner: { id: string; rows: Entry[] }) =>
    scanPartnerIds.has(partner.id) ? partner.rows.filter(isScanned) : partner.rows;
  const pendingScanKeys = (partner: { id: string; rows: Entry[] }) =>
    Object.keys(scannedCtes[partner.id] || {}).filter(
      (key) =>
        !partner.rows.some(
          (entry) =>
            scanKey(entry.cteKey) === key || scanKey(entry.cte) === key,
        ),
    );

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
      closing: { entries, importInfo },
      scans: scannedCtes,
      tde: { rates: tdeRates, importInfo: tdeImportInfo },
      maex: maexAdditionalSenders,
      billed: billedDocuments,
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
        closing?: { entries?: Entry[]; importInfo?: ImportInfo | null };
        scans?: Record<string, Record<string, string>>;
        tde?: {
          rates?: TdeRateRecord[];
          importInfo?: TdeImportInfo | null;
        };
        maex?: Record<string, MaexAdditionalSender>;
        billed?: Record<string, BilledDocumentRecord>;
      };
      if (
        backup.product !== "Fechamentos GMOBS" ||
        backup.version !== 1 ||
        !Array.isArray(backup.closing?.entries)
      )
        throw new Error("Este arquivo não é um backup válido do Fechamentos GMOBS.");

      setEntries(normalizeSavedEntries(backup.closing.entries));
      setImportInfo(backup.closing.importInfo || null);
      setScannedCtes(backup.scans || {});
      setTdeRates(Array.isArray(backup.tde?.rates) ? backup.tde.rates : []);
      setTdeImportInfo(backup.tde?.importInfo || null);
      setMaexAdditionalSenders(backup.maex || {});
      setBilledDocuments(normalizeBilledDocuments(backup.billed || {}));
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

  async function importExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setMessage("");
    try {
      const result = await readClosingFile(file);
      const seen = new Set<string>();
      const tdeMap = effectiveTdeRates(tdeRates);
      let redeliveries = 0;
      let unidentified = 0;
      const additions = result.rows.map((row): Entry => {
        const partner = identifyPartner(row.partner);
        const key = `${partner.id}|${row.cte}|${row.invoice}`.toLowerCase();
        const repeated = seen.has(key);
        seen.add(key);
        const isRedelivery = row.isRedelivery || repeated;
        if (isRedelivery) redeliveries++;
        if (partner.id === "unidentified") unidentified++;
        const recipientCnpj = normalizeCnpj(row.recipientCnpj);
        const tde = recipientCnpj
          ? tdeMap.get(`${recipientCnpj}|${partner.id}`) ?? row.tde
          : row.tde;
        return {
          id: crypto.randomUUID(),
          partnerId: partner.id,
          partnerName: partner.name,
          partnerRaw: row.partner,
          partnerCnpj: row.partnerCnpj,
          status: row.status,
          date: row.date,
          deliveryDate: row.deliveryDate,
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
        };
      });
      setEntries(additions);
      setImportInfo({
        file: file.name,
        imported: additions.length,
        redeliveries,
        unidentified,
        excluded: result.excluded,
      });
      setSelectedExports([]);
      setMessage(
        `${additions.length} entregas, reentregas e complementos importados com sucesso.`,
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
      setImportInfo(null);
      setScannedCtes({});
      setTdeRates([]);
      setTdeImportInfo(null);
      setMaexAdditionalSenders({});
      setBilledDocuments({});
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
      ]);
      (["closing", "scans", "tde", "maex", "billed"] as CloudStateKey[])
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
        {(
          [
            ["import", "1", "Importar"],
            ["preview", "2", "Prévia"],
            ["export", "3", "Exportar"],
          ] as const
        ).map(([id, number, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setMessage("");
            }}
          >
            <b>{number}</b>
            {label}
          </button>
        ))}
      </nav>
      <section className="panel">
        {tab === "import" && (
          <div className="import-view">
            <div className="intro">
              <small>PASSO 1</small>
              <h2>Importe o relatório, a tabela de TDE e o histórico</h2>
              <p>
                O relatório traz as entregas. A tabela de TDE procura o CNPJ do
                destinatário, enquanto os fechamentos antigos impedem que um
                documento já faturado seja enviado novamente.
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
            </div>

            <section className="cloud-backup">
              <div>
                <small>BACKUP E TROCA DE COMPUTADOR</small>
                <h3>Leve todos os dados com segurança</h3>
                <p>
                  O backup inclui relatório, bipagens, TDE, remetentes da Maex e
                  documentos já enviados ao faturamento.
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
        {tab !== "import" && (
          <>
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
                    </div>
                    {scanPartnerIds.has(active.id) && (
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
        {message && (
          <button className="message" onClick={() => setMessage("")}>
            {message}
            <span>×</span>
          </button>
        )}
      </section>
    </main>
  );
}
