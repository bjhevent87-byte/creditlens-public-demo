const REPORT_CODE = "11011";
const REPORT_NAMES = { "11011": "사업보고서", "11012": "반기보고서", "11013": "1분기보고서", "11014": "3분기보고서" };

function toNumber(value) {
  const text = String(value ?? "").replaceAll(",", "").trim();
  if (!text || text === "-") return null;
  const parenthesized = text.startsWith("(") && text.endsWith(")");
  const parsed = Number(parenthesized ? `-${text.slice(1, -1)}` : text);
  return Number.isFinite(parsed) ? parsed : null;
}

function selectAccount(rows, { ids = [], names = [], statements = null, flow = false }) {
  const pool = statements ? rows.filter((row) => statements.includes(row.sj_div)) : rows;
  const amount = (row) => toNumber(flow ? (row.thstrm_add_amount || row.thstrm_amount) : row.thstrm_amount);
  for (const id of ids) {
    const row = pool.find((item) => item.account_id === id);
    if (row) return amount(row);
  }
  for (const name of names) {
    const normalized = name.replaceAll(" ", "");
    const row = pool.find((item) => String(item.account_nm || "").replaceAll(" ", "") === normalized);
    if (row) return amount(row);
  }
  return null;
}

function sumFinite(...values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) : null;
}

export function normalizeStatement(rows, year, fsDiv, reportCode = REPORT_CODE) {
  const income = ["IS", "CIS"];
  const revenue = selectAccount(rows, {
    ids: ["ifrs-full_Revenue", "ifrs_Revenue", "dart_OperatingRevenue"],
    names: ["매출액", "수익(매출액)", "영업수익"], statements: income, flow: true,
  });
  const operatingProfit = selectAccount(rows, {
    ids: ["dart_OperatingIncomeLoss", "ifrs-full_ProfitLossFromOperatingActivities"],
    names: ["영업이익", "영업이익(손실)", "영업손익"], statements: income, flow: true,
  });
  const netIncome = selectAccount(rows, {
    ids: ["ifrs-full_ProfitLoss", "ifrs_ProfitLoss"],
    names: ["당기순이익", "당기순이익(손실)", "연결당기순이익"], statements: income, flow: true,
  });
  const currentBorrowings = selectAccount(rows, {
    ids: ["ifrs-full_CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings", "ifrs-full_CurrentBorrowings", "ifrs-full_ShorttermBorrowings"],
    names: ["단기차입금", "유동성장기차입금", "유동차입금"],
  });
  const longBorrowings = selectAccount(rows, {
    ids: ["ifrs-full_NoncurrentBorrowings", "ifrs-full_LongtermBorrowings"],
    names: ["장기차입금", "비유동차입금"],
  });
  const currentBonds = selectAccount(rows, { ids: ["ifrs-full_CurrentPortionOfBondsIssued"], names: ["유동성사채"] });
  const longBonds = selectAccount(rows, { ids: ["ifrs-full_BondsIssued"], names: ["사채"] });
  const currentLeaseLiabilities = selectAccount(rows, {
    ids: ["ifrs-full_CurrentLeaseLiabilities", "dart_CurrentPortionOfLeaseLiabilities"],
    names: ["유동리스부채", "유동성리스부채", "리스부채(유동)"],
  });
  const noncurrentLeaseLiabilities = selectAccount(rows, {
    ids: ["ifrs-full_NoncurrentLeaseLiabilities"],
    names: ["비유동리스부채", "리스부채(비유동)"],
  });
  const financeCosts = selectAccount(rows, {
    ids: ["ifrs-full_FinanceCosts"], names: ["금융비용"], flow: true,
  });
  const disclosedInterestExpense = selectAccount(rows, {
    ids: ["ifrs-full_InterestExpense"], names: ["이자비용"], flow: true,
  });
  return {
    period: String(year),
    rceptNo: rows.find((row) => row.rcept_no)?.rcept_no || null,
    reportType: REPORT_NAMES[reportCode] || "정기보고서",
    reportCode,
    fsDiv,
    revenue,
    operatingProfit,
    netIncome,
    costOfSales: selectAccount(rows, { ids: ["ifrs-full_CostOfSales"], names: ["매출원가"], statements: income, flow: true }),
    financeCosts,
    disclosedInterestExpense,
    // 기존 소비자와의 호환을 유지하되 화면에서는 반드시 금융비용으로 표시한다.
    interestExpense: Number.isFinite(disclosedInterestExpense) ? disclosedInterestExpense : financeCosts,
    interestExpenseBasis: Number.isFinite(disclosedInterestExpense) ? "공시 이자비용" : "포괄손익계산서 금융비용",
    totalAssets: selectAccount(rows, { ids: ["ifrs-full_Assets", "ifrs_Assets"], names: ["자산총계"] }),
    totalLiabilities: selectAccount(rows, { ids: ["ifrs-full_Liabilities", "ifrs_Liabilities"], names: ["부채총계"] }),
    equity: selectAccount(rows, { ids: ["ifrs-full_Equity", "ifrs_Equity"], names: ["자본총계"] }),
    currentAssets: selectAccount(rows, { ids: ["ifrs-full_CurrentAssets"], names: ["유동자산"] }),
    currentLiabilities: selectAccount(rows, { ids: ["ifrs-full_CurrentLiabilities"], names: ["유동부채"] }),
    cash: selectAccount(rows, { ids: ["ifrs-full_CashAndCashEquivalents"], names: ["현금및현금성자산"] }),
    accountsReceivable: selectAccount(rows, { ids: ["ifrs-full_TradeReceivables", "ifrs-full_TradeAndOtherCurrentReceivables"], names: ["매출채권", "매출채권및기타채권"] }),
    inventory: selectAccount(rows, { ids: ["ifrs-full_Inventories"], names: ["재고자산"] }),
    accountsPayable: selectAccount(rows, { ids: ["ifrs-full_TradePayables", "ifrs-full_TradeAndOtherCurrentPayables"], names: ["매입채무", "매입채무및기타채무"] }),
    workingCapitalAccountScope: rows.some((row) => row.account_id === "ifrs-full_TradeReceivables") && rows.some((row) => row.account_id === "ifrs-full_TradePayables")
      ? "순수 매출채권·매입채무"
      : "매출채권 및 기타수취채권·매입채무 및 기타지급채무(주석 분해 필요)",
    operatingCashFlow: selectAccount(rows, { ids: ["ifrs-full_CashFlowsFromUsedInOperatingActivities", "ifrs_CashFlowsFromUsedInOperatingActivities"], names: ["영업활동현금흐름", "영업활동으로인한현금흐름"], statements: ["CF"], flow: true }),
    investingCashFlow: selectAccount(rows, { ids: ["ifrs-full_CashFlowsFromUsedInInvestingActivities"], names: ["투자활동현금흐름"], statements: ["CF"], flow: true }),
    financingCashFlow: selectAccount(rows, { ids: ["ifrs-full_CashFlowsFromUsedInFinancingActivities"], names: ["재무활동현금흐름"], statements: ["CF"], flow: true }),
    capex: selectAccount(rows, { ids: ["ifrs-full_PurchaseOfPropertyPlantAndEquipment"], names: ["유형자산의취득", "유형자산취득"], statements: ["CF"], flow: true }),
    intangibleCapex: selectAccount(rows, { ids: ["ifrs-full_PurchaseOfIntangibleAssets"], names: ["무형자산의취득", "무형자산취득"], statements: ["CF"], flow: true }),
    leasePrincipalPayments: selectAccount(rows, { ids: ["ifrs-full_PaymentsOfLeaseLiabilities"], names: ["리스부채의상환", "리스부채상환", "리스료의지급"], statements: ["CF"], flow: true }),
    dividendsPaid: selectAccount(rows, { ids: ["ifrs-full_DividendsPaid"], names: ["배당금의지급", "배당금지급"], statements: ["CF"], flow: true }),
    shortTermDebt: sumFinite(currentBorrowings, currentBonds),
    longTermDebt: sumFinite(longBorrowings, longBonds),
    currentLeaseLiabilities,
    noncurrentLeaseLiabilities,
    source: `OpenDART ${year} ${REPORT_NAMES[reportCode] || "정기보고서"} ${fsDiv === "CFS" ? "연결" : "별도"}`,
  };
}

export class DartService {
  constructor({ apiKey, cache, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.cache = cache;
    this.fetchImpl = fetchImpl;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async request(endpoint, params) {
    if (!this.apiKey) throw new Error("OPEN_DART_API_KEY가 설정되지 않았습니다.");
    const query = new URLSearchParams({ crtfc_key: this.apiKey, ...params });
    let response;
    try {
      response = await this.fetchImpl(`https://opendart.fss.or.kr/api/${endpoint}?${query}`, {
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      const cause = error?.cause?.code || error?.cause?.message || error?.message || "연결 오류";
      if (error?.name === "TimeoutError") throw new Error(`OpenDART 응답시간 초과 (${endpoint})`);
      throw new Error(`OpenDART 네트워크 연결 실패 (${endpoint}): ${cause}`);
    }
    if (!response.ok) throw new Error(`DART 통신 오류 (${response.status})`);
    const payload = await response.json();
    if (!['000', '013'].includes(payload.status)) throw new Error(`DART: ${payload.message || payload.status}`);
    return payload;
  }

  async companyInfo(corpCode) {
    const key = `dart-company:${corpCode}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const payload = await this.request("company.json", { corp_code: corpCode });
    this.cache.set(key, payload);
    return payload;
  }

  async statement(corpCode, year, fsDiv = "OFS", reportCode = REPORT_CODE) {
    const key = `dart-statement:${corpCode}:${year}:${reportCode}:${fsDiv}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const payload = await this.request("fnlttSinglAcntAll.json", {
      corp_code: corpCode, bsns_year: String(year), reprt_code: reportCode, fs_div: fsDiv,
    });
    if (payload.status === "013") throw new Error(`${year}년 ${REPORT_NAMES[reportCode] || "정기보고서"} ${fsDiv} 재무 데이터가 없습니다.`);
    const result = normalizeStatement(payload.list || [], year, fsDiv, reportCode);
    this.cache.set(key, result);
    return result;
  }

  async threeYearAnalysis(corpCode, endYear, fsDiv = "OFS") {
    const candidateYears = Array.from({ length: 6 }, (_, index) => endYear - index);
    const settled = await Promise.allSettled(candidateYears.map((year) => this.statement(corpCode, year, fsDiv)));
    const records = settled
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value)
      .sort((a, b) => Number(a.period) - Number(b.period))
      .slice(-3);
    const errors = settled.flatMap((item, index) => item.status === "rejected" ? [{ year: candidateYears[index], message: item.reason.message }] : []);
    if (!records.length) throw new Error(errors.map((item) => `${item.year}: ${item.message}`).join(" / "));
    const latestAvailableYear = Number(records.at(-1)?.period);
    return {
      records,
      errors,
      requestedYear: endYear,
      latestAvailableYear,
      yearFallback: latestAvailableYear < endYear,
      fsDiv,
    };
  }

  async latestInterim(corpCode, endYear, fsDiv = "OFS") {
    const attempts = [];
    for (const year of [endYear, endYear - 1]) {
      for (const reportCode of ["11014", "11012", "11013"]) attempts.push({ year, reportCode });
    }
    for (const attempt of attempts) {
      try {
        return await this.statement(corpCode, attempt.year, fsDiv, attempt.reportCode);
      } catch { /* 다음 최신 정기보고서 후보 확인 */ }
    }
    return null;
  }

  async auditOverview(corpCode, year) {
    const payload = await this.request("accnutAdtorNmNdAdtOpinion.json", {
      corp_code: corpCode, bsns_year: String(year), reprt_code: REPORT_CODE,
    });
    if (payload.status === "013") return null;
    const rows = payload.list || [];
    const current = rows.filter((row) => String(row.bsns_year || "").includes("당기"));
    const selected = current.length ? current : rows.slice(0, 2);
    return {
      auditor: selected[0]?.adtor || null,
      opinions: [...new Set(selected.map((row) => row.adt_opinion).filter(Boolean))],
      emphasisMatters: [...new Set(selected.map((row) => row.emphs_matter).filter((value) => value && value !== "해당사항 없음"))],
      keyAuditMatters: [...new Set(selected.map((row) => row.core_adt_matter).filter(Boolean))],
      source: `OpenDART ${year} 회계감사인의 명칭 및 감사의견`,
    };
  }
}
