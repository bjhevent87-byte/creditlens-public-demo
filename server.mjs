import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvironment } from "./src/env.mjs";
import { ExpiringCache } from "./src/cache.mjs";
import { parseJsonBody, sendJson, serveStatic, SECURITY_HEADERS } from "./src/http.mjs";
import { CompanyRepository } from "./src/services/company-repository.mjs";
import { DartService } from "./src/services/dart-service.mjs";
import { buildCashFlowAnalysis, enrichFinancialRecords } from "./src/services/financial-service.mjs";
import { buildDecisionSupport, buildInspectionChecklist, buildRiskAssessment } from "./src/services/risk-engine.mjs";
import { runSimpleOperatingScenario, runStressTest } from "./src/services/stress-test-service.mjs";
import { MacroService } from "./src/services/macro-service.mjs";
import { KosisService } from "./src/services/kosis-service.mjs";
import { buildPerformanceAnalysis } from "./src/services/performance-service.mjs";
import { DEMO_COMPANY, DEMO_MACRO, DEMO_RECORDS } from "./src/demo-data.mjs";
import { buildLoanStructure } from "./src/services/loan-structure-service.mjs";
import { buildReviewOutcome } from "./src/services/review-outcome-service.mjs";
import { CaseRepository } from "./src/services/case-service.mjs";
import { buildInterimTrend } from "./src/services/interim-service.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const env = loadEnvironment(ROOT);
const PORT = Number(env.CREDIT_PLATFORM_PORT || 4180);
const PUBLIC_DEMO = env.VERCEL === "1" || env.CREDIT_PLATFORM_PUBLIC_DEMO === "1";
const cache = new ExpiringCache(Math.max(Number(env.CACHE_TTL_MINUTES || 60), 1) * 60_000);
const localCompanyData = path.join(ROOT, "data", "companies.json");
const companyDataPath = env.COMPANY_DATA_PATH ? path.resolve(ROOT, env.COMPANY_DATA_PATH) : localCompanyData;
const companies = new CompanyRepository(companyDataPath);
const cases = new CaseRepository(path.join(ROOT, "data", "cases"));
const dart = new DartService({ apiKey: env.OPEN_DART_API_KEY || env.DART_API_KEY || "", cache });
const macro = new MacroService({ apiKey: env.ECOS_API_KEY || "", cache });
const kosis = new KosisService({ apiKey: env.KOSIS_API_KEY || env.KOSIS_TOKEN || "", cache });
const rateLimit = new Map();
const rateLimitMax = Math.max(Number(env.RATE_LIMIT_PER_MINUTE || 90), 10);

function withinRateLimit(req, res) {
  const now = Date.now();
  const key = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local").split(",")[0];
  const current = rateLimit.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current;
  entry.count += 1;
  rateLimit.set(key, entry);
  if (entry.count <= rateLimitMax) return true;
  sendJson(res, 429, { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." });
  return false;
}

function kstDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

function normalizeLoanRequest(input = {}) {
  const optionalRate = (value) => value === "" || value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 30 ? null : Number(value);
  const nonNegative = (value, fallback = 0) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? fallback : Math.max(Number(value), 0);
  return {
    workingAmount: nonNegative(input.workingAmount),
    facilityAmount: nonNegative(input.facilityAmount),
    workingTermMonths: Math.max(nonNegative(input.workingTermMonths, 12), 1),
    facilityTermMonths: Math.max(nonNegative(input.facilityTermMonths, 60), 1),
    workingRatePct: optionalRate(input.workingRatePct),
    facilityRatePct: optionalRate(input.facilityRatePct),
    workingRateType: input.workingRateType === "fixed" ? "fixed" : "floating",
    facilityRateType: input.facilityRateType === "fixed" ? "fixed" : "floating",
    workingRepayment: input.workingRepayment === "equal-principal" ? "equal-principal" : "bullet",
    facilityRepayment: input.facilityRepayment === "bullet" ? "bullet" : "equal-principal",
    facilityGraceMonths: nonNegative(input.facilityGraceMonths),
    purpose: String(input.purpose || "").slice(0, 500),
  };
}

function buildStatementView({ rawRecords, loanRequest, macroRows, company }) {
  const records = enrichFinancialRecords(rawRecords);
  const assessment = buildRiskAssessment(records, loanRequest);
  const performance = buildPerformanceAnalysis(records, macroRows);
  const inspection = buildInspectionChecklist(assessment, loanRequest, company);
  const decisionSupport = buildDecisionSupport(assessment, loanRequest, records);
  const macroInterpretations = macroRows.flatMap((item) => {
    if (!item.latest || !item.previous) return [];
    const change = item.latest.value - item.previous.value;
    if (item.id === "usd-krw" && change < 0) return [{ type: "외부환경", text: "원/달러 환율 하락은 수출기업의 원화 환산매출에 부담이 될 수 있으나 환헤지·외화비용·해외생산 비중 확인이 필요합니다.", source: item.source }];
    if (item.id === "kr-base-rate" && change > 0) return [{ type: "외부환경", text: "기준금리 상승은 변동금리 및 차환분의 금융비용에 영향을 줄 수 있으므로 실제 조달금리와 만기구조를 확인해야 합니다.", source: item.source }];
    if (item.id === "export-volume" && item.latest.value < 0) return [{ type: "외부환경", text: "관련 수출지표 약화가 확인됩니다. 회사 매출이 성장하더라도 점유율·수주·고객구성 변화인지 구분해야 합니다.", source: item.source }];
    return [];
  });
  return {
    records,
    cashFlowAnalysis: buildCashFlowAnalysis(records),
    performance,
    assessment: { ...assessment, interpretations: [...assessment.interpretations, ...macroInterpretations] },
    inspection,
    decisionSupport,
  };
}

async function assembleAnalysis({ company, companyInfo, statementSets, loanRequest, macroRows, mode, errors = [], requestedYear = null, latestAvailableYear = null, yearFallback = false, supplementary = {} }) {
  const statementViews = Object.fromEntries(Object.entries(statementSets).map(([fsDiv, rawRecords]) => [fsDiv, buildStatementView({ rawRecords, loanRequest, macroRows, company: { ...company, companyInfo } })]));
  const primaryFsDiv = statementViews.OFS ? "OFS" : Object.keys(statementViews)[0];
  const primary = statementViews[primaryFsDiv];
  const primaryInterimTrend = supplementary.interimViews?.[primaryFsDiv]?.trend || (supplementary.interimTrend?.fsDiv === primaryFsDiv ? supplementary.interimTrend : null);
  const latest = primary.records.at(-1);
  const allRecords = Object.values(statementViews).flatMap((view) => view.records);
  const validations = primary.records.map((row) => ({
    period: row.period,
    balanceSheet: row.balanceSheetValid === null ? "자료부족" : row.balanceSheetValid ? "일치" : "불일치",
    balanceSheetGap: row.balanceSheetGap,
    cashFlow: Number.isFinite(row.cashFlowReconciliationGap) ? (Math.abs(row.cashFlowReconciliationGap) <= Math.max(Math.abs(row.cash || 0) * 0.01, 1) ? "대체로 일치" : "차이 확인") : "비교자료 부족",
    cashFlowGap: row.cashFlowReconciliationGap,
  }));
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    basisDate: kstDate(),
    mode,
    company: { ...company, companyInfo },
    loanRequest,
    primaryFsDiv,
    availableStatements: Object.keys(statementViews),
    statementViews,
    ...primary,
    macro: macroRows,
    supplementary,
    sources: [
      ...allRecords.map((item) => ({ name: item.source, status: "확인", period: item.period, fsDiv: item.fsDiv })),
      ...(supplementary.audit ? [{ name: supplementary.audit.source, status: "확인", period: supplementary.audit.year || null }] : []),
      ...Object.values(supplementary.interimViews || {}).filter((view) => view.current).map((view) => ({ name: view.current.source, status: "확인", period: view.current.period, fsDiv: view.current.fsDiv })),
      ...macroRows.map((item) => ({ name: item.source || item.name, status: item.status, period: item.latest?.date || null })),
    ],
    dataQuality: {
      consolidation: primaryFsDiv === "CFS" ? "연결" : "별도",
      primaryStatement: primaryFsDiv === "OFS" ? "별도재무제표(차주 법인)" : "연결재무제표(그룹)",
      availableStatements: Object.keys(statementViews),
      unit: "원",
      annualPeriods: primary.records.map((item) => item.period),
      requestedYear,
      latestAvailableYear: latestAvailableYear || Number(primary.records.at(-1)?.period),
      yearFallback,
      errors,
      validations,
      notices: [
        yearFallback ? `요청 기준연도 ${requestedYear}년의 연간 사업보고서가 없어 최신 가용 ${latestAvailableYear}년부터 과거 3개년을 표시함` : "요청 기준연도의 연간 사업보고서 반영",
        primaryFsDiv === "OFS" ? "차주 법인의 상환능력은 별도재무제표를 기본으로 분석" : "별도재무제표 부재로 연결재무제표를 기본 사용",
        "연결재무제표는 그룹 지원·부담 위험을 확인하는 보조 화면", "결측값은 0으로 대체하지 않음", "현금흐름 합계와 현금잔액 차이는 환율효과 등으로 발생할 수 있어 원문 조정항목 확인 필요", "공시 이후 변동은 최신 정기보고서와 고객 제출자료로 보완 필요",
        primaryInterimTrend ? `최신 ${primaryInterimTrend.period} ${primaryFsDiv === "OFS" ? "별도" : "연결"} 자료를 전년 동기와 비교` : "최신 중간재무 비교자료가 없어 최근 실적 확인 필요",
        supplementary.audit?.opinions?.some((opinion) => !String(opinion).includes("적정")) ? "감사의견 중 적정 이외 표현이 있어 원문 확인 필요" : "감사의견 원문과 핵심감사사항 확인 필요",
      ],
    },
  };
}

async function api(req, res, url) {
  if (req.method === "POST" && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return sendJson(res, 403, { error: "동일한 웹페이지에서만 입력할 수 있습니다." });
  if (url.pathname === "/api/health") return sendJson(res, 200, { ok: true, port: PORT, publicDemo: PUBLIC_DEMO, dart: dart.configured, ecos: macro.configured, kosis: kosis.configured, basisDate: kstDate() });
  if (PUBLIC_DEMO && url.pathname.startsWith("/api/cases")) return sendJson(res, 403, { error: "공개 데모에서는 사건·증빙 저장이 비활성화됩니다. 로컬판에서 사용해 주세요." });
  if (url.pathname === "/api/config") return sendJson(res, 200, {
    services: [
      { id: "dart", name: "OpenDART", configured: dart.configured, role: "기업개요·3개년 재무" },
      { id: "ecos", name: "한국은행 ECOS", configured: macro.configured, role: "금리·환율·경기" },
      { id: "kosis", name: "KOSIS", configured: kosis.configured, role: "업종 통계표 검색·수치 조회", status: kosis.configured ? "연결 가능" : "키 미설정" },
      { id: "kdi", name: "KDI 경제교육·정보센터", configured: false, role: "전망·해설", status: "출처 링크 모듈 예정" },
    ],
  });
  if (url.pathname.startsWith("/api/kosis/") && req.method === "GET") {
    if (!kosis.configured) return sendJson(res, 503, { error: "KOSIS_API_KEY가 설정되지 않았습니다. CreditLens .env에 추가한 뒤 서버를 다시 실행해 주세요." });
    if (url.pathname === "/api/kosis/search") return sendJson(res, 200, { tables: await kosis.search(url.searchParams.get("q")) });
    if (url.pathname === "/api/kosis/table") return sendJson(res, 200, await kosis.table({ orgId: url.searchParams.get("orgId"), tblId: url.searchParams.get("tblId") }));
    if (url.pathname === "/api/kosis/series") return sendJson(res, 200, await kosis.series({ orgId: url.searchParams.get("orgId"), tblId: url.searchParams.get("tblId"), frequency: url.searchParams.get("frequency"), query: url.searchParams.get("q") }));
  }
  if (url.pathname === "/api/companies") {
    return sendJson(res, 200, { companies: await companies.search(url.searchParams.get("q") || "", 15) });
  }
  if (url.pathname === "/api/analyze" && req.method === "POST") {
    const input = await parseJsonBody(req);
    const loanRequest = normalizeLoanRequest(input.loanRequest);
    const endYear = Math.min(Math.max(Number(input.endYear || new Date().getFullYear() - 1), 2015), new Date().getFullYear());
    if (input.demo) {
      return sendJson(res, 200, await assembleAnalysis({ company: DEMO_COMPANY, companyInfo: DEMO_COMPANY.companyInfo, statementSets: { CFS: DEMO_RECORDS }, loanRequest, macroRows: DEMO_MACRO, mode: "교육용 시나리오" }));
    }
    const corpCode = String(input.corpCode || "").replace(/\D/g, "");
    if (corpCode.length !== 8) return sendJson(res, 400, { error: "기업을 검색해 선택해 주세요." });
    const company = await companies.find(corpCode);
    if (!company) return sendJson(res, 404, { error: "기업코드를 찾지 못했습니다." });
    const [companyResult, ofsResult, cfsResult, ofsInterim, cfsInterim, auditResult, macroRows] = await Promise.all([
      dart.companyInfo(corpCode),
      dart.threeYearAnalysis(corpCode, endYear, "OFS").catch((error) => ({ error })),
      dart.threeYearAnalysis(corpCode, endYear, "CFS").catch((error) => ({ error })),
      dart.latestInterim(corpCode, new Date().getFullYear(), "OFS").catch(() => null),
      dart.latestInterim(corpCode, new Date().getFullYear(), "CFS").catch(() => null),
      dart.auditOverview(corpCode, endYear - (endYear === new Date().getFullYear() ? 1 : 0)).catch(() => null),
      macro.snapshot(),
    ]);
    const statementSets = {};
    if (ofsResult.records?.length) statementSets.OFS = ofsResult.records;
    if (cfsResult.records?.length) statementSets.CFS = cfsResult.records;
    if (!Object.keys(statementSets).length) throw new Error([ofsResult.error?.message, cfsResult.error?.message].filter(Boolean).join(" / ") || "재무 데이터를 찾지 못했습니다.");
    const primaryResult = ofsResult.records?.length ? ofsResult : cfsResult;
    const [priorOfsInterim, priorCfsInterim] = await Promise.all([
      ofsInterim ? dart.statement(corpCode, Number(ofsInterim.period) - 1, "OFS", ofsInterim.reportCode).catch(() => null) : null,
      cfsInterim ? dart.statement(corpCode, Number(cfsInterim.period) - 1, "CFS", cfsInterim.reportCode).catch(() => null) : null,
    ]);
    const interimViews = {
      ...(ofsInterim ? { OFS: { current: ofsInterim, prior: priorOfsInterim ? { period: priorOfsInterim.period, reportType: priorOfsInterim.reportType, source: priorOfsInterim.source, rceptNo: priorOfsInterim.rceptNo } : null, trend: buildInterimTrend(ofsInterim, priorOfsInterim) } } : {}),
      ...(cfsInterim ? { CFS: { current: cfsInterim, prior: priorCfsInterim ? { period: priorCfsInterim.period, reportType: priorCfsInterim.reportType, source: priorCfsInterim.source, rceptNo: priorCfsInterim.rceptNo } : null, trend: buildInterimTrend(cfsInterim, priorCfsInterim) } } : {}),
    };
    const enrichedCompany = { ...company, industry: companyResult.induty_code ? `산업코드 ${companyResult.induty_code}` : "업종 확인 필요" };
    return sendJson(res, 200, await assembleAnalysis({ company: enrichedCompany, companyInfo: companyResult, statementSets, loanRequest, macroRows, mode: "공식 API", errors: [...(ofsResult.errors || []), ...(cfsResult.errors || [])], requestedYear: primaryResult.requestedYear, latestAvailableYear: primaryResult.latestAvailableYear, yearFallback: primaryResult.yearFallback, supplementary: { interim: ofsInterim, interimTrend: interimViews.OFS?.trend || null, interimViews, audit: auditResult } }));
  }
  if (url.pathname === "/api/stress-test" && req.method === "POST") {
    const input = await parseJsonBody(req);
    return sendJson(res, 200, runStressTest(input.latest || {}, normalizeLoanRequest(input.loanRequest), input.scenario || {}));
  }
  if (url.pathname === "/api/stress-test/simple" && req.method === "POST") {
    const input = await parseJsonBody(req);
    return sendJson(res, 200, runSimpleOperatingScenario(input.latest || {}, input.scenario || {}));
  }
  if (url.pathname === "/api/loan-structure" && req.method === "POST") {
    const input = await parseJsonBody(req);
    return sendJson(res, 200, buildLoanStructure(normalizeLoanRequest(input.loanRequest), input.customerInputs || {}));
  }
  if (url.pathname === "/api/review-outcome" && req.method === "POST") {
    const input = await parseJsonBody(req);
    return sendJson(res, 200, buildReviewOutcome(input.assessment, input.reviews, input.attachments, input.structure));
  }
  if (url.pathname === "/api/cases" && req.method === "GET") return sendJson(res, 200, { cases: await cases.list() });
  if (url.pathname === "/api/cases" && req.method === "POST") return sendJson(res, 200, await cases.save(await parseJsonBody(req)));
  const caseMatch = url.pathname.match(/^\/api\/cases\/([0-9a-f-]{36})(?:\/(revisions|evidence))?$/i);
  if (caseMatch && req.method === "GET" && !caseMatch[2]) {
    const record = await cases.load(caseMatch[1]);
    return sendJson(res, record ? 200 : 404, record || { error: "저장된 사건이 없습니다." });
  }
  if (caseMatch && req.method === "GET" && caseMatch[2] === "revisions") return sendJson(res, 200, { revisions: await cases.revisions(caseMatch[1]) });
  if (caseMatch && req.method === "POST" && caseMatch[2] === "evidence") return sendJson(res, 200, await cases.addEvidence(caseMatch[1], await parseJsonBody(req, 14_000_000)));
  const evidenceMatch = url.pathname.match(/^\/api\/cases\/([0-9a-f-]{36})\/evidence\/([0-9a-f-]{36})$/i);
  if (evidenceMatch && req.method === "GET") {
    const { bytes, extension } = await cases.evidenceFile(evidenceMatch[1], evidenceMatch[2]);
    const contentType = { ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".csv": "text/csv; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }[extension];
    res.writeHead(200, { "Content-Type": contentType || "application/octet-stream", "Content-Disposition": `attachment; filename="${evidenceMatch[2]}${extension}"`, "Cache-Control": "no-store", ...SECURITY_HEADERS });
    res.end(bytes); return;
  }
  return sendJson(res, 404, { error: "API를 찾을 수 없습니다." });
}

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname !== "/api/health" && !withinRateLimit(req, res)) return;
      return await api(req, res, url);
    }
    return await serveStatic(res, PUBLIC_DIR, url.pathname);
  } catch (error) {
    if (req.url.startsWith("/api/")) return sendJson(res, 500, { error: error.message });
    try { return await serveStatic(res, PUBLIC_DIR, "/"); } catch {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server error");
    }
  }
}

if (env.CREDIT_PLATFORM_SERVERLESS !== "1" && env.VERCEL !== "1") {
  const server = http.createServer(handleRequest);
  server.listen(PORT, "127.0.0.1", () => console.log(`기업여신 의사결정 지원 플랫폼: http://localhost:${PORT}`));
}
