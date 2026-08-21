"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { exportClosingXlsx, readClosingFile } from "./excel";

type Tab = "import" | "preview" | "export";
type Entry = {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerRaw: string;
  partnerCnpj: string;
  status: string;
  date: string;
  deliveryDate: string;
  cte: string;
  cteKey: string;
  invoice: string;
  sender: string;
  senderCnpj: string;
  recipient: string;
  recipientCnpj: string;
  city: string;
  observation: string;
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
};
type ImportInfo = {
  file: string;
  imported: number;
  redeliveries: number;
  unidentified: number;
  excluded: number;
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
  ["maex", "Maex", ["maex"]],
  ["displan", "Displan", ["displan"]],
  ["trd", "TRD", ["trd transporte", "trd"]],
  ["dy", "D&Y", ["d e y", "dey", "d y"]],
  ["pajucara", "Pajuçara", ["pajucar", "pajucara"]],
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
const scanPartnerIds = new Set(["trd", "argius", "dy"]);
const scanKey = (value?: string) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
function identifyPartner(raw: string) {
  const text = normalized(raw);
  const match = partnerAliases.find(([, , aliases]) =>
    aliases.some((alias) => text.includes(alias)),
  );
  if (match) return { id: match[0], name: match[1] };
  if (!text) return { id: "unidentified", name: "Não identificado" };
  return { id: `custom-${text.replace(/\s+/g, "-")}`, name: raw.trim() };
}
const unidentifiedKey = (entry: Entry) =>
  normalized(entry.partnerCnpj || entry.partnerRaw || entry.sender || "sem-dados");
const totalOf = (entry: Entry) =>
  Math.max(0, entry.reportedTotal ?? entry.freight);
const periodName = (date: string) => {
  const value = new Date(
    `${date || new Date().toISOString().slice(0, 10)}T12:00:00`,
  );
  return `${value.getDate() <= 15 ? "1ª" : "2ª"} Quinzena de ${value.toLocaleDateString("pt-BR", { month: "long" })} de ${value.getFullYear()}`;
};

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
  const [hydrated, setHydrated] = useState(false);
  const [assignmentChoices, setAssignmentChoices] = useState<
    Record<string, string>
  >({});
  const [newPartnerNames, setNewPartnerNames] = useState<
    Record<string, string>
  >({});
  const [scanInput, setScanInput] = useState("");
  const [scannedCtes, setScannedCtes] = useState<
    Record<string, Record<string, string>>
  >({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem("gmobs-closing-v3");
        if (saved) setEntries(JSON.parse(saved));
        const savedScans = localStorage.getItem("gmobs-scanned-ctes-v1");
        if (savedScans) setScannedCtes(JSON.parse(savedScans));
      } catch {
        /* começa vazio se o armazenamento estiver inválido */
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (hydrated)
      localStorage.setItem("gmobs-closing-v3", JSON.stringify(entries));
  }, [entries, hydrated]);
  useEffect(() => {
    if (hydrated)
      localStorage.setItem(
        "gmobs-scanned-ctes-v1",
        JSON.stringify(scannedCtes),
      );
  }, [scannedCtes, hydrated]);

  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (!dateFrom || !entry.date || entry.date >= dateFrom) &&
          (!dateTo || !entry.date || entry.date <= dateTo),
      ),
    [entries, dateFrom, dateTo],
  );
  const partners = useMemo(() => {
    const map = new Map<string, { id: string; name: string; rows: Entry[] }>();
    filtered.forEach((entry) => {
      const current = map.get(entry.partnerId) || {
        id: entry.partnerId,
        name: entry.partnerName,
        rows: [],
      };
      current.rows.push(entry);
      map.set(entry.partnerId, current);
    });
    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
  }, [filtered]);
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

  async function importExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setMessage("");
    try {
      const result = await readClosingFile(file);
      const seen = new Set<string>();
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
        return {
          id: crypto.randomUUID(),
          partnerId: partner.id,
          partnerName: partner.name,
          partnerRaw: row.partner,
          partnerCnpj: row.partnerCnpj,
          status: row.status,
          date: row.date,
          deliveryDate: row.deliveryDate,
          cte: row.cte,
          cteKey: row.cteKey,
          invoice: row.invoice,
          sender: row.sender,
          senderCnpj: row.senderCnpj,
          recipient: row.recipient,
          recipientCnpj: row.recipientCnpj,
          city: row.city,
          observation: row.observation,
          freight: row.freight,
          partnerFreight: row.partnerFreight,
          tde: row.tde,
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
    chosen.forEach((partner) => {
      const exportRows = rowsForClosing(partner);
      if (!exportRows.length) {
        skipped.push(partner.name);
        return;
      }
      exportClosingXlsx(
        exportRows.map((entry) => ({
          partner: partner.name,
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
          cte: entry.cte,
          cteKey: entry.cteKey,
          invoice: entry.invoice,
          sender: entry.sender,
          senderCnpj: entry.senderCnpj,
          recipient: entry.recipient,
          recipientCnpj: entry.recipientCnpj,
          city: entry.city,
          observation: entry.observation,
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
        })),
        partner.name,
        period,
      );
      generated++;
    });
    setMessage(
      `${generated} arquivo(s) gerado(s).${
        skipped.length
          ? ` Sem documentos bipados: ${skipped.join(", ")}.`
          : ""
      }`,
    );
  }

  return (
    <main className="shell">
      <header className="header">
        <div>
          <span>GMOBS</span>
          <h1>Fechamentos</h1>
        </div>
        <p>Dados salvos neste computador</p>
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
              <h2>Importe o relatório geral</h2>
              <p>
                Envie uma planilha com todas as transportadoras. Apenas entregas
                e reentregas entrarão no fechamento.
              </p>
            </div>
            <input
              ref={inputRef}
              hidden
              type="file"
              accept=".xls,.xlsx,.csv"
              onChange={importExcel}
            />
            <button
              className="upload"
              disabled={importing}
              onClick={() => inputRef.current?.click()}
            >
              <span>↑</span>
              <strong>
                {importing ? "Lendo a planilha..." : "Selecionar planilha"}
              </strong>
              <small>Excel .xls, .xlsx ou .csv</small>
            </button>
            {importInfo && (
              <div className="import-summary">
                <div>
                  <small>ÚLTIMO ARQUIVO</small>
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
                    <dt>Fora do fechamento</dt>
                    <dd>{importInfo.excluded}</dd>
                  </div>
                  <div>
                    <dt>Sem parceira</dt>
                    <dd>{importInfo.unidentified}</dd>
                  </div>
                </dl>
              </div>
            )}
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
            {!partners.length ? (
              <div className="empty">
                <span>□</span>
                <h3>Nenhum dado para mostrar</h3>
                <p>Importe uma planilha ou altere o período selecionado.</p>
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
                            autoFocus
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
                      <p>Soma da coluna Valor do Frete do relatório</p>
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
