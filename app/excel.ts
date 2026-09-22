import XLSX from "xlsx-js-style";
import { jsPDF } from "jspdf";
import { normalizeCnpj, normalizeInvoiceKey } from "./excel-light";
export { commissionTotal, normalizeCnpj, normalizeInvoiceKey } from "./excel-light";

export type BillingPdfRow = { partner: string; value: number; createdBy: string };
export type FinancialPdfRow = { account: string; value: number; paidAt: string };

const compactMoney = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const compactDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};
function exportCompactTablePdf(title: string, period: string, headers: string[], rows: string[][], total: number, filename: string) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 8;
  const pageWidth = 210 - margin * 2;
  const rowHeight = 5.5;
  const columnWidth = pageWidth / headers.length;
  let y = 10;
  const drawHeader = () => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(title, margin, y);
    pdf.setFontSize(8);
    pdf.text(period, 210 - margin, y, { align: "right" });
    y += 5;
    pdf.setFillColor(20, 108, 67);
    pdf.rect(margin, y, pageWidth, rowHeight, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(7);
    headers.forEach((header, index) => pdf.text(header, margin + index * columnWidth + 1.5, y + 3.7));
    pdf.setTextColor(20, 30, 25);
    y += rowHeight;
  };
  drawHeader();
  rows.forEach((row, rowIndex) => {
    if (y + rowHeight > 287) {
      pdf.addPage();
      y = 10;
      drawHeader();
    }
    if (rowIndex % 2 === 0) {
      pdf.setFillColor(242, 246, 244);
      pdf.rect(margin, y, pageWidth, rowHeight, "F");
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    row.forEach((cell, index) => pdf.text(String(cell).slice(0, 52), margin + index * columnWidth + 1.5, y + 3.7));
    y += rowHeight;
  });
  y += 2;
  pdf.setDrawColor(20, 108, 67);
  pdf.line(margin, y, 210 - margin, y);
  y += 5;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(`TOTAL: ${compactMoney(total)}`, 210 - margin, y, { align: "right" });
  pdf.save(filename);
}

export function exportBillingPdf(period: string, rows: BillingPdfRow[]) {
  exportCompactTablePdf("Faturamento por parceiro", period, ["PARCEIRO", "VALOR", "LANÇADO POR"], rows.map((row) => [row.partner, compactMoney(row.value), row.createdBy]), rows.reduce((sum, row) => sum + row.value, 0), `Faturamento - ${period}.pdf`);
}

export function exportFinancialPdf(month: string, rows: FinancialPdfRow[]) {
  exportCompactTablePdf("Financeiro mensal", month, ["CONTA", "VALOR", "DATA DO PAGAMENTO"], rows.map((row) => [row.account, compactMoney(row.value), compactDate(row.paidAt)]), rows.reduce((sum, row) => sum + row.value, 0), `Financeiro - ${month}.pdf`);
}

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
  merchandiseValue: number;
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

export type ImportedRomaneioRow = {
  filial: string;
  romaneio: string;
  tabela: string;
  status: string;
  emissionDate: string;
  deliveryPartner: string;
  freightLetter: string;
  freightLetterDate: string;
  cpf: string;
  driver: string;
  plate: string;
  vehicleType: string;
  trailer: string;
  freight: number;
  weight: number;
  deliveries: number;
  volumes: number;
  route: string;
  documents: string[];
  helpers: string;
  checkers: string;
};

export type DriverClosingDay = {
  date: string;
  romaneios?: string[];
  cities: string[];
  cityText?: string;
  observation?: string;
  invoiceCount: number;
  freight: number;
};

export type DriverClosingDiscount = {
  description: string;
  amount: number;
  installment: number;
  installments: number;
};

export type DriverClosingExport = {
  driver: string;
  cpf: string;
  plates: string[];
  vehicleTypes: string[];
  periodFrom: string;
  periodTo: string;
  days: DriverClosingDay[];
  discounts?: DriverClosingDiscount[];
};

export type CoverDocumentExport = {
  scannedAt: string;
  invoice: string;
  invoiceKey: string;
  cte: string;
  cteKey: string;
  mde: string;
  sender: string;
  recipient: string;
  city: string;
  date: string;
  deliveryDate: string;
  status: string;
  manualCoverNumber?: string;
  volumes?: number;
  weight?: number;
  merchandiseValue?: number;
  manualEntry?: boolean;
};

export type CoverExport = {
  id: string;
  sequenceNumber?: number;
  partnerId?: string;
  partnerName: string;
  kind: "shipment" | "return" | "collection";
  createdAt: string;
  generatedBy?: string;
  documents: CoverDocumentExport[];
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
  mde: ["mde", "md e", "documento", "documento original"],
  cte: [
    "cte",
    "ct e",
    "ct-e",
    "ct e parceiro",
    "conhecimento",
    "documento",
    "numero cte",
    "n cte",
    "doc redesp parceiro",
  ],
  cteKey: ["chave ct e parceiro", "chave cte parceiro", "chave ct e", "chave cte"],
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
  merchandiseValue: [
    "valor mercadoria",
    "valor da mercadoria",
    "valor nota fiscal",
    "valor da nota fiscal",
    "valor nf",
    "valor total mercadoria",
  ],
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

const excelDateTime = (value: unknown) => {
  const dateParts = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
  if (value instanceof Date) return dateParts(value);
  if (typeof value === "number" && value > 20000) {
    const date = XLSX.SSF.parse_date_code(value);
    if (date)
      return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}T${String(date.H || 0).padStart(2, "0")}:${String(date.M || 0).padStart(2, "0")}:${String(Math.floor(date.S || 0)).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  const br = text.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (br)
    return `${br[3].length === 2 ? `20${br[3]}` : br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}T${(br[4] || "0").padStart(2, "0")}:${br[5] || "00"}:${br[6] || "00"}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : dateParts(parsed);
};

export async function readRomaneioFile(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: false,
  });
  let best: {
    rows: unknown[][];
    header: number;
    sheet: string;
    columns: Record<string, number>;
    score: number;
  } | null = null;

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      { header: 1, defval: "", raw: true },
    );
    for (let header = 0; header < Math.min(rows.length, 25); header++) {
      const titles = rows[header].map(normalize);
      const at = (name: string, start = 0) =>
        titles.findIndex(
          (title, index) => index >= start && title === normalize(name),
        );
      const columns: Record<string, number> = {
        filial: at("FILIAL"),
        romaneio: at("ROMANEIO"),
        tabela: at("TABELA"),
        status: at("STATUS"),
        emissionDate: at("DATA EMISSAO"),
        deliveryPartner: at("PARCEIRA DE ENTREGA"),
        freightLetter: at("CARTA FRETE"),
        cpf: at("CPF"),
        driver: at("MOTORISTA"),
        plate: at("PLACA"),
        vehicleType: at("TIPO VEICULO"),
        trailer: at("ENGATE"),
        freight: at("FRETE"),
        weight: at("PESO"),
        deliveries: at("QTD. ENTREGAS"),
        volumes: at("VOLUMES"),
        route: at("EM ROTA"),
        documents: at("DOCUMENTOS"),
        helpers: at("AJUDANTES"),
        checkers: at("CONFERENTES"),
      };
      columns.freightLetterDate = at(
        "DATA EMISSAO",
        Math.max(0, columns.freightLetter + 1),
      );
      const required = [
        "romaneio",
        "emissionDate",
        "driver",
        "plate",
        "route",
        "documents",
      ];
      const score = Object.values(columns).filter((column) => column >= 0).length;
      if (
        required.every((key) => columns[key] >= 0) &&
        (!best || score > best.score)
      )
        best = { rows, header, sheet: sheetName, columns, score };
    }
  }

  if (!best)
    throw new Error(
      "Não encontrei as colunas ROMANEIO, DATA EMISSÃO, MOTORISTA, PLACA, EM ROTA e DOCUMENTOS.",
    );

  const value = (row: unknown[], key: string) => {
    const column = best!.columns[key];
    return column === undefined || column < 0 ? "" : row[column];
  };
  const rows = best.rows
    .slice(best.header + 1)
    .map((row): ImportedRomaneioRow => ({
      filial: identifierText(value(row, "filial")),
      romaneio: identifierText(value(row, "romaneio")),
      tabela: String(value(row, "tabela") ?? "").trim(),
      status: String(value(row, "status") ?? "").trim(),
      emissionDate: excelDateTime(value(row, "emissionDate")),
      deliveryPartner: String(value(row, "deliveryPartner") ?? "").trim(),
      freightLetter: identifierText(value(row, "freightLetter")),
      freightLetterDate: excelDateTime(value(row, "freightLetterDate")),
      cpf: identifierText(value(row, "cpf")),
      driver: String(value(row, "driver") ?? "").trim(),
      plate: String(value(row, "plate") ?? "").trim(),
      vehicleType: String(value(row, "vehicleType") ?? "").trim(),
      trailer: String(value(row, "trailer") ?? "").trim(),
      freight: toNumber(value(row, "freight")),
      weight: toNumber(value(row, "weight")),
      deliveries: toNumber(value(row, "deliveries")),
      volumes: toNumber(value(row, "volumes")),
      route: String(value(row, "route") ?? "").trim(),
      documents: String(value(row, "documents") ?? "")
        .split(/[,;\n]+/)
        .map((document) => document.trim())
        .filter(Boolean),
      helpers: String(value(row, "helpers") ?? "").trim(),
      checkers: String(value(row, "checkers") ?? "").trim(),
    }))
    .filter(
      (row) =>
        Boolean(row.romaneio) &&
        !["total", "subtotal"].includes(normalize(row.romaneio)),
    );

  if (!rows.length)
    throw new Error(
      "O relatório foi reconhecido, mas não encontrei romaneios abaixo do cabeçalho.",
    );
  return { rows, sheet: best.sheet };
}

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
      const documentoMde = headerAt("Documento");
      const documentoOriginal = headerAt("Documento Original");
      const cteParceiro = headerAt("CT-e Parceiro");
      const chaveCteParceiro =
        headerAt("Chave CT-e Parceiro") >= 0
          ? headerAt("Chave CT-e Parceiro")
          : headerAt("Chave CT-e");
      const valorDoFrete = headerAt("Valor do Frete");
      const tipoDocumento = headerAt("Tipo");
      const isDocsCteReport =
        tipoDocumento >= 0 &&
        rows
          .slice(i + 1, i + 8)
          .some((row) => normalize(row[tipoDocumento]).includes("ct e"));
      if (documentoMde >= 0) {
        if (isDocsCteReport) {
          map.cte = documentoMde;
          map.mde = documentoOriginal >= 0 ? documentoOriginal : undefined;
        } else {
          map.mde = documentoMde;
        }
      }
      if (documentoOriginal >= 0) map.mde = documentoOriginal;
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
      if (valorDoFrete >= 0) map.reportedTotal = valorDoFrete;
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
        merchandiseValue: toNumber(value(row, "merchandiseValue")),
        freight: toNumber(value(row, "freight")),
        partnerFreight: toNumber(value(row, "partnerFreight")),
        tde: toNumber(value(row, "tde")),
        tda: toNumber(value(row, "tda")),
        trt: toNumber(value(row, "trt")),
        redelivery: toNumber(value(row, "redelivery")),
        dedicated: toNumber(value(row, "dedicated")),
        adjustment: toNumber(value(row, "adjustment")),
      };
      if (!result.cteKey) {
        const observationKey = result.observation.match(/\b\d{44}\b/);
        if (observationKey) result.cteKey = observationKey[0];
      }
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
        (row.mde || row.cte || row.invoice) &&
        !normalize(row.mde).includes("total") &&
        !normalize(row.cte).includes("total") &&
        !normalize(row.invoice).includes("total"),
    );
  const eligible = imported.filter(
    (row) => row.eligible && Boolean(row.cte || row.invoice),
  );
  if (!imported.length)
    throw new Error(
      "A planilha foi reconhecida, mas não encontrei documentos nas linhas abaixo do cabeçalho.",
    );
  const latestEmissionDate = imported.reduce((latest, row) => {
    const date = String(row.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return latest;
    return !latest || date > latest ? date : latest;
  }, "");
  return {
    rows: eligible,
    referenceRows: imported,
    excluded: imported.length - eligible.length,
    sheet: best.sheet,
    latestEmissionDate,
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
    return "PAJUÇARA";
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
      "Não encontrei as colunas CTRC/SUBC e NF no fechamento da Pajuçara.",
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
      "O fechamento da Pajuçara foi reconhecido, mas não encontrei documentos abaixo do cabeçalho.",
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
const baseFreightOf = (row: ExportRow) =>
  Math.max(0, row.reportedTotal ?? row.freight);

function maexPeriodName(period: string) {
  const match = period.match(
    /^([12])[ªº°]\s+Quinzena\s+de\s+(.+?)\s+de\s+(\d{4})$/i,
  );
  return match
    ? `${match[1]}° Quinzena de ${match[2]} / ${match[3].slice(-2)}`
    : period;
}

function buildClosingSheet(
  rows: ExportRow[],
  partnerName: string,
  period: string,
  options: { showTde?: boolean; showDedicated?: boolean } = {},
) {
  const showTde = options.showTde !== false;
  const showDedicated = options.showDedicated !== false;
  const isMaex = normalize(partnerName) === "maex";
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
  const institutionalRows = isMaex
    ? [
        ["Empresa: GISE TRANSPORTES LTDA"],
        ["RUA CARLOS MARCONDES, 279, LIMOEIRO SAO JOSE DOS CAMPOS-SP"],
        ["CNPJ: 53.823.705/0001-75 IE 135.201.059.11"],
        [
          "DADOS BANCARIOS: BANCO BRADESCO AG 0858 C/C 17133-6 ou PIX   53.823.705/0001-75",
        ],
        [maexPeriodName(period)],
        [""],
        ["Parceiro: MAEX"],
      ]
    : [
        ["Empresa: MVF TRANSPORTES"],
        ["RUA CARLOS MARCONDES, 279, LIMOEIRO SAO JOSE DOS CAMPOS-SP"],
        ["CNPJ: 19.712.822/0001-23 IE 645.650.481.111"],
        [
          "DADOS BANCARIOS: BANCO ITAU - AG 7440   C/C 0011791-4   PIX 19712822000123",
        ],
        [period],
      ];
  const headerRowIndex = institutionalRows.length;
  const headerExcelRow = headerRowIndex + 1;
  const firstDataRowIndex = headerRowIndex + 1;
  const firstDataExcelRow = firstDataRowIndex + 1;
  const totalExcelRow = rows.length + firstDataExcelRow;
  const data = [
    ...institutionalRows,
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
        f: `SUM(${XLSX.utils.encode_col(header.length - 1)}${firstDataExcelRow}:${XLSX.utils.encode_col(header.length - 1)}${totalExcelRow - 1})`,
        v: rows.reduce((sum, row) => sum + row.total, 0),
        t: "n",
      },
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!merges"] = Array.from({ length: institutionalRows.length }, (_, r) => ({
    s: { r, c: 0 },
    e: { r, c: header.length - 1 },
  }));
  const last = totalExcelRow;
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
  sheet["!rows"] = isMaex
    ? [
        { hpt: 21 },
        { hpt: 20 },
        { hpt: 20 },
        { hpt: 20 },
        { hpt: 22 },
        { hpt: 12 },
        { hpt: 21 },
        { hpt: 24 },
      ]
    : [
        { hpt: 21 },
        { hpt: 20 },
        { hpt: 20 },
        { hpt: 20 },
        { hpt: 22 },
        { hpt: 24 },
      ];
  const lastColumn = XLSX.utils.encode_col(header.length - 1);
  const totalLabelColumn = XLSX.utils.encode_col(header.length - 2);
  sheet["!autofilter"] = {
    ref: `A${headerExcelRow}:${lastColumn}${last - 1}`,
  };
  sheet["!freeze"] = { xSplit: 0, ySplit: firstDataRowIndex };
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
  const titleRows = isMaex ? [1, 2, 3, 4, 5, 7] : [1, 2, 3, 4, 5];
  titleRows.map((row) => `A${row}`).forEach((a) => {
    if (sheet[a]) sheet[a].s = titleStyle;
  });
  for (let c = 0; c < header.length; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRowIndex, c })];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "000000" } },
      font: { color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center" },
      border: { bottom: { style: "thin", color: { rgb: "000000" } } },
    };
  }
  for (let r = firstDataRowIndex; r < last - 1; r++) {
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
    "EMISSÃO",
    "Mde",
    "CTE",
    "NF",
    "REMETENTE",
    "DESTINATARIO",
    "CIDADE",
    "PESO",
    "VOL",
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
      furnitureRate,
    ]),
    [
      ...Array.from({ length: header.length - 2 }, () => ""),
      "TOTAL:",
      {
        f: `SUM(J9:J${rows.length + 8})`,
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
    e: { r, c: 9 },
  }));
  sheet["!cols"] = [12, 13, 13, 20, 38, 38, 25, 11, 9, 18].map(
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
  sheet["!autofilter"] = { ref: `A8:J${lastDataRow}` };
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
    [0].forEach((c) => {
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
    const rateCell = sheet[XLSX.utils.encode_cell({ r, c: 9 })];
    rateCell.z = "R$ #,##0.00";
    rateCell.s.numFmt = "R$ #,##0.00";
  }

  ["I", "J"].forEach((column) => {
    const cell = sheet[`${column}${lastRow}`];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "FFF200" } },
      font: { name: "Calibri", color: { rgb: "111111" }, bold: true, sz: 14 },
      alignment: { horizontal: column === "I" ? "left" : "right" },
      ...(column === "J" ? { numFmt: "R$ #,##0.00" } : {}),
    };
    if (column === "J") cell.z = "R$ #,##0.00";
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
    `Pendencias Pajuçara - ${safeName || "comparacao"}.xlsx`,
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

export function exportDriverClosingXlsx(report: DriverClosingExport) {
  const totalInvoices = report.days.reduce(
    (sum, day) => sum + day.invoiceCount,
    0,
  );
  const totalFreight = report.days.reduce((sum, day) => sum + day.freight, 0);
  const period = [report.periodFrom, report.periodTo]
    .filter(Boolean)
    .map((date) => date.split("-").reverse().join("/"))
    .join(" a ") || "Todo o período";
  const headerRow = 7;
  const dataStartRow = headerRow + 1;
  const totalRow = dataStartRow + report.days.length;
  const data = [
    ["FECHAMENTO DE ROMANEIOS POR MOTORISTA", "", "", ""],
    ["Motorista:", report.driver, "", ""],
    ["CPF:", report.cpf || "Não informado", "", ""],
    ["Veículo(s):", [...report.plates, ...report.vehicleTypes].filter(Boolean).join(" · ") || "Não informado", "", ""],
    ["Período:", period, "", ""],
    ["", "", "", ""],
    ["DATA", "CIDADES ATENDIDAS", "NOTAS ENTREGUES", "VALOR TOTAL DO FRETE"],
    ...report.days.map((day) => [
      new Date(`${day.date}T12:00:00`),
      day.cities.join(" · ") || "Não informada",
      day.invoiceCount,
      day.freight,
    ]),
    ["TOTAL", "", totalInvoices, totalFreight],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    ...Array.from({ length: 4 }, (_, index) => ({
      s: { r: index + 1, c: 1 },
      e: { r: index + 1, c: 3 },
    })),
  ];
  sheet["!cols"] = [{ wch: 14 }, { wch: 55 }, { wch: 18 }, { wch: 23 }];
  sheet["!rows"] = [{ hpt: 28 }, ...Array.from({ length: 5 }, () => ({ hpt: 20 }))];
  sheet["!freeze"] = { xSplit: 0, ySplit: headerRow };
  sheet["!autofilter"] = {
    ref: `A${headerRow}:D${Math.max(headerRow, totalRow - 1)}`,
  };

  for (let row = 0; row < data.length; row++) {
    for (let column = 0; column < 4; column++) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = sheet[address] || (sheet[address] = { t: "s", v: "" });
      cell.s = {
        fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
        font: { name: "Calibri", color: { rgb: "202B24" }, sz: 11 },
        alignment: { vertical: "center" },
      };
    }
  }

  const title = sheet.A1;
  title.s = {
    fill: { patternType: "solid", fgColor: { rgb: "146C43" } },
    font: { name: "Calibri", color: { rgb: "FFFFFF" }, bold: true, sz: 16 },
    alignment: { horizontal: "center", vertical: "center" },
  };
  for (let row = 1; row <= 4; row++) {
    const label = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    label.s = {
      fill: { patternType: "solid", fgColor: { rgb: "E6F2EB" } },
      font: { name: "Calibri", color: { rgb: "175B3B" }, bold: true },
      alignment: { vertical: "center" },
    };
    const value = sheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
    value.s = {
      fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
      font: { name: "Calibri", color: { rgb: "202B24" }, bold: true },
      alignment: { vertical: "center" },
    };
  }
  for (let column = 0; column < 4; column++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow - 1, c: column })];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "17231C" } },
      font: { name: "Calibri", color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
    };
  }
  report.days.forEach((_, index) => {
    const row = dataStartRow - 1 + index;
    for (let column = 0; column < 4; column++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      cell.s = {
        fill: {
          patternType: "solid",
          fgColor: { rgb: index % 2 ? "F3F8F5" : "FFFFFF" },
        },
        font: { name: "Calibri", color: { rgb: "202B24" } },
        alignment: {
          horizontal: column === 1 ? "left" : "center",
          vertical: "center",
          wrapText: column === 1,
        },
        border: { bottom: { style: "thin", color: { rgb: "D9E3DD" } } },
      };
    }
    const dateCell = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    dateCell.z = "dd/mm/yyyy";
    dateCell.s.numFmt = "dd/mm/yyyy";
    const countCell = sheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
    countCell.z = "0";
    countCell.s.numFmt = "0";
    const freightCell = sheet[XLSX.utils.encode_cell({ r: row, c: 3 })];
    freightCell.z = "R$ #,##0.00";
    freightCell.s.numFmt = "R$ #,##0.00";
  });
  for (let column = 0; column < 4; column++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: totalRow - 1, c: column })];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "FFE36D" } },
      font: { name: "Calibri", color: { rgb: "17231C" }, bold: true, sz: 12 },
      alignment: { horizontal: column < 2 ? "left" : "center", vertical: "center" },
    };
  }
  sheet[XLSX.utils.encode_cell({ r: totalRow - 1, c: 2 })].z = "0";
  sheet[XLSX.utils.encode_cell({ r: totalRow - 1, c: 3 })].z = "R$ #,##0.00";

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Fechamento");
  const safeDriver = report.driver
    .replace(/[^a-zA-Z0-9À-ÿ]+/g, " ")
    .trim()
    .slice(0, 80);
  XLSX.writeFile(
    workbook,
    `Fechamento Motorista - ${safeDriver || "Sem nome"} - ${period.replace(/[^a-zA-Z0-9À-ÿ]+/g, " ").trim()}.xlsx`,
    { compression: true },
  );
}

const pdfDate = (date: string) =>
  date ? date.split("-").reverse().join("/") : "";

const safePdfFilenamePart = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9À-ÿ]+/g, " ")
    .trim()
    .slice(0, 80);

export function exportDriverClosingPdf(report: DriverClosingExport) {
  const totalInvoices = report.days.reduce(
    (sum, day) => sum + day.invoiceCount,
    0,
  );
  const totalFreight = report.days.reduce((sum, day) => sum + day.freight, 0);
  const totalDiscount = (report.discounts || []).reduce(
    (sum, discount) => sum + discount.amount,
    0,
  );
  const period =
    [report.periodFrom, report.periodTo]
      .filter(Boolean)
      .map(pdfDate)
      .join(" a ") || "Todo o período";
  const monthLabel = (() => {
    const base = report.periodTo || report.periodFrom;
    if (!base) return "";
    const parsed = new Date(`${base}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    });
  })();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 18;
  const tableWidth = pageWidth - margin * 2;
  const widths = [18, 24, 18, 54, 18, 26, 16];
  const startY = 24;
  const minRows = 18;
  const rowHeight = 4.8;
  let y = startY;

  const moneyText = (value: number) =>
    value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  pdf.setDrawColor(0, 0, 0);
  pdf.setFillColor(0, 0, 0);
  pdf.rect(margin, y, tableWidth, 2, "F");
  y += 2;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("Recibo referente ao mês de", margin + tableWidth * 0.38, y + 4.5, {
    align: "center",
  });
  pdf.text(monthLabel || period, margin + tableWidth * 0.7, y + 4.5, {
    align: "center",
  });
  pdf.setFontSize(6);
  pdf.text(new Date().toLocaleDateString("pt-BR"), margin + tableWidth - 2, y + 1.2, {
    align: "right",
  });
  y += 7;
  pdf.setFontSize(6.5);
  pdf.text("Motorista:", pageWidth / 2, y - 0.5, { align: "center" });
  pdf.setFontSize(11);
  pdf.text(report.driver || "Motorista não informado", pageWidth / 2, y + 4, {
    align: "center",
  });
  y += 7;

  pdf.setLineWidth(0.45);
  pdf.rect(margin, startY + 2, tableWidth, y - startY - 2);
  pdf.line(margin, y, margin + tableWidth, y);

  const headers = [
    "Data",
    "Romaneio",
    "Dedicados",
    "Cidade",
    "Notas Feitas",
    "Produção",
    "Fechado",
  ];
  pdf.setFontSize(6);
  let x = margin;
  headers.forEach((header, index) => {
    pdf.text(header, x + widths[index] / 2, y + 4.2, { align: "center" });
    x += widths[index];
  });
  y += 6;
  pdf.line(margin, y, margin + tableWidth, y);

  const tableBodyTop = y;
  const rows = Math.max(minRows, report.days.length);
  for (let index = 0; index < rows; index++) {
    const day = report.days[index];
    const rowY = y;
    if (day && index % 2 === 0) {
      pdf.setFillColor(239, 248, 241);
      pdf.rect(margin, rowY, tableWidth, rowHeight, "F");
    }
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(day ? 0.35 : 0.2);
    pdf.setLineDashPattern([0.7, 0.7], 0);
    pdf.line(margin, rowY + rowHeight, margin + tableWidth, rowY + rowHeight);
    pdf.setLineDashPattern([], 0);
    if (day) {
      const city = day.cityText || day.cities.join(" · ") || "Não informada";
      const cityWithObservation = [city, day.observation ? `Obs.: ${day.observation}` : ""]
        .filter(Boolean)
        .join(" - ");
      const cityLines = pdf.splitTextToSize(cityWithObservation, widths[3] - 2);
      pdf.setTextColor(0, 0, 0);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(5.8);
      x = margin;
      pdf.text(pdfDate(day.date), x + widths[0] / 2, rowY + 3.3, {
        align: "center",
      });
      x += widths[0];
      pdf.text(
        (day.romaneios || []).join(" / ") || "-",
        x + widths[1] / 2,
        rowY + 3.3,
        { align: "center" },
      );
      x += widths[1];
      pdf.text("-", x + widths[2] / 2, rowY + 3.3, { align: "center" });
      x += widths[2];
      pdf.text(cityLines.slice(0, 2), x + 1, rowY + 3.1);
      x += widths[3];
      pdf.text(String(day.invoiceCount), x + widths[4] / 2, rowY + 3.3, {
        align: "center",
      });
      x += widths[4];
      pdf.text(moneyText(day.freight), x + widths[5] - 1, rowY + 3.3, {
        align: "right",
      });
      x += widths[5];
      pdf.text("-", x + widths[6] / 2, rowY + 3.3, { align: "center" });
    }
    y += rowHeight;
  }

  x = margin;
  widths.slice(0, -1).forEach((width) => {
    x += width;
    pdf.setLineDashPattern([], 0);
    pdf.line(x, tableBodyTop - 6, x, y);
  });
  pdf.rect(margin, tableBodyTop - 6, tableWidth, y - tableBodyTop + 6);

  pdf.setFillColor(239, 248, 241);
  pdf.rect(margin, y, tableWidth, 9, "F");
  pdf.rect(margin, y, tableWidth, 9);
  pdf.setFontSize(6.5);
  pdf.setFont("helvetica", "bold");
  pdf.text("DIÁRIAS:", margin + 2, y + 4.2);
  pdf.text(String(report.days.length), margin + 7, y + 8);
  pdf.text("Total Produção + Dedicados :", pageWidth / 2 - 10, y + 4.2, {
    align: "center",
  });
  pdf.text(String(totalInvoices), margin + widths[0] + widths[1] + widths[2] + widths[3] + widths[4] / 2, y + 4.2, {
    align: "center",
  });
  pdf.text(moneyText(totalFreight), margin + tableWidth - widths[6] - 2, y + 4.2, {
    align: "right",
  });
  y += 9;

  pdf.rect(margin, y, tableWidth, 10);
  pdf.text("Total:", margin + 30, y + 5.8);
  pdf.text(moneyText(totalFreight), margin + tableWidth - 54, y + 5.8, {
    align: "right",
  });
  pdf.text("PAGAR:", margin + tableWidth - 36, y + 5.8, { align: "right" });
  pdf.text(moneyText(Math.max(0, totalFreight - totalDiscount)), margin + tableWidth - 4, y + 5.8, {
    align: "right",
  });
  y += 13;

  pdf.rect(margin, y, tableWidth, 7);
  pdf.text("DESCONTAR NO PAGAMENTO", pageWidth / 2, y + 4.8, {
    align: "center",
  });
  y += 7;
  pdf.rect(margin, y, tableWidth, 22);
  if (report.discounts?.length) {
    pdf.setFillColor(255, 245, 160);
    pdf.rect(margin + 2, y + 2, tableWidth - 4, 13, "F");
    pdf.setDrawColor(0, 0, 0);
    pdf.rect(margin + 2, y + 2, tableWidth - 4, 13);
    pdf.setFontSize(11);
    pdf.text(
      report.discounts
        .map(
          (discount) =>
            `${discount.description}: parcela ${discount.installment}/${discount.installments} - ${moneyText(discount.amount)}`,
        )
        .join(" | "),
      pageWidth / 2,
      y + 10.5,
      { align: "center", maxWidth: tableWidth - 8 },
    );
  }

  const safeDriver = safePdfFilenamePart(report.driver) || "Sem nome";
  const safePeriod = safePdfFilenamePart(period) || "Todo periodo";
  pdf.save(`Fechamento Motorista - ${safeDriver} - ${safePeriod}.pdf`);
}

const coverDate = (value: string) =>
  value ? new Date(value).toLocaleDateString("pt-BR") : new Date().toLocaleDateString("pt-BR");
const uniqueCoverDocuments = (documents: CoverDocumentExport[]) => [
  ...new Map(
    documents.map((document) => {
      const clean = (value: string | undefined) => String(value || "").replace(/\W/g, "").toUpperCase();
      const key = clean(document.cteKey)
        ? `CHAVE:${clean(document.cteKey)}`
        : clean(document.cte)
          ? `CTE:${clean(document.cte)}`
          : clean(document.manualCoverNumber)
            ? `CAPA:${clean(document.manualCoverNumber)}`
            : `NF:${clean(document.invoiceKey || document.invoice)}`;
      return [key, document] as const;
    }),
  ).values(),
];

export function exportCoverPdf(cover: CoverExport) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 14;
  const width = 182;
  const title = cover.kind === "shipment"
    ? "PROTOCOLO DE EMBARQUE"
    : cover.kind === "collection"
      ? "PROTOCOLO DE COLETA"
      : "PROTOCOLO DE CAPAS";
  const protocol = cover.id || Date.now().toString().slice(-8);
  const isOperationalCover = cover.kind === "shipment" || cover.kind === "collection";
  const columns = 3;
  const cellWidth = width / columns;
  const headerY = 56;
  const rowsPerPage = 24;
  const documentsPerPage = isOperationalCover ? 25 : rowsPerPage * columns;
  const documents = uniqueCoverDocuments(cover.documents);
  const pages = Math.max(1, Math.ceil(documents.length / documentsPerPage));

  for (let page = 0; page < pages; page++) {
    if (page) pdf.addPage();
    const pageDocuments = documents.slice(
      page * documentsPerPage,
      (page + 1) * documentsPerPage,
    );
    pdf.setDrawColor(25, 25, 25);
    pdf.setTextColor(178, 192, 183);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(Math.min(42, Math.max(24, 330 / Math.max(6, cover.partnerName.length))));
    pdf.text(cover.partnerName.toUpperCase(), 105, 162, { align: "center", angle: 35, maxWidth: 150 });
    pdf.setTextColor(0, 0, 0);
    pdf.setLineWidth(0.35);
    pdf.rect(margin, 14, width, 34);
    pdf.line(margin + 40, 14, margin + 40, 48);
    pdf.line(margin + 124, 14, margin + 124, 48);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(17);
    pdf.text("MVFLOG", margin + 20, 31, { align: "center" });
    pdf.setFontSize(10);
    pdf.text(cover.partnerName.toUpperCase(), margin + 82, 23, { align: "center", maxWidth: 80 });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text("CAPA DE DOCUMENTOS DA TRANSPORTADORA", margin + 82, 30, { align: "center" });
    pdf.text(`Gerado em ${coverDate(cover.createdAt)}`, margin + 82, 37, { align: "center" });
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(title, margin + 153, 23, { align: "center", maxWidth: 54 });
    pdf.setFontSize(13);
    pdf.text(protocol, margin + 153, 33, { align: "center" });
    pdf.setFontSize(8);
    pdf.text(`${documents.length} item(ns) · ${page + 1}/${pages}`, margin + 153, 41, { align: "center" });
    pdf.rect(margin, 48, width, 8);
    pdf.setFontSize(8.5);
    pdf.text(`${title} - ${cover.partnerName}`, margin + width / 2, 53.3, { align: "center" });
    pdf.setFillColor(0, 0, 0);
    pdf.rect(margin, headerY, width, 7, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(8);
    if (isOperationalCover) {
      const tableColumns = [
        { label: "CTE", width: 22 },
        { label: "NF", width: 24 },
        { label: "REMETENTE", width: 37 },
        { label: "DESTINATÁRIO", width: 39 },
        { label: "VOLUMES", width: 17 },
        { label: "PESO", width: 19 },
        { label: "VALOR", width: 24 },
      ];
      let x = margin;
      tableColumns.forEach((column) => {
        pdf.text(column.label, x + column.width / 2, headerY + 4.8, { align: "center", maxWidth: column.width - 2 });
        x += column.width;
      });
      pdf.setTextColor(0, 0, 0);
      let y = headerY + 7;
      pageDocuments.forEach((document, row) => {
        if (row % 2 === 1) {
          pdf.setFillColor(205, 205, 205);
          pdf.rect(margin, y, width, 7, "F");
        }
        const values = [
          document.cte || "-",
          document.invoice || "-",
          document.sender || "-",
          document.recipient || "-",
          String(document.volumes ?? "-"),
          document.weight === undefined ? "-" : document.weight.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
          document.merchandiseValue === undefined ? "-" : document.merchandiseValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        ];
        x = margin;
        tableColumns.forEach((column, index) => {
          pdf.rect(x, y, column.width, 7);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(index === 2 || index === 3 ? 6.3 : 7.2);
          pdf.text(values[index], x + column.width / 2, y + 4.7, { align: "center", maxWidth: column.width - 2 });
          x += column.width;
        });
        y += 7;
      });
      while (y < headerY + 7 + 25 * 7) {
        if (Math.round((y - headerY - 7) / 7) % 2 === 1) {
          pdf.setFillColor(205, 205, 205);
          pdf.rect(margin, y, width, 7, "F");
        }
        x = margin;
        tableColumns.forEach((column) => {
          pdf.rect(x, y, column.width, 7);
          x += column.width;
        });
        y += 7;
      }
      const footerY = 252;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.text(`Gerado por: ${cover.generatedBy || "Não informado"}`, margin, footerY);
      pdf.line(margin + 30, footerY + 12, margin + width - 30, footerY + 12);
      pdf.setFontSize(7.5);
      pdf.text("ASSINATURA DO RESPONSÁVEL / DATA", margin + width / 2, footerY + 17, { align: "center" });
      continue;
    }
    for (let col = 0; col < columns; col++)
      pdf.text(cover.kind === "return" ? "CAPA / CTE" : "CTE", margin + cellWidth * col + cellWidth / 2, headerY + 4.8, { align: "center" });
    pdf.setTextColor(0, 0, 0);
    let y = headerY + 7;
    const visibleRows = Math.max(1, Math.ceil(pageDocuments.length / columns));
    for (let row = 0; row < visibleRows; row++) {
      if (row % 2 === 1) {
        pdf.setFillColor(205, 205, 205);
        pdf.rect(margin, y, width, 7, "F");
      }
      pdf.rect(margin, y, width, 7);
      for (let col = 1; col < columns; col++) pdf.line(margin + cellWidth * col, y, margin + cellWidth * col, y + 7);
      for (let col = 0; col < columns; col++) {
        const document = pageDocuments[row + col * visibleRows];
        if (!document) continue;
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8.5);
        const documentNumber = document.manualCoverNumber || document.cte || document.invoice || "SEM CTE";
        pdf.text(documentNumber.padStart(9, "0"), margin + cellWidth * col + cellWidth / 2, y + 4.8, { align: "center" });
      }
      y += 7;
    }
    y = Math.max(y + 13, 238);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(`Gerado por: ${cover.generatedBy || "Não informado"}`, margin, y);
    y += 12;
    pdf.line(margin + 30, y, margin + width - 30, y);
    pdf.setFontSize(7.5);
    pdf.text("ASSINATURA DO RESPONSÁVEL / DATA", margin + width / 2, y + 5, { align: "center" });
  }
  const safePartner = cover.partnerName.replace(/[\\/:*?"<>|]+/g, "-");
  const kindLabel = cover.kind === "shipment" ? "Embarque" : cover.kind === "collection" ? "Coleta" : "Capas";
  pdf.save(`Capa ${kindLabel} - ${safePartner} - ${coverDate(cover.createdAt).replace(/\//g, "-")}.pdf`);
}

export function exportCoverDetailedPdf(cover: CoverExport) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const margin = 9;
  const pageWidth = 297;
  const columns = [
    { label: "NF", width: 25 },
    { label: "CT-e", width: 22 },
    { label: "Chave CT-e", width: 68 },
    { label: "Remetente", width: 48 },
    { label: "Destinatário", width: 48 },
    { label: "Volumes", width: 18 },
    { label: "Peso", width: 22 },
    { label: "Cidade", width: 27 },
  ];
  const rowHeight = 7;
  const rowsPerPage = 20;
  const documents = uniqueCoverDocuments(cover.documents);
  const pages = Math.max(1, Math.ceil(documents.length / rowsPerPage));
  for (let page = 0; page < pages; page++) {
    if (page) pdf.addPage();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text(`RELATÓRIO COMPLETO DA CAPA ${cover.id}`, margin, 12);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(`${cover.partnerName} · ${coverDate(cover.createdAt)} · Gerado por ${cover.generatedBy || "Não informado"} · Página ${page + 1}/${pages}`, margin, 18);
    let y = 23;
    pdf.setFillColor(24, 107, 73);
    pdf.rect(margin, y, pageWidth - margin * 2, rowHeight, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    let x = margin;
    columns.forEach((column) => {
      pdf.text(column.label, x + 1.5, y + 4.7, { maxWidth: column.width - 3 });
      x += column.width;
    });
    pdf.setTextColor(0, 0, 0);
    y += rowHeight;
    documents.slice(page * rowsPerPage, (page + 1) * rowsPerPage).forEach((document, index) => {
      if (index % 2) {
        pdf.setFillColor(238, 245, 241);
        pdf.rect(margin, y, pageWidth - margin * 2, rowHeight, "F");
      }
      const values = [
        document.invoice || document.manualCoverNumber || "-",
        document.cte || "-",
        document.cteKey || "-",
        document.sender || "-",
        document.recipient || "-",
        String(document.volumes ?? "-"),
        document.weight === undefined ? "-" : `${document.weight.toLocaleString("pt-BR")} kg`,
        document.city || "-",
      ];
      x = margin;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      columns.forEach((column, columnIndex) => {
        pdf.rect(x, y, column.width, rowHeight);
        pdf.text(values[columnIndex], x + 1.5, y + 4.6, { maxWidth: column.width - 3 });
        x += column.width;
      });
      y += rowHeight;
    });
  }
  const safePartner = cover.partnerName.replace(/[\\/:*?"<>|]+/g, "-");
  pdf.save(`Relatorio completo ${cover.id} - ${safePartner}.pdf`);
}

export function exportCoversReportXlsx(covers: CoverExport[], periodFrom: string, periodTo: string) {
  const rows = covers.flatMap((cover) => uniqueCoverDocuments(cover.documents).map((document) => ({
    "Data da capa": coverDate(cover.createdAt),
    Tipo: cover.kind === "shipment" ? "Embarque" : cover.kind === "collection" ? "Coleta" : "Capas",
    Transportadora: cover.partnerName,
    Protocolo: cover.id,
    "Número identificador": cover.sequenceNumber || "",
    "Gerado por": cover.generatedBy || "",
    "Bipado em": coverDate(document.scannedAt),
    NF: document.invoice,
    "Chave NF": document.invoiceKey,
    CTE: document.cte,
    "Número de capa manual": document.manualCoverNumber || "",
    "Chave CTE": document.cteKey,
    "MD-e": document.mde,
    Remetente: document.sender,
    Destinatário: document.recipient,
    Cidade: document.city,
    Emissão: document.date,
    Entrega: document.deliveryDate,
    Status: document.status,
    Volumes: document.volumes ?? "",
    "Peso (kg)": document.weight ?? "",
    "Valor da mercadoria": document.merchandiseValue ?? "",
  })));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Aviso: "Nenhuma nota encontrada no período selecionado." }]);
  sheet["!cols"] = [14, 14, 22, 18, 18, 22, 14, 14, 48, 14, 20, 48, 14, 24, 24, 20, 14, 14, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, "Capas");
  const label = `${periodFrom || "inicio"} a ${periodTo || "hoje"}`.replace(/[\\/:*?"<>|]+/g, "-");
  XLSX.writeFile(workbook, `Relatorio de Capas - ${label}.xlsx`);
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
