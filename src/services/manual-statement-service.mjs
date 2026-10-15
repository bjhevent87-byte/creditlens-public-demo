const REQUIRED = ["period", "revenue", "operatingProfit", "operatingCashFlow", "totalAssets", "totalLiabilities", "equity"];
const AMOUNTS = [
  "revenue", "operatingProfit", "netIncome", "costOfSales", "operatingCashFlow", "investingCashFlow",
  "financingCashFlow", "cash", "totalAssets", "totalLiabilities", "equity", "currentAssets",
  "currentLiabilities", "accountsReceivable", "inventory", "accountsPayable", "shortTermDebt",
  "longTermDebt", "financeCosts", "interestExpense", "capex", "intangibleCapex",
];

export const MANUAL_CSV_COLUMNS = ["period", ...AMOUNTS];

export const MANUAL_FIELD_LABELS = {
  revenue: "매출액", operatingProfit: "영업이익", netIncome: "당기순이익", costOfSales: "매출원가",
  operatingCashFlow: "영업활동현금흐름", investingCashFlow: "투자활동현금흐름",
  financingCashFlow: "재무활동현금흐름", cash: "현금및현금성자산",
  totalAssets: "자산총계", totalLiabilities: "부채총계", equity: "자본총계",
  currentAssets: "유동자산", currentLiabilities: "유동부채",
  accountsReceivable: "매출채권", inventory: "재고자산", accountsPayable: "매입채무",
  shortTermDebt: "단기 금융차입금", longTermDebt: "장기 금융차입금",
  financeCosts: "금융비용", interestExpense: "이자비용", capex: "유형자산 취득",
  intangibleCapex: "무형자산 취득",
};

export const MANUAL_CSV_LABELS = { period: "연도", ...MANUAL_FIELD_LABELS };
const HEADER_ALIASES = new Map(MANUAL_CSV_COLUMNS.flatMap((field) => [
  [field, field], [MANUAL_CSV_LABELS[field], field],
]));

function normalizeCsvHeaders(rawHeaders) {
  const headers = rawHeaders.map((header) => {
    const field = HEADER_ALIASES.get(header.trim());
    if (!field) throw new Error(`알 수 없는 CSV 계정명 '${header}'입니다. 한글 양식의 계정명과 원본 계정을 대조해 주세요.`);
    return field;
  });
  if (new Set(headers).size !== headers.length) throw new Error("CSV에 같은 계정이 중복되었습니다. 한글·영어 헤더가 같은 계정을 가리키는지 확인하세요.");
  return headers;
}

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
  const headers = normalizeCsvHeaders(rows[0]);
  for (const field of REQUIRED) if (!headers.includes(field)) throw new Error(`필수 열 ${MANUAL_CSV_LABELS[field]}이(가) 없습니다.`);
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
      if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) throw new Error(`${period}년 ${MANUAL_CSV_LABELS[field]}에 숫자가 아닌 값이 있습니다.`);
      record[field] = Number(cleaned) * multiplier;
      if (!Number.isFinite(record[field])) throw new Error(`${period}년 ${MANUAL_CSV_LABELS[field]} 금액이 너무 큽니다.`);
    }
    for (const field of REQUIRED.slice(1)) if (!Number.isFinite(record[field])) throw new Error(`${period}년 필수 계정 ${MANUAL_CSV_LABELS[field]}이(가) 비어 있습니다. 결측값은 0으로 계산하지 않습니다.`);
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

// 입력자료의 오류를 숨기거나 0으로 바꾸지 않고, 담당자가 원문과 대조해 수정할 과제로 반환한다.
// 이 결과는 원본 PDF의 내용이나 진위를 확인했다는 뜻이 아니다.
export function inspectManualStatementsCsv(csvText, { unit = "억원", sourceName = "고객 제출 CSV", fsDiv = "OFS", loanRequest = {}, overrides = [] } = {}) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  if (!text || Buffer.byteLength(text, "utf8") > 150_000) throw new Error("CSV 파일은 150KB 이하로 입력해 주세요.");
  const rows = csvRows(text);
  if (rows.length < 3 || rows.length > 5) throw new Error("헤더와 연간 재무 2~4개년을 입력해 주세요.");
  const headers = normalizeCsvHeaders(rows[0]);
  if (!headers.includes("period")) throw new Error("연도 열이 없습니다.");
  if (!["OFS", "CFS"].includes(fsDiv)) throw new Error("별도·연결 재무제표 유형을 선택해 주세요.");
  const multiplier = { 원: 1, 천원: 1_000, 백만원: 1_000_000, 억원: 100_000_000 }[unit];
  if (!multiplier) throw new Error("금액 단위는 원·천원·백만원·억원 중 하나를 선택해 주세요.");
  const revisions = Array.isArray(overrides) ? overrides.slice(0, 100) : [];
  const byPeriod = new Map();
  const changes = [];
  const invalidInputs = new Map();
  const normalized = rows.slice(1).map((cells, rowIndex) => {
    if (cells.length !== headers.length) throw new Error(`${rowIndex + 2}행의 열 개수가 헤더와 다릅니다.`);
    const values = Object.fromEntries(headers.map((name, index) => [name, cells[index]]));
    const period = String(values.period || "");
    if (!/^20\d{2}$/.test(period)) throw new Error(`${rowIndex + 2}행의 연도는 YYYY 형식이어야 합니다.`);
    const record = { period, fsDiv, source: `${sourceName} · 원본 대조 전`, workingCapitalAccountScope: "고객 제출 계정 · 정의 확인 필요" };
    for (const field of AMOUNTS) {
      const raw = values[field];
      if (raw === undefined || raw === "") { record[field] = null; continue; }
      const cleaned = String(raw).replaceAll(",", "").replaceAll(" ", "");
      if (!/^-?\d+(?:\.\d+)?$/.test(cleaned) || !Number.isFinite(Number(cleaned) * multiplier)) {
        record[field] = null;
        invalidInputs.set(`${period}:${field}`, String(raw));
      } else record[field] = Number(cleaned) * multiplier;
    }
    byPeriod.set(period, { record, values });
    return record;
  });
  if (new Set(normalized.map((row) => row.period)).size !== normalized.length) throw new Error("동일한 연도가 중복 입력되었습니다.");

  for (const revision of revisions) {
    const period = String(revision?.period || "");
    const field = String(revision?.field || "");
    const entry = byPeriod.get(period);
    if (!entry || !AMOUNTS.includes(field)) continue;
    const value = String(revision.value ?? "").replaceAll(",", "").replaceAll(" ", "");
    if (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value) * multiplier)) continue;
    const previous = entry.record[field];
    entry.record[field] = Number(value) * multiplier;
    entry.values[field] = value;
    invalidInputs.delete(`${period}:${field}`);
    changes.push({ period, field, label: MANUAL_CSV_LABELS[field], previous, current: entry.record[field], page: String(revision.page || "").slice(0, 30), note: String(revision.note || "").slice(0, 300), status: "담당자 수정 · 원본 자동 대조 아님" });
  }

  normalized.sort((left, right) => left.period.localeCompare(right.period));
  const issues = [];
  const add = ({ id, period, type, severity = "review", title, detail, fields = [], affects = [], values = {} }) => {
    issues.push({ id, period, type, severity, title, detail, fields, affects, values });
  };
  for (const [index, record] of normalized.entries()) {
    const entry = byPeriod.get(record.period);
    const valuesFor = (fields) => Object.fromEntries(fields.map((field) => [field, entry.values[field] ?? ""]));
    for (const field of REQUIRED.slice(1)) {
      if (Number.isFinite(record[field])) continue;
      const invalid = invalidInputs.get(`${record.period}:${field}`);
      add({ id: `${record.period}-${field}`, period: record.period, type: invalid ? "invalid" : "missing", severity: "blocking", title: `${MANUAL_FIELD_LABELS[field]} ${invalid ? "숫자 형식 확인" : "입력 필요"}`, detail: invalid ? `입력값 '${invalid}'을(를) 숫자로 읽지 못했습니다. 원문과 단위를 확인하세요.` : "필수 계정이 비어 있습니다. 원문 값과 단위를 확인해 입력하세요.", fields: [field], affects: field === "operatingCashFlow" ? ["현금창출력", "상환재원"] : field === "revenue" || field === "operatingProfit" ? ["수익성·성장성", "상환능력"] : ["재무구조", "상환능력"], values: valuesFor([field]) });
    }
    const { totalAssets: assets, totalLiabilities: liabilities, equity } = record;
    const gap = assets - liabilities - equity;
    if ([assets, liabilities, equity].every(Number.isFinite) && Math.abs(gap) > Math.max(Math.abs(assets) * 0.005, 100_000_000)) {
      const fields = ["totalAssets", "totalLiabilities", "equity"];
      add({ id: `${record.period}-balance`, period: record.period, type: "balance", severity: "blocking", title: "자산·부채·자본 합계 불일치", detail: `자산 - 부채 - 자본 차이 ${(gap / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원. 세 계정 중 어느 값·단위가 잘못됐는지 원문에서 확인하세요.`, fields, affects: ["부채비율", "ROA", "재무구조 판단"], values: valuesFor(fields) });
    }
    const currentAssetFields = ["currentAssets", "cash", "accountsReceivable", "inventory"];
    if (currentAssetFields.every((field) => Number.isFinite(record[field]))) {
      const components = record.cash + record.accountsReceivable + record.inventory;
      if (record.currentAssets + 1_000_000 < components) {
        add({ id: `${record.period}-current-assets`, period: record.period, type: "current-assets-components", severity: "blocking", title: "유동자산보다 주요 구성계정 합계가 큽니다", detail: `현금·매출채권·재고 합계 ${(components / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원이 유동자산 ${(record.currentAssets / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원보다 큽니다. 네 계정이 모두 유동으로 분류된다는 전제에서 원문 수치·계정 범위를 대조하세요.`, fields: currentAssetFields, affects: ["유동비율", "운전자금 회전", "단기 상환능력"], values: valuesFor(currentAssetFields) });
      }
    }
    if (index > 0) {
      const previous = normalized[index - 1];
      const fields = ["operatingCashFlow", "investingCashFlow", "financingCashFlow", "cash"];
      if (fields.every((field) => Number.isFinite(record[field])) && Number.isFinite(previous.cash)) {
        const flow = record.operatingCashFlow + record.investingCashFlow + record.financingCashFlow;
        const gap = record.cash - previous.cash - flow;
        if (Math.abs(gap) > Math.max(Math.abs(record.cash) * 0.01, 100_000_000)) add({ id: `${record.period}-cash-bridge`, period: record.period, type: "cash-bridge", severity: "review", title: "현금흐름과 현금잔액 증감 차이", detail: `현금잔액 증감과 세 활동 현금흐름 합계 차이 ${(gap / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원. 환율효과 등 조정항목 또는 입력오류를 원문에서 확인하세요.`, fields, affects: ["현금흐름 대조"], values: valuesFor(fields) });
      }
    }
  }
  const latest = normalized.at(-1);
  const purposeFields = new Map();
  if (Number(loanRequest.workingAmount) > 0) for (const field of ["costOfSales", "accountsReceivable", "inventory", "accountsPayable"]) purposeFields.set(field, "운전자금 회전주기");
  if (Number(loanRequest.facilityAmount) > 0) for (const field of ["financeCosts", "capex", "intangibleCapex", "shortTermDebt", "longTermDebt"]) purposeFields.set(field, "시설자금·기존 차입 검토");
  for (const [field, affects] of purposeFields) {
    if (Number.isFinite(latest[field])) continue;
    const entry = byPeriod.get(latest.period);
    const invalid = invalidInputs.get(`${latest.period}:${field}`);
    add({ id: `${latest.period}-${field}`, period: latest.period, type: invalid ? "invalid" : "missing", title: `${MANUAL_FIELD_LABELS[field]} ${invalid ? "숫자 형식 확인" : "자료 필요"}`, detail: invalid ? `입력값 '${invalid}'을(를) 숫자로 읽지 못했습니다. 원문을 확인하세요.` : `${affects}에 필요한 계정입니다. 자료가 없으면 해당 검토를 확정하지 않습니다.`, fields: [field], affects: [affects], values: { [field]: entry.values[field] ?? "" } });
  }
  return { records: normalized, issues, changes, inputUnit: unit };
}
