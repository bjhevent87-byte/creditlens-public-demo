import test from "node:test";
import assert from "node:assert/strict";
import { buildInterimTrend } from "../src/services/interim-service.mjs";

test("2026 반기 손익·현금흐름은 2025 반기 누적액과만 비교한다", () => {
  const current = { period: "2026", reportType: "반기보고서", fsDiv: "OFS", revenue: 120, operatingProfit: 20, operatingCashFlow: 18, financeCosts: 5, totalLiabilities: 60, equity: 100 };
  const prior = { period: "2025", reportType: "반기보고서", fsDiv: "OFS", revenue: 100, operatingProfit: 10, operatingCashFlow: 15, financeCosts: 4, totalLiabilities: 50, equity: 100 };
  const trend = buildInterimTrend(current, prior);
  assert.equal(trend.period, "2026 반기보고서");
  assert.equal(trend.comparisonPeriod, "2025 반기보고서");
  assert.equal(trend.revenueGrowth, 20);
  assert.equal(trend.previousOperatingCashFlow, 15);
  assert.equal(trend.previousFinanceCosts, 4);
  assert.equal(trend.previousTotalLiabilities, 50);
  assert.equal(trend.fsDiv, "OFS");
});

test("전년 동기 영업현금이 음수이면 왜곡되는 증가율을 만들지 않는다", () => {
  const trend = buildInterimTrend({ period: "2026", reportType: "반기보고서", fsDiv: "OFS", operatingCashFlow: 10, operatingProfit: 5 }, { period: "2025", reportType: "반기보고서", fsDiv: "OFS", operatingCashFlow: -4, operatingProfit: -2 });
  assert.equal(trend.operatingCashFlowGrowth, null);
  assert.equal(trend.operatingProfitGrowth, null);
  assert.equal(buildInterimTrend(null, null), null);
});

test("중간재무 비교에 세 활동 현금흐름과 재무상태표 양 기간 원값을 보존한다", () => {
  const current = { period: "2026", reportType: "반기보고서", fsDiv: "OFS", totalAssets: 37192827, totalLiabilities: 24482364, equity: 12710463, investingCashFlow: -30, financingCashFlow: 20, netIncome: 80, shortTermDebt: 3135539, longTermDebt: 7175294 };
  const prior = { period: "2025", reportType: "반기보고서", fsDiv: "OFS", totalAssets: 33716415, totalLiabilities: 21675398, equity: 12041017, investingCashFlow: -20, financingCashFlow: 10, netIncome: 70, shortTermDebt: 2500000, longTermDebt: 7000000 };
  const trend = buildInterimTrend(current, prior);
  assert.equal(trend.totalAssets, 37192827);
  assert.equal(trend.previousTotalAssets, 33716415);
  assert.equal(trend.previousInvestingCashFlow, -20);
  assert.equal(trend.previousFinancingCashFlow, 10);
  assert.equal(trend.previousNetIncome, 70);
  assert.equal(trend.shortTermDebt, 3135539);
  assert.equal(trend.previousShortTermDebt, 2500000);
  assert.equal(trend.previousLongTermDebt, 7000000);
  assert.equal(trend.totalAssets, trend.totalLiabilities + trend.equity);
});
