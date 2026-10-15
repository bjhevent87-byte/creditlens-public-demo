import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { inspectManualStatementsCsv, MANUAL_CSV_COLUMNS, MANUAL_CSV_LABELS } from "../src/services/manual-statement-service.mjs";

const csv = [
  "period,revenue,operatingProfit,operatingCashFlow,totalAssets,totalLiabilities,equity,costOfSales,accountsReceivable,inventory,accountsPayable",
  "2024,100,10,8,200,80,120,70,20,15,10",
  "2025,110,11,9,230,100,120,75,22,16,12",
].join("\n");

test("재무상태표 불일치는 버리지 않고 수정 가능한 검증 과제로 반환한다", () => {
  const found = inspectManualStatementsCsv(csv, { unit: "억원", loanRequest: { workingAmount: 10 } });
  const issue = found.issues.find((item) => item.type === "balance");
  assert.equal(issue.period, "2025");
  assert.equal(issue.severity, "blocking");
  assert.deepEqual(issue.fields, ["totalAssets", "totalLiabilities", "equity"]);
  assert.match(issue.detail, /10억원/);
});

test("담당자 원문 대조값을 반영하면 불일치가 해소되고 변경 이력을 남긴다", () => {
  const found = inspectManualStatementsCsv(csv, {
    unit: "억원",
    overrides: [{ period: "2025", field: "equity", value: "130", page: "감사보고서 p.12", note: "자본총계 대조" }],
  });
  assert.equal(found.issues.some((item) => item.type === "balance"), false);
  assert.equal(found.records.at(-1).equity, 130 * 100_000_000);
  assert.equal(found.changes[0].page, "감사보고서 p.12");
  assert.match(found.changes[0].status, /자동 대조 아님/);
});

test("목적별 필수 보조계정이 없으면 0으로 만들지 않고 확인 과제로 남긴다", () => {
  const found = inspectManualStatementsCsv(csv, { unit: "억원", loanRequest: { facilityAmount: 30 } });
  assert.equal(found.records.at(-1).financeCosts, null);
  assert.ok(found.issues.some((item) => item.id === "2025-financeCosts" && item.severity === "review"));
});

test("가상기업 CSV의 유동자산 오기를 원본 대조 과제로 표시하고 수정 후 해소한다", () => {
  const input = [
    "period,revenue,operatingProfit,operatingCashFlow,totalAssets,totalLiabilities,equity,currentAssets,cash,accountsReceivable,inventory",
    "2024,265,27,21,455,205,250,195,51,65,77",
    "2025,290,20,8,490,230,260,205,48,80,92",
  ].join("\n");
  const found = inspectManualStatementsCsv(input, { unit: "억원" });
  assert.equal(found.issues.find((issue) => issue.type === "current-assets-components")?.severity, "blocking");
  const corrected = inspectManualStatementsCsv(input, { unit: "억원", overrides: [{ period: "2025", field: "currentAssets", value: "230", page: "가상 원본 p.2", note: "유동자산 대조" }] });
  assert.equal(corrected.issues.some((issue) => issue.type === "current-assets-components"), false);
  assert.equal(corrected.records.at(-1).currentAssets, 230 * 100_000_000);
});

test("한글 CSV 계정명을 읽고 영어 기존 양식도 유지하며 중복 별칭을 거부한다", () => {
  const korean = readFileSync(new URL("../public/가상_에이비정밀_별도재무_2023-2025_억원.csv", import.meta.url), "utf8");
  assert.deepEqual(korean.split(/\r?\n/)[0].split(","), MANUAL_CSV_COLUMNS.map((field) => MANUAL_CSV_LABELS[field]));
  const reviewed = inspectManualStatementsCsv(korean, { unit: "억원" });
  assert.equal(reviewed.records.at(-1).revenue, 290 * 100_000_000);
  assert.ok(reviewed.issues.some((issue) => issue.type === "current-assets-components"));
  assert.equal(inspectManualStatementsCsv(csv, { unit: "억원" }).records.length, 2);
  assert.throws(() => inspectManualStatementsCsv("연도,period,매출액\n2024,2024,100\n2025,2025,110"), /중복/);
  assert.throws(() => inspectManualStatementsCsv("연도,임의계정\n2024,1\n2025,2"), /알 수 없는 CSV 계정명/);
});

test("비상장 분석 API는 감사·사업 입력의 출처 상태를 보존하되 자동 검증으로 표시하지 않는다", async () => {
  process.env.CREDIT_PLATFORM_SERVERLESS = "1";
  const { handleRequest } = await import("../server.mjs");
  const server = createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const input = {
      companyName: "가상 에이비정밀", industry: "자동차부품 제조업", unit: "억원", csvText: csv,
      statementBasis: "OFS", accountingStandard: "일반기업회계기준", auditStatus: "감사의견 원문 확인 필요",
      auditReview: { opinion: "적정", reportDate: "2026-03-20", sourcePage: "감사보고서 p.1" },
      businessEvidence: { businessModel: { text: "자동차부품 매출 구조 담당자 입력", source: "사업설명 p.3" }, customers: { text: "거래처 결제조건 면담", source: "면담 2026-10-15" } },
      sourceReview: { confirmed: true, note: "재무제표 p.2와 대조" }, loanRequest: { workingAmount: 10 },
    };
    const response = await fetch(`http://127.0.0.1:${port}/api/manual-analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.manualReview.auditReview, { opinion: "적정", reportDate: "2026-03-20", sourcePage: "감사보고서 p.1", status: "담당자 입력 · 원문 자동검증 아님" });
    assert.equal(data.manualReview.businessEvidence.find((item) => item.id === "businessModel")?.source, "사업설명 p.3");
    assert.match(data.manualReview.businessEvidence.find((item) => item.id === "customers")?.status, /자동검증 아님/);
    assert.equal(data.manualReview.issues.some((item) => item.id === "audit-opinion-source"), false);
    const withoutPage = await fetch(`http://127.0.0.1:${port}/api/manual-analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, auditReview: { opinion: "한정" } }) });
    assert.equal((await withoutPage.json()).manualReview.issues.some((item) => item.id === "audit-opinion-source"), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
