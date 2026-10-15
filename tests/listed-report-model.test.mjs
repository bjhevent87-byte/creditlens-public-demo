import assert from "node:assert/strict";
import test from "node:test";
import { buildListedReportModel } from "../public/listed-report-model.js";
import { renderFullReport } from "../public/final-report.js";
import { enrichFinancialRecords } from "../src/services/financial-service.mjs";

const ofRecord = (period, revenue) => ({
  period, revenue, operatingProfit: revenue * .1, operatingCashFlow: revenue * .08,
  investingCashFlow: -revenue * .04, financingCashFlow: -revenue * .01,
  totalAssets: revenue * 1.2, totalLiabilities: revenue * .4, equity: revenue * .8,
  currentAssets: revenue * .5, currentLiabilities: revenue * .2,
  shortTermDebt: revenue * .08, longTermDebt: revenue * .12,
  financeCosts: revenue * .01, totalDebt: revenue * .2,
  source: `OpenDART ${period} 사업보고서 별도`, fsDiv: "OFS",
});

function listedAnalysis(mode = "공식 API") {
  const ofs = [ofRecord("2024", 10_000_000_000), ofRecord("2025", 11_000_000_000)];
  const cfs = [ofRecord("2024", 80_000_000_000), ofRecord("2025", 90_000_000_000)].map((row) => ({ ...row, fsDiv: "CFS", source: `OpenDART ${row.period} 사업보고서 연결` }));
  return {
    mode, basisDate: "2026-10-15",
    company: { name: "검증기업", corpCode: "00123456", industry: "제조업", companyInfo: { induty_code: "30121" } },
    loanRequest: { workingAmount: 10, workingTermMonths: 12, facilityAmount: 30, facilityTermMonths: 60 },
    primaryFsDiv: "OFS", records: cfs,
    statementViews: {
      OFS: { records: ofs, inspection: [{ ruleId: "FI-C01", category: "경영진", question: "대응계획은?" }], assessment: { redFlags: [] }, decisionSupport: { workingCapital: { stance: "회수재원 확인 후 검토", appliedRules: [] }, facility: { stance: "투자 검증 후 검토", appliedRules: [] } } },
      CFS: { records: cfs, inspection: [], assessment: { redFlags: [] } },
    },
    supplementary: { interimViews: { OFS: { trend: { period: "2026 반기보고서", comparisonPeriod: "2025 반기보고서", revenue: 6_000_000_000, previousRevenue: 5_500_000_000, operatingProfit: 550_000_000, previousOperatingProfit: 500_000_000, operatingCashFlow: 400_000_000, previousOperatingCashFlow: 350_000_000 } } } },
    dataQuality: { requestedYear: 2026, latestAvailableYear: 2025, yearFallback: true, validations: [] },
    macro: [],
  };
}

test("상장 전체 보고서는 화면에서 연결을 보더라도 차주 별도재무를 사용하고 최신 반기를 앞세운다", () => {
  const model = buildListedReportModel(listedAnalysis(), { inspections: [{ category: "경영진", question: "대응계획은?", status: "미확인" }] });
  assert.match(model.basisLabel, /별도재무제표/);
  assert.equal(model.records.at(-1).revenue, 11_000_000_000);
  assert.equal(model.focusInterim, true);
  assert.match(model.sections.summary.bullets[0], /2026년의 연간 사업보고서는 아직 없어/);
  const html = renderFullReport(model);
  assert.match(html, /최근 중간 누적 매출/);
  assert.match(html, /2025 반기보고서 → 2026 반기보고서/);
  assert.ok(html.indexOf("현장실사 기록과 우려 재판단") < html.indexOf("종합 심사의견"));
});

test("현장 우려 또는 근거 미완료는 긍정적 심사 준비 상태를 최종보고서에 그대로 싣지 않는다", () => {
  const model = buildListedReportModel(listedAnalysis(), {
    inspections: [{ category: "경영진", question: "대응계획은?", selectedStatus: "이상징후", status: "근거 미기록", observation: "수주 공백", evidence: "", action: "자료 요청" }],
    reviewOutcome: { working: { status: "심사부 검토자료 준비" }, facility: { status: "심사부 검토자료 준비" } },
  });
  assert.match(model.loanReviews.working.status, /현장 우려·자료요청 1건/);
  assert.match(model.loanReviews.facility.status, /조건 제안 보류/);
  assert.match(model.sections.summary.bullets.at(-1), /0\/1건/);
  assert.ok(model.openItems.some((item) => item.title.includes("경영진 현장 확인")));
});

test("현장 판단은 관찰·증빙·후속조치가 모두 있어야 완료로 세고 누락은 과제로 남긴다", () => {
  const item = { category: "경영진", question: "대응계획은?", selectedStatus: "확인", status: "확인", observation: "일정 설명", evidence: "면담록 2쪽", action: "" };
  const pending = buildListedReportModel(listedAnalysis(), { inspections: [item] });
  assert.match(pending.sections.summary.bullets.at(-1), /0\/1건/);
  assert.match(pending.loanReviews.working.status, /현장실사 1건 미완료/);
  assert.ok(pending.openItems.some((entry) => entry.title.includes("경영진 현장 확인")));

  const completed = buildListedReportModel(listedAnalysis(), { inspections: [{ ...item, action: "심사역에 면담록 전달" }] });
  assert.match(completed.sections.summary.bullets.at(-1), /1\/1건/);
  assert.doesNotMatch(completed.loanReviews.working.status, /현장실사.*미완료/);
});

test("교육용 데모는 공식 API 수신으로 출처가 오인되지 않는다", () => {
  const demo = listedAnalysis("교육용 시나리오");
  demo.statementViews.OFS.records.forEach((row) => { row.source = "교육용 예시 데이터"; });
  const model = buildListedReportModel(demo, { macroRows: [{ name: "기준금리", source: "교육용 예시 데이터", latest: { value: 3, date: "2026-10-15" } }] });
  assert.match(model.sourceLabel, /공식 공시 아님/);
  assert.ok(model.sources.every((source) => !source.status.includes("API 수신")));
  assert.match(renderFullReport(model), /교육용 가상자료/);
});

test("금융비용 계정이 없는 자료의 이자비용 대체는 명칭을 구분한다", () => {
  const record = enrichFinancialRecords([{ period: "2025", revenue: 10_000_000_000, operatingProfit: 1_000_000_000, interestExpense: 100_000_000 }])[0];
  assert.equal(record.financeCostsSource, "이자비용 대체값");
  const model = buildListedReportModel({ ...listedAnalysis(), statementViews: { OFS: { ...listedAnalysis().statementViews.OFS, records: [record] } } });
  assert.match(renderFullReport(model), /영업이익\/이자비용\(대체\)/);
});
