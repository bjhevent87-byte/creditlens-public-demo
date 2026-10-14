const EOK = 100_000_000;
const isValid = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const won = (eok) => Number(eok || 0) * EOK;
const fmt = (value) => `${(value / EOK).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원`;

export function runSimpleOperatingScenario(latest, scenario = {}) {
  const salesShockPct = Number(scenario.salesShock ?? 0);
  const marginShockPp = Number(scenario.marginShockPp ?? 0);
  const missingInputs = [];
  if (!isValid(latest?.revenue) || Number(latest.revenue) <= 0) missingInputs.push("공시 매출액");
  if (!isValid(latest?.operatingProfit)) missingInputs.push("공시 영업이익");
  if (!Number.isFinite(salesShockPct) || Math.abs(salesShockPct) > 30) missingInputs.push("매출 변화 ±30% 범위");
  if (!Number.isFinite(marginShockPp) || Math.abs(marginShockPp) > 20) missingInputs.push("영업이익률 변화 ±20%p 범위");
  if (missingInputs.length) return { available: false, simple: true, missingInputs, interpretation: `계산에 필요한 ${missingInputs.join("·")}을(를) 확인해 주세요. 결측값을 0으로 대체하지 않습니다.` };
  const revenue = Number(latest.revenue);
  const operatingProfit = Number(latest.operatingProfit);
  const marginPct = operatingProfit / revenue * 100;
  const stressedRevenue = revenue * (1 + salesShockPct / 100);
  const stressedMarginPct = marginPct + marginShockPp;
  const stressedOperatingProfit = stressedRevenue * stressedMarginPct / 100;
  return {
    available: true, simple: true, label: "매출·영업이익 단순 민감도",
    assumptions: { salesShockPct, marginShockPp },
    baseline: { revenue, operatingProfit, operatingMargin: marginPct },
    stressed: { revenue: stressedRevenue, operatingProfit: stressedOperatingProfit, operatingMargin: stressedMarginPct },
    changes: { revenue: stressedRevenue - revenue, operatingProfit: stressedOperatingProfit - operatingProfit },
    calculationSteps: [
      { label: "가정 매출", formula: "최근 연간 매출 × (1 + 매출 변화율)", substitution: `${fmt(revenue)} × (1 + ${salesShockPct}%)`, result: stressedRevenue, format: "money" },
      { label: "가정 영업이익", formula: "가정 매출 × (기존 영업이익률 + 이익률 변화폭)", substitution: `${fmt(stressedRevenue)} × (${marginPct.toFixed(2)}% + ${marginShockPp}%p)`, result: stressedOperatingProfit, format: "money" },
    ],
    interpretation: "매출과 영업이익률 가정만 바꾼 계산 예시입니다. 신규대출 이자·원금, 실제 현금흐름, 승인가능 금액은 계산하지 않습니다.",
  };
}

export function runStressTest(latest, loanRequest = {}, scenario = {}) {
  const salesShock = Number(scenario.salesShock ?? 0) / 100;
  const marginShockPp = Number(scenario.marginShockPp ?? 0);
  const rateShockPp = Number(scenario.rateShockPp ?? 0);
  const collectionDelayDays = Number(scenario.collectionDelayDays ?? 0);
  const workingDebt = won(loanRequest.workingAmount);
  const facilityDebt = won(loanRequest.facilityAmount);
  const newDebt = workingDebt + facilityDebt;
  const missingInputs = [];
  for (const [key, label] of [
    ["revenue", "매출액"], ["operatingMargin", "영업이익률"], ["operatingProfit", "영업이익"],
    ["totalDebt", "기존 금융차입금"], ["financeCosts", "기존 금융비용"],
    ["totalLiabilities", "부채총계"], ["equity", "자본총계"],
  ]) if (!isValid(latest?.[key])) missingInputs.push(label);
  if (workingDebt > 0 && !isValid(loanRequest.workingRatePct)) missingInputs.push("운전자금 금리 가정");
  if (facilityDebt > 0 && !isValid(loanRequest.facilityRatePct)) missingInputs.push("시설자금 금리 가정");
  if (rateShockPp !== 0 && !isValid(scenario.existingVariableSharePct)) missingInputs.push("기존 차입금 변동금리 비중");
  if (collectionDelayDays !== 0 && !isValid(scenario.creditSalesSharePct)) missingInputs.push("외상매출 비중");
  if (isValid(scenario.existingVariableSharePct) && (Number(scenario.existingVariableSharePct) < 0 || Number(scenario.existingVariableSharePct) > 100)) missingInputs.push("기존 차입금 변동금리 비중 0~100% 확인");
  if (isValid(scenario.creditSalesSharePct) && (Number(scenario.creditSalesSharePct) < 0 || Number(scenario.creditSalesSharePct) > 100)) missingInputs.push("외상매출 비중 0~100% 확인");
  if (Math.abs(rateShockPp) > 5) missingInputs.push("금리 변화폭 ±5%p 범위 확인");
  const assumptions = {
    salesShock, marginShockPp, rateShockPp, collectionDelayDays, newDebt,
    existingVariableSharePct: isValid(scenario.existingVariableSharePct) ? Number(scenario.existingVariableSharePct) : null,
    creditSalesSharePct: isValid(scenario.creditSalesSharePct) ? Number(scenario.creditSalesSharePct) : null,
    workingRatePct: isValid(loanRequest.workingRatePct) ? Number(loanRequest.workingRatePct) : null,
    facilityRatePct: isValid(loanRequest.facilityRatePct) ? Number(loanRequest.facilityRatePct) : null,
  };
  if (missingInputs.length) return { available: false, label: "자료 입력 후 계산 가능", missingInputs, assumptions, interpretation: `필수 입력 ${missingInputs.join("·")}이 없어 결측값을 0으로 대체하지 않았습니다.` };

  const revenue = Number(latest.revenue);
  const debt = Number(latest.totalDebt);
  const financeCosts = Number(latest.financeCosts);
  const workingRate = Number(loanRequest.workingRatePct || 0);
  const facilityRate = Number(loanRequest.facilityRatePct || 0);
  const baseNewInterest = workingDebt * workingRate / 100 + facilityDebt * facilityRate / 100;
  const proFormaInterest = financeCosts + baseNewInterest;
  const workingVariable = loanRequest.workingRateType === "fixed" ? 0 : 1;
  const facilityVariable = loanRequest.facilityRateType === "fixed" ? 0 : 1;
  const rateSensitiveDebt = debt * Number(scenario.existingVariableSharePct || 0) / 100 + workingDebt * workingVariable + facilityDebt * facilityVariable;
  const stressedInterest = Math.max(proFormaInterest + rateSensitiveDebt * rateShockPp / 100, 0);
  const stressedRevenue = revenue * (1 + salesShock);
  const stressedOperatingProfit = stressedRevenue * (Number(latest.operatingMargin) + marginShockPp) / 100;
  const receivablesCashDrag = revenue * Number(scenario.creditSalesSharePct || 0) / 100 / 365 * collectionDelayDays;
  const stressedCoverage = stressedInterest > 0 ? stressedOperatingProfit / stressedInterest : null;
  const proFormaCoverage = proFormaInterest > 0 ? Number(latest.operatingProfit) / proFormaInterest : null;
  const stressedDebtRatio = Number(latest.equity) > 0 ? (Number(latest.totalLiabilities) + newDebt) / Number(latest.equity) * 100 : null;
  return {
    available: true, label: "입력 가정에 따른 시나리오 분석", assumptions,
    baseline: { revenue, operatingProfit: latest.operatingProfit, totalDebt: debt, interestCoverage: latest.financeCostCoverage, debtRatio: latest.debtRatio, financeCosts },
    proForma: { interestExpense: proFormaInterest, interestCoverage: proFormaCoverage, baseNewInterest, rateSensitiveDebt },
    stressed: { revenue: stressedRevenue, operatingProfit: stressedOperatingProfit, totalDebt: debt + newDebt, interestExpense: stressedInterest, interestCoverage: stressedCoverage, debtRatio: stressedDebtRatio, receivablesCashDrag },
    collectionEffect: {
      direction: collectionDelayDays > 0 ? "부정적" : collectionDelayDays < 0 ? "긍정적" : "변화 없음",
      explanation: collectionDelayDays > 0 ? "외상매출 회수가 늦어져 같은 기간 운전자금이 더 묶입니다." : collectionDelayDays < 0 ? "외상매출 회수가 빨라져 운전자금 부담이 줄어듭니다." : "회수기간 변화가 없습니다.",
      formula: `매출액 ${fmt(revenue)} × 외상매출 비중 ${Number(scenario.creditSalesSharePct || 0)}% ÷ 365 × ${collectionDelayDays}일`,
    },
    calculationSteps: [
      { label: "신규 대출의 기본 연간 이자", formula: "운전자금 × 가정금리 + 시설자금 × 가정금리", substitution: `${fmt(workingDebt)} × ${workingRate}% + ${fmt(facilityDebt)} × ${facilityRate}%`, result: baseNewInterest, format: "money" },
      { label: "신규여신 반영 기준 금융비용", formula: "공시 금융비용 + 신규 대출 기본 이자", substitution: `${fmt(financeCosts)} + ${fmt(baseNewInterest)}`, result: proFormaInterest, format: "money" },
      { label: "금리변화 적용 차입금", formula: "기존차입금 × 변동금리 비중 + 신규 변동금리 대출", substitution: `${fmt(debt)} × ${Number(scenario.existingVariableSharePct || 0)}% + ${fmt(workingDebt * workingVariable + facilityDebt * facilityVariable)}`, result: rateSensitiveDebt, format: "money" },
      { label: "시나리오 금융비용", formula: "신규여신 반영 기준 금융비용 + 민감 차입금 × 금리변화폭", substitution: `${fmt(proFormaInterest)} + ${fmt(rateSensitiveDebt)} × ${rateShockPp}%p`, result: stressedInterest, format: "money" },
      { label: "시나리오 영업이익", formula: "매출 × (기존 영업이익률 + 마진 변화폭)", substitution: `${fmt(stressedRevenue)} × (${Number(latest.operatingMargin).toFixed(2)}% + ${marginShockPp}%p)`, result: stressedOperatingProfit, format: "money" },
      { label: "영업이익/금융비용", formula: "시나리오 영업이익 ÷ 시나리오 금융비용", substitution: `${fmt(stressedOperatingProfit)} ÷ ${fmt(stressedInterest)}`, result: stressedCoverage, format: "ratio" },
    ],
    interpretation: stressedCoverage !== null && stressedCoverage < 1
      ? "이 가정에서는 영업이익이 금융비용에 미치지 못합니다. 실제 원리금 상환능력은 월별 현금수지·만기표로 별도 검증해야 합니다."
      : "금융비용 완충력은 유지되지만 이는 원금상환 검증이 아닙니다. 월별 현금수지와 기존 만기를 함께 확인해야 합니다.",
  };
}
