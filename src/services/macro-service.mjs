const SERIES = [
  { id: "kr-base-rate", name: "한국 기준금리", code: "722Y001", frequency: "D", items: ["0101000"], unit: "%" },
  { id: "kr-3y", name: "국고채 3년", code: "817Y002", frequency: "D", items: ["010200000"], unit: "%" },
  { id: "usd-krw", name: "원/달러 환율", code: "731Y001", frequency: "D", items: ["0000001"], unit: "원" },
  { id: "kr-cpi", name: "소비자물가지수", code: "901Y009", frequency: "M", items: ["0"], unit: "2020=100" },
  { id: "kr-ccsi", name: "소비자심리지수", code: "511Y002", frequency: "M", items: ["FME"], unit: "지수" },
  { id: "kr-industrial-production", name: "전산업생산지수", code: "901Y033", frequency: "M", items: ["A00", "2"], unit: "2020=100" },
  { id: "export-volume", name: "수출물량지수", code: "403Y002", frequency: "M", items: ["*AA"], unit: "2020=100" },
  { id: "manufacturing-bsi", name: "제조업 업황 BSI", code: "512Y007", frequency: "M", items: ["AA", "C0000"], unit: "지수" },
];

function dateText(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export class MacroService {
  constructor({ apiKey, cache, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.cache = cache;
    this.fetchImpl = fetchImpl;
  }

  get configured() { return Boolean(this.apiKey); }

  async latest(meta) {
    if (!this.apiKey) return { ...meta, status: "자료없음", message: "ECOS_API_KEY 미설정" };
    const end = new Date();
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 2);
    const startText = meta.frequency === "M" ? dateText(start).slice(0, 6) : dateText(start);
    const endText = meta.frequency === "M" ? dateText(end).slice(0, 6) : dateText(end);
    const path = meta.items.map(encodeURIComponent).join("/");
    const key = `ecos:${meta.id}:${endText}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    try {
      const pageSize = 1000;
      const rows = [];
      let cursor = 1;
      let totalCount = Infinity;
      while (cursor <= totalCount) {
        const finish = cursor + pageSize - 1;
        const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(this.apiKey)}/json/kr/${cursor}/${finish}/${meta.code}/${meta.frequency}/${startText}/${endText}/${path}`;
        const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`ECOS 통신 오류 (${response.status})`);
        const payload = await response.json();
        const block = payload?.StatisticSearch;
        const pageRows = Array.isArray(block?.row) ? block.row : [];
        totalCount = Number(block?.list_total_count || pageRows.length || 0);
        rows.push(...pageRows);
        if (!pageRows.length || rows.length >= totalCount) break;
        cursor += pageSize;
      }
      const valid = rows.map((row) => ({ date: row.TIME, value: Number(row.DATA_VALUE) })).filter((row) => Number.isFinite(row.value)).sort((a, b) => a.date.localeCompare(b.date));
      const latest = valid.at(-1);
      const previous = valid.at(-2);
      const result = { ...meta, status: latest ? "확인" : "자료없음", latest, previous, source: "한국은행 ECOS", collectedAt: new Date().toISOString(), paginationComplete: Number.isFinite(totalCount) && rows.length >= totalCount };
      this.cache.set(key, result);
      return result;
    } catch (error) {
      return { ...meta, status: "조회실패", message: error.message, source: "한국은행 ECOS" };
    }
  }

  async snapshot() {
    return Promise.all(SERIES.map((meta) => this.latest(meta)));
  }
}
