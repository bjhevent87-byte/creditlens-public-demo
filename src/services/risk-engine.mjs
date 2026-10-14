import { growth } from "./financial-service.mjs";

function finding({ id, level, title, metric, current, previous, reason, causes, checks, source }) {
  return { id, level, title, metric, current, previous, reason, causes, checks, source };
}

export function buildRiskAssessment(records, request = {}) {
  const latest = records.at(-1);
  const previous = records.at(-2);
  const redFlags = [];
  if (!latest) return { redFlags, facts: [], interpretations: [], checks: [] };

  if (latest.operatingCashFlow < 0) redFlags.push(finding({
    id: "negative-cfo", level: "danger", title: "영업현금흐름 적자", metric: "CFO",
    current: latest.operatingCashFlow, previous: previous?.operatingCashFlow,
    reason: "본업에서 현금이 유입되지 않아 원리금 상환재원의 지속성을 확인해야 합니다.",
    causes: ["매출채권 회수 지연", "재고 누적", "일회성 운전자금 유출"],
    checks: ["매출채권 Aging", "재고 명세", "주요 거래처 결제조건"], source: latest.source,
  }));
  if (latest.netIncome > 0 && latest.operatingCashFlow < 0) redFlags.push(finding({
    id: "profit-cfo-gap", level: "danger", title: "순이익 흑자와 CFO 적자의 괴리", metric: "순이익 대비 CFO",
    current: latest.operatingCashFlow, previous: latest.netIncome,
    reason: "회계상 이익이 현금으로 전환되지 않고 있습니다.", causes: ["비현금 이익", "채권·재고 증가"],
    checks: ["현금흐름 조정항목", "특수관계자 거래", "매출 인식 조건"], source: latest.source,
  }));
  if (Number.isFinite(latest.revenueGrowth) && Number.isFinite(latest.cfoGrowth) && latest.revenueGrowth - latest.cfoGrowth >= 15) redFlags.push(finding({
    id: "sales-cfo-divergence", level: "warning", title: "매출 성장 대비 현금전환력 둔화", metric: "매출증가율 - CFO증가율",
    current: latest.revenueGrowth - latest.cfoGrowth, previous: null,
    reason: "외형 성장만큼 현금이 따라오지 않아 성장의 질과 운전자금 부담을 확인해야 합니다.",
    causes: ["외상매출 확대", "재고 선매입", "결제조건 악화"], checks: ["매출처별 매출", "채권회수일", "재고회전일"], source: latest.source,
  }));
  if (Number.isFinite(latest.receivablesGrowth) && Number.isFinite(latest.revenueGrowth) && latest.receivablesGrowth - latest.revenueGrowth >= 10) redFlags.push(finding({
    id: "receivables-ahead", level: "warning", title: "매출보다 빠른 매출채권 증가", metric: "채권증가율 - 매출증가율",
    current: latest.receivablesGrowth - latest.revenueGrowth, previous: null,
    reason: "회수조건 악화 또는 매출의 질 저하 가능성을 확인해야 합니다.", causes: ["결제기일 연장", "특정 매출처 집중", "연체 증가"],
    checks: ["채권 Aging", "상위 10개 매출처", "연체·대손충당금"], source: latest.source,
  }));
  if (Number.isFinite(latest.inventoryGrowth) && Number.isFinite(latest.revenueGrowth) && latest.inventoryGrowth - latest.revenueGrowth >= 10) redFlags.push(finding({
    id: "inventory-ahead", level: "warning", title: "매출보다 빠른 재고 증가", metric: "재고증가율 - 매출증가율",
    current: latest.inventoryGrowth - latest.revenueGrowth, previous: null,
    reason: "수요 둔화·선제 생산·원재료 비축 중 어떤 요인인지 현장에서 확인해야 합니다.", causes: ["판매부진", "선제 생산", "원재료 가격 대응"],
    checks: ["실재 재고", "장기체화·불용재고", "제품별 재고회전"], source: latest.source,
  }));
  if (Number.isFinite(latest.financeCostCoverage) && latest.financeCostCoverage < 1.5) redFlags.push(finding({
    id: "low-finance-cost-coverage", level: latest.financeCostCoverage < 1 ? "danger" : "warning", title: "금융비용 완충력 제약", metric: "영업이익/금융비용",
    current: latest.financeCostCoverage, previous: previous?.financeCostCoverage,
    reason: "영업이익이 공시 금융비용을 충분히 웃돌지 못해 금리 상승과 추가 차입에 취약할 수 있습니다. 순수 이자비용 기준 배율은 주석으로 별도 확인해야 합니다.", causes: ["낮은 영업마진", "차입금 증가", "조달금리 상승"],
    checks: ["차입금 만기표", "변동금리 비중", "차입별 실제 금리", "주석상 이자비용"], source: latest.source,
  }));
  if (Number.isFinite(latest.debtGrowth) && latest.debtGrowth >= 20) redFlags.push(finding({
    id: "debt-surge", level: "warning", title: Number.isFinite(previous?.debtGrowth) && latest.debtGrowth < previous.debtGrowth ? "차입잔액 증가 · 증가속도 둔화" : "차입잔액 증가",
    metric: "총차입금 증가율",
    current: latest.debtGrowth, previous: previous?.debtGrowth,
    reason: `${latest.period}년 차입잔액은 ${Math.round(latest.totalDebt / 100_000_000).toLocaleString("ko-KR")}억원으로 전년 ${Math.round(previous.totalDebt / 100_000_000).toLocaleString("ko-KR")}억원보다 ${latest.debtGrowth.toFixed(1)}% 늘었습니다.${Number.isFinite(previous?.debtGrowth) && latest.debtGrowth < previous.debtGrowth ? ` 증가율은 전년 ${previous.debtGrowth.toFixed(1)}%보다 둔화했지만 잔액은 여전히 증가했습니다.` : ""} 증가한 자금의 용도와 상환재원을 확인해야 합니다.`, causes: ["운전자금 부족", "CAPEX", "기존 차입 차환"],
    checks: ["차입금 명세", "자금용도 증빙", "향후 12개월 만기"], source: latest.source,
  }));
  if (Number.isFinite(latest.currentRatio) && latest.currentRatio < 100) redFlags.push(finding({
    id: "low-current-ratio", level: "watch", title: "유동비율 100% 미만", metric: "유동비율",
    current: latest.currentRatio, previous: previous?.currentRatio,
    reason: "단기 채무와 영업정산 구조를 함께 보고 차환 의존도를 확인해야 합니다.", causes: ["단기차입 의존", "매입채무 구조", "현금성자산 부족"],
    checks: ["월별 자금수지", "한도 여유", "단기차입 만기"], source: latest.source,
  }));

  const facts = [
    { label: "매출", value: latest.revenue, change: latest.revenueGrowth, unit: "원", source: latest.source },
    { label: "영업현금흐름", value: latest.operatingCashFlow, change: latest.cfoGrowth, unit: "원", source: latest.source },
    { label: "총차입금", value: latest.totalDebt, change: latest.debtGrowth, unit: "원", source: latest.source },
    { label: "현금전환주기", value: latest.cashConversionCycle, change: previous && Number.isFinite(latest.cashConversionCycle) && Number.isFinite(previous.cashConversionCycle) ? latest.cashConversionCycle - previous.cashConversionCycle : null, unit: "일", source: latest.source },
  ];
  const interpretations = redFlags.slice(0, 4).map((item) => ({ text: item.reason, evidenceIds: [item.id], confidence: "규칙 기반 해석" }));
  if (!interpretations.length) interpretations.push({
    text: "공시 재무지표에서 즉시 경고할 임계치가 확인되지 않았습니다. 이는 여신 승인 또는 상환능력 확정을 의미하지 않습니다.",
    evidenceIds: [], confidence: "제한적 확인",
  });
  const checks = [...new Set(redFlags.flatMap((item) => item.checks))];
  if (Number(request.facilityAmount) > 0) checks.push("시설투자 계약서·견적서", "기존·예상 가동률", "자기자금 투입계획", "투자 후 수주 근거");
  if (Number(request.workingAmount) > 0) checks.push("월별 운전자금 산정표", "매출채권 Aging", "재고 명세", "매입채무 결제조건");
  return { redFlags, facts, interpretations, checks: [...new Set(checks)] };
}

function inspectionIndustry(company = {}) {
  const text = `${company.industry || ""} ${company.companyInfo?.induty_code || ""}`;
  const code = (text.match(/\b(\d{2,5})\b/) || [])[1] || "";
  if (/대형마트|소매|유통|도매/.test(text) || /^(45|46|47)/.test(code)) return "retail";
  if (/건설|부동산/.test(text) || /^(41|42|68)/.test(code)) return "construction";
  if (/정보|소프트웨어|연구|기술|바이오/.test(text) || /^(58|59|60|61|62|63|70|71|72)/.test(code)) return "technology";
  if (/제조/.test(text) || /^(1[0-9]|2[0-9]|3[0-4])/.test(code)) return "manufacturing";
  return "general";
}

export function buildInspectionChecklist(assessment, request = {}, company = {}) {
  const items = [
    { ruleId: "FI-C01", ruleSource: "공통", category: "경영진", question: "경영진이 최근 실적 변화의 원인과 대응계획을 수치와 일정으로 설명하는가", reason: "경영능력과 계획의 실행가능성 확인", status: "미확인" },
    { ruleId: "FI-C02", ruleSource: "공통", category: "조직·인력", question: "핵심인력의 근속·이탈 상황과 업무대체 체계가 안정적으로 운영되는가", reason: "사업 연속성과 조직 안정성 확인", status: "미확인" },
    { ruleId: "FI-C03", ruleSource: "공통", category: "영업현장", question: "주요 고객·공급처와의 거래가 실제 운영상황 및 제출자료와 일치하는가", reason: "매출과 구매구조의 실재성 확인", status: "미확인" },
    { ruleId: "FI-C04", ruleSource: "공통", category: "내부관리", question: "판매·구매·재고·자금 집행의 승인과 기록 절차가 담당자별로 분리되어 있는가", reason: "내부통제와 자료 신뢰성 확인", status: "미확인" },
  ];
  for (const flag of assessment.redFlags) {
    if (flag.id.includes("inventory")) items.push({ ruleId: `FI-R-${flag.id}`, ruleSource: "재무 위험신호", category: "재고운영", question: "현장 재고의 수량·상태·보관기간이 재고명세와 일치하는가", reason: flag.title, status: "미확인" });
    if (flag.id.includes("receivable") || flag.id.includes("sales-cfo")) items.push({ ruleId: `FI-R-${flag.id}`, ruleSource: "재무 위험신호", category: "영업·회수", question: "주요 거래처의 납품·검수·청구·회수 과정에 지연이나 분쟁이 있는가", reason: flag.title, status: "미확인" });
  }
  const industry = inspectionIndustry(company);
  if (industry === "manufacturing") items.push(
    { category: "생산", question: "주요 생산라인의 실제 가동상태와 병목공정이 생산계획과 일치하는가", reason: "생산능력과 가동률 확인", status: "미확인" },
    { category: "품질", question: "불량·반품·재작업 현황과 품질관리 기록이 안정적으로 관리되는가", reason: "수익성과 거래지속성 확인", status: "미확인" },
    { category: "설비", question: "핵심설비의 노후도·유지보수 이력과 대체가능성이 적정한가", reason: "조업중단 및 추가투자 위험 확인", status: "미확인" },
  );
  if (industry === "retail") items.push(
    { category: "점포운영", question: "주요 점포의 고객 유입·객단가·매장 생산성 변화가 내부자료와 일치하는가", reason: "영업현장의 매출창출력 확인", status: "미확인" },
    { category: "상품·재고", question: "상품 진열·회전·폐기·할인판매 상태와 장기재고 관리가 적정한가", reason: "재고손실과 운전자금 부담 확인", status: "미확인" },
    { category: "상권·채널", question: "상권 변화와 온라인·오프라인 채널 전환에 대한 대응계획이 구체적인가", reason: "점포 경쟁력과 사업모델 확인", status: "미확인" },
  );
  if (industry === "technology") items.push(
    { category: "기술·권리", question: "핵심기술과 특허의 실제 보유·귀속·유효기간 및 분쟁 가능성을 설명할 수 있는가", reason: "기술경쟁력과 권리 안정성 확인", status: "미확인" },
    { category: "개발인력", question: "핵심 개발인력 의존도와 이탈 시 대체·인수인계 계획이 마련되어 있는가", reason: "기술사업 연속성 확인", status: "미확인" },
    { category: "상용화", question: "개발단계·고객검증·수주·매출전환 일정에 객관적 증빙이 있는가", reason: "미래 현금창출 가능성 확인", status: "미확인" },
  );
  if (industry === "construction") items.push(
    { category: "사업현장", question: "인허가·공정률·시공상태가 사업계획 및 기성자료와 일치하는가", reason: "사업진행 실재성 확인", status: "미확인" },
    { category: "원가·공정", question: "공사비 상승·공정지연·우발비용에 대한 예비비와 대응계획이 있는가", reason: "비용초과 위험 확인", status: "미확인" },
    { category: "분양·임대", question: "분양·임대·매각계획과 계약현황을 현장에서 확인할 수 있는가", reason: "상환재원 실현가능성 확인", status: "미확인" },
  );
  if (Number(request.facilityAmount) > 0) {
    items.push(
      { ruleId: "FI-F01", ruleSource: "시설자금", category: "시설", question: "신규 설비의 실재·사양·계약금 지급 여부", reason: "시설자금 용도 검증", status: "미확인" },
      { ruleId: "FI-F02", ruleSource: "시설자금", category: "시설", question: "이전 가동률과 현재 가동률 및 산출 근거", reason: "투자 필요성과 수요 검증", status: "미확인" },
      { ruleId: "FI-F03", ruleSource: "시설자금", category: "시설", question: "투자 후 생산량을 흡수할 수주·판매계획", reason: "장기 현금창출력 검증", status: "미확인" },
    );
  }
  if (Number(request.workingAmount) > 0) items.push(
    { ruleId: "FI-W01", ruleSource: "운전자금", category: "자금흐름", question: "매입부터 판매·검수·청구·입금까지 실제 회전 과정과 신청기간이 일치하는가", reason: "운전자금 기간과 회수재원의 정합성 확인", status: "미확인" },
    { ruleId: "FI-W02", ruleSource: "운전자금", category: "자금용도", question: "신청자금이 원재료·상품매입 등 제시한 용도로 집행될 수 있는 거래 증빙이 있는가", reason: "시설·관계회사 등 타용도 유출 방지", status: "미확인" },
  );
  return items
    .map((item, index) => ({ ruleId: item.ruleId || `FI-I${String(index + 1).padStart(2, "0")}`, ruleSource: item.ruleSource || "업종", ...item }))
    .filter((item, index, all) => all.findIndex((other) => other.category === item.category && other.question === item.question) === index);
}

export function buildDecisionSupport(assessment, request = {}, records = []) {
  const severe = assessment.redFlags.filter((item) => item.level === "danger").length;
  const caution = assessment.redFlags.filter((item) => ["warning", "watch"].includes(item.level)).length;
  const workingAmount = Number(request.workingAmount || 0);
  const facilityAmount = Number(request.facilityAmount || 0);
  const latest = records.at(-1) || {};
  const previous = records.at(-2) || {};
  const daysText = (value) => Number.isFinite(value) ? `${value.toFixed(1)}일` : "자료부족";
  const percentText = (value) => Number.isFinite(value) ? `${value.toFixed(1)}%` : "자료부족";
  const visibleRevenueGrowth = Number.isFinite(latest.revenueGrowth) ? Number(latest.revenueGrowth.toFixed(1)) : null;
  const visibleCfoGrowth = Number.isFinite(latest.cfoGrowth) ? Number(latest.cfoGrowth.toFixed(1)) : null;
  const gap = visibleRevenueGrowth !== null && visibleCfoGrowth !== null ? Number((visibleRevenueGrowth - visibleCfoGrowth).toFixed(1)) : null;
  const growthText = (name, value) => !Number.isFinite(value) ? `${name} 비교자료 없음` : value > 0 ? `${name} ${value.toFixed(1)}% 증가` : value < 0 ? `${name} ${Math.abs(value).toFixed(1)}% 감소` : `${name} 변화 없음`;
  const growthComparison = `${growthText("매출", visibleRevenueGrowth)} · ${growthText("영업현금", visibleCfoGrowth)}`;
  const gapInterpretation = !Number.isFinite(gap) ? "매출 또는 영업현금흐름 비교자료가 부족합니다."
    : latest.operatingCashFlow < 0 ? `${growthComparison}. 영업현금흐름 자체는 적자이므로 증가율만으로 현금창출력 개선을 판단하지 않습니다.`
      : gap > 0 ? `${growthComparison}. 매출 증가율이 영업현금 증가율보다 ${gap.toFixed(1)}%p 높습니다. 채권·재고 증가로 현금회수가 늦어졌는지 확인합니다.`
        : gap < 0 ? `${growthComparison}. 영업현금 증가율이 매출 증가율보다 ${Math.abs(gap).toFixed(1)}%p 높습니다. 두 수치의 차이가 일회성 운전자본 회수 때문인지 확인합니다.`
          : `${growthComparison}. 두 증가율이 같습니다.`;
  const workingRules = [
    {
      id: "WC-01", title: "현금전환주기", result: daysText(latest.cashConversionCycle),
      formula: "채권회수일 + 재고보유일 - 매입결제일",
      calculation: `${daysText(latest.dso)} + ${daysText(latest.dio)} - ${daysText(latest.dpo)} = ${daysText(latest.cashConversionCycle)}`,
      explanation: `상품 매입대금 지급부터 판매대금 회수까지 순수하게 현금이 묶이는 기간입니다. ${latest.workingCapitalDaysBasis || "잔액 기준"}으로 계산했습니다.`,
      interpretation: Number.isFinite(latest.cashConversionCycle) ? `신청기간 ${request.workingTermMonths || 12}개월과 ${latest.cashConversionCycle.toFixed(1)}일 회전주기가 맞는지, 같은 기간 여러 번 회전하는 자금인지 확인합니다.` : "회전일수 산정에 필요한 매출채권·재고·매입채무를 확인해야 합니다.",
      check: "월별 매입·판매·회수 일정과 신청기간 비교",
    },
    {
      id: "WC-02", title: "매출과 영업현금 증가율", result: Number.isFinite(gap) ? `매출 ${percentText(visibleRevenueGrowth)} · 영업현금 ${percentText(visibleCfoGrowth)}` : "자료부족",
      formula: "매출증가율 - 영업현금흐름 증가율",
      calculation: `${percentText(visibleRevenueGrowth)} - ${visibleCfoGrowth < 0 ? `(${percentText(visibleCfoGrowth)})` : percentText(visibleCfoGrowth)} = ${Number.isFinite(gap) ? `${gap.toFixed(1)}%p` : "자료부족"} (표시값 기준)`,
      explanation: "매출과 영업현금이 각각 전년보다 얼마나 달라졌는지 먼저 비교합니다. 두 증가율의 간격은 %p이며, 영업현금의 절대금액·흑자 여부와 구분합니다.",
      interpretation: gapInterpretation,
      check: "채권 Aging·재고·매입결제조건으로 차이의 원인 확인",
    },
    {
      id: "WC-03", title: "최근 연간 영업현금", result: Number.isFinite(latest.operatingCashFlow) ? `${Math.round(latest.operatingCashFlow / 100_000_000).toLocaleString("ko-KR")}억원` : "자료부족",
      formula: "현금흐름표 영업활동현금흐름",
      calculation: `${latest.period || "최근"}년 CFO ${Number.isFinite(latest.operatingCashFlow) ? `${Math.round(latest.operatingCashFlow / 100_000_000).toLocaleString("ko-KR")}억원` : "자료부족"}${Number.isFinite(previous.operatingCashFlow) ? ` · 전년 ${Math.round(previous.operatingCashFlow / 100_000_000).toLocaleString("ko-KR")}억원` : ""}`,
      explanation: "연간 CFO는 상환재원의 출발점이지만 대출 만기월의 실제 현금과 같지 않습니다.",
      interpretation: "월별 자금수지에서 대출 만기까지 실제로 회수되는 금액을 다시 계산해야 합니다.",
      check: "향후 12개월 월별 자금수지와 기존 원리금 상환일정 확인",
    },
  ];
  const capexCoverage = Number(latest.totalCapex) > 0 && Number.isFinite(latest.operatingCashFlow) ? latest.operatingCashFlow / latest.totalCapex : null;
  const facilityRules = [
    { id: "FC-01", title: "내부현금의 투자흡수력", result: Number.isFinite(capexCoverage) ? `${capexCoverage.toFixed(2)}배` : "자료부족", formula: "CFO ÷ 유형·무형 CAPEX", calculation: `${Number.isFinite(latest.operatingCashFlow) ? Math.round(latest.operatingCashFlow / 100_000_000).toLocaleString("ko-KR") : "?"}억원 ÷ ${Number.isFinite(latest.totalCapex) ? Math.round(latest.totalCapex / 100_000_000).toLocaleString("ko-KR") : "?"}억원 = ${Number.isFinite(capexCoverage) ? `${capexCoverage.toFixed(2)}배` : "자료부족"}`, explanation: "1배 이상이면 최근 투자규모를 영업현금으로 충당했다는 뜻이며, 신규 시설 전체를 감당한다는 의미는 아닙니다.", interpretation: "신규 시설자금, 자기자금, 기존 투자계획을 합친 뒤 향후 현금수지로 재검증합니다.", check: "자기자금 투입과 비용초과 대응재원 확인" },
    { id: "FC-02", title: "기존 금융비용 완충력", result: Number.isFinite(latest.financeCostCoverage) ? `${latest.financeCostCoverage.toFixed(2)}배` : "자료부족", formula: "영업이익 ÷ 금융비용", calculation: `${Number.isFinite(latest.operatingProfit) ? Math.round(latest.operatingProfit / 100_000_000).toLocaleString("ko-KR") : "?"}억원 ÷ ${Number.isFinite(latest.financeCosts) ? Math.round(latest.financeCosts / 100_000_000).toLocaleString("ko-KR") : "?"}억원 = ${Number.isFinite(latest.financeCostCoverage) ? `${latest.financeCostCoverage.toFixed(2)}배` : "자료부족"}`, explanation: "포괄손익계산서 금융비용 기준입니다. 주석상 순수 이자비용을 사용한 이자보상배율과 구분합니다.", interpretation: "신규 차입의 예상 금리와 상환방식을 반영해 투자 후 배율을 다시 계산해야 합니다.", check: "신규 원리금 반영 추정 현금흐름 및 주석상 이자비용 확인" },
    { id: "FC-03", title: "투자수요와 매출전환 검증", result: "고객자료 필요", formula: "추가 판매량 × 공헌이익 - 신규 고정비", calculation: "가동률·수주·단가·원가 자료 입력 후 계산", explanation: "시설투자가 실제 추가 현금을 만드는지 확인하는 단계로, 공시 API만으로 자동 확정할 수 없습니다.", interpretation: "기존 유휴설비가 있는데 신규시설을 요청하는지, 투자 후 판매처가 확보됐는지 확인합니다.", check: "가동률·수주·판매계약·인허가 확인" },
  ];
  return {
    workingCapital: {
      requested: workingAmount,
      stance: workingAmount ? (severe ? "추가 검증 후 검토" : "회전주기·회수재원 확인 후 검토") : "신청 없음",
      basis: ["운전자금 회전주기", "CFO와 매출의 괴리", "채권·재고 증감"],
      appliedRules: workingRules,
    },
    facility: {
      requested: facilityAmount,
      stance: facilityAmount ? (severe || caution >= 2 ? "자기자금·수주·담보 보완 가능성 검토" : "투자 후 현금창출력 검증 후 검토") : "신청 없음",
      basis: ["기존 가동률", "CAPEX와 장기 현금흐름", "산업 수요", "자기자금 투입"],
      appliedRules: facilityRules,
    },
    disclaimer: "이 결과는 공개자료 기반 판단지원이며 승인·거절 또는 담보금액을 자동 결정하지 않습니다.",
  };
}
