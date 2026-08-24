import XLSX from "xlsx-js-style";

export type ImportedRow = {
  partner: string;
  partnerCnpj: string;
  occurrence: string;
  status: string;
  statusDescription: string;
  eligible: boolean;
  isRedelivery: boolean;
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
  reportedTotal?: number;
};

export type ImportedTdeClient = {
  name: string;
  cnpj: string;
  rates: Array<{ partner: string; value: number }>;
};

export type PajussaraClosingDocument = {
  date: string;
  cte: string;
  invoice: string;
  invoiceKey: string;
  sender: string;
  recipient: string;
  city: string;
  commission: number;
};

export type BilledClosingDocument = {
  cte: string;
  invoice: string;
};

export type BilledClosingImport = {
  partner: string;
  sheet: string;
  documents: BilledClosingDocument[];
};

const aliases: Record<keyof ImportedRow, string[]> = {
  partner: [
    "parceiro",
    "parceira",
    "transportadora",
    "empresa parceira",
    "prestador",
    "agregado",
    "nome redespacho",
  ],
  partnerCnpj: [],
  occurrence: [
    "tipo",
    "ocorrencia",
    "ocorrência",
    "evento",
    "servico",
    "serviço",
    "status",
    "situacao",
    "situação",
  ],
  isRedelivery: [],
  status: ["status"],
  statusDescription: ["descricao status", "descrição status"],
  eligible: [],
  date: [
    "data",
    "entrada",
    "data entrada",
    "data entrega",
    "entrega",
    "dt entrega",
    "data emissao",
    "data emissão",
  ],
  deliveryDate: ["data entrega", "dt entrega"],
  mde: ["mde", "documento"],
  cte: [
    "cte",
    "ct e",
    "ct-e",
    "ct e parceiro",
    "conhecimento",
    "documento",
    "numero cte",
    "n cte",
  ],
  cteKey: ["chave ct e parceiro", "chave cte parceiro"],
  invoice: [
    "nf",
    "nota fiscal",
    "notas fiscais serie",
    "minuta",
    "minuta nf",
    "numero nf",
    "n nota",
  ],
  sender: ["remetente", "origem", "cliente origem"],
  senderCnpj: [],
  recipient: ["destinatario", "destinatário", "recebedor", "cliente destino"],
  recipientCnpj: [],
  city: ["cidade", "destino", "municipio", "município", "rota"],
  observation: ["observacao", "observação"],
  weight: ["peso"],
  volumes: ["volumes", "volume", "vol"],
  freight: [
    "frete",
    "frete parceiro",
    "valor frete",
    "frete dy",
    "frete d y",
    "frete base",
    "frete valor",
  ],
  partnerFreight: ["valor frete parceiro", "frete parceiro"],
  tde: ["tde", "tds", "t d e", "t d s", "taxa dificuldade entrega"],
  tda: ["tda", "t d a", "taxa adicional"],
  trt: ["trt", "t r t"],
  redelivery: ["reentrega", "re entrega", "valor reentrega"],
  dedicated: ["dedicado", "dedicada", "valor dedicado"],
  adjustment: ["ajuste", "acrescimo", "acréscimo", "desconto"],
  reportedTotal: [
    "valor do frete",
    "total comissao",
    "total comissão",
    "comissao",
    "comissão",
    "valor comissao",
  ],
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "")
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
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
  const firstPart = String(value ?? "")
    .trim()
    .split(/\s+-\s+|\s+serie\s+|\//i)[0];
  const digits = firstPart.replace(/\D/g, "").replace(/^0+/, "");
  return digits || (firstPart.includes("0") ? "0" : "");
};
const optionalNumber = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  if (!/\d/.test(String(value))) return null;
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const excelDate = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d)
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  const br = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br)
    return `${br[3].length === 2 ? `20${br[3]}` : br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toISOString().slice(0, 10);
};

export async function readClosingFile(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: false,
  });
  let best: {
    rows: unknown[][];
    header: number;
    map: Partial<Record<keyof ImportedRow, number>>;
    sheet: string;
    score: number;
  } | null = null;
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      { header: 1, defval: "", raw: true },
    );
    for (let i = 0; i < Math.min(rows.length, 35); i++) {
      const map: Partial<Record<keyof ImportedRow, number>> = {};
      rows[i].forEach((cell, column) => {
        const header = normalize(cell);
        (Object.keys(aliases) as (keyof ImportedRow)[]).forEach((key) => {
          if (
            map[key] === undefined &&
            aliases[key].some((alias) => normalize(alias) === header)
          )
            map[key] = column;
        });
      });
      const headerAt = (name: string) =>
        rows[i].findIndex((cell) => normalize(cell) === normalize(name));
      const remetente = headerAt("CNPJ Remetente");
      const destinatario = headerAt("CNPJ Destinatario");
      const redespacho = headerAt("CNPJ Redespacho");
      const cteParceiro = headerAt("CT-e Parceiro");
      const chaveCteParceiro = headerAt("Chave CT-e Parceiro");
      if (remetente >= 0) map.sender = remetente + 1;
      if (remetente >= 0) map.senderCnpj = remetente;
      if (destinatario >= 0) {
        map.recipientCnpj = destinatario;
        map.recipient = destinatario + 1;
        map.city = destinatario + 2;
      }
      if (redespacho >= 0) map.partner = redespacho + 1;
      if (redespacho >= 0) map.partnerCnpj = redespacho;
      if (cteParceiro >= 0) map.cte = cteParceiro;
      if (chaveCteParceiro >= 0) map.cteKey = chaveCteParceiro;
      const score =
        Object.keys(map).length +
        (map.cte !== undefined ? 3 : 0) +
        (map.invoice !== undefined ? 2 : 0) +
        (map.freight !== undefined ? 3 : 0);
      if (!best || score > best.score)
        best = { rows, header: i, map, sheet: sheetName, score };
    }
  }
  if (
    !best ||
    best.score < 4 ||
    (best.map.cte === undefined && best.map.invoice === undefined)
  )
    throw new Error(
      "Não encontrei uma linha de títulos com CTE, NF ou Minuta.",
    );
  const value = (row: unknown[], key: keyof ImportedRow) =>
    best!.map[key] === undefined ? "" : row[best!.map[key]!];
  const imported = best.rows
    .slice(best.header + 1)
    .map((row) => {
      const result: ImportedRow = {
        partner: String(value(row, "partner") ?? "").trim(),
        partnerCnpj: String(value(row, "partnerCnpj") ?? "").trim(),
        occurrence: String(value(row, "occurrence") ?? "").trim(),
        status: String(value(row, "status") ?? "").trim(),
        statusDescription: String(value(row, "statusDescription") ?? "").trim(),
        eligible: true,
        isRedelivery: false,
        date: excelDate(value(row, "date")),
        deliveryDate: excelDate(value(row, "deliveryDate")),
        mde: String(value(row, "mde") ?? "").trim(),
        cte: String(value(row, "cte") ?? "").trim(),
        cteKey: String(value(row, "cteKey") ?? "").trim(),
        invoice: String(value(row, "invoice") ?? "").trim(),
        sender: String(value(row, "sender") ?? "").trim(),
        senderCnpj: String(value(row, "senderCnpj") ?? "").trim(),
        recipient: String(value(row, "recipient") ?? "").trim(),
        recipientCnpj: String(value(row, "recipientCnpj") ?? "").trim(),
        city: String(value(row, "city") ?? "").trim(),
        observation: String(value(row, "observation") ?? "").trim(),
        weight: toNumber(value(row, "weight")),
        volumes: toNumber(value(row, "volumes")),
        freight: toNumber(value(row, "freight")),
        partnerFreight: toNumber(value(row, "partnerFreight")),
        tde: toNumber(value(row, "tde")),
        tda: toNumber(value(row, "tda")),
        trt: toNumber(value(row, "trt")),
        redelivery: toNumber(value(row, "redelivery")),
        dedicated: toNumber(value(row, "dedicated")),
        adjustment: toNumber(value(row, "adjustment")),
      };
      result.isRedelivery = /(^|[^A-Z0-9])RE([^A-Z0-9]|$)/.test(
        `${result.status} ${result.statusDescription} ${result.occurrence} ${result.cte} ${result.invoice}`.toUpperCase(),
      );
      const statusCode = normalize(result.status);
      const statusText = normalize(result.statusDescription);
      result.eligible =
        (!statusCode && !statusText) ||
        statusCode === "et" ||
        statusCode === "re" ||
        statusCode === "cf" ||
        statusText === "entregue" ||
        statusText === "reentrega" ||
        statusText === "complemento de frete";
      if (
        best!.map.reportedTotal !== undefined &&
        value(row, "reportedTotal") !== ""
      )
        result.reportedTotal = toNumber(value(row, "reportedTotal"));
      return result;
    })
    .filter(
      (row) =>
        (row.cte || row.invoice) &&
        !normalize(row.cte).includes("total") &&
        !normalize(row.invoice).includes("total"),
    );
  const eligible = imported.filter((row) => row.eligible);
  if (!eligible.length)
    throw new Error(
      "A planilha foi reconhecida, mas não encontrei documentos nas linhas abaixo do cabeçalho.",
    );
  return {
    rows: eligible,
    excluded: imported.length - eligible.length,
    sheet: best.sheet,
    recognized: (Object.keys(best.map) as (keyof ImportedRow)[]).map(
      (key) => aliases[key][0],
    ),
  };
}

const billedCteHeaders = new Set([
  "cte",
  "ct e",
  "ct e parceiro",
  "conhecimento",
  "numero cte",
  "n cte",
]);
const billedInvoiceHeaders = new Set([
  "nf",
  "nota fiscal",
  "notas fiscais serie",
  "minuta",
  "minuta nf",
  "numero nf",
  "n nota",
]);
const identifierText = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value))
    return Number.isInteger(value) ? String(Math.trunc(value)) : String(value);
  return String(value ?? "").trim();
};
const inferBilledPartner = (fileName: string, rows: unknown[][]) => {
  const fileContent = normalize(fileName);
  const headingContent = normalize(
    rows
      .slice(0, 10)
      .flat()
      .filter((cell) => typeof cell === "string")
      .join(" "),
  );
  const fileWords = new Set(fileContent.split(" "));
  if (
    fileContent.includes("custos extras") ||
    fileContent.includes("argius") ||
    headingContent.includes("parceiro argius")
  )
    return "Argius";
  if (
    fileContent.includes("maex") ||
    fileContent.includes("mardonio") ||
    headingContent.includes("parceiro maex") ||
    headingContent.includes("fechamento maex")
  )
    return "Maex";
  if (
    fileWords.has("trd") ||
    headingContent.includes("parceiro trd") ||
    headingContent.includes("frete trd")
  )
    return "TRD";
  if (
    fileContent.includes("displan") ||
    headingContent.includes("parceiro displan") ||
    headingContent.includes("frete displan")
  )
    return "Displan";
  if (
    fileContent.includes("d y") ||
    fileContent.includes("d e y") ||
    fileWords.has("dey") ||
    fileWords.has("arc") ||
    headingContent.includes("parceiro d y") ||
    headingContent.includes("parceiro arc")
  )
    return "D&Y";
  if (
    fileContent.includes("fitlog") ||
    headingContent.includes("parceiro fitlog") ||
    headingContent.includes("frete fitlog")
  )
    return "Fitlog";
  if (fileContent.includes("pajussara") || fileContent.includes("pajucara"))
    return "PAJUSSARA";
  if (fileContent.includes("rio vermelho")) return "Rio Vermelho";
  if (
    fileContent.includes("tadex") ||
    fileContent.includes("tadlog") ||
    fileWords.has("simb") ||
    fileWords.has("simbax") ||
    fileWords.has("stx")
  )
    return "Tadex";
  if (fileContent.includes("ttjb")) return "TTJB";
  if (fileContent.includes("lovato")) return "Lovato";
  return "";
};

export async function readBilledClosingFile(
  file: File,
): Promise<BilledClosingImport> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: false,
  });
  let best: BilledClosingImport | null = null;

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      { header: 1, defval: "", raw: true },
    );
    for (let header = 0; header < Math.min(rows.length, 35); header++) {
      const titles = rows[header].map(normalize);
      const cteColumn = titles.findIndex((title) =>
        billedCteHeaders.has(title),
      );
      const invoiceColumn = titles.findIndex((title) =>
        billedInvoiceHeaders.has(title),
      );
      if (cteColumn < 0 || invoiceColumn < 0) continue;

      const documents = rows
        .slice(header + 1)
        .map((row) => ({
          cte: identifierText(row[cteColumn]),
          invoice: identifierText(row[invoiceColumn]),
        }))
        .filter(
          (document) =>
            Boolean(document.cte) &&
            !["total", "subtotal"].includes(normalize(document.cte)),
        );
      if (!documents.length) continue;
      const candidate = {
        partner: inferBilledPartner(file.name, rows),
        sheet: sheetName,
        documents,
      };
      if (!best || candidate.documents.length > best.documents.length)
        best = candidate;
    }
  }

  if (!best)
    throw new Error(`Não encontrei as colunas CTE e NF em ${file.name}.`);
  if (!best.partner)
    throw new Error(
      `Não consegui identificar a transportadora de ${file.name}. Inclua o nome da parceira no arquivo.`,
    );
  return best;
}

export async function readTdeFile(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: false,
  });
  let best: {
    rows: unknown[][];
    header: number;
    sheet: string;
    nameColumn: number;
    cnpjColumn: number;
    rateColumns: Array<{ column: number; partner: string }>;
    score: number;
  } | null = null;

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      { header: 1, defval: "", raw: true },
    );
    for (let header = 0; header < Math.min(rows.length, 20); header++) {
      const titles = rows[header].map((cell) => normalize(cell));
      const nameColumn = titles.findIndex((title) =>
        ["nome", "razao social", "cliente"].includes(title),
      );
      const cnpjColumn = titles.findIndex((title) => title === "cnpj");
      if (nameColumn < 0 || cnpjColumn < 0) continue;

      const sampleRows = rows.slice(header + 1, header + 16);
      const rateColumns = rows[header]
        .map((cell, column) => ({
          column,
          partner: String(cell ?? "").trim(),
        }))
        .filter(
          ({ column, partner }) =>
            column !== nameColumn &&
            column !== cnpjColumn &&
            Boolean(normalize(partner)) &&
            sampleRows.some(
              (row) => optionalNumber(row[column]) !== null,
            ),
        );
      const validCnpjs = sampleRows.filter((row) =>
        normalizeCnpj(row[cnpjColumn]),
      ).length;
      const score = rateColumns.length * 5 + validCnpjs;
      if (rateColumns.length && (!best || score > best.score)) {
        best = {
          rows,
          header,
          sheet: sheetName,
          nameColumn,
          cnpjColumn,
          rateColumns,
          score,
        };
      }
    }
  }

  if (!best)
    throw new Error(
      "Não encontrei as colunas NOME, CNPJ e as taxas por transportadora na lista de TDE.",
    );

  const clientsByCnpj = new Map<string, ImportedTdeClient>();
  for (const row of best.rows.slice(best.header + 1)) {
    const cnpj = normalizeCnpj(row[best.cnpjColumn]);
    if (!cnpj) continue;
    const name = String(row[best.nameColumn] ?? "").trim();
    const current = clientsByCnpj.get(cnpj) || { name, cnpj, rates: [] };
    if (!current.name && name) current.name = name;
    best.rateColumns.forEach(({ column, partner }) => {
      const amount = optionalNumber(row[column]);
      if (amount === null) return;
      const existing = current.rates.find(
        (rate) => normalize(rate.partner) === normalize(partner),
      );
      if (existing) existing.value = amount;
      else current.rates.push({ partner, value: amount });
    });
    clientsByCnpj.set(cnpj, current);
  }

  const clients = [...clientsByCnpj.values()].filter(
    (client) => client.rates.length,
  );
  if (!clients.length)
    throw new Error(
      "A lista de TDE foi reconhecida, mas não encontrei clientes com CNPJ e taxa preenchidos.",
    );

  return {
    clients,
    sheet: best.sheet,
    partners: best.rateColumns.map((column) => column.partner),
  };
}

export async function readPajussaraClosingFile(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: false,
  });
  let best: {
    rows: unknown[][];
    header: number;
    sheet: string;
    dateColumn: number;
    cteColumn: number;
    invoiceColumn: number;
    senderColumn: number;
    recipientColumn: number;
    cityColumn: number;
    commissionColumn: number;
  } | null = null;

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      { header: 1, defval: "", raw: true },
    );
    for (let header = 0; header < Math.min(rows.length, 40); header++) {
      const titles = rows[header].map((cell) => normalize(cell));
      const cteColumn = titles.findIndex(
        (title) => title === "ctrc subc" || title.includes("ctrc subc"),
      );
      const invoiceColumn = titles.findIndex((title) => title === "nf");
      if (cteColumn < 0 || invoiceColumn < 0) continue;
      best = {
        rows,
        header,
        sheet: sheetName,
        dateColumn: titles.findIndex((title) => title === "emissao"),
        cteColumn,
        invoiceColumn,
        senderColumn: titles.findIndex((title) => title === "remetente"),
        recipientColumn: titles.findIndex((title) => title === "pagador"),
        cityColumn: titles.findIndex((title) => title === "destino"),
        commissionColumn: titles.findIndex((title) => title === "val comis"),
      };
      break;
    }
    if (best) break;
  }

  if (!best)
    throw new Error(
      "Não encontrei as colunas CTRC/SUBC e NF no fechamento da Pajussara.",
    );

  const cell = (row: unknown[], column: number) =>
    column < 0 ? "" : row[column];
  const documents: PajussaraClosingDocument[] = [];
  for (const row of best.rows.slice(best.header + 1)) {
    const firstCell = normalize(row[0]);
    if (
      documents.length &&
      ["expedido", "recebido", "total"].includes(firstCell)
    )
      break;
    const cte = String(cell(row, best.cteColumn) ?? "").trim();
    const invoice = String(cell(row, best.invoiceColumn) ?? "").trim();
    const invoiceKey = normalizeInvoiceKey(invoice);
    if (!cte || !invoiceKey || cte.includes("---")) continue;
    documents.push({
      date: excelDate(cell(row, best.dateColumn)),
      cte,
      invoice,
      invoiceKey,
      sender: String(cell(row, best.senderColumn) ?? "").trim(),
      recipient: String(cell(row, best.recipientColumn) ?? "").trim(),
      city: String(cell(row, best.cityColumn) ?? "").trim(),
      commission: toNumber(cell(row, best.commissionColumn)),
    });
  }

  if (!documents.length)
    throw new Error(
      "O fechamento da Pajussara foi reconhecido, mas não encontrei documentos abaixo do cabeçalho.",
    );

  const period = workbook.SheetNames.flatMap((sheetName) =>
    XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: false,
    }),
  )
    .flat()
    .map((value) => String(value ?? "").trim())
    .find((value) => normalize(value).startsWith("periodo"));

  return { documents, sheet: best.sheet, period: period || "" };
}

export type ExportRow = ImportedRow & { total: number };
export const commissionTotal = (row: {
  reportedTotal?: number;
  freight: number;
  tde: number;
}) => Math.max(0, (row.reportedTotal ?? row.freight) + row.tde);
const baseFreightOf = (row: ExportRow) =>
  Math.max(0, row.reportedTotal ?? row.freight);
function buildClosingSheet(
  rows: ExportRow[],
  partnerName: string,
  period: string,
  options: { showTde?: boolean; showDedicated?: boolean } = {},
) {
  const showTde = options.showTde !== false;
  const showDedicated = options.showDedicated !== false;
  const header = [
    "ENTRADA",
    "CTE",
    "NF",
    "REMETENTE",
    "DESTINATARIO",
    "CIDADE",
    "DATA DE ENTREGA",
    ...(showTde ? ["T.D.E"] : []),
    ...(showDedicated ? ["DEDICADO"] : []),
    "T.D.A",
    `FRETE ${partnerName.toUpperCase()}`,
    "TOTAL COMISSAO",
  ];
  const data = [
    ["Empresa: MVF TRANSPORTES"],
    ["RUA CARLOS MARCONDES, 279, LIMOEIRO SAO JOSE DOS CAMPOS-SP"],
    ["CNPJ: 19.712.822/0001-23 IE 645.650.481.111"],
    [
      "DADOS BANCARIOS: BANCO ITAU - AG 7440   C/C 0011791-4   PIX 19712822000123",
    ],
    [period],
    header,
    ...rows.map((row) => {
      const isFreightComplement = normalize(row.status) === "cf";
      return [
        row.date ? new Date(`${row.date}T12:00:00`) : "",
        `${row.cte}${row.isRedelivery ? " RE" : ""}`.trim(),
        row.invoice,
        row.sender,
        row.recipient,
        row.city,
        isFreightComplement
          ? "OUTROS"
          : row.isRedelivery
            ? "REENTREGA"
          : row.deliveryDate
            ? new Date(`${row.deliveryDate}T12:00:00`)
            : "",
        ...(showTde ? [row.tde || ""] : []),
        ...(showDedicated
          ? [(isFreightComplement ? baseFreightOf(row) : row.dedicated) || ""]
          : []),
        row.tda || row.trt || "",
        isFreightComplement ? "" : row.partnerFreight || "",
        row.total,
      ];
    }),
    [
      ...Array.from({ length: header.length - 2 }, () => ""),
      "TOTAL:",
      {
        f: `SUM(${XLSX.utils.encode_col(header.length - 1)}7:${XLSX.utils.encode_col(header.length - 1)}${rows.length + 6})`,
        v: rows.reduce((sum, row) => sum + row.total, 0),
        t: "n",
      },
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!merges"] = Array.from({ length: 5 }, (_, r) => ({
    s: { r, c: 0 },
    e: { r, c: header.length - 1 },
  }));
  const last = rows.length + 7;
  const widths = [
    12,
    12,
    19,
    34,
    38,
    24,
    18,
    ...(showTde ? [12] : []),
    ...(showDedicated ? [12] : []),
    12,
    16,
    18,
  ];
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!rows"] = [
    { hpt: 21 },
    { hpt: 20 },
    { hpt: 20 },
    { hpt: 20 },
    { hpt: 22 },
    { hpt: 24 },
  ];
  const lastColumn = XLSX.utils.encode_col(header.length - 1);
  const totalLabelColumn = XLSX.utils.encode_col(header.length - 2);
  sheet["!autofilter"] = { ref: `A6:${lastColumn}${last - 1}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 6 };
  for (let r = 0; r < last; r++)
    for (let c = 0; c < header.length; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address] || (sheet[address] = { t: "s", v: "" });
      cell.s = {
        fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
        font: { color: { rgb: "111111" } },
        alignment: { vertical: "center" },
      };
    }
  const titleStyle = {
    fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
    font: { color: { rgb: "111111" }, bold: true, sz: 12 },
    alignment: { vertical: "center" },
  };
  ["A1", "A2", "A3", "A4", "A5"].forEach((a) => {
    if (sheet[a]) sheet[a].s = titleStyle;
  });
  for (let c = 0; c < header.length; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 5, c })];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "000000" } },
      font: { color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center" },
      border: { bottom: { style: "thin", color: { rgb: "000000" } } },
    };
  }
  for (let r = 6; r < last - 1; r++) {
    const dateCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    if (dateCell?.v instanceof Date) {
      dateCell.t = "d";
      dateCell.z = "dd/mm/yy";
      dateCell.s.numFmt = "dd/mm/yy";
    }
    const deliveryDateCell = sheet[XLSX.utils.encode_cell({ r, c: 6 })];
    if (deliveryDateCell?.v instanceof Date) {
      deliveryDateCell.t = "d";
      deliveryDateCell.z = "dd/mm/yy";
      deliveryDateCell.s.numFmt = "dd/mm/yy";
    }
    for (let c = 7; c < header.length; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") {
        cell.z = "R$ #,##0.00";
        cell.s.numFmt = "R$ #,##0.00";
      }
    }
  }
  [totalLabelColumn, lastColumn].forEach((col) => {
    const cell = sheet[`${col}${last}`];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "FFF200" } },
      font: { color: { rgb: "111111" }, bold: true, sz: 14 },
      alignment: {
        horizontal: col === totalLabelColumn ? "left" : "right",
      },
      ...(col === lastColumn ? { numFmt: "R$ #,##0.00" } : {}),
    };
    cell.z = col === lastColumn ? "R$ #,##0.00" : undefined;
  });
  return sheet;
}

function buildFreightComplementsSheet(rows: ExportRow[]) {
  const header = [
    "TRANSPORTADORA",
    "ENTRADA",
    "CTE",
    "NF",
    "REMETENTE",
    "DESTINATARIO",
    "CIDADE",
    "OBSERVACAO",
    "VALOR DO FRETE",
  ];
  const data = [
    ["COMPLEMENTOS DE FRETE - CF"],
    header,
    ...rows.map((row) => [
      row.partner,
      row.date ? new Date(`${row.date}T12:00:00`) : "",
      row.cte,
      row.invoice,
      row.sender,
      row.recipient,
      row.city,
      row.observation,
      baseFreightOf(row),
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [22, 12, 14, 20, 32, 36, 24, 70, 18].map((wch) => ({
    wch,
  }));
  sheet["!autofilter"] = { ref: `A2:I${rows.length + 2}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 2 };
  for (let c = 0; c < header.length; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 1, c })];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "000000" } },
      font: { color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center" },
    };
  }
  if (sheet.A1) {
    sheet.A1.s = {
      font: { color: { rgb: "111111" }, bold: true, sz: 14 },
      alignment: { vertical: "center" },
    };
  }
  for (let r = 2; r < rows.length + 2; r++) {
    const dateCell = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
    if (dateCell?.v instanceof Date) {
      dateCell.t = "d";
      dateCell.z = "dd/mm/yy";
      dateCell.s = { numFmt: "dd/mm/yy" };
    }
    const valueCell = sheet[XLSX.utils.encode_cell({ r, c: 8 })];
    if (valueCell) {
      valueCell.z = "R$ #,##0.00";
      valueCell.s = { numFmt: "R$ #,##0.00" };
    }
  }
  return sheet;
}

const argiusTdaOf = (row: ExportRow) => Math.max(0, row.tda || row.trt || 0);
const argiusDedicatedOf = (row: ExportRow) =>
  Math.max(
    0,
    normalize(row.status) === "cf" ? baseFreightOf(row) : row.dedicated || 0,
  );
const argiusExtrasOf = (row: ExportRow) => {
  const tda = argiusTdaOf(row);
  const tde = Math.max(0, row.tde || 0);
  const dedicated = argiusDedicatedOf(row);
  return { tda, tde, dedicated, total: tda + tde + dedicated };
};

function buildArgiusSheet(
  rows: ExportRow[],
  mode: "normal" | "extras",
) {
  const isExtras = mode === "extras";
  const visibleRows = isExtras
    ? rows.filter((row) => argiusExtrasOf(row).total > 0)
    : rows;
  const header = [
    "ENTRADA",
    "CTE",
    "NF",
    "REMETENTE",
    "CNPJ",
    "DESTINATARIO",
    "CNPJ",
    "CIDADE",
    ...(isExtras ? ["T.D.A", "T.D.E", "DEDICADO"] : []),
    "TOTAL COMISSAO",
  ];
  const rowTotals = visibleRows.map((row) => {
    const extras = argiusExtrasOf(row);
    return isExtras ? extras.total : Math.max(0, row.total - extras.total);
  });
  const totalColumn = XLSX.utils.encode_col(header.length - 1);
  const totalExcelRow = visibleRows.length + 2;
  const totalValue = rowTotals.reduce((sum, value) => sum + value, 0);
  const totalCell = visibleRows.length
    ? {
        f: `SUM(${totalColumn}2:${totalColumn}${visibleRows.length + 1})`,
        v: totalValue,
        t: "n",
      }
    : { v: 0, t: "n" };
  const data = [
    header,
    ...visibleRows.map((row, index) => {
      const extras = argiusExtrasOf(row);
      return [
        row.date ? new Date(`${row.date}T12:00:00`) : "",
        row.cte,
        row.invoice,
        row.sender,
        row.senderCnpj,
        row.recipient,
        row.recipientCnpj,
        row.city,
        ...(isExtras
          ? [
              extras.tda || "",
              extras.tde || "",
              extras.dedicated || "",
            ]
          : []),
        rowTotals[index],
      ];
    }),
    [
      ...Array.from({ length: header.length - 2 }, () => ""),
      "TOTAL:",
      totalCell,
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [
    12,
    12,
    25,
    34,
    20,
    38,
    20,
    25,
    ...(isExtras ? [12, 12, 12] : []),
    18,
  ].map((wch) => ({ wch }));
  sheet["!autofilter"] = {
    ref: `A1:${totalColumn}${Math.max(1, visibleRows.length + 1)}`,
  };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  for (let c = 0; c < header.length; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "000000" } },
      font: { color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center" },
    };
  }
  for (let r = 1; r <= visibleRows.length; r++) {
    for (let c = 0; c < header.length; c++) {
      const cell =
        sheet[XLSX.utils.encode_cell({ r, c })] ||
        (sheet[XLSX.utils.encode_cell({ r, c })] = { t: "s", v: "" });
      cell.s = {
        fill: {
          patternType: "solid",
          fgColor: { rgb: r % 2 ? "FFF8E7" : "FFFFFF" },
        },
        font: { color: { rgb: "111111" } },
        alignment: { vertical: "center" },
        border: { bottom: { style: "thin", color: { rgb: "D8D8D8" } } },
      };
      if ([1, 2, 4, 6].includes(c)) {
        cell.z = "@";
        cell.s.numFmt = "@";
      }
    }
    const dateCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    if (dateCell?.v instanceof Date) {
      dateCell.t = "d";
      dateCell.z = "dd/mm/yyyy";
      dateCell.s.numFmt = "dd/mm/yyyy";
    }
    for (let c = 8; c < header.length; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") {
        cell.z = "R$ #,##0.00";
        cell.s.numFmt = "R$ #,##0.00";
      }
    }
  }
  [header.length - 2, header.length - 1].forEach((c) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: totalExcelRow - 1, c })];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "FFF200" } },
      font: { color: { rgb: "111111" }, bold: true, sz: 14 },
      alignment: {
        horizontal: c === header.length - 2 ? "left" : "right",
      },
      ...(c === header.length - 1 ? { numFmt: "R$ #,##0.00" } : {}),
    };
    if (c === header.length - 1) cell.z = "R$ #,##0.00";
  });
  return sheet;
}

const maexPeriodName = (period: string) => {
  const match = period.match(
    /^([12])[ªº°]\s+Quinzena\s+de\s+(.+?)\s+de\s+(\d{4})$/i,
  );
  return match
    ? `${match[1]}° Quinzena de ${match[2]} / ${match[3].slice(-2)}`
    : period;
};

const excelSerialFromIso = (date: string) => {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return (
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
      86400000 +
    25569
  );
};

function buildMaexAdditionalSheet(rows: ExportRow[], period: string) {
  const furnitureRate = 15;
  const header = [
    "CHEGADA",
    "Mde",
    "CTE",
    "NF",
    "REMETENTE",
    "DESTINATARIO",
    "CIDADE",
    "PESO",
    "VOL",
    "ENTREGA",
    "TAXA DE MOVEIS",
  ];
  const data = [
    ["Empresa: GISE TRANSPORTES LTDA"],
    ["RUA CARLOS MARCONDES, 279, LIMOEIRO SAO JOSE DOS CAMPOS-SP"],
    ["CNPJ: 53.823.705/0001-75 IE 135.201.059.11"],
    [
      "DADOS BANCARIOS: BANCO BRADESCO AG 0858 C/C 17133-6 ou PIX 53.823.705/0001-75",
    ],
    [maexPeriodName(period)],
    ["****REFERENTE ADICIONAL DE ENTREGAS DE MOVEIS - ACORDADO COM OSMAR"],
    ["Parceiro: MAEX"],
    header,
    ...rows.map((row) => [
      row.date ? excelSerialFromIso(row.date) : "",
      row.mde,
      row.cte,
      row.invoice,
      row.sender,
      row.recipient,
      row.city,
      row.weight || "",
      row.volumes || "",
      row.deliveryDate
        ? excelSerialFromIso(row.deliveryDate)
        : row.isRedelivery
          ? "RE"
          : row.status || "",
      furnitureRate,
    ]),
    [
      ...Array.from({ length: header.length - 2 }, () => ""),
      "TOTAL:",
      {
        f: `SUM(K9:K${rows.length + 8})`,
        v: rows.length * furnitureRate,
        t: "n",
      },
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const lastRow = rows.length + 9;
  const lastDataRow = rows.length + 8;
  sheet["!merges"] = Array.from({ length: 7 }, (_, r) => ({
    s: { r, c: 0 },
    e: { r, c: 10 },
  }));
  sheet["!cols"] = [12, 13, 13, 20, 38, 38, 25, 11, 9, 14, 18].map(
    (wch) => ({ wch }),
  );
  sheet["!rows"] = [
    { hpt: 21 },
    { hpt: 20 },
    { hpt: 20 },
    { hpt: 20 },
    { hpt: 22 },
    { hpt: 25 },
    { hpt: 21 },
    { hpt: 25 },
  ];
  sheet["!autofilter"] = { ref: `A8:K${lastDataRow}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 8 };

  for (let r = 0; r < lastRow; r++) {
    for (let c = 0; c < header.length; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address] || (sheet[address] = { t: "s", v: "" });
      cell.s = {
        fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
        font: { name: "Calibri", color: { rgb: "111111" }, sz: 11 },
        alignment: { vertical: "center" },
      };
    }
  }

  for (let r = 0; r < 5; r++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    cell.s.font = {
      name: "Calibri",
      color: { rgb: "111111" },
      bold: true,
      sz: 11,
    };
  }
  for (let c = 0; c < header.length; c++) {
    const noteCell = sheet[XLSX.utils.encode_cell({ r: 5, c })];
    noteCell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "990000" } },
      font: { name: "Calibri", color: { rgb: "FFFFFF" }, bold: true },
      alignment: { vertical: "center" },
    };
    const headerCell = sheet[XLSX.utils.encode_cell({ r: 7, c })];
    headerCell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "000000" } },
      font: { name: "Calibri", color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center" },
      border: { bottom: { style: "thin", color: { rgb: "000000" } } },
    };
  }
  sheet.A7.s.font = {
    name: "Calibri",
    color: { rgb: "111111" },
    bold: true,
  };

  for (let r = 8; r < lastRow - 1; r++) {
    for (let c = 0; c < header.length; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      cell.s.border = {
        bottom: { style: "thin", color: { rgb: "D8D8D8" } },
      };
    }
    [0, 9].forEach((c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (typeof cell?.v === "number") {
        cell.t = "n";
        cell.z = "dd/mm/yyyy";
        cell.s.numFmt = "dd/mm/yyyy";
      }
    });
    const weightCell = sheet[XLSX.utils.encode_cell({ r, c: 7 })];
    if (typeof weightCell?.v === "number") {
      weightCell.z = "0.00";
      weightCell.s.numFmt = "0.00";
    }
    const volumeCell = sheet[XLSX.utils.encode_cell({ r, c: 8 })];
    if (typeof volumeCell?.v === "number") {
      volumeCell.z = "0";
      volumeCell.s.numFmt = "0";
    }
    const rateCell = sheet[XLSX.utils.encode_cell({ r, c: 10 })];
    rateCell.z = "R$ #,##0.00";
    rateCell.s.numFmt = "R$ #,##0.00";
  }

  ["J", "K"].forEach((column) => {
    const cell = sheet[`${column}${lastRow}`];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "FFF200" } },
      font: { name: "Calibri", color: { rgb: "111111" }, bold: true, sz: 14 },
      alignment: { horizontal: column === "J" ? "left" : "right" },
      ...(column === "K" ? { numFmt: "R$ #,##0.00" } : {}),
    };
    if (column === "K") cell.z = "R$ #,##0.00";
  });
  return sheet;
}

export function exportPajussaraMissingXlsx(
  rows: ExportRow[],
  comparisonFile: string,
) {
  const header = [
    "ENTRADA",
    "CTE",
    "NF",
    "REMETENTE",
    "DESTINATARIO",
    "CIDADE",
    "DATA DE ENTREGA",
    "TOTAL COMISSAO",
  ];
  const totalRow = rows.length + 2;
  const totalValue = rows.reduce((sum, row) => sum + row.total, 0);
  const data = [
    header,
    ...rows.map((row) => [
      row.date ? new Date(`${row.date}T12:00:00`) : "",
      row.cte,
      row.invoice,
      row.sender,
      row.recipient,
      row.city,
      row.isRedelivery
        ? "REENTREGA"
        : row.deliveryDate
          ? new Date(`${row.deliveryDate}T12:00:00`)
          : "",
      row.total,
    ]),
    [
      ...Array.from({ length: header.length - 2 }, () => ""),
      "TOTAL:",
      rows.length
        ? { f: `SUM(H2:H${rows.length + 1})`, v: totalValue, t: "n" }
        : { v: 0, t: "n" },
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [12, 14, 20, 36, 38, 25, 18, 18].map((wch) => ({
    wch,
  }));
  sheet["!autofilter"] = { ref: `A1:H${Math.max(1, rows.length + 1)}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };

  for (let c = 0; c < header.length; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "000000" } },
      font: { color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center" },
    };
  }
  for (let r = 1; r <= rows.length; r++) {
    for (let c = 0; c < header.length; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address] || (sheet[address] = { t: "s", v: "" });
      cell.s = {
        fill: {
          patternType: "solid",
          fgColor: { rgb: r % 2 ? "FFF4F1" : "FFFFFF" },
        },
        font: { color: { rgb: "111111" } },
        alignment: { vertical: "center" },
        border: { bottom: { style: "thin", color: { rgb: "E3D7D4" } } },
      };
      if ([1, 2].includes(c)) {
        cell.z = "@";
        cell.s.numFmt = "@";
      }
    }
    [0, 6].forEach((c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell?.v instanceof Date) {
        cell.t = "d";
        cell.z = "dd/mm/yyyy";
        cell.s.numFmt = "dd/mm/yyyy";
      }
    });
    const totalCell = sheet[XLSX.utils.encode_cell({ r, c: 7 })];
    totalCell.z = "R$ #,##0.00";
    totalCell.s.numFmt = "R$ #,##0.00";
  }
  [6, 7].forEach((c) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: totalRow - 1, c })];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "FFF200" } },
      font: { color: { rgb: "111111" }, bold: true, sz: 14 },
      alignment: { horizontal: c === 6 ? "left" : "right" },
      ...(c === 7 ? { numFmt: "R$ #,##0.00" } : {}),
    };
    if (c === 7) cell.z = "R$ #,##0.00";
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Faltantes");
  const sourceName = comparisonFile.replace(/\.[^.]+$/, "");
  const safeName = sourceName
    .replace(/[^a-zA-Z0-9À-ÿ]+/g, " ")
    .trim()
    .slice(0, 80);
  XLSX.writeFile(
    workbook,
    `Pendencias Pajussara - ${safeName || "comparacao"}.xlsx`,
    { compression: true },
  );
}

export function exportMaexAdditionalXlsx(
  rows: ExportRow[],
  period: string,
) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    buildMaexAdditionalSheet(rows, period),
    "TEMP_EXPORT",
  );
  XLSX.writeFile(
    workbook,
    `Fechamento Adicional Maex - ${period.replace(/[^a-zA-Z0-9À-ÿ]+/g, " ").trim()}.xlsx`,
    { compression: true },
  );
}

export function exportClosingXlsx(
  rows: ExportRow[],
  partnerName: string,
  period: string,
) {
  const isArgius = normalize(partnerName) === "argius";
  const isFitlog = normalize(partnerName) === "fitlog";
  const safePeriod = period.replace(/[^a-zA-Z0-9À-ÿ]+/g, " ").trim();
  if (isArgius) {
    const normalWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      normalWorkbook,
      buildArgiusSheet(rows, "normal"),
      "DadosExcel",
    );
    XLSX.writeFile(
      normalWorkbook,
      `Fechamento Argius - ${safePeriod}.xlsx`,
      { compression: true },
    );

    const extrasWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      extrasWorkbook,
      buildArgiusSheet(rows, "extras"),
      "TDA TDE Dedicado",
    );
    XLSX.writeFile(
      extrasWorkbook,
      `Fechamento Adicionais Argius - ${safePeriod}.xlsx`,
      { compression: true },
    );
    return 2;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    buildClosingSheet(rows, partnerName, period, {
      showTde: true,
      showDedicated: !isFitlog,
    }),
    "DadosExcel",
  );
  const freightComplements = rows.filter(
    (row) => normalize(row.status) === "cf",
  );
  if (freightComplements.length) {
    XLSX.utils.book_append_sheet(
      workbook,
      buildFreightComplementsSheet(freightComplements),
      "OUTROS",
    );
  }
  XLSX.writeFile(
    workbook,
    `Fechamento ${partnerName} - ${safePeriod}.xlsx`,
    { compression: true },
  );
  return 1;
}

export function exportMultipleClosingsXlsx(
  groups: Array<{ partnerName: string; rows: ExportRow[] }>,
  period: string,
) {
  const workbook = XLSX.utils.book_new();
  const used = new Set<string>();
  groups.forEach(({ partnerName, rows }, index) => {
    const isFitlog = normalize(partnerName) === "fitlog";
    const base =
      partnerName
        .replace(/[\\/?*:[\]]/g, " ")
        .trim()
        .slice(0, 31) || `Parceira ${index + 1}`;
    let name = base;
    let suffix = 2;
    while (used.has(name.toLowerCase())) {
      const tail = ` (${suffix++})`;
      name = `${base.slice(0, 31 - tail.length)}${tail}`;
    }
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(
      workbook,
      buildClosingSheet(rows, partnerName, period, {
        showTde: true,
        showDedicated: !isFitlog,
      }),
      name,
    );
  });
  const freightComplements = groups
    .flatMap(({ rows }) => rows)
    .filter((row) => normalize(row.status) === "cf");
  if (freightComplements.length) {
    XLSX.utils.book_append_sheet(
      workbook,
      buildFreightComplementsSheet(freightComplements),
      "OUTROS",
    );
  }
  XLSX.writeFile(
    workbook,
    `Fechamentos - ${period.replace(/[^a-zA-Z0-9À-ÿ]+/g, " ").trim()}.xlsx`,
    { compression: true },
  );
}
