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
        cte: String(value(row, "cte") ?? "").trim(),
        cteKey: String(value(row, "cteKey") ?? "").trim(),
        invoice: String(value(row, "invoice") ?? "").trim(),
        sender: String(value(row, "sender") ?? "").trim(),
        senderCnpj: String(value(row, "senderCnpj") ?? "").trim(),
        recipient: String(value(row, "recipient") ?? "").trim(),
        recipientCnpj: String(value(row, "recipientCnpj") ?? "").trim(),
        city: String(value(row, "city") ?? "").trim(),
        observation: String(value(row, "observation") ?? "").trim(),
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
    "DATA DE ENTREGA",
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
        row.tde || "",
        row.tda || "",
        (isFreightComplement ? row.total : row.dedicated) || "",
        row.trt || "",
        isFreightComplement ? "" : row.partnerFreight || "",
        row.total,
      ];
    }),
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
      "",
      "TOTAL:",
      {
        f: `SUM(M7:M${rows.length + 6})`,
        v: rows.reduce((sum, row) => sum + row.total, 0),
        t: "n",
      },
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!merges"] = Array.from({ length: 5 }, (_, r) => ({
    s: { r, c: 0 },
    e: { r, c: 12 },
  }));
  const last = rows.length + 7;
  sheet["!cols"] = [
    12, 12, 19, 34, 38, 24, 18, 12, 12, 12, 12, 16, 18,
  ].map((wch) => ({ wch }));
  sheet["!rows"] = [
    { hpt: 21 },
    { hpt: 20 },
    { hpt: 20 },
    { hpt: 20 },
    { hpt: 22 },
    { hpt: 24 },
  ];
  sheet["!autofilter"] = { ref: `A6:M${last - 1}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 6 };
  for (let r = 0; r < last; r++)
    for (let c = 0; c < 13; c++) {
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
  for (let c = 0; c < 13; c++) {
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
    for (let c = 7; c < 13; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") {
        cell.z = "R$ #,##0.00";
        cell.s.numFmt = "R$ #,##0.00";
      }
    }
  }
  ["L", "M"].forEach((col) => {
    const cell = sheet[`${col}${last}`];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: "FFF200" } },
      font: { color: { rgb: "111111" }, bold: true, sz: 14 },
      alignment: { horizontal: col === "L" ? "left" : "right" },
      ...(col === "M" ? { numFmt: "R$ #,##0.00" } : {}),
    };
    cell.z = col === "M" ? "R$ #,##0.00" : undefined;
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
      row.total,
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

function buildArgiusSheet(rows: ExportRow[]) {
  const header = [
    "ENTRADA",
    "CTE",
    "NF",
    "REMETENTE",
    "CNPJ",
    "DESTINATARIO",
    "CNPJ",
    "CIDADE",
    "T.D.E",
    "T.D.A",
    "DEDICADO",
    "TOTAL COMISSAO",
  ];
  const data = [
    header,
    ...rows.map((row) => [
      row.date ? new Date(`${row.date}T12:00:00`) : "",
      row.cte,
      row.invoice,
      row.sender,
      row.senderCnpj,
      row.recipient,
      row.recipientCnpj,
      row.city,
      row.tde || "",
      row.tda || "",
      (normalize(row.status) === "cf" ? row.total : row.dedicated) || "",
      row.total,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [
    12, 12, 25, 34, 20, 38, 20, 25, 12, 12, 12, 18,
  ].map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:L${rows.length + 1}` };
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
    }
    const dateCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    if (dateCell?.v instanceof Date) {
      dateCell.t = "d";
      dateCell.z = "dd/mm/yyyy";
      dateCell.s.numFmt = "dd/mm/yyyy";
    }
    for (let c = 8; c < 12; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") {
        cell.z = "R$ #,##0.00";
        cell.s.numFmt = "R$ #,##0.00";
      }
    }
  }
  return sheet;
}

export function exportClosingXlsx(
  rows: ExportRow[],
  partnerName: string,
  period: string,
) {
  const workbook = XLSX.utils.book_new();
  const isArgius = normalize(partnerName) === "argius";
  XLSX.utils.book_append_sheet(
    workbook,
    isArgius ? buildArgiusSheet(rows) : buildClosingSheet(rows, partnerName, period),
    "DadosExcel",
  );
  const freightComplements = rows.filter(
    (row) => normalize(row.status) === "cf",
  );
  if (freightComplements.length && !isArgius) {
    XLSX.utils.book_append_sheet(
      workbook,
      buildFreightComplementsSheet(freightComplements),
      "OUTROS",
    );
  }
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
