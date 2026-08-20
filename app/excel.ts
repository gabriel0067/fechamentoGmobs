import XLSX from "xlsx-js-style";

export type ImportedRow = {
  partner: string;
  occurrence: string;
  status: string;
  statusDescription: string;
  eligible: boolean;
  isRedelivery: boolean;
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
  reportedTotal?: number;
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
  recipient: ["destinatario", "destinatário", "recebedor", "cliente destino"],
  city: ["cidade", "destino", "municipio", "município", "rota"],
  freight: [
    "frete",
    "frete parceiro",
    "valor frete",
    "frete dy",
    "frete d y",
    "frete base",
    "frete valor",
  ],
  tde: ["tde", "tds", "t d e", "t d s", "taxa dificuldade entrega"],
  tda: ["tda", "t d a", "taxa adicional"],
  trt: ["trt", "t r t"],
  redelivery: ["reentrega", "re entrega", "valor reentrega"],
  dedicated: ["dedicado", "dedicada", "valor dedicado"],
  adjustment: ["ajuste", "acrescimo", "acréscimo", "desconto"],
  reportedTotal: [
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
      if (remetente >= 0) map.sender = remetente + 1;
      if (destinatario >= 0) {
        map.recipient = destinatario + 1;
        map.city = destinatario + 2;
      }
      if (redespacho >= 0) map.partner = redespacho + 1;
      if (cteParceiro >= 0) map.cte = cteParceiro;
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
        occurrence: String(value(row, "occurrence") ?? "").trim(),
        status: String(value(row, "status") ?? "").trim(),
        statusDescription: String(value(row, "statusDescription") ?? "").trim(),
        eligible: true,
        isRedelivery: false,
        date: excelDate(value(row, "date")),
        cte: String(value(row, "cte") ?? "").trim(),
        invoice: String(value(row, "invoice") ?? "").trim(),
        sender: String(value(row, "sender") ?? "").trim(),
        recipient: String(value(row, "recipient") ?? "").trim(),
        city: String(value(row, "city") ?? "").trim(),
        freight: toNumber(value(row, "freight")),
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
        statusText === "entregue" ||
        statusText === "reentrega";
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

export type ExportRow = ImportedRow & { total: number };
function buildClosingSheet(
  rows: ExportRow[],
  partnerName: string,
  period: string,
) {
  const header = [
    "ENTRADA",
    "CTE",
    "NF",
    "REMETENTE",
    "DESTINATARIO",
    "CIDADE",
    "T.D.E",
    "T.D.A",
    "DEDICADO",
    "TRT",
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
    ...rows.map((row) => [
      row.date ? new Date(`${row.date}T12:00:00`) : "",
      `${row.cte}${row.isRedelivery ? " RE" : ""}`.trim(),
      row.invoice,
      row.sender,
      row.recipient,
      row.city,
      row.tde || "",
      row.tda || "",
      row.dedicated || "",
      row.trt || "",
      row.freight || "",
      row.total,
    ]),
    [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "TOTAL:",
      {
        f: `SUM(L7:L${rows.length + 6})`,
        v: rows.reduce((sum, row) => sum + row.total, 0),
        t: "n",
      },
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const last = rows.length + 7;
  sheet["!cols"] = [12, 12, 19, 34, 38, 24, 12, 12, 12, 12, 16, 18].map(
    (wch) => ({ wch }),
  );
  sheet["!rows"] = [
    { hpt: 21 },
    { hpt: 20 },
    { hpt: 20 },
    { hpt: 20 },
    { hpt: 22 },
    { hpt: 24 },
  ];
  sheet["!autofilter"] = { ref: `A6:L${last - 1}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 6 };
  for (let r = 0; r < last; r++)
    for (let c = 0; c < 12; c++) {
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
  for (let c = 0; c < 12; c++) {
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
    for (let c = 6; c < 12; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") {
        cell.z = "R$ #,##0.00";
        cell.s.numFmt = "R$ #,##0.00";
      }
    }
  }
  ["K", "L"].forEach((col) => {
    const cell = sheet[`${col}${last}`];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "FFF200" } },
      font: { color: { rgb: "111111" }, bold: true, sz: 14 },
      alignment: { horizontal: col === "K" ? "left" : "right" },
      ...(col === "L" ? { numFmt: "R$ #,##0.00" } : {}),
    };
    cell.z = col === "L" ? "R$ #,##0.00" : undefined;
  });
  return sheet;
}

export function exportClosingXlsx(
  rows: ExportRow[],
  partnerName: string,
  period: string,
) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    buildClosingSheet(rows, partnerName, period),
    "DadosExcel",
  );
  XLSX.writeFile(
    workbook,
    `Fechamento ${partnerName} - ${period.replace(/[^a-zA-Z0-9À-ÿ]+/g, " ").trim()}.xlsx`,
    { compression: true },
  );
}

export function exportMultipleClosingsXlsx(
  groups: Array<{ partnerName: string; rows: ExportRow[] }>,
  period: string,
) {
  const workbook = XLSX.utils.book_new();
  const used = new Set<string>();
  groups.forEach(({ partnerName, rows }, index) => {
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
      buildClosingSheet(rows, partnerName, period),
      name,
    );
  });
  XLSX.writeFile(
    workbook,
    `Fechamentos - ${period.replace(/[^a-zA-Z0-9À-ÿ]+/g, " ").trim()}.xlsx`,
    { compression: true },
  );
}
