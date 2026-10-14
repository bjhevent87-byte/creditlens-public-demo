export function buildInterimTrend(current, prior) {
  if (!current) return null;
  const rate = (now, before) => Number.isFinite(now) && Number.isFinite(before) && before > 0 ? ((now - before) / before) * 100 : null;
  const comparable = (key) => ({ [key]: current[key] ?? null, [`previous${key[0].toUpperCase()}${key.slice(1)}`]: prior?.[key] ?? null });
  return {
    period: `${current.period} ${current.reportType}`,
    comparisonPeriod: prior ? `${prior.period} ${prior.reportType}` : null,
    fsDiv: current.fsDiv,
    revenue: current.revenue,
    previousRevenue: prior?.revenue ?? null,
    revenueGrowth: rate(current.revenue, prior?.revenue),
    operatingProfit: current.operatingProfit,
    previousOperatingProfit: prior?.operatingProfit ?? null,
    operatingProfitGrowth: rate(current.operatingProfit, prior?.operatingProfit),
    operatingCashFlow: current.operatingCashFlow,
    previousOperatingCashFlow: prior?.operatingCashFlow ?? null,
    operatingCashFlowGrowth: rate(current.operatingCashFlow, prior?.operatingCashFlow),
    ...comparable("investingCashFlow"),
    ...comparable("financingCashFlow"),
    ...comparable("netIncome"),
    ...comparable("totalAssets"),
    ...comparable("currentAssets"),
    ...comparable("currentLiabilities"),
    ...comparable("cash"),
    financeCosts: current.financeCosts,
    previousFinanceCosts: prior?.financeCosts ?? null,
    totalLiabilities: current.totalLiabilities,
    previousTotalLiabilities: prior?.totalLiabilities ?? null,
    equity: current.equity,
    previousEquity: prior?.equity ?? null,
    ...comparable("shortTermDebt"),
    ...comparable("longTermDebt"),
    source: current.source,
    rceptNo: current.rceptNo,
    warning: "중간재무의 손익·현금흐름은 누적 실적입니다. 연간 실적과 직접 비교하지 않고 전년 동기와만 비교합니다.",
  };
}
