import test from "node:test";
import assert from "node:assert/strict";
import { inspectManualStatementsCsv } from "../src/services/manual-statement-service.mjs";

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
