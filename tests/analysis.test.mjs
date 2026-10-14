import test from "node:test";
import assert from "node:assert/strict";
import { buildCashFlowAnalysis, enrichFinancialRecords } from "../src/services/financial-service.mjs";
import { buildDecisionSupport, buildInspectionChecklist, buildRiskAssessment } from "../src/services/risk-engine.mjs";
import { runSimpleOperatingScenario, runStressTest } from "../src/services/stress-test-service.mjs";
import { buildPerformanceAnalysis } from "../src/services/performance-service.mjs";
import { DEMO_RECORDS } from "../src/demo-data.mjs";
import { DartService, normalizeStatement } from "../src/services/dart-service.mjs";

test("공시의 유동·비유동 차입금 표준계정으로 차입 비중을 계산한다", () => {
  const rows = [
    { sj_div: "BS", account_id: "ifrs-full_CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings", account_nm: "차입금", thstrm_amount: "2464190000000" },
    { sj_div: "BS", account_id: "ifrs-full_LongtermBorrowings", account_nm: "차입금", thstrm_amount: "10180049000000" },
  ];
  const record = enrichFinancialRecords([normalizeStatement(rows, 2025, "CFS")])[0];
  assert.equal(record.shortTermDebt, 2_464_190_000_000);
  assert.equal(record.longTermDebt, 10_180_049_000_000);
  assert.ok(Math.abs(record.shortTermDebtShare - 19.49) < 0.02);
});
import { MacroService } from "../src/services/macro-service.mjs";
import { buildLoanStructure } from "../src/services/loan-structure-service.mjs";
import { buildReviewOutcome } from "../src/services/review-outcome-service.mjs";
import { CaseRepository } from "../src/services/case-service.mjs";
import { CompanyRepository } from "../src/services/company-repository.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("담당자용 단순 민감도는 금리·차입명세 없이 매출과 영업이익만 계산한다", () => {
  const base = { revenue: 100_000_000_000, operatingProfit: 10_000_000_000 };
  const result = runSimpleOperatingScenario(base, { salesShock: 10, marginShockPp: -2 });
  assert.equal(result.available, true);
  assert.ok(Math.abs(result.stressed.revenue - 110_000_000_000) < 1);
  assert.ok(Math.abs(result.stressed.operatingProfit - 8_800_000_000) < 1);
  assert.equal(result.proForma, undefined);
  assert.equal(runSimpleOperatingScenario({ revenue: null, operatingProfit: 1 }, {}).available, false);
});

test("차입잔액 증가속도가 둔화하면 급증 대신 잔액 증가와 둔화를 함께 알린다", () => {
  const records = [
    { period: 2024, totalDebt: 150_000_000_000, debtGrowth: 50.5, source: "test" },
    { period: 2025, totalDebt: 210_750_000_000, debtGrowth: 40.5, source: "test" },
  ];
  const warning = buildRiskAssessment(records).redFlags.find((item) => item.id === "debt-surge");
  assert.match(warning.title, /증가속도 둔화/);
  assert.match(warning.reason, /40\.5% 늘었습니다/);
  assert.match(warning.reason, /50\.5%보다 둔화/);
});

test("재무 레코드에서 회전주기와 이자보상배율을 계산한다", () => {
  const records = enrichFinancialRecords(DEMO_RECORDS);
  const latest = records.at(-1);
  assert.ok(Number.isFinite(latest.cashConversionCycle));
  assert.equal(Math.round(latest.interestCoverage * 100) / 100, 4.29);
  assert.equal(latest.totalDebt, 99_000_000_000);
});

test("세 현금흐름과 FCF를 연결해 외부조달 투자부담을 판정한다", () => {
  const records = enrichFinancialRecords(DEMO_RECORDS);
  const latest = records.at(-1);
  const analysis = buildCashFlowAnalysis(records);
  assert.equal(latest.freeCashFlow, -17_500_000_000);
  assert.equal(latest.cashFlowSubtotal, -2_500_000_000);
  assert.equal(latest.cashBalanceChange, -3_000_000_000);
  assert.equal(latest.cashFlowReconciliationGap, -500_000_000);
  assert.equal(Math.round(latest.capexCoverage * 100) / 100, 0.4);
  assert.ok(analysis.insights.some((item) => item.id === "investment-funded-externally"));
  assert.ok(analysis.insights.some((item) => item.id === "debt-expansion"));
});

test("매출보다 채권과 재고가 빠르게 늘면 이상징후를 만든다", () => {
  const records = enrichFinancialRecords(DEMO_RECORDS);
  const assessment = buildRiskAssessment(records, { workingAmount: 10, facilityAmount: 100 });
  const ids = assessment.redFlags.map((item) => item.id);
  assert.ok(ids.includes("sales-cfo-divergence"));
  assert.ok(ids.includes("receivables-ahead"));
  assert.ok(ids.includes("inventory-ahead"));
  assert.ok(assessment.checks.includes("자기자금 투입계획"));
});

test("스트레스 테스트는 신규 대출과 금리충격을 반영한다", () => {
  const latest = enrichFinancialRecords(DEMO_RECORDS).at(-1);
  const result = runStressTest(latest, { workingAmount: 10, facilityAmount: 100, workingRatePct: 5, facilityRatePct: 5.5 }, { salesShock: -20, marginShockPp: -3, rateShockPp: 2, collectionDelayDays: 30, existingVariableSharePct: 50, creditSalesSharePct: 80 });
  assert.equal(result.available, true);
  assert.equal(result.assumptions.newDebt, 11_000_000_000);
  assert.equal(result.proForma.baseNewInterest, 600_000_000);
  assert.equal(result.proForma.interestExpense, 4_800_000_000);
  assert.ok(result.stressed.totalDebt > latest.totalDebt);
  assert.ok(result.stressed.debtRatio > latest.debtRatio);
  assert.ok(result.stressed.interestCoverage < latest.interestCoverage);
});

test("금리하락과 매출채권 회수기간 단축도 기준점 대비 반영한다", () => {
  const latest = enrichFinancialRecords(DEMO_RECORDS).at(-1);
  const result = runStressTest(latest, { workingAmount: 10, workingRatePct: 5 }, { salesShock: 0, marginShockPp: 0, rateShockPp: -1, collectionDelayDays: -20, existingVariableSharePct: 50, creditSalesSharePct: 80 });
  assert.ok(result.stressed.interestExpense < latest.interestExpense);
  assert.ok(result.stressed.receivablesCashDrag < 0);
  assert.equal(result.collectionEffect.direction, "긍정적");
});

test("금리변화 0에서도 신규대출 기본 이자는 반영하고 결측값은 0으로 보지 않는다", () => {
  const latest = enrichFinancialRecords(DEMO_RECORDS).at(-1);
  const base = runStressTest(latest, {}, {});
  const withLoan = runStressTest(latest, { workingAmount: 10, facilityAmount: 100, workingRatePct: 5, facilityRatePct: 5.5 }, {});
  assert.equal(base.available, true);
  assert.equal(withLoan.stressed.interestExpense - base.stressed.interestExpense, 600_000_000);
  assert.ok(Array.isArray(withLoan.calculationSteps));
  const missing = runStressTest({ ...latest, totalDebt: null }, { workingAmount: 10, workingRatePct: 5 }, {});
  assert.equal(missing.available, false);
  assert.ok(Array.isArray(missing.missingInputs));
  assert.ok(missing.missingInputs.includes("기존 금융차입금"));
});

test("고정금리 차입은 금리충격을 적용하지 않고 외상매출 비중만 회수지연에 반영한다", () => {
  const latest = enrichFinancialRecords(DEMO_RECORDS).at(-1);
  const result = runStressTest(latest, { workingAmount: 10, workingRatePct: 5, workingRateType: "fixed" }, { rateShockPp: 2, existingVariableSharePct: 0, collectionDelayDays: 10, creditSalesSharePct: 20 });
  assert.equal(result.available, true);
  assert.equal(result.proForma.rateSensitiveDebt, 0);
  assert.equal(result.stressed.interestExpense, result.proForma.interestExpense);
  assert.equal(result.stressed.receivablesCashDrag, latest.revenue * .2 / 365 * 10);
});

test("월별·연도별 상환표는 자금용도를 분리하고 통합 부담도 확인한다", () => {
  const result = buildLoanStructure({ workingAmount: 10, facilityAmount: 100, workingTermMonths: 12, facilityTermMonths: 60, workingRatePct: 5, facilityRatePct: 5, workingRepayment: "bullet", facilityRepayment: "equal-principal" }, {
    openingUnrestrictedCash: 0, minimumCashBalance: 0,
    monthlyAvailableCash: Array(12).fill(2), monthlyExistingDebtService: Array(12).fill(0),
    annualAvailableCash: Array(5).fill(50), annualExistingDebtService: Array(5).fill(10), targetCoverage: 1.2,
  });
  assert.equal(result.working.status, "입력자료 기준 충족");
  assert.equal(result.facility.status, "입력자료 기준 충족");
  assert.equal(result.combined.status, "통합 상환일정 재검토");
  assert.equal(result.working.rows.length, 12);
  assert.equal(result.facility.rows.length, 5);
  assert.equal(result.termAlternatives.working.find((item) => item.termMonths === 24).status, "추가 현금수지 필요");
  assert.equal(result.termAlternatives.facility.find((item) => item.termMonths === 60).status, "입력가정 충족");
  assert.ok(result.rateAlternatives.working.find((item) => item.ratePct === 7).endingCash < result.rateAlternatives.working.find((item) => item.ratePct === 5).endingCash);
  assert.ok(result.rateAlternatives.facility.find((item) => item.ratePct === 7).minimumCoverage < result.rateAlternatives.facility.find((item) => item.ratePct === 5).minimumCoverage);
});

test("차입금 명세의 만기집중·변동금리 비중을 공시 차입금과 대조한다", () => {
  const result = buildLoanStructure({}, { debtRegisterComplete: true, publicDebtEok: 100, debtRegister: [
    { balanceEok: 40, maturityMonths: 6, rateType: "floating" },
    { balanceEok: 60, maturityMonths: 36, rateType: "fixed" },
  ] });
  assert.equal(result.registerSummary.totalEok, 100);
  assert.equal(result.registerSummary.dueWithin12Eok, 40);
  assert.equal(result.registerSummary.variableSharePct, 40);
  assert.equal(result.registerSummary.reconciliationGapEok, 0);
});

test("증빙파일과 검증 메모 없이 위험 해소로 표시하지 않는다", () => {
  const assessment = { redFlags: [{ id: "negative-cfo", title: "현금부족", reason: "상환재원 확인", level: "danger" }] };
  const structure = { working: { status: "입력자료 기준 충족", missingInputs: [] }, facility: { status: "신청 없음" } };
  const unsupported = buildReviewOutcome(assessment, { "negative-cfo": { status: "해소", note: "현금회수 확인했습니다." } }, [], structure);
  assert.equal(unsupported.findings[0].status, "해소 근거 부족");
  const supported = buildReviewOutcome(assessment, { "negative-cfo": { status: "해소", note: "채권 연령표의 10월 회수액을 확인했습니다." } }, [{ id: "f1", findingId: "negative-cfo", name: "채권표.pdf", sha256: "abc" }], structure);
  assert.equal(supported.working.status, "심사부 검토자료 준비");
});

test("스트레스 테스트 기본점은 네 가정 모두 0이다", () => {
  const latest = enrichFinancialRecords(DEMO_RECORDS).at(-1);
  const result = runStressTest(latest, {}, {});
  assert.equal(result.assumptions.salesShock, 0);
  assert.equal(result.assumptions.marginShockPp, 0);
  assert.equal(result.assumptions.rateShockPp, 0);
  assert.equal(result.assumptions.collectionDelayDays, 0);
});

test("유통기업 현장실사는 제조설비 대신 점포와 상품 운영을 확인한다", () => {
  const records = enrichFinancialRecords(DEMO_RECORDS);
  const assessment = buildRiskAssessment(records, { workingAmount: 10 });
  const checklist = buildInspectionChecklist(assessment, { workingAmount: 10 }, { industry: "산업코드 471" });
  const categories = checklist.map((item) => item.category);
  assert.ok(categories.includes("점포운영"));
  assert.ok(categories.includes("상품·재고"));
  assert.ok(!categories.includes("생산"));
  assert.ok(checklist.every((item) => item.ruleId && item.ruleSource));
});

test("요청연도 사업보고서가 없으면 이전 최신 3개년을 채운다", async () => {
  const service = new DartService({ apiKey: "test", cache: { get() {}, set() {} } });
  service.statement = async (_corpCode, year) => {
    if (year === 2026) throw new Error("미공시");
    return { period: String(year) };
  };
  const result = await service.threeYearAnalysis("00000000", 2026);
  assert.deepEqual(result.records.map((item) => item.period), ["2023", "2024", "2025"]);
  assert.equal(result.yearFallback, true);
  assert.equal(result.latestAvailableYear, 2025);
});

test("DART 네트워크 장애는 기관과 실패 지점을 표시한다", async () => {
  const service = new DartService({
    apiKey: "test",
    cache: { get() {}, set() {} },
    fetchImpl: async () => { throw new TypeError("fetch failed", { cause: { code: "NETWORK_BLOCKED" } }); },
  });
  await assert.rejects(
    () => service.companyInfo("00164742"),
    /OpenDART 네트워크 연결 실패 \(company\.json\): NETWORK_BLOCKED/,
  );
});

test("ECOS는 첫 100건이 아니라 전체 페이지의 최신값을 선택한다", async () => {
  const fetchImpl = async (url) => {
    const secondPage = url.includes("/1001/2000/");
    return { ok: true, async json() { return { StatisticSearch: { list_total_count: 1001, row: secondPage ? [{ TIME: "20261008", DATA_VALUE: "3.0" }] : Array.from({ length: 1000 }, (_, index) => ({ TIME: `2025${String((index % 12) + 1).padStart(2, "0")}01`, DATA_VALUE: "2.5" })) } }; } };
  };
  const service = new MacroService({ apiKey: "test", cache: { get() {}, set() {} }, fetchImpl });
  const result = await service.latest({ id: "test", name: "테스트", code: "X", frequency: "D", items: ["Y"], unit: "%" });
  assert.equal(result.latest.date, "20261008");
  assert.equal(result.paginationComplete, true);
});

test("3개년 재무를 5개 경영성과 축과 검증 가설로 정리한다", () => {
  const records = enrichFinancialRecords(DEMO_RECORDS);
  const performance = buildPerformanceAnalysis(records, []);
  assert.deepEqual(performance.dimensions.map((item) => item.id), ["profitability", "growth", "stability", "activity", "cash"]);
  assert.ok(performance.hypotheses.some((item) => item.id === "growth-quality"));
  assert.ok(performance.conclusion.evidence.length >= 2);
  for (const dimension of performance.dimensions) {
    for (const metric of dimension.metrics) {
      assert.equal(metric.calculations.length, records.length);
      assert.match(metric.calculation.equation, /억원|일/);
      assert.match(metric.calculation.equation, /=/);
      assert.doesNotMatch(metric.calculation.equation, /undefined|NaN/);
    }
  }
});

test("성장률 변화는 %p로 표시하고 직전연도 결측은 오래된 연도로 대체하지 않는다", () => {
  const records = enrichFinancialRecords(DEMO_RECORDS);
  const result = buildPerformanceAnalysis(records, []);
  const growth = result.dimensions.find((item) => item.id === "growth");
  assert.match(growth.interpretation, /매출증가율 개선\(\+1\.5%p\)/);
  assert.match(growth.metrics[0].criterion, /%p 이내/);

  const missingPrevious = records.map((item) => ({ ...item }));
  missingPrevious.at(-2).revenueGrowth = null;
  const missingResult = buildPerformanceAnalysis(missingPrevious, []);
  const revenueGrowth = missingResult.dimensions.find((item) => item.id === "growth").metrics[0];
  assert.equal(revenueGrowth.trend.className, "unknown");
  assert.equal(revenueGrowth.trend.previous, null);
});

test("차입금 한쪽 계정이 없으면 단기차입 비중을 임의로 계산하지 않는다", () => {
  const records = enrichFinancialRecords([{ ...DEMO_RECORDS.at(-1), shortTermDebt: null }]);
  assert.equal(records[0].totalDebt, null);
  assert.equal(records[0].shortTermDebtShare, null);
  assert.match(records[0].debtShareUnavailableReason, /단기차입금 계정/);
});

test("차입구조와 단순 FCF·리스배당 후 잔여현금을 구분한다", () => {
  const records = enrichFinancialRecords(DEMO_RECORDS.map((row) => ({ ...row, intangibleCapex: 1_000_000_000, leasePrincipalPayments: 500_000_000, dividendsPaid: 300_000_000 })));
  const latest = records.at(-1);
  assert.equal(Math.round(latest.shortTermDebtShare * 10) / 10, 42.4);
  assert.equal(Math.round(latest.longTermDebtShare * 10) / 10, 57.6);
  assert.equal(latest.freeCashFlow, -18_500_000_000);
  assert.equal(latest.debtServiceResidual, -19_300_000_000);
});

test("자금용도 검토는 실제 대입값과 해석을 제공한다", () => {
  const records = enrichFinancialRecords(DEMO_RECORDS);
  const assessment = buildRiskAssessment(records, { workingAmount: 10, facilityAmount: 100 });
  const support = buildDecisionSupport(assessment, { workingAmount: 10, facilityAmount: 100, workingTermMonths: 12 }, records);
  assert.match(support.workingCapital.appliedRules[0].calculation, /=/);
  assert.match(support.workingCapital.appliedRules[1].explanation, /%p/);
  assert.match(support.facility.appliedRules[1].explanation, /금융비용/);
});

test("매출·영업현금 비교는 두 증가율을 먼저 보여주고 현금 적자를 개선으로 단정하지 않는다", () => {
  const base = enrichFinancialRecords(DEMO_RECORDS);
  const prior = base.at(-2);
  const latest = { ...base.at(-1), revenueGrowth: 13.9, cfoGrowth: 30.9, operatingCashFlow: 100_000_000_000 };
  const rule = buildDecisionSupport({ redFlags: [] }, { workingAmount: 10 }, [prior, latest]).workingCapital.appliedRules[1];
  assert.equal(rule.result, "매출 13.9% · 영업현금 30.9%");
  assert.match(rule.interpretation, /17\.0%p 높습니다/);
  assert.match(rule.calculation, /13\.9% - 30\.9% = -17\.0%p/);
  const negative = buildDecisionSupport({ redFlags: [] }, { workingAmount: 10 }, [prior, { ...latest, operatingCashFlow: -1 }]).workingCapital.appliedRules[1];
  assert.match(negative.interpretation, /적자이므로/);
});

test("DART 연간 재무의 기본 범위는 차주 법인 별도재무제표다", async () => {
  let requestedUrl = "";
  const service = new DartService({
    apiKey: "test",
    cache: { get() {}, set() {} },
    fetchImpl: async (url) => {
      requestedUrl = url;
      return { ok: true, async json() { return { status: "000", list: [] }; } };
    },
  });
  await service.statement("00000000", 2025);
  assert.match(requestedUrl, /fs_div=OFS/);
});

test("기업명 검색에서 빈 종목코드가 무관한 기업을 매칭하지 않는다", async () => {
  const folder = await mkdtemp(join(tmpdir(), "creditlens-search-"));
  try {
    const file = join(folder, "companies.json");
    await writeFile(file, JSON.stringify([{ name: "이마트", stockCode: "139480", corpCode: "00872984" }, { name: "다른회사", stockCode: "012345", corpCode: "00000000" }]));
    const matches = await new CompanyRepository(file).search("이마트");
    assert.deepEqual(matches.map((item) => item.name), ["이마트"]);
  } finally { await rm(folder, { recursive: true }); }
});

test("상장 종목명 현대차와 DART 법인명 현대자동차를 모두 검색한다", async () => {
  const folder = await mkdtemp(join(tmpdir(), "creditlens-stock-name-"));
  try {
    const file = join(folder, "companies.json");
    await writeFile(file, JSON.stringify([{ name: "현대자동차", stockCode: "005380", corpCode: "00164742" }, { name: "현대차증권", stockCode: "001500", corpCode: "00137997" }]));
    const repository = new CompanyRepository(file);
    assert.equal((await repository.search("현대차"))[0].name, "현대차");
    assert.equal((await repository.search("현대자동차"))[0].name, "현대차");
    assert.equal((await repository.find("00164742")).legalName, "현대자동차");
  } finally { await rm(folder, { recursive: true }); }
});

test("사건 저장은 수정 이력을 보존하고 증빙파일 해시를 기록한다", async () => {
  const folder = await mkdtemp(join(tmpdir(), "creditlens-case-"));
  try {
    const repository = new CaseRepository(folder);
    const first = await repository.save({ companyName: "테스트기업", corpCode: "00000000", summary: "사전검토", snapshot: { analysis: { inspection: [{ ruleId: "FI-C03" }] }, reviewOutcome: { working: { status: "보류" } } } });
    const second = await repository.save({ id: first.id, companyName: "테스트기업", corpCode: "00000000", summary: "증빙확인", snapshot: { analysis: { inspection: [{ ruleId: "FI-C03" }] }, reviewOutcome: { working: { status: "검토" } } } });
    assert.equal(second.revision, 2);
    assert.equal((await repository.revisions(first.id)).length, 2);
    assert.equal((await repository.list())[0].revision, 2);
    const pdf = Buffer.from("%PDF-1.4\nfield inspection sample");
    const attachment = await repository.addEvidence(first.id, { name: "현장점검.pdf", base64: pdf.toString("base64"), inspectionId: "FI-C03" });
    assert.equal(attachment.sha256.length, 64);
    assert.equal(attachment.inspectionId, "FI-C03");
    assert.equal((await repository.evidenceFile(first.id, attachment.id)).bytes.toString(), pdf.toString());
    const photo = Buffer.from([255, 216, 255, 224, 0, 0]);
    const photoAttachment = await repository.addEvidence(first.id, { name: "현장사진.jpg", base64: photo.toString("base64"), inspectionId: "FI-C03" });
    assert.equal(photoAttachment.extension, ".jpg");
    assert.deepEqual((await repository.evidenceFile(first.id, photoAttachment.id)).bytes, photo);
    await assert.rejects(repository.addEvidence(first.id, { name: "잘못된항목.pdf", base64: pdf.toString("base64"), inspectionId: "다른 항목" }), /올바른 현장실사 항목 식별자/);
    await assert.rejects(repository.addEvidence(first.id, { name: "가짜.pdf", base64: Buffer.from("not-pdf").toString("base64"), inspectionId: "FI-C03" }), /올바른 PDF/);
  } finally { await rm(folder, { recursive: true }); }
});
