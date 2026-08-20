"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { exportMultipleClosingsXlsx, readClosingFile } from "./excel";

type Tab = "import" | "preview" | "export";
type Entry = {
  id: string;
  partnerId: string;
  partnerName: string;
  date: string;
  cte: string;
  invoice: string;
  sender: string;
  recipient: string;
  city: string;
  freight: number;
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
];
function identifyPartner(raw: string) {
  const text = normalized(raw);
  const match = partnerAliases.find(([, , aliases]) =>
    aliases.some((alias) => text.includes(alias)),
  );
  if (match) return { id: match[0], name: match[1] };
  if (!text) return { id: "unidentified", name: "Não identificado" };
  return { id: `custom-${text.replace(/\s+/g, "-")}`, name: raw.trim() };
}
const totalOf = (entry: Entry) =>
  entry.reportedTotal ??
  Math.max(
    0,
    entry.freight +
      entry.tde +
      entry.tda +
      entry.trt +
      entry.redelivery +
      entry.dedicated +
      entry.adjustment,
  );
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem("gmobs-closing-v3");
        if (saved) setEntries(JSON.parse(saved));
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
          date: row.date,
          cte: row.cte,
          invoice: row.invoice,
          sender: row.sender,
          recipient: row.recipient,
          city: row.city,
          freight: row.freight,
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
        `${additions.length} entregas e reentregas importadas com sucesso.`,
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
    exportMultipleClosingsXlsx(
      chosen.map((partner) => ({
        partnerName: partner.name,
        rows: partner.rows.map((entry) => ({
          partner: partner.name,
          occurrence: entry.isRedelivery ? "RE" : "",
          status: entry.isRedelivery ? "RE" : "ET",
          statusDescription: entry.isRedelivery ? "REENTREGA" : "ENTREGUE",
          eligible: true,
          isRedelivery: entry.isRedelivery,
          date: entry.date,
          cte: entry.cte,
          invoice: entry.invoice,
          sender: entry.sender,
          recipient: entry.recipient,
          city: entry.city,
          freight: entry.freight,
          tde: entry.tde,
          tda: entry.tda,
          trt: entry.trt,
          redelivery: entry.redelivery,
          dedicated: entry.dedicated,
          adjustment: entry.adjustment,
          reportedTotal: entry.reportedTotal,
          total: totalOf(entry),
        })),
      })),
      periodName(lastDate),
    );
    setMessage(`Arquivo gerado para ${chosen.length} transportadora(s).`);
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
                    <div className="metrics">
                      <article>
                        <small>Notas</small>
                        <strong>
                          {
                            new Set(
                              active.rows.map((r) => r.invoice).filter(Boolean),
                            ).size
                          }
                        </strong>
                      </article>
                      <article>
                        <small>Minutas / CTEs</small>
                        <strong>
                          {
                            new Set(
                              active.rows.map((r) => r.cte).filter(Boolean),
                            ).size
                          }
                        </strong>
                      </article>
                      <article>
                        <small>Reentregas</small>
                        <strong>
                          {active.rows.filter((r) => r.isRedelivery).length}
                        </strong>
                      </article>
                    </div>
                    <div className="grand-total">
                      <small>VALOR DO FECHAMENTO</small>
                      <strong>
                        {money(
                          active.rows.reduce(
                            (sum, row) => sum + totalOf(row),
                            0,
                          ),
                        )}
                      </strong>
                      <p>Frete Valor + TDE + TDA + TRT e demais acréscimos</p>
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
                          {partner.rows.length} registros ·{" "}
                          {money(
                            partner.rows.reduce(
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
                          .flatMap((p) => p.rows)
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
