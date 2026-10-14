import { readFile } from "node:fs/promises";

// OpenDART uses legal entity names; the trading screen uses listed stock names.
const LISTED_STOCK_NAMES = new Map([["005380", "현대차"]]);

export class CompanyRepository {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.companies = null;
  }

  async load() {
    if (!this.companies) this.companies = JSON.parse(await readFile(this.dataPath, "utf8")).map((item) => {
      const listedName = LISTED_STOCK_NAMES.get(item.stockCode);
      return listedName ? { ...item, name: listedName, legalName: item.name } : item;
    });
    return this.companies;
  }

  async search(query, limit = 12) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, "");
    const list = await this.load();
    return list
      .filter((item) => item.name.toLowerCase().includes(q) || item.legalName?.toLowerCase().includes(q) || (digits && item.stockCode.includes(digits)))
      .sort((a, b) => {
        const exactA = a.name.toLowerCase() === q || a.legalName?.toLowerCase() === q || (digits && a.stockCode === digits);
        const exactB = b.name.toLowerCase() === q || b.legalName?.toLowerCase() === q || (digits && b.stockCode === digits);
        if (exactA !== exactB) return Number(exactB) - Number(exactA);
        return a.name.length - b.name.length;
      })
      .slice(0, limit);
  }

  async find(corpCode) {
    return (await this.load()).find((item) => item.corpCode === corpCode) || null;
  }
}
