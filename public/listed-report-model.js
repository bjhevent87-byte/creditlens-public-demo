const hasValue = (value) => Number.isFinite(Number(value)) && value !== null && value !== undefined && value !== "";
const money = (value) => hasValue(value) ? `${(Number(value) / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원` : "자료 확인 필요";
const ratio = (value, digits = 1, unit = "%") => hasValue(value) ? `${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits })}${unit}` : "자료 확인 필요";
const period = (row) => row?.period ? `${row.period}년` : "기간 확인 필요";
const nonempty = (values) => values.filter((value) => value !== null && value !== undefined && String(value).trim());

function growth(current, previous) {
  return hasValue(current) && hasValue(previous) && Number(previous) > 0
    ? `${((Number(current) / Number(previous) - 1) * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
    : "증감률 산정 불가";
}

function interimForScope(analysis, scope) {
  const view = analysis.supplementary?.interimViews?.[scope];
  if (view?.trend) return view.trend;
  if (view?.current) return {
    ...view.current,
    period: `${view.current.period} ${view.current.reportType || "중간보고서"}`,
    comparisonPeriod: view.prior ? `${view.prior.period} ${view.prior.reportType || "동일 보고서"}` : null,
    previousRevenue: view.prior?.revenue ?? null,
    previousOperatingProfit: view.prior?.operatingProfit ?? null,
    previousOperatingCashFlow: view.prior?.operatingCashFlow ?? null,
  };
  const trend = analysis.supplementary?.interimTrend;
  return trend?.fsDiv === scope ? trend : null;
}

function uniqueSources(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row?.name) return false;
    const key = `${row.name}|${row.period || ""}|${row.scope || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildListedReportModel(analysis, context = {}) {
  if (!analysis) throw new Error("분석 결과가 없습니다.");
  const scope = analysis.statementViews?.OFS ? "OFS" : analysis.primaryFsDiv || "CFS";
  const borrower = analysis.statementViews?.[scope] || analysis;
  const records = Array.isArray(borrower.records) ? borrower.records : [];
  const latest = records.at(-1) || {};
  const previous = records.at(-2) || {};
  const group = scope === "OFS" ? analysis.statementViews?.CFS?.records?.at(-1) : null;
  const request = analysis.loanRequest || {};
  const company = analysis.company || {};
  const companyInfo = company.companyInfo || {};
  const interim = interimForScope(analysis, scope);
  const focusInterim = Boolean(interim && Number(String(interim.period).slice(0, 4)) === Number(analysis.dataQuality?.requestedYear) && Number(analysis.dataQuality?.requestedYear) > Number(latest.period));
  const demo = /교육용|가상/.test(String(analysis.mode || "")) || /교육용|가상/.test(String(latest.source || ""));
  const flags = Array.isArray(borrower.assessment?.redFlags) ? borrower.assessment.redFlags : [];
  const cashInsights = Array.isArray(borrower.cashFlowAnalysis?.insights) ? borrower.cashFlowAnalysis.insights : [];
  const workingRules = borrower.decisionSupport?.workingCapital?.appliedRules || [];
  const facilityRules = borrower.decisionSupport?.facility?.appliedRules || [];
  const inspection = Array.isArray(context.inspections) ? context.inspections : (borrower.inspection || []).map((item) => ({
    category: item.category, question: item.question, status: "미확인", observation: "", evidence: "", action: "", files: [],
  }));
  const completed = inspection.filter((item) =>
    !["미확인", "근거 미기록", "후속조치 미기록", "요청자료 미기록"].includes(item.status)
    && item.observation?.trim() && item.evidence?.trim() && (item.action || item.followUp)?.trim()).length;
  const onsiteConcerns = inspection.filter((item) => /우려|이상|자료\s*요청/.test(String(item.selectedStatus || item.status || "")));
  const onsitePending = inspection.length - completed;
  const onsiteGate = onsiteConcerns.length
    ? `현장 우려·자료요청 ${onsiteConcerns.length}건의 근거와 조치가 심사역에게 재검토되기 전까지 조건 제안 보류`
    : onsitePending > 0 ? `현장실사 ${onsitePending}건 미완료 · 조건 제안 보류` : null;
  const relevantMacro = Array.isArray(context.macroRows) ? context.macroRows : [];
  const industryEvidence = Array.isArray(context.industryEvidence) ? context.industryEvidence : [];
  const findingReviews = Array.isArray(context.findings) ? context.findings : flags;
  const review = context.reviewOutcome || {};
  const validationIssues = (analysis.dataQuality?.validations || []).filter((item) => item.balanceSheet === "불일치" || item.cashFlow === "차이 확인");
  const basisLabel = scope === "OFS" ? "별도재무제표 · 차주 법인" : "연결재무제표 · 차주 별도자료 미확인";

  const summaryBullets = nonempty([
    analysis.dataQuality?.yearFallback ? `요청 기준연도 ${analysis.dataQuality.requestedYear}년의 연간 사업보고서는 아직 없어 ${analysis.dataQuality.latestAvailableYear || latest.period}년 연간자료를 사용했습니다. ${focusInterim ? `${interim.period} 누적 실적을 첫 요약에 별도로 제시합니다.` : "당해연도 중간 실적도 추가 확인해야 합니다."}` : null,
    `${period(latest)} ${basisLabel}: 매출 ${money(latest.revenue)}, 영업이익 ${money(latest.operatingProfit)}, 영업활동현금흐름 ${money(latest.operatingCashFlow)}.`,
    interim ? `${interim.period} 누적: 매출 ${money(interim.revenue)}, 영업이익 ${money(interim.operatingProfit)}, 영업활동현금흐름 ${money(interim.operatingCashFlow)}. ${interim.comparisonPeriod || "전년 동기 비교자료 없음"}와만 비교합니다.` : "최신 중간재무를 확인하지 못했습니다. 연간 실적 이후의 변화를 별도로 확인해야 합니다.",
    flags.length ? `규칙 기반 우선 확인 ${flags.length}건: ${flags.slice(0, 4).map((item) => item.title).join(" · ")}. 원인 확정이 아니라 검증 대상입니다.` : "설정된 수치 임계치의 자동 경고는 없습니다. 위험 부재나 승인 가능을 뜻하지 않습니다.",
    `현장실사 ${completed}/${inspection.length}건에 관찰 사실·확인 근거·후속조치가 함께 기록됐습니다. 미확인 항목은 최종 의견에서 제외하지 않습니다.`,
  ]);

  const macroBullets = relevantMacro.map((item) => item.latest && hasValue(item.latest.value)
    ? `${item.name}: ${ratio(item.latest.value, 2, item.unit ? ` ${item.unit}` : "")} (${item.latest.date || "수록시점 확인 필요"}; ${item.source || "출처 확인 필요"}). 기업 매출·원가·차입금과의 실제 노출은 별도 확인해야 합니다.`
    : `${item.name}: 최신 수치 확인 필요 (${item.source || "출처 확인 필요"}).`);
  const industryBullets = industryEvidence.map((item) => `${item.name || "업종지표"} ${item.period || "기간 미확인"}: ${hasValue(item.previous) ? item.previous : "자료없음"} → ${hasValue(item.latest) ? item.latest : "자료없음"}${item.unit || ""}. 회사 매출노출 ${hasValue(item.exposure) ? ratio(item.exposure, 1) : "미확인"}; ${item.verification || "원자료·기업노출 대조 전"}.`);
  const operationsBullets = nonempty([
    hasValue(latest.dso) || hasValue(latest.dio) || hasValue(latest.dpo) ? `매출채권 회수 ${ratio(latest.dso, 1, "일")}, 재고 보유 ${ratio(latest.dio, 1, "일")}, 매입채무 결제 ${ratio(latest.dpo, 1, "일")}; 현금전환주기 ${ratio(latest.cashConversionCycle, 1, "일")} (${period(latest)} 연간). 계정 범위와 평균잔액은 원문 대조가 필요합니다.` : null,
    context.siteUtilization ? `현장 입력 가동률: 이전 ${ratio(context.siteUtilization.previous)} → 현재 ${ratio(context.siteUtilization.current)} (변화 ${ratio(context.siteUtilization.current - context.siteUtilization.previous, 1, "%p")}). 산출기간·분모·설비별 원자료 대조 전입니다.` : null,
    ...cashInsights.map((item) => `${item.title}: ${item.meaning}`),
    "공급처·주요 고객·상품 또는 생산라인별 실제 운영상황은 공시 재무계정만으로 확인하지 못합니다. 현장 기록 및 계약·매출 자료와 대조해야 합니다.",
  ]);
  const debtBullets = nonempty([
    `${period(latest)} 구조화 자료에서 확인된 차입·사채 계정 합계(리스 제외) ${money(latest.totalDebt)}, 부채비율 ${ratio(latest.debtRatio)}, 유동비율 ${ratio(latest.currentRatio)}, ${latest.financeCostsSource === "이자비용 대체값" ? "영업이익/이자비용(대체)" : "영업이익/금융비용"} ${ratio(latest.financeCostCoverage, 2, "배")}. 누락 계정과 만기분류는 주석 대조 전입니다.`,
    hasValue(latest.shortTermDebtShare) ? `구조화 계정 기준 1년 내 차입·사채 비중 ${ratio(latest.shortTermDebtShare)}. 누락 계정, 유동성 대체, 차환약정·리스·보증을 주석과 차입명세로 확인해야 합니다.` : "1년 내 차입·사채 비중을 구조화 계정에서 확정하지 못했습니다. 주석의 유동성 대체·사채·리스 구분을 확인해야 합니다.",
    group ? `연결(그룹) ${group.period}년 영업활동현금흐름 ${money(group.operatingCashFlow)}, 금융차입금 ${money(group.totalDebt)}. 그룹 현금이 차주 법인의 직접 상환재원이라는 뜻은 아닙니다.` : "연결 그룹 수치를 별도로 확보하지 못했습니다. 종속회사 손실·보증·자금지원 위험을 원문에서 확인해야 합니다.",
    context.debtSummary?.trusted ? `고객 차입명세 대조: 12개월 내 만기 ${ratio(context.debtSummary.dueWithin12, 1, "억원")}, 변동금리 비중 ${ratio(context.debtSummary.variableShare)}. 차입명세의 원본 대조 기록을 확인해야 합니다.` : "기존 차입별 만기·금리조건·담보·보증은 원문과 고객 제출자료 대조 전입니다.",
  ]);
  const purposeBullets = nonempty([
    Number(request.workingAmount) > 0 ? `운전자금 ${request.workingAmount}억원·${request.workingTermMonths || "기간 미입력"}개월: ${borrower.decisionSupport?.workingCapital?.stance || "검토 전"}. ${workingRules.map((rule) => `${rule.title} ${rule.result} (${rule.calculation})`).join("; ") || "회전기간과 월별 회수재원 확인 필요"}.` : null,
    Number(request.facilityAmount) > 0 ? `시설자금 ${request.facilityAmount}억원·${request.facilityTermMonths || "기간 미입력"}개월: ${borrower.decisionSupport?.facility?.stance || "검토 전"}. ${facilityRules.map((rule) => `${rule.title} ${rule.result} (${rule.calculation})`).join("; ") || "투자집행·가동·장기 현금창출 확인 필요"}.` : null,
    !Number(request.workingAmount) && !Number(request.facilityAmount) ? "신청 여신 금액이 입력되지 않았습니다. 자금용도별 상환 판단 전입니다." : null,
  ]);
  const stress = context.stress;
  const scenarioBullets = nonempty([
    stress?.available && stress.simple && stress.baseline && stress.stressed
      ? `사용자 가정에 따른 단순 민감도: 연간 매출 ${money(stress.baseline.revenue)} → ${money(stress.stressed.revenue)}, 영업이익 ${money(stress.baseline.operatingProfit)} → ${money(stress.stressed.operatingProfit)}. 미래 예측 또는 원리금 상환 가능액이 아닙니다.`
      : "매출·영업이익 민감도는 계산하지 않았거나 필수 재무값이 부족합니다. 결측값을 0으로 보지 않습니다.",
    ...purposeBullets,
    context.structure?.basis ? `고객 현금수지 입력 기준: ${context.structure.basis}. 은행 승인한도나 제시금리가 아닙니다.` : "월별 자금수지와 기존 원리금 일정이 없어 적정금액·상환구조는 산정하지 않습니다.",
  ]);
  const reviewedFindings = Array.isArray(review.findings) ? review.findings : [];
  const resolved = reviewedFindings.filter((item) => item.status === "해소");
  const pending = reviewedFindings.filter((item) => item.status !== "해소");
  const opinionBullets = nonempty([
    Number(request.workingAmount) > 0 ? `운전자금: ${onsiteGate || review.working?.status || "심사 전"}. ${onsiteGate ? "현장 관찰·증빙의 해소 여부와 회수자료를 다시 확인해야 합니다." : review.working?.explanation || "실제 회전재원과 만기 내 현금회수 자료 확인이 필요합니다."}` : null,
    Number(request.facilityAmount) > 0 ? `시설자금: ${onsiteGate || review.facility?.status || "심사 전"}. ${onsiteGate ? "현장 관찰·증빙의 해소 여부와 투자·가동자료를 다시 확인해야 합니다." : review.facility?.explanation || "투자계약·자기자금·투자 후 원리금 일정 확인이 필요합니다."}` : null,
    `증빙으로 해소 기록 ${resolved.length}건, 미해결·추가 확인 ${pending.length}건. 파일 첨부만으로 우려가 해소되지는 않습니다.`,
    ...resolved.slice(0, 5).map((item) => `${item.title}: ${item.note || "해소 판단 근거 미기록"} (담당자 판단이며 심사역 재확인 대상).`),
    context.inspectionNotes ? `현장 종합 메모: ${context.inspectionNotes}` : "현장 종합 메모가 입력되지 않았습니다.",
  ]);
  const workingReview = Number(request.workingAmount) > 0 ? {
    status: onsiteGate || review.working?.status || borrower.decisionSupport?.workingCapital?.stance || "상환구조 검증 전",
    evidence: `${period(latest)} 현금전환주기 ${ratio(latest.cashConversionCycle, 1, "일")}, 영업활동현금흐름 ${money(latest.operatingCashFlow)}${interim ? `; 최근 ${interim.period} 누적 영업현금 ${money(interim.operatingCashFlow)}` : ""}.`,
    concern: flags.length ? `우선 확인 신호 ${flags.length}건의 자금회전·회수 영향을 원자료와 대조해야 합니다.` : "월별 매입·판매·회수 일정과 실제 대출 만기 내 회수가능액을 확인해야 합니다.",
    condition: onsiteGate ? "현장 우려·미확인 항목을 대조하고, 매출채권 연령표와 월별 자금수지 확인 후 금액·만기·상환방식을 심사역이 검토합니다." : review.working?.explanation || "매출채권 연령표와 월별 자금수지 확인 후 금액·만기·상환방식을 심사역이 검토합니다.",
  } : null;
  const facilityReview = Number(request.facilityAmount) > 0 ? {
    status: onsiteGate || review.facility?.status || borrower.decisionSupport?.facility?.stance || "투자 후 현금흐름 검증 전",
    evidence: `${period(latest)} 영업활동현금흐름 ${money(latest.operatingCashFlow)}, 유형·무형자산 취득 ${money(latest.totalCapex)}, 영업이익 ${money(latest.operatingProfit)}.`,
    concern: "투자 집행·가동·수주·추가 현금창출과 기존 원리금 일정을 연결한 검증이 필요합니다.",
    condition: onsiteGate ? "현장 우려·미확인 항목을 대조하고, 투자계약·자기자금·가동계획과 연도별 현금수지 확인 후 장기 상환조건을 심사역이 검토합니다." : review.facility?.explanation || "투자계약, 자기자금, 가동·판매계획과 연도별 현금수지 확인 후 장기 상환조건을 심사역이 검토합니다.",
  } : null;
  const scenarioRows = stress?.available && stress.simple && stress.baseline && stress.stressed ? [{
    name: "매출·영업이익 단순 민감도",
    assumptions: `매출 변화 ${ratio(stress.assumptions?.salesShockPct, 1)}, 영업이익률 변화 ${ratio(stress.assumptions?.marginShockPp, 1, "%p")}`,
    results: `매출 ${money(stress.baseline.revenue)} → ${money(stress.stressed.revenue)}; 영업이익 ${money(stress.baseline.operatingProfit)} → ${money(stress.stressed.operatingProfit)}`,
    interpretation: stress.interpretation || "가정에 따른 민감도이며 예측값이 아닙니다.",
    limitations: "신규 대출 이자·원금, 실제 현금흐름, 승인가능액은 계산하지 않았습니다.",
  }] : [];
  const financialFindings = findingReviews.slice(0, 8).map((item) => ({
    title: item.title,
    observed: item.reason || `${item.metric || "재무 변화"} · 원계정 확인 필요`,
    interpretation: "규칙이 우선 확인 신호로 분류했습니다. 제시된 문장은 원인 확정이나 위험등급이 아닙니다.",
    check: item.id?.includes("receivable") ? "매출채권 연령표·거래처별 회수내역" : item.id?.includes("debt") ? "차입금 주석·만기표·실제 자금용도" : "공시 원계정·주석 및 고객 제출자료",
  }));
  const openItems = [
    { title: "차입금·담보·보증 주석 원문 대조", reason: "구조화 차입·사채 계정 합계에는 누락 계정 또는 유동성 대체가 있을 수 있습니다.", owner: "기업금융 담당자" },
    { title: "월별 자금수지와 기존 원리금 일정", reason: "연간 손익·영업현금만으로 신청 만기별 상환재원을 확정할 수 없습니다.", owner: "기업금융 담당자·심사역" },
    { title: "사업부문·주요 거래처·관계회사 지원", reason: "기업개황과 재무계정만으로 사업구조·집중위험·그룹 지원의무를 검증하지 못합니다.", owner: "기업금융 담당자" },
    ...(analysis.dataQuality?.yearFallback ? [{ title: `${analysis.dataQuality.requestedYear}년 연간자료 공백`, reason: `${analysis.dataQuality.latestAvailableYear || latest.period}년 연간자료를 사용했습니다. 최신 중간 누적실적은 별도 기간으로 검토하고, 이후 월별 실적을 확인해야 합니다.`, owner: "기업금융 담당자" }] : []),
    ...pending.map((item) => ({ title: item.title, reason: item.originalConcern || item.note || "증빙·재판단 필요", owner: "기업금융 담당자·심사역" })),
    ...findingReviews.filter((item) => !reviewedFindings.some((reviewed) => reviewed.id === item.id)).map((item) => ({ title: item.title, reason: item.reason || "원자료와 대조 필요", owner: "기업금융 담당자" })),
    ...validationIssues.map((item) => ({ title: `${item.period}년 재무 자동검산 차이`, reason: `자산=부채+자본 ${item.balanceSheet}; 현금흐름 ${item.cashFlow}`, owner: "자료 제출자·담당자" })),
    ...inspection.filter((item) =>
      !item.status || ["미확인", "근거 미기록", "후속조치 미기록", "요청자료 미기록"].includes(item.status)
      || !item.observation?.trim() || !item.evidence?.trim() || !(item.action || item.followUp)?.trim()
      || /우려|이상|자료\s*요청/.test(String(item.selectedStatus || item.status || "")))
      .map((item) => ({ title: `${item.category} 현장 확인`, reason: `${item.question} · ${item.selectedStatus || item.status}${item.status !== item.selectedStatus ? ` (${item.status})` : ""}`, owner: "현장 담당자·심사역" })),
  ];

  const sources = uniqueSources([
    ...Object.entries(analysis.statementViews || { [scope]: borrower }).flatMap(([fsDiv, view]) => (view.records || []).map((row) => ({
      name: row.source || "재무제표 출처 확인 필요", period: `${row.period}년 사업보고서`, scope: fsDiv === "OFS" ? "별도 · 차주" : "연결 · 그룹", status: demo ? "교육용 가상자료 · 공식 공시 아님" : "API 수신 · 원문 대조 필요", url: !demo && row.rceptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(row.rceptNo)}` : null,
    }))),
    ...Object.entries(analysis.supplementary?.interimViews || {}).flatMap(([fsDiv, view]) => [view.current, view.prior].filter(Boolean).map((row) => ({
      name: row.source || "중간재무 공시", period: `${row.period} ${row.reportType || "중간보고서"}`, scope: fsDiv === "OFS" ? "별도 · 차주" : "연결 · 그룹", status: demo ? "교육용 가상자료 · 공식 공시 아님" : "API 수신 · 전년 동기 대조", url: !demo && row.rceptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(row.rceptNo)}` : null,
    }))),
    analysis.supplementary?.audit ? { name: analysis.supplementary.audit.source || "감사 관련 공시", period: analysis.supplementary.audit.year || "연도 확인 필요", scope: "감사", status: "원문 감사의견 확인 필요" } : null,
    ...relevantMacro.map((item) => ({ name: `${item.source || "외부자료"} · ${item.name}`, period: item.latest?.date || "수록시점 없음", scope: "거시·업종 보조", status: demo || /교육용|가상/.test(String(item.source || item.status || "")) ? "교육용 가상자료 · 공식 통계 아님" : hasValue(item.latest?.value) ? "API 수신 · 기업 노출 검증 전" : "자료없음" })),
    ...industryEvidence.map((item) => ({ name: item.source || item.name || "업종자료", period: item.period || "기간 확인 필요", scope: "업종·기업 노출", status: item.verification || "원자료 검증 전", url: item.url || null })),
  ].filter(Boolean));

  const definitions = [
    { name: "영업이익률", formula: "영업이익 ÷ 매출액 × 100", accounts: "손익계산서 영업이익·매출액", period: period(latest), scope: basisLabel, source: latest.source || "원문 확인 필요" },
    { name: "부채비율", formula: "부채총계 ÷ 자본총계 × 100", accounts: "재무상태표 부채총계·자본총계", period: `${latest.period || "자료없음"}년 말`, scope: basisLabel, source: latest.source || "원문 확인 필요" },
    { name: latest.financeCostsSource === "이자비용 대체값" ? "영업이익/이자비용(대체)" : "영업이익/금융비용", formula: `영업이익 ÷ ${latest.financeCostsSource === "이자비용 대체값" ? "이자비용 대체값" : "포괄손익계산서 금융비용"}`, accounts: latest.financeCostsSource === "이자비용 대체값" ? "금융비용 계정 없음 · 이자비용으로 대체" : "금융비용은 순수 이자비용과 다름", period: period(latest), scope: basisLabel, source: latest.source || "원문 확인 필요" },
    { name: "현금전환주기", formula: "채권회수일 + 재고보유일 - 매입결제일", accounts: `${latest.workingCapitalDaysBasis || "매출채권·재고·매입채무 평균잔액, 매출·매출원가"} · 채권/채무 계정 범위 주석 확인`, period: period(latest), scope: basisLabel, source: latest.source || "원문 확인 필요" },
    { name: "단순 FCF", formula: "영업활동현금흐름 - 유형·무형자산 취득", accounts: "현금흐름표 영업현금·유형/무형 CAPEX", period: period(latest), scope: basisLabel, source: latest.source || "원문 확인 필요" },
    { name: "1년 내 확인 차입·사채 비중", formula: "구조화 계정의 유동 차입금·사채 ÷ 확인된 유동·비유동 차입금·사채 × 100", accounts: "리스 제외 · 누락 계정·유동성 대체·만기 주석 대조 전", period: `${latest.period || "자료없음"}년 말`, scope: basisLabel, source: latest.source || "원문 확인 필요" },
  ];

  return {
    company: { name: company.name || "기업명 확인 필요", industry: context.industryLabel ? `${context.industryLabel}${companyInfo.induty_code ? ` · 산업코드 ${companyInfo.induty_code}` : ""}` : company.industry || "업종 확인 필요", ceo: companyInfo.ceo_nm || "원문 확인 필요", address: companyInfo.adres || "원문 확인 필요", corpCode: company.corpCode || "" },
    basisDate: analysis.basisDate,
    basisLabel,
    sourceLabel: demo ? "교육용 가상자료 · 공식 공시 아님" : analysis.mode === "공식 API" ? "OpenDART 공시 API · 사업보고서 원문 대조 전" : analysis.mode || "출처 확인 필요",
    verificationStatus: demo ? "가상자료 · 실무 판단 금지" : "공시 API 수신 · 계정/주석 원문 대조 전",
    focusInterim,
    loanRequest: { ...request },
    records,
    interim,
    industryIndicators: industryEvidence.map((item) => ({
      name: item.name,
      value: `${hasValue(item.previous) ? item.previous : "자료없음"} → ${hasValue(item.latest) ? item.latest : "자료없음"}${item.unit || ""}`,
      period: item.period,
      source: item.source,
      companyExposure: `회사 매출 노출 ${hasValue(item.exposure) ? ratio(item.exposure, 1) : "확인 전"}${item.exposureBasis ? ` · 근거 ${item.exposureBasis}` : " · 노출 근거 미입력"}`,
      verification: item.verification || "원자료·기업 노출 대조 전",
    })),
    financialFindings,
    loanReviews: {
      ...(workingReview ? { working: workingReview } : {}),
      ...(facilityReview ? { facility: facilityReview } : {}),
      integrated: { text: "운전자금과 시설자금의 집행·상환 시점이 겹치는지, 단기 운전자금이 시설투자 공백을 메우는 구조인지 확인해야 합니다. 두 용도의 심사조건은 별도로 결정합니다." },
    },
    scenarios: scenarioRows,
    inspectionSummary: context.inspectionNotes || "현장실사 종합 메모가 입력되지 않았습니다. 항목별 관찰·근거·후속조치를 먼저 대조하세요.",
    opinion: {
      working: workingReview ? `${workingReview.status}. ${workingReview.condition}` : "신청 없음",
      facility: facilityReview ? `${facilityReview.status}. ${facilityReview.condition}` : "신청 없음",
      conditions: "미해소 우려와 현장실사 증빙을 대조하고, 고객의 월별 현금수지·차입 만기·담보 및 내부 정책에 따라 심사역이 금액·금리·만기를 별도 검토합니다.",
    },
    sections: {
      summary: { text: `${demo ? "교육용 가상 재무자료" : "차주 법인의 공시 재무"}와 최신 중간실적을 구분해 상환능력의 관찰값과 미확인 사항을 제시합니다. 자동 판정은 여신 승인·거절 의견이 아닙니다.`, bullets: summaryBullets },
      business: { text: `${company.name || "대상 기업"}의 ${demo ? "예시 기업개황" : "공시 기업개황"}은 식별 자료입니다. 사업별 매출·고객·공급처·자회사별 현금흐름을 자동으로 검증했다는 의미가 아닙니다.`, bullets: nonempty([`산업코드 ${companyInfo.induty_code || "원문 확인 필요"}; 대표자 ${companyInfo.ceo_nm || "원문 확인 필요"}; 주소 ${companyInfo.adres || "원문 확인 필요"}.`, "사업부문·판매채널·주요 매출처·합병 및 사업범위 변화는 사업보고서 본문과 고객 제출자료로 확인해야 합니다."]) },
      industry: { text: `${context.industryLabel || "해당 업종"}에 관련된 ${demo ? "교육용 예시 지표" : "공식 지표"}를 보조 근거로 제시합니다. 수치의 방향만으로 해당 회사 매출·이익 변화를 단정하지 않습니다.`, bullets: [...macroBullets, ...industryBullets, ...(!macroBullets.length && !industryBullets.length ? ["기업 노출이 확인된 업종·거시 지표가 없습니다. 관련 원자료와 회사 매출·원가 노출비중 확인이 필요합니다."] : [])] },
      management: { text: "경영진·지배구조·관계회사 지원은 재무계정만으로 확정할 수 없습니다. 공시 원문과 면담·현장 근거를 분리하여 검토합니다.", bullets: nonempty([`DART 기업개황 대표자: ${companyInfo.ceo_nm || "자료 확인 필요"}.`, analysis.supplementary?.audit?.opinions?.length ? `수신 감사의견: ${analysis.supplementary.audit.opinions.join(" · ")}. 감사보고서 원문과 핵심감사사항을 대조해야 합니다.` : "감사의견·핵심감사사항 원문 대조 필요.", "지배구조, 관계회사 보증·자금지원, 경영진 실행력은 사업보고서 주석·이사회 자료 및 현장 면담으로 확인해야 합니다."]) },
      operations: { text: "매입·생산·판매·채권회수의 실제 운영은 재무지표와 현장 관찰을 함께 검증합니다. 아래 회전일은 공시 계정과 평균잔액에 근거한 추정입니다.", bullets: operationsBullets },
      debt: { text: "차주 별도 수치와 그룹 연결 위험을 분리합니다. 구조화 자료의 차입·사채 계정 합계와 금융비용만으로 만기별 원리금 상환 여부를 확정하지 않습니다.", bullets: debtBullets },
      scenario: { text: "시나리오는 사용자가 둔 가정에 따른 민감도이며 전망치·승인한도·금리 제안이 아닙니다. 운전자금과 시설자금을 따로 검토합니다.", bullets: scenarioBullets },
      opinion: { text: `${demo ? "교육용 가상자료" : "공개자료"}, 고객자료, 현장실사로 확인된 사실과 미해소 위험을 분리한 심사 전 검토의견입니다. 최종 조건은 심사역의 내부 기준·증빙 대조 후 정합니다.`, bullets: opinionBullets },
    },
    inspections: inspection,
    openItems,
    sources,
    definitions,
    limitations: [
      demo ? "이 보고서의 재무·거시 수치는 교육용 가상자료입니다. 공식 공시 또는 실무 여신 판단에 사용할 수 없습니다." : "공시 API 수치는 제출회사의 공시를 구조화한 자료로, 공시 원문·주석과 대조해야 합니다. 결측값을 0으로 계산하지 않습니다.",
      ...(analysis.dataQuality?.yearFallback ? [`요청 기준연도 ${analysis.dataQuality.requestedYear}년 연간자료가 없어 ${analysis.dataQuality.latestAvailableYear || latest.period}년 연간 공시를 사용했습니다. 중간 누적자료는 전년 동기와만 비교합니다.`] : []),
      "중간 손익·현금흐름은 누적액이며 전년 동기와 비교합니다. 연간 실적과 합산하지 않습니다.",
      "구조화 공시에서 확인된 차입·사채 계정 합계는 누락 계정이 있을 수 있습니다. 만기·순수 이자비용·담보·보증·약정·관계회사 지원은 주석 및 고객자료 확인 전에는 확정하지 않습니다.",
      "현장실사 기록과 첨부파일은 담당자 입력이며 파일의 진위나 내용이 자동 검증되었다는 뜻이 아닙니다.",
      "이 보고서는 공개자료 기반 심사 지원자료이며 신용등급, 승인·거절, 적정 금액·금리·담보를 자동 결정하지 않습니다.",
    ],
  };
}
