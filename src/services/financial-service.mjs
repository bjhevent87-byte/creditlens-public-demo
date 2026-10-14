function ratio(a, b, multiplier = 100) {
  return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? (a / b) * multiplier : null;
}

function growth(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) && previous !== 0 ? ((current / previous) - 1) * 100 : null;
}

function days(balance, flow) {
  return Number.isFinite(balance) && Number.isFinite(flow) && flow !== 0 ? (balance / Math.abs(flow)) * 365 : null;
}

function average(current, previous) {
  if (Number.isFinite(current) && Number.isFinite(previous)) return (current + previous) / 2;
  return Number.isFinite(current) ? current : null;
}

function sumWhenComplete(...values) {
  return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function enrichFinancialRecords(records) {
  return [...records].sort((a, b) => a.period.localeCompare(b.period)).map((row, index, all) => {
    const previous = all[index - 1];
    // 한쪽 차입금 계정이 없을 때 나머지 한쪽만으로 총차입금을 만들면 비중이 왜곡된다.
    const totalDebt = sumWhenComplete(row.shortTermDebt, row.longTermDebt);
    const previousDebt = previous ? sumWhenComplete(previous.shortTermDebt, previous.longTermDebt) : null;
    const averageReceivables = average(row.accountsReceivable, previous?.accountsReceivable);
    const averageInventory = average(row.inventory, previous?.inventory);
    const averagePayables = average(row.accountsPayable, previous?.accountsPayable);
    const averageAssets = average(row.totalAssets, previous?.totalAssets);
    const averageEquity = average(row.equity, previous?.equity);
    const dso = days(averageReceivables, row.revenue);
    const dio = days(averageInventory, row.costOfSales);
    const dpo = days(averagePayables, row.costOfSales);
    const tangibleCapex = Number.isFinite(row.capex) ? Math.abs(row.capex) : null;
    const intangibleCapex = Number.isFinite(row.intangibleCapex) ? Math.abs(row.intangibleCapex) : null;
    const totalCapex = [tangibleCapex, intangibleCapex].filter(Number.isFinite).reduce((sum, value) => sum + value, 0) || null;
    const freeCashFlow = Number.isFinite(row.operatingCashFlow) && Number.isFinite(totalCapex) ? row.operatingCashFlow - totalCapex : null;
    const leasePrincipal = Number.isFinite(row.leasePrincipalPayments) ? Math.abs(row.leasePrincipalPayments) : null;
    const dividendsPaid = Number.isFinite(row.dividendsPaid) ? Math.abs(row.dividendsPaid) : null;
    const debtServiceResidual = Number.isFinite(freeCashFlow) && Number.isFinite(leasePrincipal) && Number.isFinite(dividendsPaid)
      ? freeCashFlow - leasePrincipal - dividendsPaid
      : null;
    const leaseLiabilities = [row.currentLeaseLiabilities, row.noncurrentLeaseLiabilities].filter(Number.isFinite).reduce((sum, value) => sum + value, 0) || null;
    const adjustedDebt = Number.isFinite(totalDebt) && Number.isFinite(leaseLiabilities) ? totalDebt + leaseLiabilities : null;
    const financeCosts = Number.isFinite(row.financeCosts) ? row.financeCosts : row.interestExpense;
    const shortTermDebtShare = Number.isFinite(totalDebt) && totalDebt !== 0 ? ratio(row.shortTermDebt, totalDebt) : null;
    const longTermDebtShare = Number.isFinite(totalDebt) && totalDebt !== 0 ? ratio(row.longTermDebt, totalDebt) : null;
    const debtShareUnavailableReason = !Number.isFinite(row.shortTermDebt) && !Number.isFinite(row.longTermDebt)
      ? "단기·장기 차입금 계정을 공시 본문에서 확인하지 못했습니다. 주석 확인이 필요합니다."
      : !Number.isFinite(row.shortTermDebt)
        ? "단기차입금 계정을 공시 본문에서 확인하지 못했습니다. 주석 확인이 필요합니다."
        : !Number.isFinite(row.longTermDebt)
          ? "장기차입금 계정을 공시 본문에서 확인하지 못했습니다. 주석 확인이 필요합니다."
          : totalDebt === 0 ? "확인된 차입금 합계가 0원이므로 비중을 계산하지 않습니다." : null;
    const cashFlowSubtotal = sumWhenComplete(row.operatingCashFlow, row.investingCashFlow, row.financingCashFlow);
    const cashBalanceChange = previous && Number.isFinite(row.cash) && Number.isFinite(previous.cash) ? row.cash - previous.cash : null;
    const balanceSheetGap = [row.totalAssets, row.totalLiabilities, row.equity].every(Number.isFinite) ? row.totalAssets - row.totalLiabilities - row.equity : null;
    const balanceSheetTolerance = Number.isFinite(row.totalAssets) ? Math.max(Math.abs(row.totalAssets) * 0.0001, 1) : null;
    return {
      ...row,
      totalDebt,
      financeCosts,
      leaseLiabilities,
      adjustedDebt,
      shortTermDebtShare,
      longTermDebtShare,
      debtShareUnavailableReason,
      revenueGrowth: previous ? growth(row.revenue, previous.revenue) : null,
      operatingProfitGrowth: previous ? growth(row.operatingProfit, previous.operatingProfit) : null,
      operatingProfitGrowthType: previous && previous.operatingProfit < 0 && row.operatingProfit >= 0 ? "적자→흑자" : previous && previous.operatingProfit >= 0 && row.operatingProfit < 0 ? "흑자→적자" : "증가율",
      cfoGrowth: previous ? growth(row.operatingCashFlow, previous.operatingCashFlow) : null,
      receivablesGrowth: previous ? growth(row.accountsReceivable, previous.accountsReceivable) : null,
      inventoryGrowth: previous ? growth(row.inventory, previous.inventory) : null,
      debtGrowth: previous ? growth(totalDebt, previousDebt) : null,
      operatingMargin: ratio(row.operatingProfit, row.revenue),
      netMargin: ratio(row.netIncome, row.revenue),
      roa: ratio(row.netIncome, averageAssets),
      roe: ratio(row.netIncome, averageEquity),
      assetTurnover: ratio(row.revenue, averageAssets, 1),
      debtRatio: ratio(row.totalLiabilities, row.equity),
      currentRatio: ratio(row.currentAssets, row.currentLiabilities),
      financeCostCoverage: ratio(row.operatingProfit, financeCosts, 1),
      interestCoverage: ratio(row.operatingProfit, row.interestExpense, 1),
      cfoToRevenue: ratio(row.operatingCashFlow, row.revenue),
      cfoToOperatingProfit: ratio(row.operatingCashFlow, row.operatingProfit, 1),
      cfoToDebt: ratio(row.operatingCashFlow, totalDebt),
      dso,
      dio,
      dpo,
      cashConversionCycle: [dso, dio, dpo].every(Number.isFinite) ? dso + dio - dpo : null,
      workingCapitalDaysBasis: `${previous ? "기초·기말 평균잔액" : "기말잔액 근사"} · ${row.workingCapitalAccountScope || "공시 본문 계정"}`,
      tangibleCapex,
      totalCapex,
      freeCashFlow,
      freeCashFlowMargin: ratio(freeCashFlow, row.revenue),
      debtServiceResidual,
      residualComponentsComplete: Number.isFinite(row.leasePrincipalPayments) && Number.isFinite(row.dividendsPaid),
      capexCoverage: Number.isFinite(totalCapex) && totalCapex > 0 ? ratio(row.operatingCashFlow, totalCapex, 1) : null,
      cashFlowSubtotal,
      cashBalanceChange,
      cashFlowReconciliationGap: Number.isFinite(cashFlowSubtotal) && Number.isFinite(cashBalanceChange) ? cashBalanceChange - cashFlowSubtotal : null,
      debtBalanceChange: Number.isFinite(totalDebt) && Number.isFinite(previousDebt) ? totalDebt - previousDebt : null,
      balanceSheetGap,
      balanceSheetValid: Number.isFinite(balanceSheetGap) && Number.isFinite(balanceSheetTolerance) ? Math.abs(balanceSheetGap) <= balanceSheetTolerance : null,
      metricBasis: {
        statement: row.fsDiv === "OFS" ? "별도재무제표(차주 법인)" : "연결재무제표(그룹)",
        financeCost: row.interestExpenseBasis || "공시 금융비용",
        workingCapital: `${previous ? "기초·기말 평균잔액" : "기말잔액 근사"} · ${row.workingCapitalAccountScope || "공시 본문 계정"}`,
        fcf: "영업활동현금흐름 - 유형·무형자산 취득",
        debt: "단기·장기차입금 및 사채 합계(리스부채 별도)",
      },
    };
  });
}

export function buildCashFlowAnalysis(records) {
  const latest = records.at(-1) || {};
  const insights = [];
  const add = (id, tone, title, fact, meaning, checks) => insights.push({ id, tone, title, fact, meaning, checks });

  if (Number.isFinite(latest.operatingCashFlow) && latest.operatingCashFlow < 0 && latest.financingCashFlow > 0) {
    add("operating-deficit-financed", "danger", "영업현금 부족을 외부자금으로 보완",
      `영업 ${latest.operatingCashFlow}원 · 재무 ${latest.financingCashFlow}원`,
      "본업에서 빠져나간 현금을 차입·증자 등 재무활동 유입으로 메웠을 가능성이 있습니다.",
      ["재무활동현금흐름 세부내역", "신규 차입과 상환 내역", "월별 영업자금수지"]);
  }
  if (latest.operatingCashFlow > 0 && latest.investingCashFlow < 0 && latest.freeCashFlow < 0 && latest.financingCashFlow > 0) {
    add("investment-funded-externally", "warning", "투자 후 현금부족과 외부조달 동반",
      `FCF ${latest.freeCashFlow}원 · 재무 ${latest.financingCashFlow}원`,
      "영업현금만으로 CAPEX를 충당하지 못한 시기에 재무활동 현금이 유입됐습니다. 성장투자인지 자금공백 보전인지 구분해야 합니다.",
      ["CAPEX 계약·집행내역", "투자성과와 회수기간", "차입금 사용처"]);
  } else if (latest.operatingCashFlow > 0 && latest.investingCashFlow < 0 && latest.freeCashFlow >= 0) {
    add("investment-internally-funded", "positive", "영업현금 범위 내 투자 집행",
      `FCF ${latest.freeCashFlow}원 · CFO/CAPEX ${latest.capexCoverage}배`,
      "영업에서 창출한 현금으로 CAPEX를 충당하고도 잉여현금이 남은 구조입니다.",
      ["일회성 운전자본 개선 여부", "향후 투자계획", "원리금 상환일정"]);
  }
  if (latest.investingCashFlow > 0) {
    add("positive-investing-cash", "watch", "투자활동 현금유입의 원천 확인",
      `투자활동현금흐름 ${latest.investingCashFlow}원`,
      "투자활동의 양수는 자산 매각·금융상품 회수 등에서 발생할 수 있어 그 자체로 영업개선으로 보지 않습니다.",
      ["유형자산 처분내역", "금융상품 회수내역", "핵심 영업자산 매각 여부"]);
  }
  if (latest.financingCashFlow < 0 && latest.operatingCashFlow > 0) {
    add("financing-outflow", "positive", "영업현금 창출과 재무활동 유출",
      `영업 ${latest.operatingCashFlow}원 · 재무 ${latest.financingCashFlow}원`,
      "차입금 상환·배당·자기주식 취득 등으로 현금이 나갔을 수 있습니다. 차입상환이면 재무구조 개선 신호가 될 수 있습니다.",
      ["차입금 상환내역", "배당금 지급", "자기주식·리스부채 지급"]);
  }
  if (latest.financingCashFlow > 0 && latest.debtBalanceChange > 0) {
    add("debt-expansion", "warning", "재무현금 유입과 차입잔액 증가",
      `재무 ${latest.financingCashFlow}원 · 차입잔액 증감 ${latest.debtBalanceChange}원`,
      "외부조달 유입과 기말 차입금 증가가 함께 나타났습니다. 조달 목적과 향후 상환재원을 연결해 확인해야 합니다.",
      ["신규 차입별 용도", "차입금 만기표", "향후 원리금 상환계획"]);
  }
  if (!insights.length) {
    add("cashflow-review", "watch", "세 활동 현금흐름 세부 확인",
      "자동 경고 조합 없음",
      "현금흐름 부호만으로 결론내리지 않고 주석과 고객 제출 자금수지를 함께 확인합니다.",
      ["현금흐름표 주석", "일회성 현금거래", "향후 12개월 자금수지"]);
  }

  return {
    latestPeriod: latest.period || null,
    metrics: {
      operatingCashFlow: latest.operatingCashFlow,
      investingCashFlow: latest.investingCashFlow,
      financingCashFlow: latest.financingCashFlow,
      freeCashFlow: latest.freeCashFlow,
      debtServiceResidual: latest.debtServiceResidual,
      capexCoverage: latest.capexCoverage,
      cashFlowSubtotal: latest.cashFlowSubtotal,
      cashBalanceChange: latest.cashBalanceChange,
      reconciliationGap: latest.cashFlowReconciliationGap,
      debtBalanceChange: latest.debtBalanceChange,
    },
    insights,
    caution: "투자·재무활동현금흐름은 양수·음수만으로 좋고 나쁨을 판단하지 않습니다.",
  };
}

export { growth, ratio };
