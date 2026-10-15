import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { buildPrivateReportModel } from "../public/private-report-model.js";
import { renderFullReport } from "../public/final-report.js";
import { runSimpleOperatingScenario } from "../src/services/stress-test-service.mjs";

const sampleCsv = readFileSync(new URL("../public/가상_에이비정밀_별도재무_2023-2025_억원.csv", import.meta.url), "utf8");

async function manualAnalysis(statementBasis = "OFS") {
  process.env.CREDIT_PLATFORM_SERVERLESS = "1";
  const { handleRequest } = await import("../server.mjs");
  const server = createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const input = {
      companyName: "가상기업 에이비정밀", industry: "자동차부품 제조업 · 가상 사례", unit: "억원", csvText: sampleCsv,
      statementBasis, accountingStandard: "일반기업회계기준", auditStatus: "감사의견 원문 확인 필요",
      auditReview: { opinion: "적정", reportDate: "2026-03-20", sourcePage: "가상 감사보고서 p.1" },
      businessEvidence: {
        businessModel: { text: "가상 제품 A를 생산한다는 담당자 입력", source: "가상 사업설명 p.3" },
        customers: { text: "가상 거래처 납품조건을 면담으로 확인", source: "가상 면담록 p.2" },
        management: { text: "가상 경영진의 대응계획", source: "가상 면담록 p.5" },
      },
      sourceReview: { confirmed: true, note: "가상 재무제표 p.2 계정·단위 대조" },
      overrides: [{ period: "2025", field: "currentAssets", value: "230", page: "가상 재무제표 p.2", note: "유동자산 대조" }],
      loanRequest: { workingAmount: 10, workingTermMonths: 12, facilityAmount: 30, facilityTermMonths: 60 },
    };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/manual-analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    return response.json();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("비상장 실제 분석 응답이 고객자료 출처·세 현금흐름·현장 기록과 함께 12장 보고서로 이어진다", async () => {
  const analysis = await manualAnalysis();
  const [first, second] = analysis.inspection;
  const inspections = analysis.inspection.map((item) => ({ category: item.category, question: item.question, status: "미확인", observation: "", evidence: "", action: "", files: [] }));
  inspections[0] = { ...inspections[0], status: "정상 확인", observation: "가상 실적 설명을 들음", evidence: "가상 면담록 p.5", action: "" };
  inspections[1] = { ...inspections[1], status: "우려 확인", observation: "가상 생산라인 1개 중단", evidence: "가상 현장사진 1번", action: "가동 계획 재확인", files: [{ name: "가상_현장사진.jpg", sha256: "abcdef0123456789" }] };
  const simple = runSimpleOperatingScenario(analysis.records.at(-1), { salesShock: -10, marginShockPp: -2 });
  assert.equal(simple.available, true);
  const model = buildPrivateReportModel(analysis, {
    csvName: "가상_에이비정밀_별도재무.csv",
    pdfFiles: [{ name: "가상_감사보고서.pdf", sha256: "aabbccddeeff0011" }],
    inspections,
    inspectionSummary: "가상 생산중단 원인과 재가동 일정을 추가 확인한다.",
    scenario: { name: "고객 제출 연간 재무 · 단순 민감도", assumptions: "매출 -10%, 영업이익률 -2%p", results: "가정 매출·영업이익 계산", interpretation: simple.interpretation, limitations: "승인한도 아님" },
  });
  assert.equal(model.records.length, 3);
  assert.equal(model.records.at(-1).operatingCashFlow, 8 * 100_000_000);
  assert.equal(model.records.at(-1).investingCashFlow, -25 * 100_000_000);
  assert.equal(model.records.at(-1).financingCashFlow, 14 * 100_000_000);
  assert.equal(model.sections.summary.bullets.some((line) => /현장실사 1\/\d+건 기록 완료/.test(line)), true);
  assert.match(model.loanReviews.working.status, /현장 우려·자료요청/);
  assert.match(model.sections.business.bullets[0], /근거 가상 사업설명 p\.3/);
  assert.match([model.sections.management.text, ...model.sections.management.bullets].join(" "), /적정.*2026-03-20.*가상 감사보고서 p\.1/);
  assert.doesNotMatch(model.sections.management.text, /PDF 원문 자동검증 결과가 아닙니다/);
  assert.doesNotMatch(model.sections.industry.text, /판단 근거로 확정하지 않습니다/);
  assert.equal(model.sources.some((source) => source.name === "가상_감사보고서.pdf" && /해시 기록/.test(source.status)), true);
  assert.equal(model.scenarios.length, 1);
  assert.equal(model.inspections[0].question, first.question);
  assert.equal(model.inspections[1].question, second.question);
  const report = renderFullReport(model);
  assert.equal((report.match(/class="cr-section"/g) || []).length, 12);
  for (const phrase of ["가상 제품 A", "가상 사업설명 p.3", "가상 생산라인 1개 중단", "가상 현장사진 1번", "가상_현장사진.jpg", "가상 생산중단 원인", "가상_감사보고서.pdf", "매출 -10%", "가정 매출·영업이익 계산"]) assert.ok(report.includes(phrase), phrase);
  assert.match(report, /고객 입력|담당자 대조 기록|자동검증 전/);
  assert.doesNotMatch(report, /승인 완료|대출 승인 확정/);
});

test("비상장 보고서의 산업·경영진 보완 의견도 출처가 있을 때만 채택하고 HTML을 이스케이프한다", async () => {
  const analysis = await manualAnalysis();
  const baseline = buildPrivateReportModel(analysis);
  const incomplete = buildPrivateReportModel(analysis, {
    reportEdits: { management: { text: "출처 없는 경영진 평가", source: "" } },
  });
  assert.equal(incomplete.sections.management.text, baseline.sections.management.text);

  const edited = buildPrivateReportModel(analysis, {
    reportEdits: {
      industry: { text: "수주 물량 감소로 가동률 저하", source: "고객 수주대장 3쪽" },
      management: { text: '<script>alert(1)</script> 경영진이 대체 고객 확보 계획 제시', source: "면담록 2쪽" },
    },
  });
  const html = renderFullReport(edited);
  assert.match(html, /수주 물량 감소로 가동률 저하/);
  assert.match(html, /고객 수주대장 3쪽/);
  assert.match(html, /경영진이 대체 고객 확보 계획 제시/);
  assert.match(html, /면담록 2쪽/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("연결자료만 들어오면 차주 직접 상환능력과 조건 제안을 보류한다", async () => {
  const analysis = await manualAnalysis("CFS");
  const model = buildPrivateReportModel(analysis);
  assert.equal(analysis.manualReview.issues.some((issue) => issue.id === "borrower-separate" && issue.severity === "blocking"), true);
  assert.match(model.verificationStatus, /판단 보류/);
  assert.match(model.loanReviews.working.status, /입력 오류 해소 전/);
  assert.match(model.sections.opinion.text, /수치 판단 보류/);
  assert.equal(model.openItems.some((item) => item.title === "차주 법인 별도재무제표 확보"), true);
});

test("감사보고서가 없다고 입력한 경우 존재하지 않는 감사 원본을 출처로 만들지 않는다", async () => {
  const analysis = await manualAnalysis();
  analysis.manualReview.auditReview = { opinion: "감사보고서 없음", reportDate: "", sourcePage: "" };
  const model = buildPrivateReportModel(analysis);
  assert.equal(model.sources.some((source) => source.scope === "감사의견"), false);
  assert.match([model.sections.management.text, ...model.sections.management.bullets].join(" "), /감사보고서 없음/);
});
