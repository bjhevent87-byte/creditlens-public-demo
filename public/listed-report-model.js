import { applyReportEdits } from "./report-edits.js";

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
    analysis.dataQuality?.yearFallback ? `${analysis.dataQuality.requestedYear}년 사업보고서 미공시 → ${analysis.dataQuality.latestAvailableYear || latest.period}년 연간자료 사용` : null,
    analysis.dataQuality?.yearFallback && focusInterim ? `${interim.period} 누적 실적을 첫 요약에 별도 표시` : null,
    focusInterim ? `${period(latest)} ${basisLabel}: 매출 ${money(latest.revenue)}, 영업이익 ${money(latest.operatingProfit)}, 영업활동현금흐름 ${money(latest.operatingCashFlow)}.` : null,
    interim ? { text: `${interim.period} 누적: 매출 ${money(interim.revenue)}, 영업이익 ${money(interim.operatingProfit)}, 영업활동현금흐름 ${money(interim.operatingCashFlow)}.`, detail: `${interim.comparisonPeriod || "전년 동기 비교자료 없음"}와 비교` } : "최신 중간재무 없음 · 최근 월별 실적 확인",
    flags.length ? `규칙 기반 우선 확인 ${flags.length}건: ${flags.slice(0, 4).map((item) => item.title).join(" · ")}` : "규칙 기반 우선 확인 0건",
    `현장실사 ${completed}/${inspection.length}건 기록 완료 · 관찰 사실·근거·후속조치`,
  ]);

  const macroBullets = relevantMacro.map((item) => item.latest && hasValue(item.latest.value)
    ? `${item.name} ${ratio(item.latest.value, 2, item.unit ? ` ${item.unit}` : "")} · ${item.latest.date || "수록시점 확인 필요"}`
    : `${item.name} · 최신 수치 확인 필요`);
  const operationsBullets = nonempty([
    hasValue(latest.dso) || hasValue(latest.dio) || hasValue(latest.dpo) ? `${period(latest)} 회수 ${ratio(latest.dso, 1, "일")} + 재고 ${ratio(latest.dio, 1, "일")} − 결제 ${ratio(latest.dpo, 1, "일")} = 현금전환주기 ${ratio(latest.cashConversionCycle, 1, "일")}` : null,
    context.siteUtilization ? `현장 가동률 ${ratio(context.siteUtilization.previous)} → ${ratio(context.siteUtilization.current)} (${ratio(context.siteUtilization.current - context.siteUtilization.previous, 1, "%p")})` : null,
    ...cashInsights.slice(0, 3).map((item) => `${item.title}: ${item.meaning}`),
  ]);
  const debtBullets = nonempty([
    `${period(latest)} 차입·사채(리스 제외) ${money(latest.totalDebt)} · 1년 내 비중 ${ratio(latest.shortTermDebtShare)}`,
    group ? `그룹 연결 ${group.period}년 영업현금 ${money(group.operatingCashFlow)} · 차입금 ${money(group.totalDebt)} (차주 별도재원과 구분)` : null,
    context.debtSummary?.trusted ? `고객 차입명세: 12개월 내 만기 ${ratio(context.debtSummary.dueWithin12, 1, "억원")} · 변동금리 ${ratio(context.debtSummary.variableShare)}` : "차입 만기·담보·보증 주석 확인 전",
  ]);
  const stress = context.stress;
  const reviewedFindings = Array.isArray(review.findings) ? review.findings : [];
  const resolved = reviewedFindings.filter((item) => item.status === "해소");
  const pending = reviewedFindings.filter((item) => item.status !== "해소");
  const opinionBullets = nonempty([
    Number(request.facilityAmount) > 0 ? `시설자금: ${onsiteGate || review.facility?.status || "심사 전"}` : null,
    `우려 해소 ${resolved.length}건 · 미해결·추가 확인 ${pending.length}건`,
    ...resolved.slice(0, 3).map((item) => `${item.title}: ${item.note || "해소 근거 미기록"}`),
    context.inspectionNotes ? `현장 메모: ${context.inspectionNotes}` : null,
  ]);
  const workingReview = Number(request.workingAmount) > 0 ? {
    status: onsiteGate || review.working?.status || borrower.decisionSupport?.workingCapital?.stance || "상환구조 검증 전",
    evidence: `${period(latest)} 현금전환주기 ${ratio(latest.cashConversionCycle, 1, "일")} · 영업현금 ${money(latest.operatingCashFlow)}${interim ? ` · ${interim.period} 누적 영업현금 ${money(interim.operatingCashFlow)}` : ""}`,
    concern: flags.length ? `우선 확인 신호 ${flags.length}건 · 회수 영향 확인` : "월별 회수액·만기 내 입금액 확인 전",
    condition: onsiteGate ? "현장 우려 재판단 · 채권 Aging·월별 자금수지 확인 후 조건 검토" : review.working?.explanation || "채권 Aging·월별 자금수지 확인 후 조건 검토",
  } : null;
  const facilityReview = Number(request.facilityAmount) > 0 ? {
    status: onsiteGate || review.facility?.status || borrower.decisionSupport?.facility?.stance || "투자 후 현금흐름 검증 전",
    evidence: `${period(latest)} 영업현금 ${money(latest.operatingCashFlow)} · CAPEX ${money(latest.totalCapex)} · 영업이익 ${money(latest.operatingProfit)}`,
    concern: "투자·가동·수주·기존 원리금 일정 확인 전",
    condition: onsiteGate ? "현장 우려 재판단 · 투자계약·자기자금·가동계획·연도별 현금수지 확인" : review.facility?.explanation || "투자계약·자기자금·가동계획·연도별 현금수지 확인",
  } : null;
  const scenarioRows = stress?.available && stress.simple && stress.baseline && stress.stressed ? [{
    name: "매출·영업이익 단순 민감도",
    assumptions: `매출 변화 ${ratio(stress.assumptions?.salesShockPct, 1)}, 영업이익률 변화 ${ratio(stress.assumptions?.marginShockPp, 1, "%p")}`,
    results: `매출 ${money(stress.baseline.revenue)} → ${money(stress.stressed.revenue)}; 영업이익 ${money(stress.baseline.operatingProfit)} → ${money(stress.stressed.operatingProfit)}`,
    interpretation: "공시 연간 실적에 사용자 가정 적용",
    limitations: "원리금·실제 현금흐름·여신한도 미산정",
  }] : [];
  const auditBullets = analysis.supplementary?.audit?.opinions?.length
    ? [`수신 감사의견: ${analysis.supplementary.audit.opinions.join(" · ")} · 원문 대조 필요`]
    : [];
  const financialFindings = findingReviews.slice(0, 8).map((item) => ({
    title: item.title,
    observed: item.reason || `${item.metric || "재무 변화"} · 원계정 확인 필요`,
    interpretation: item.meaning || "원인 확인 전",
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
      integrated: { text: "두 자금의 상환월 중복·운전자금의 시설투자 전용 여부 확인" },
    },
    scenarios: scenarioRows,
    inspectionSummary: context.inspectionNotes || "현장실사 종합 메모 미입력",
    opinion: {
      working: workingReview ? `${workingReview.status} · ${workingReview.condition}` : "신청 없음",
      facility: facilityReview ? `${facilityReview.status} · ${facilityReview.condition}` : "신청 없음",
      conditions: "미해소 우려·월별 자금수지·차입 만기·담보 확인 후 금액·금리·만기 검토",
    },
    sections: applyReportEdits({
      summary: { bullets: summaryBullets },
      business: { bullets: ["사업부문·판매채널·주요 거래처: 사업보고서·고객자료 확인"] },
      industry: { text: macroBullets.length || industryEvidence.length ? `${context.industryLabel || "해당 업종"} · 관련 지표` : "업종·회사 노출 근거 입력 전", bullets: macroBullets },
      management: { text: "경영진·지배구조 근거 입력 전", bullets: auditBullets.length ? auditBullets : ["감사의견 원문 확인 전"], persistentBullets: auditBullets },
      operations: { bullets: operationsBullets },
      debt: { bullets: debtBullets },
      scenario: { text: "연간 매출·영업이익에 사용자 가정 적용" },
      opinion: { bullets: opinionBullets },
    }, context.reportEdits),
    inspections: inspection,
    openItems,
    sources,
    definitions,
    limitations: [
      demo ? "교육용 가상자료 · 실무 여신 판단에 사용 불가" : "공시 API 수신 · 원계정·주석 원문 대조 전",
      "중간 누적실적은 전년 동기와 비교 · 연간 실적과 합산하지 않음",
      "현장기록·첨부파일은 담당자 입력 · 파일 내용·진위 자동검증 아님",
    ],
  };
}
