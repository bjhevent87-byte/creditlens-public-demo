const REQUIRED = ["period", "revenue", "operatingProfit", "operatingCashFlow", "totalAssets", "totalLiabilities", "equity"];
const AMOUNTS = [
  "revenue", "operatingProfit", "netIncome", "costOfSales", "operatingCashFlow", "investingCashFlow",
  "financingCashFlow", "cash", "totalAssets", "totalLiabilities", "equity", "currentAssets",
  "currentLiabilities", "accountsReceivable", "inventory", "accountsPayable", "shortTermDebt",
  "longTermDebt", "financeCosts", "interestExpense", "capex", "intangibleCapex",
];

export const MANUAL_CSV_COLUMNS = ["period", ...AMOUNTS];

function csvRows(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(field.trim()); field = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseManualStatementsCsv(csvText, { unit = "억원", sourceName = "고객 제출 CSV" } = {}) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  if (!text || Buffer.byteLength(text, "utf8") > 150_000) throw new Error("CSV 파일은 150KB 이하로 입력해 주세요.");
  const rows = csvRows(text);
  if (rows.length < 3 || rows.length > 5) throw new Error("헤더와 연간 재무 2~4개년을 입력해 주세요.");
  const headers = rows[0];
  if (new Set(headers).size !== headers.length) throw new Error("CSV 헤더에 중복 계정명이 있습니다.");
  for (const field of REQUIRED) if (!headers.includes(field)) throw new Error(`필수 열 ${field}이(가) 없습니다.`);
  const multiplier = { 원: 1, 천원: 1_000, 백만원: 1_000_000, 억원: 100_000_000 }[unit];
  if (!multiplier) throw new Error("금액 단위는 원·천원·백만원·억원 중 하나를 선택해 주세요.");
  const normalized = rows.slice(1).map((cells, rowIndex) => {
    if (cells.length !== headers.length) throw new Error(`${rowIndex + 2}행의 열 개수가 헤더와 다릅니다.`);
    const values = Object.fromEntries(headers.map((name, index) => [name, cells[index]]));
    const period = String(values.period || "");
    if (!/^20\d{2}$/.test(period)) throw new Error(`${rowIndex + 2}행의 연도는 YYYY 형식이어야 합니다.`);
    const record = { period, fsDiv: "OFS", source: `${sourceName} · 원본 미검증`, workingCapitalAccountScope: "고객 제출 계정 · 정의 확인 필요" };
    for (const field of AMOUNTS) {
      const input = values[field];
      if (input === undefined || input === "") { record[field] = null; continue; }
      const cleaned = String(input).replaceAll(",", "").replaceAll(" ", "");
      if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) throw new Error(`${period}년 ${field}에 숫자가 아닌 값이 있습니다.`);
      record[field] = Number(cleaned) * multiplier;
      if (!Number.isFinite(record[field])) throw new Error(`${period}년 ${field} 금액이 너무 큽니다.`);
    }
    for (const field of REQUIRED.slice(1)) if (!Number.isFinite(record[field])) throw new Error(`${period}년 필수 계정 ${field}이(가) 비어 있습니다. 결측값은 0으로 계산하지 않습니다.`);
    const gap = record.totalAssets - record.totalLiabilities - record.equity;
    if (record.totalAssets <= 0 || record.equity === 0 || Math.abs(gap) > Math.max(Math.abs(record.totalAssets) * 0.005, 100_000_000)) {
      throw new Error(`${period}년 자산=부채+자본 검증에 실패했습니다. 금액 단위와 입력값을 확인해 주세요.`);
    }
    return record;
  });
  const periods = normalized.map((row) => row.period);
  if (new Set(periods).size !== periods.length) throw new Error("동일한 연도가 중복 입력되었습니다.");
  return normalized.sort((left, right) => left.period.localeCompare(right.period));
}
