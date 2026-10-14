const BASE_URL = "https://kosis.kr/openapi/";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const PERIOD_ORDER = ["M", "Q", "Y", "H", "D"];
const FREQUENCY_CODES = { "월": "M", "분기": "Q", "년": "Y", "연": "Y", "반기": "H", "일": "D" };

function requireId(value, label) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw new Error(`${label}가 올바르지 않습니다.`);
  return id;
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.list)) return payload.list;
  const message = String(payload?.errMsg || payload?.message || payload?.error || "");
  if (message) throw new Error(`KOSIS 응답을 확인해 주세요: ${message.slice(0, 160)}`);
  return [];
}

function numeric(value) {
  const raw = String(value ?? "").replaceAll(",", "").trim();
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function periodText(value, frequency) {
  const raw = String(value || "").replace(/\D/g, "");
  if (frequency === "M" && raw.length === 6) return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  if (frequency === "D" && raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
  if (frequency === "Q" && raw.length >= 5) return `${raw.slice(0, 4)} ${raw.slice(4)}분기`;
  return String(value || "");
}

export function extractKosisSeries(rows, { orgId, tblId, tableName, frequency, query = "", limit = 120 }) {
  const groups = new Map();
  for (const row of rows) {
    const value = numeric(row?.DT);
    if (value === null || !row?.PRD_DE) continue;
    const codes = [row.ITM_ID, ...Array.from({ length: 8 }, (_, index) => row[`C${index + 1}`])];
    const key = codes.map((part) => String(part || "")).join("|");
    const names = [row.ITM_NM, ...Array.from({ length: 8 }, (_, index) => row[`C${index + 1}_NM`])].filter(Boolean);
    if (!groups.has(key)) groups.set(key, { key, name: [...new Set(names)].join(" · ") || tableName, unit: row.UNIT_NM || "", values: [] });
    groups.get(key).values.push({ period: String(row.PRD_DE), value });
  }
  const series = [];
  for (const group of groups.values()) {
    const unique = [...new Map(group.values.map((point) => [point.period, point])).values()].sort((a, b) => b.period.localeCompare(a.period));
    if (unique.length < 2) continue;
    const comparisonWarning = ["M", "Q"].includes(frequency) && !/계절조정|전년동기/.test(group.name)
      ? "원계열의 직전 수록시점 비교에는 계절성이 섞일 수 있습니다. 같은 달·분기 전년 동기 또는 계절조정 계열로 재확인하세요."
      : "";
    series.push({
      key: group.key,
      name: group.name,
      unit: group.unit,
      latest: unique[0].value,
      previous: unique[1].value,
      latestPeriod: periodText(unique[0].period, frequency),
      previousPeriod: periodText(unique[1].period, frequency),
      frequency,
      comparisonWarning,
      source: `https://kosis.kr/statHtml/statHtml.do?orgId=${encodeURIComponent(orgId)}&tblId=${encodeURIComponent(tblId)}`,
      tableName,
      orgId,
      tblId,
    });
  }
  const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  return series.filter((item) => terms.every((term) => item.name.toLowerCase().includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name, "ko")).slice(0, limit);
}

export class KosisService {
  constructor({ apiKey = "", cache, fetchImpl = fetch } = {}) {
    this.apiKey = String(apiKey).trim();
    this.cache = cache;
    this.fetchImpl = fetchImpl;
  }

  get configured() { return Boolean(this.apiKey); }

  async request(endpoint, params, ttlMs = 60 * 60_000) {
    if (!this.configured) throw new Error("KOSIS_API_KEY가 설정되지 않았습니다. CreditLens .env에 추가해 주세요.");
    const cacheKey = `kosis:${endpoint}:${JSON.stringify(params)}`;
    const cached = this.cache?.get(cacheKey);
    if (cached) return cached;
    const url = new URL(endpoint, BASE_URL);
    for (const [key, value] of Object.entries({ method: "getList", format: "json", jsonVD: "Y", ...params, apiKey: this.apiKey })) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new Error("KOSIS 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (!response.ok) throw new Error(`KOSIS 조회 실패 (${response.status}). 인증키·이용승인·통계표를 확인해 주세요.`);
    const body = await response.text();
    if (body.length > 3_000_000) throw new Error("통계표가 너무 큽니다. 더 세분화된 통계표를 선택해 주세요.");
    let payload;
    try { payload = JSON.parse(body); } catch { throw new Error("KOSIS가 JSON이 아닌 응답을 반환했습니다."); }
    const rows = rowsOf(payload);
    this.cache?.set(cacheKey, rows, ttlMs);
    return rows;
  }

  async search(query) {
    const searchNm = String(query || "").trim();
    if (searchNm.length < 2 || searchNm.length > 50) throw new Error("검색어를 2~50자로 입력해 주세요.");
    const rows = await this.request("statisticsSearch.do", { searchNm, sort: "RANK", startCount: 1, resultCount: 20 });
    return rows.filter((row) => ID_PATTERN.test(String(row.ORG_ID || "")) && ID_PATTERN.test(String(row.TBL_ID || "")))
      .map((row) => ({ orgId: row.ORG_ID, tblId: row.TBL_ID, tableName: row.TBL_NM || row.TBL_ID, organization: row.ORG_NM || "", lastPeriod: row.END_PRD_DE || "" }))
      .slice(0, 20);
  }

  async table({ orgId, tblId }) {
    const ids = { orgId: requireId(orgId, "기관 ID"), tblId: requireId(tblId, "통계표 ID") };
    const [periods, names] = await Promise.all([
      this.request("statisticsData.do", { method: "getMeta", type: "PRD", ...ids }),
      this.request("statisticsData.do", { method: "getMeta", type: "TBL", ...ids }),
    ]);
    const frequencies = [...new Set(periods.map((row) => FREQUENCY_CODES[String(row.PRD_SE || "").trim()] || String(row.PRD_SE || "").trim()).filter((frequency) => PERIOD_ORDER.includes(frequency)))].sort((a, b) => PERIOD_ORDER.indexOf(a) - PERIOD_ORDER.indexOf(b));
    return { ...ids, tableName: names[0]?.TBL_NM || ids.tblId, frequencies, latestPeriod: periods[0]?.END_PRD_DE || periods[0]?.PRD_DE || "" };
  }

  async series({ orgId, tblId, frequency, query = "" }) {
    const ids = { orgId: requireId(orgId, "기관 ID"), tblId: requireId(tblId, "통계표 ID") };
    const prdSe = String(frequency || "").toUpperCase();
    if (!PERIOD_ORDER.includes(prdSe)) throw new Error("지원하지 않는 수록주기입니다.");
    const term = String(query || "").trim();
    if (term.length > 50) throw new Error("세부 계열 검색어는 50자 이내로 입력해 주세요.");
    const dimensions = await this.request("statisticsData.do", { method: "getMeta", type: "ITM", ...ids });
    const dimensionIds = [...new Set(dimensions.map((row) => String(row.OBJ_ID || "")).filter((id) => id && id !== "ITEM"))];
    const objects = Object.fromEntries((dimensionIds.length ? dimensionIds : ["A"]).slice(0, 8).map((_, index) => [`objL${index + 1}`, "ALL"]));
    const rows = await this.request("Param/statisticsParameterData.do", { ...ids, itmId: "ALL", ...objects, prdSe, newEstPrdCnt: 2 });
    if (rows.length > 10_000) throw new Error("통계표의 계열이 너무 많습니다. 더 세분화된 통계표를 선택해 주세요.");
    const nameRows = await this.request("statisticsData.do", { method: "getMeta", type: "TBL", ...ids });
    return { ...ids, frequency: prdSe, tableName: nameRows[0]?.TBL_NM || ids.tblId, series: extractKosisSeries(rows, { ...ids, tableName: nameRows[0]?.TBL_NM || ids.tblId, frequency: prdSe, query: term }) };
  }
}
