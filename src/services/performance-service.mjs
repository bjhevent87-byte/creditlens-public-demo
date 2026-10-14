function format(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "자료없음";
}

function money(value) {
  return Number.isFinite(value)
    ? `${(value / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원`
    : "자료없음";
}

function metricResult(value, unit) {
  const displayUnit = unit === "%p" ? "%" : unit;
  const digits = unit === "배" || unit === "회" ? 2 : 1;
  return `${Number(value).toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${displayUnit}`;
}

function numericSubstitution(key, records, value, unit) {
  const row = records.at(-1);
  const prior = records.at(-2);
  if (!row || !Number.isFinite(value)) return { equation: "계산에 필요한 공시 수치가 부족합니다.", note: null };
  const result = metricResult(value, unit);
  const previousAverage = (field, label) => {
    if (!Number.isFinite(row[field])) return null;
    return prior && Number.isFinite(prior[field])
      ? `${label} 평균 = (전기말 ${money(prior[field])} + 당기말 ${money(row[field])}) ÷ 2`
      : `${label} 평균은 전기말 자료가 없어 당기말 ${money(row[field])}으로 근사`;
  };
  const calculatedAverage = (field) => Number.isFinite(row[field])
    ? prior && Number.isFinite(prior[field]) ? (prior[field] + row[field]) / 2 : row[field]
    : null;
  const withValues = (values, equation, note = null) => values.every(Number.isFinite)
    ? { equation: `${equation} = ${result}`, note }
    : { equation: "계산에 필요한 공시 수치가 부족합니다.", note: null };

  switch (key) {
    case "operatingMargin": return withValues([row.operatingProfit, row.revenue], `${money(row.operatingProfit)} ÷ ${money(row.revenue)} × 100`);
    case "netMargin": return withValues([row.netIncome, row.revenue], `${money(row.netIncome)} ÷ ${money(row.revenue)} × 100`);
    case "roa": return withValues([row.netIncome, calculatedAverage("totalAssets")], `${money(row.netIncome)} ÷ 평균자산 ${money(calculatedAverage("totalAssets"))} × 100`, previousAverage("totalAssets", "총자산"));
    case "revenueGrowth": return withValues([row.revenue, prior?.revenue], `(${money(row.revenue)} ÷ ${money(prior?.revenue)} - 1) × 100`);
    case "operatingProfitGrowth": return withValues([row.operatingProfit, prior?.operatingProfit], `(${money(row.operatingProfit)} ÷ ${money(prior?.operatingProfit)} - 1) × 100`, row.operatingProfitGrowthType !== "증가율" ? "흑자·적자 전환기에는 증가율보다 부호 변화와 절대금액을 우선 해석합니다." : null);
    case "debtRatio": return withValues([row.totalLiabilities, row.equity], `${money(row.totalLiabilities)} ÷ ${money(row.equity)} × 100`);
    case "currentRatio": return withValues([row.currentAssets, row.currentLiabilities], `${money(row.currentAssets)} ÷ ${money(row.currentLiabilities)} × 100`);
    case "financeCostCoverage": return withValues([row.operatingProfit, row.financeCosts], `${money(row.operatingProfit)} ÷ ${money(row.financeCosts)}`);
    case "assetTurnover": return withValues([row.revenue, calculatedAverage("totalAssets")], `${money(row.revenue)} ÷ 평균자산 ${money(calculatedAverage("totalAssets"))}`, previousAverage("totalAssets", "총자산"));
    case "dso": return withValues([calculatedAverage("accountsReceivable"), row.revenue], `평균매출채권 ${money(calculatedAverage("accountsReceivable"))} ÷ ${money(row.revenue)} × 365`, previousAverage("accountsReceivable", "매출채권"));
    case "cashConversionCycle": return withValues([row.dso, row.dio, row.dpo], `${format(row.dso, 2)}일 + ${format(row.dio, 2)}일 - ${format(row.dpo, 2)}일`, `채권: ${money(calculatedAverage("accountsReceivable"))} ÷ 매출 ${money(row.revenue)} × 365 · 재고: ${money(calculatedAverage("inventory"))} ÷ 매출원가 ${money(row.costOfSales)} × 365 · 매입채무: ${money(calculatedAverage("accountsPayable"))} ÷ 매출원가 ${money(row.costOfSales)} × 365`);
    case "cfoToRevenue": return withValues([row.operatingCashFlow, row.revenue], `${money(row.operatingCashFlow)} ÷ ${money(row.revenue)} × 100`);
    case "cfoToOperatingProfit": return withValues([row.operatingCashFlow, row.operatingProfit], `${money(row.operatingCashFlow)} ÷ ${money(row.operatingProfit)}`);
    case "freeCashFlowMargin": return withValues(
      [row.operatingCashFlow, row.totalCapex, row.revenue],
      `(${money(row.operatingCashFlow)} - 확인된 CAPEX ${money(row.totalCapex)}) ÷ ${money(row.revenue)} × 100`,
      Number.isFinite(row.tangibleCapex) && Number.isFinite(row.intangibleCapex)
        ? `CAPEX = 유형자산 취득 ${money(row.tangibleCapex)} + 무형자산 취득 ${money(row.intangibleCapex)}`
        : "CAPEX 일부 계정이 공시 본문에서 확인되지 않아 확인된 취득금액만 반영했습니다. 주석 검증이 필요합니다.",
    );
    default: return { equation: "계산 근거가 정의되지 않았습니다.", note: null };
  }
}

function trend(values, higherIsBetter = true) {
  const previous = values.at(-2);
  const latest = values.at(-1);
  if (!Number.isFinite(previous) || !Number.isFinite(latest)) return { direction: "자료부족", className: "unknown", delta: null, previous: Number.isFinite(previous) ? previous : null, latest: Number.isFinite(latest) ? latest : null, threshold: null };
  const delta = latest - previous;
  const threshold = Math.max(Math.abs(previous) * 0.05, 0.2);
  if (Math.abs(delta) <= threshold) return { direction: "유지", className: "neutral", delta, previous, latest, threshold };
  const improving = higherIsBetter ? delta > 0 : delta < 0;
  return { direction: improving ? "개선" : "약화", className: improving ? "improving" : "weakening", delta, previous, latest, threshold };
}

function metric({ label, key, unit, records, higherIsBetter = true, formula, definition, account, warning }) {
  const values = records.map((row) => row[key]);
  const result = trend(values, higherIsBetter);
  const calculations = records.map((_, index) => numericSubstitution(key, records.slice(0, index + 1), values[index], unit));
  const calculation = calculations.at(-1);
  return {
    label, key, unit, values, latest: values.at(-1), trend: result, higherIsBetter,
    formula, definition, account, warning, calculation, calculations,
    criterion: result.className === "unknown"
      ? "직전연도와 당기 값이 모두 있어야 판정합니다. 결측값은 이전 연도로 대체하지 않습니다."
      : `직전연도 대비 ${higherIsBetter ? "증가" : "감소"}하면 개선, 반대면 약화입니다. 단, ±${format(result.threshold)}${["%", "%p"].includes(unit) ? "%p" : unit} 이내는 유지로 봅니다.`,
  };
}

function chooseDimensionStatus(metrics) {
  const available = metrics.filter((item) => item.trend.className !== "unknown");
  if (!available.length) return { label: "자료부족", className: "unknown", explanation: "비교 가능한 지표가 없습니다." };
  const improving = available.filter((item) => item.trend.className === "improving").length;
  const weakening = available.filter((item) => item.trend.className === "weakening").length;
  if (weakening > improving) return { label: "약화", className: "weakening", explanation: `${available.length}개 지표 중 약화 ${weakening}개, 개선 ${improving}개` };
  if (improving > weakening) return { label: "개선", className: "improving", explanation: `${available.length}개 지표 중 개선 ${improving}개, 약화 ${weakening}개` };
  return { label: "혼재", className: "neutral", explanation: `${available.length}개 지표의 개선·약화 수가 같거나 변화가 제한적` };
}

function evidenceSentence(dimension) {
  const notable = dimension.metrics.filter((item) => ["improving", "weakening"].includes(item.trend.className));
  if (!notable.length) return "직전연도 대비 유의한 방향 변화가 확인되지 않았습니다.";
  return notable.map((item) => `${item.label} ${item.trend.direction}(${item.trend.delta >= 0 ? "+" : ""}${format(item.trend.delta)}${["%", "%p"].includes(item.unit) ? "%p" : item.unit})`).join(" · ");
}

function verificationStep(title, data, question) {
  return { title, data, question };
}

export function buildPerformanceAnalysis(records, macroRows = []) {
  const latest = records.at(-1);
  const previous = records.at(-2);
  if (!latest) return { dimensions: [], hypotheses: [], conclusion: { label: "자료부족", text: "분석할 재무자료가 없습니다.", evidence: [] } };

  const dimensions = [
    {
      id: "profitability", name: "수익성", question: "매출에서 남기는 이익과 자산의 수익성이 직전연도보다 좋아졌는가",
      metrics: [
        metric({ label: "영업이익률", key: "operatingMargin", unit: "%p", records, formula: "영업이익 ÷ 매출액 × 100", definition: "본업 매출 100원에서 남기는 영업이익", account: "손익계산서 매출액·영업이익" }),
        metric({ label: "순이익률", key: "netMargin", unit: "%p", records, formula: "당기순이익 ÷ 매출액 × 100", definition: "금융·세금까지 반영해 매출에서 최종적으로 남긴 이익", account: "손익계산서 매출액·당기순이익" }),
        metric({ label: "ROA", key: "roa", unit: "%p", records, formula: "당기순이익 ÷ 평균총자산 × 100", definition: "보유자산을 이용해 이익을 낸 정도", account: "당기순이익·기초/기말 자산총계" }),
      ],
    },
    {
      id: "growth", name: "성장성", question: "외형뿐 아니라 영업성과도 직전연도보다 함께 성장했는가",
      metrics: [
        metric({ label: "매출증가율", key: "revenueGrowth", unit: "%", records, formula: "(당기 매출 ÷ 전기 매출 - 1) × 100", definition: "직전연도 대비 외형 성장률", account: "손익계산서 매출액" }),
        metric({ label: "영업이익증가율", key: "operatingProfitGrowth", unit: "%", records, formula: "(당기 영업이익 ÷ 전기 영업이익 - 1) × 100", definition: "직전연도 대비 본업 이익 성장률", account: "손익계산서 영업이익", warning: latest.operatingProfitGrowthType !== "증가율" ? latest.operatingProfitGrowthType : null }),
      ],
    },
    {
      id: "stability", name: "안정성", question: "차입과 단기부담을 견딜 재무 완충력이 직전연도보다 좋아졌는가",
      metrics: [
        metric({ label: "부채비율", key: "debtRatio", unit: "%p", records, higherIsBetter: false, formula: "부채총계 ÷ 자본총계 × 100", definition: "자기자본 대비 전체 부채 부담", account: "재무상태표 부채총계·자본총계" }),
        metric({ label: "유동비율", key: "currentRatio", unit: "%p", records, formula: "유동자산 ÷ 유동부채 × 100", definition: "1년 내 상환부담에 대응할 단기자산의 크기", account: "재무상태표 유동자산·유동부채" }),
        metric({ label: "영업이익/금융비용", key: "financeCostCoverage", unit: "배", records, formula: "영업이익 ÷ 금융비용", definition: "본업 이익이 공시 금융비용을 몇 배 감당하는지 표시", account: "손익계산서 영업이익·금융비용", warning: "주석상 순수 이자비용을 사용한 이자보상배율과 다릅니다." }),
      ],
    },
    {
      id: "activity", name: "활동성", question: "자산과 운전자금의 회전속도가 직전연도보다 개선됐는가",
      metrics: [
        metric({ label: "총자산회전율", key: "assetTurnover", unit: "회", records, formula: "매출액 ÷ 평균총자산", definition: "자산 1원으로 창출한 매출", account: "매출액·기초/기말 자산총계" }),
        metric({ label: "매출채권 회전일", key: "dso", unit: "일", records, higherIsBetter: false, formula: "평균 매출채권 ÷ 매출액 × 365", definition: "외상매출이 현금으로 회수되기까지 걸리는 기간", account: "기초/기말 매출채권·매출액" }),
        metric({ label: "현금전환주기", key: "cashConversionCycle", unit: "일", records, higherIsBetter: false, formula: "채권회수일 + 재고보유일 - 매입결제일", definition: "상품 매입 후 판매대금이 현금으로 회수되기까지 순소요기간", account: "평균 매출채권·재고·매입채무" }),
      ],
    },
    {
      id: "cash", name: "현금창출력", question: "회계상 성과가 실제 영업현금과 잉여현금으로 전환됐는가",
      metrics: [
        metric({ label: "CFO/매출", key: "cfoToRevenue", unit: "%p", records, formula: "영업현금흐름 ÷ 매출액 × 100", definition: "매출 100원당 실제 영업현금 유입", account: "현금흐름표 영업활동현금흐름·매출액" }),
        metric({ label: "CFO/영업이익", key: "cfoToOperatingProfit", unit: "배", records, formula: "영업현금흐름 ÷ 영업이익", definition: "회계상 영업이익이 현금으로 전환된 정도", account: "영업활동현금흐름·영업이익", warning: latest.operatingProfit <= 0 ? "영업적자 시 배수 해석에 주의해야 합니다." : null }),
        metric({ label: "단순 FCF마진", key: "freeCashFlowMargin", unit: "%p", records, formula: "(CFO - 유형·무형 CAPEX) ÷ 매출액 × 100", definition: "필수 투자 후 매출 대비 남는 단순 잉여현금", account: "영업현금흐름·유형/무형자산 취득" }),
      ],
    },
  ].map((dimension) => {
    const status = chooseDimensionStatus(dimension.metrics);
    return { ...dimension, status, interpretation: evidenceSentence({ ...dimension, status }) };
  });

  const hypotheses = [];
  const macro = new Map(macroRows.map((item) => [item.id, item]));
  const baseRate = macro.get("kr-base-rate")?.latest?.value;
  if (Number.isFinite(latest.operatingMargin) && latest.operatingMargin < 5) {
    hypotheses.push({
      id: "margin-pressure", category: "낮은 영업마진의 원가 민감도", priority: "확인 필요",
      observation: `${latest.period}년 영업이익률은 ${format(latest.operatingMargin)}%로 매출 100원당 영업이익이 약 ${format(latest.operatingMargin)}원입니다. 작은 매입원가·인건비 변화도 영업이익에 크게 반영될 수 있습니다.`,
      hypothesis: "원가 상승을 판매가격에 충분히 전가하지 못했거나 저마진 상품·채널 비중이 높아졌을 가능성을 우선 검토합니다.",
      evidence: [`영업이익률 ${format(latest.operatingMargin)}%`, previous ? `전년 ${format(previous.operatingMargin)}%` : "전년 자료없음"],
      verificationSteps: [
        verificationStep("원가 변화", "상품군별 매입원가율·매출총이익률", "어떤 상품·채널의 마진이 가장 크게 하락했는가"),
        verificationStep("가격 전가", "판매단가 변경일과 원가 상승일", "원가 상승 후 판매가격 반영까지 몇 개월이 걸렸는가"),
      ],
    });
  }
  if ((Number.isFinite(latest.debtRatio) && latest.debtRatio >= 150) || (Number.isFinite(latest.financeCostCoverage) && latest.financeCostCoverage < 2)) {
    const short = Number.isFinite(latest.shortTermDebtShare) ? `${format(latest.shortTermDebtShare)}%` : "자료없음";
    const long = Number.isFinite(latest.longTermDebtShare) ? `${format(latest.longTermDebtShare)}%` : "자료없음";
    hypotheses.push({
      id: "rate-debt", category: "차입구조와 금리 민감도", priority: "우선 확인",
      observation: `${latest.period}년 공시 차입금은 단기 ${short}, 장기 ${long}로 구성됩니다. 영업이익/금융비용은 ${format(latest.financeCostCoverage, 2)}배${Number.isFinite(baseRate) ? `이고 기준금리는 ${format(baseRate, 2)}%` : ""}입니다.`,
      hypothesis: "단기차입 또는 변동금리 비중이 높다면 금리 상승·차환 시 금융비용이 빠르게 늘어날 수 있습니다. 현재 API는 만기구분은 확인하지만 고정·변동금리 비중과 실제 가산금리는 주석·고객자료로 보완해야 합니다.",
      evidence: [`단기차입 ${short}`, `장기차입 ${long}`, `부채비율 ${format(latest.debtRatio)}%`, `영업이익/금융비용 ${format(latest.financeCostCoverage, 2)}배`],
      verificationSteps: [
        verificationStep("금리조건", "고정·변동금리 비중 및 차입별 적용금리", "기준금리 1%p 상승 시 12개월 금융비용은 얼마나 늘어나는가"),
        verificationStep("만기집중", "향후 12개월 월별 차입금 만기표", "영업현금으로 상환 가능한 금액과 차환이 필요한 금액은 각각 얼마인가"),
      ],
    });
  }
  if (Number.isFinite(latest.revenueGrowth) && Number.isFinite(latest.cfoGrowth) && latest.revenueGrowth > latest.cfoGrowth + 10) {
    const gap = latest.revenueGrowth - latest.cfoGrowth;
    hypotheses.push({
      id: "growth-quality", category: "매출 성장과 현금유입의 괴리", priority: "확인 필요",
      observation: `${latest.period}년 매출은 전년 대비 ${format(latest.revenueGrowth)}% 변했지만 영업현금흐름은 ${format(latest.cfoGrowth)}% 변해 차이가 ${format(gap)}%p입니다.`,
      hypothesis: "외형 성장분이 아직 현금으로 회수되지 않았거나 재고 선매입·결제조건 변화로 운전자금이 더 많이 묶였을 가능성이 있습니다.",
      evidence: [`매출증가율 ${format(latest.revenueGrowth)}%`, `CFO증가율 ${format(latest.cfoGrowth)}%`, `차이 ${format(gap)}%p`],
      verificationSteps: [
        verificationStep("채권 회수", "매출채권 Aging과 상위 거래처 결제조건", "성장한 매출 중 정상 회수기일을 넘긴 금액은 얼마인가"),
        verificationStep("재고 부담", "품목별 재고일수와 장기체화 재고", "매출 성장 대비 재고가 더 빠르게 늘어난 품목은 무엇인가"),
      ],
    });
  }
  if (!hypotheses.length) hypotheses.push({
    id: "follow-up", category: "추가 영업자료 확인", priority: "정기 확인",
    observation: "현재 연결된 재무비율에서는 우선 가설을 자동 발동할 만큼 큰 임계치 초과가 확인되지 않았습니다.",
    hypothesis: "공시 이후 영업상황 또는 업종 내 상대적 변화는 재무제표만으로 확인되지 않을 수 있습니다.",
    evidence: ["자동 진단 임계치 미충족"],
    verificationSteps: [verificationStep("최근 실적", "최근 월별 매출·이익·자금수지", "공시 이후 실적이 연간 추세와 같은 방향인가")],
  });

  const weakening = dimensions.filter((item) => item.status.className === "weakening");
  const improving = dimensions.filter((item) => item.status.className === "improving");
  const evidence = [...weakening, ...improving].slice(0, 4).map((item) => `${item.name} ${item.status.label}: ${item.interpretation}`);
  const label = weakening.length > improving.length ? "약화 지표 원인 확인 우선" : weakening.length ? "개선·약화 혼재" : "개선 흐름의 지속성 확인";
  const priority = ["cash", "stability", "profitability", "activity", "growth"]
    .map((id) => weakening.find((item) => item.id === id)?.name).filter(Boolean);
  const period = previous ? `${previous.period}년 대비 ${latest.period}년` : `${latest.period}년`;
  const text = weakening.length
    ? `${period}에 5개 분석 영역 중 ${weakening.length}개가 약화로 분류됐습니다. ${priority.slice(0, 3).join("·")}${priority.length > 3 ? " 등" : ""}의 변화 원인을 수치와 제출자료로 우선 확인해야 합니다. 이는 여신 승인·거절 판단이 아닙니다.`
    : `${period}에 뚜렷한 약화 분류는 제한적입니다. 최근 실적과 일회성 효과를 확인해야 하며, 이는 여신 승인·거절 판단이 아닙니다.`;
  return {
    dimensions, hypotheses, conclusion: { label, text, evidence },
    rule: "각 지표는 직전연도와 비교하며 5% 또는 절대 0.2 단위 이내 변화는 유지로 분류합니다. 외부환경은 원인이 아니라 검증할 보조 근거입니다.",
  };
}
