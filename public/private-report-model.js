import { applyReportEdits } from "./report-edits.js";

const present = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const won = (value) => present(value) ? `${(Number(value) / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원` : "자료 확인 필요";
const percentage = (value, digits = 1) => present(value) ? `${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits })}%` : "자료 확인 필요";
const text = (value, fallback = "자료 확인 필요") => String(value ?? "").trim() || fallback;

function evidenceLine(entry) {
  return entry?.text && entry?.source ? `${entry.text} · 근거 ${entry.source}` : null;
}

function changeSentence(current, previous, label) {
  if (!present(current) || !present(previous)) return `${label} 전기 비교자료 없음`;
  const gap = Number(current) - Number(previous);
  const rate = Number(previous) > 0 ? `, 전기 대비 ${percentage((gap / Number(previous)) * 100)}` : ", 전기 금액이 0 이하라 증감률 미표시";
  return `${label} ${won(previous)} → ${won(current)}${rate}`;
}

export function buildPrivateReportModel(analysis, context = {}) {
  if (!analysis) throw new Error("고객 제출자료 분석 결과가 없습니다.");
  const records = Array.isArray(analysis.records) ? analysis.records : [];
  const latest = records.at(-1) || {};
  const previous = records.at(-2) || {};
  const review = analysis.manualReview || {};
  const issues = Array.isArray(review.issues) ? review.issues : [];
  const blocking = issues.filter((issue) => issue.severity === "blocking");
  const business = Object.fromEntries((review.businessEvidence || []).map((entry) => [entry.id, entry]));
  const audit = review.auditReview || {};
  const auditBullet = audit.opinion === "감사보고서 없음"
    ? "감사보고서 없음 · 담당자 입력"
    : audit.opinion && audit.opinion !== "미확인"
      ? `감사의견 ${audit.opinion} · ${audit.reportDate || "일자 미기록"} · ${audit.sourcePage || "출처 페이지 미기록"}`
      : null;
  const request = analysis.loanRequest || {};
  const inspections = Array.isArray(context.inspections) ? context.inspections : (analysis.inspection || []).map((item) => ({ category: item.category, question: item.question, status: "미확인", observation: "", evidence: "", action: "", files: [] }));
  const completed = inspections.filter((item) => item.status && item.status !== "미확인" && item.observation?.trim() && item.evidence?.trim() && item.action?.trim()).length;
  const adverse = inspections.filter((item) => /우려|이상|자료\s*요청/.test(String(item.status || "")));
  const onsiteGate = adverse.length ? `현장 우려·자료요청 ${adverse.length}건 재판단 전 · 조건 제안 보류` : completed < inspections.length ? `현장실사 ${inspections.length - completed}건 미완료 · 조건 제안 보류` : null;
  const sourceConfirmed = review.sourceReview?.confirmed === true;
  const borrowerScope = analysis.primaryFsDiv === "OFS" ? "별도재무제표 · 차주 법인" : "연결재무제표 · 차주 별도자료 미제출";
  const confidence = blocking.length ? `검산 오류 ${blocking.length}건 · 판단 보류` : sourceConfirmed ? "담당자 원본 대조 기록" : "원본 대조 전";
  const findings = (analysis.assessment?.redFlags || []).slice(0, 8).map((flag) => ({
    title: flag.title,
    observed: flag.reason || `${flag.metric || "재무 변화"} · 원문 확인 필요`,
    interpretation: "원인 확인 전",
    check: "고객 원본 계정·주석 및 거래·현장 증빙 대조",
  }));
  const workingReview = Number(request.workingAmount) > 0 ? {
    status: blocking.length ? "입력 오류 해소 전 · 검토 보류" : onsiteGate || analysis.decisionSupport?.workingCapital?.stance || "회수재원 확인 전",
    evidence: `${latest.period || "최근"}년 영업현금 ${won(latest.operatingCashFlow)} · 현금전환주기 ${present(latest.cashConversionCycle) ? `${Number(latest.cashConversionCycle).toFixed(1)}일` : "자료 부족"}`,
    concern: "신청 만기 내 실제 회수액 확인 전",
    condition: "채권 Aging·월별 회수계획·기존 원리금 확인 후 금액·만기 검토",
  } : null;
  const facilityReview = Number(request.facilityAmount) > 0 ? {
    status: blocking.length ? "입력 오류 해소 전 · 검토 보류" : onsiteGate || analysis.decisionSupport?.facility?.stance || "투자 후 상환 검증 전",
    evidence: `${latest.period || "최근"}년 영업현금 ${won(latest.operatingCashFlow)} · CAPEX ${won(latest.totalCapex)}`,
    concern: "투자·가동·판매·기존 원리금 일정 확인 전",
    condition: "설비계약·자기자금·수주·가동계획·연도별 현금수지 확인 후 조건 검토",
  } : null;
  const sourceName = text(context.csvName, "고객 제출 재무 CSV");
  const corrections = Array.isArray(review.changes) ? review.changes : [];
  const sourceBasis = corrections.length ? `${sourceName} + 담당자 수정 ${corrections.length}건` : sourceName;
  const pdfFiles = Array.isArray(context.pdfFiles) ? context.pdfFiles : [];
  const sources = [
    ...records.map((row) => ({ name: sourceName, period: `${row.period}년 연간`, scope: borrowerScope, status: sourceConfirmed ? "담당자 대조 기록 · 본문 자동검증 아님" : "고객 입력 · 원본 대조 전", locator: review.sourceReview?.note || "계정·페이지 기록 필요" })),
    ...corrections.map((change) => ({
      name: `${change.period}년 ${change.label || change.field || "계정"} 담당자 수정`,
      period: `${change.period}년`, scope: borrowerScope,
      status: change.page && change.note ? "담당자 원문 대조 기록 · 자동검증 전" : "원문 근거 미기록 · 잠정값",
      locator: `${won(change.previous)} → ${won(change.current)} · ${change.page || "페이지 미기재"} · ${change.note || "수정 근거 미기재"}`,
    })),
    ...pdfFiles.map((file) => ({ name: file.name, period: "첨부시점 미기록", scope: "재무·감사 원본 후보", status: "파일명·해시 기록 · PDF 본문 자동 판독 전", locator: file.sha256 ? `SHA-256 ${file.sha256.slice(0, 16)}…` : "해시 없음" })),
    ...Object.values(business).filter((entry) => entry?.text).map((entry) => ({ name: entry.source || `${entry.label} 담당자 메모`, period: "확인시점 미기록", scope: entry.label, status: "담당자 입력 · 원문 자동검증 전" })),
    ...(audit.opinion && !["미확인", "감사보고서 없음"].includes(audit.opinion) ? [{ name: audit.sourcePage || "감사보고서 출처 미기록", period: audit.reportDate || "감사보고서일 미기록", scope: "감사의견", status: "담당자 입력 · PDF 자동검증 전" }] : []),
  ];
  const openItems = [
    ...issues.map((issue) => ({ title: issue.title, reason: `${issue.period ? `${issue.period}년 · ` : ""}${issue.detail}`, owner: issue.severity === "blocking" ? "자료 제출자·기업금융 담당자" : "기업금융 담당자" })),
    ...inspections.filter((item) => !item.status || item.status === "미확인" || !item.observation?.trim() || !item.evidence?.trim() || !item.action?.trim() || /우려|이상|자료\s*요청/.test(String(item.status || ""))).map((item) => ({ title: `${item.category || "현장"} 현장 재확인`, reason: `${item.question || "점검 질문"} · ${item.status || "미확인"}; 관찰·증빙·후속조치 대조`, owner: "현장 담당자·심사역" })),
    { title: "주석상 만기·담보·보증과 월별 원리금", reason: "고객 CSV의 총차입금·금융비용만으로 실제 상환일정을 확인할 수 없습니다.", owner: "기업금융 담당자·심사역" },
    ...(analysis.primaryFsDiv === "CFS" ? [{ title: "차주 법인 별도재무제표 확보", reason: "연결자료는 그룹 위험이며 차주 직접 상환재원을 대체할 수 없습니다.", owner: "기업금융 담당자" }] : []),
  ];
  const definitions = [
    { name: "부채비율", formula: "부채총계 ÷ 자기자본 × 100", accounts: "제출 재무상태표 부채총계·자본총계", period: `${latest.period || "연도 확인 필요"}년 말`, scope: borrowerScope, source: sourceBasis },
    { name: "유동비율", formula: "유동자산 ÷ 유동부채 × 100", accounts: "제출 재무상태표 유동자산·유동부채", period: `${latest.period || "연도 확인 필요"}년 말`, scope: borrowerScope, source: sourceBasis },
    { name: latest.financeCostsSource === "이자비용 대체값" ? "영업이익/이자비용(대체)" : "영업이익/금융비용", formula: `영업이익 ÷ ${latest.financeCostsSource === "이자비용 대체값" ? "제출 이자비용 대체값" : "제출 금융비용"}`, accounts: "계정 정의·이자 외 금융비용 포함 여부 원문 대조", period: `${latest.period || "연도 확인 필요"}년`, scope: borrowerScope, source: sourceBasis },
    { name: "단순 FCF", formula: "영업활동현금흐름 - 유형·무형자산 취득", accounts: "고객 제출 현금흐름표", period: `${latest.period || "연도 확인 필요"}년`, scope: borrowerScope, source: sourceBasis },
    { name: "현금전환주기", formula: "채권회수일 + 재고보유일 - 매입결제일", accounts: `${latest.workingCapitalDaysBasis || "고객 제출 매출채권·재고·매입채무"} · 계정 정의 원문 확인`, period: `${latest.period || "연도 확인 필요"}년`, scope: borrowerScope, source: sourceBasis },
  ];
  const scenario = context.scenario ? [context.scenario] : [];
  return {
    company: { name: analysis.company?.name || "기업명 확인 필요", industry: analysis.company?.industry || "업종 확인 필요", ceo: "고객 제출 원본 확인 필요", address: "고객 제출 원본 확인 필요", corpCode: "비상장 차주 · 법인 식별 원본 확인 필요" },
    basisDate: analysis.basisDate,
    basisLabel: borrowerScope,
    sourceLabel: corrections.length ? `고객 제출 CSV + 담당자 수정 ${corrections.length}건` : "고객 제출 CSV",
    verificationStatus: confidence,
    loanRequest: { ...request }, records, interim: null,
    sections: applyReportEdits({
      summary: { bullets: [
        `${previous.period || "전기"} → ${latest.period || "당기"}: ${changeSentence(latest.revenue, previous.revenue, "매출")} · ${changeSentence(latest.operatingProfit, previous.operatingProfit, "영업이익")}`,
        `${latest.period || "최근"}년 현금흐름: 영업 ${won(latest.operatingCashFlow)} · 투자 ${won(latest.investingCashFlow)} · 재무 ${won(latest.financingCashFlow)}`,
        `검산 오류 ${blocking.length}건 · 추가 확인 ${issues.length - blocking.length}건 · 현장실사 ${completed}/${inspections.length}건 기록 완료`,
      ] },
      business: { text: `${review.accountingStandard || "회계기준 미확인"} · ${review.auditStatus || "감사정보 미확인"}`, bullets: [evidenceLine(business.businessModel), evidenceLine(business.customers)].filter(Boolean) },
      industry: business.industryExposure?.text && business.industryExposure?.source
        ? { text: business.industryExposure.text, source: business.industryExposure.source }
        : { text: "업종·회사 노출 근거 입력 전" },
      management: business.management?.text && business.management?.source
        ? { text: business.management.text, source: business.management.source, bullets: auditBullet ? [auditBullet] : [], persistentBullets: auditBullet ? [auditBullet] : [] }
        : { text: "경영진·지배구조 근거 입력 전", bullets: auditBullet ? [auditBullet] : [], persistentBullets: auditBullet ? [auditBullet] : [] },
      operations: { bullets: [evidenceLine(business.operations), present(latest.cashConversionCycle) ? `${latest.period}년 현금전환주기 ${Number(latest.cashConversionCycle).toFixed(1)}일 · ${latest.workingCapitalDaysBasis || "제출 계정"}` : "현금전환주기 산정자료 부족"].filter(Boolean) },
      debt: { bullets: [`${latest.period || "최근"}년 차입금 ${won(latest.totalDebt)} · 부채비율 ${percentage(latest.debtRatio)} · 유동비율 ${percentage(latest.currentRatio)}`, "차입 만기·담보·보증·기존 원리금 원문 확인 전"] },
      scenario: { text: "연간 매출·영업이익에 사용자 가정 적용" },
      opinion: { text: blocking.length ? `검산 오류 ${blocking.length}건 · 수치 판단 보류` : onsiteGate || "원본·현장 근거 대조 후 조건 검토", bullets: [workingReview ? `운전자금: ${workingReview.status}` : null, facilityReview ? `시설자금: ${facilityReview.status}` : null, `현장 우려·자료요청 ${adverse.length}건`].filter(Boolean) },
    }, context.reportEdits),
    financialFindings: findings,
    loanReviews: { ...(workingReview ? { working: workingReview } : {}), ...(facilityReview ? { facility: facilityReview } : {}), integrated: { text: "두 자금의 상환월 중복·운전자금의 시설투자 전용 여부 확인" } },
    scenarios: scenario,
    inspections,
    inspectionSummary: context.inspectionSummary || "현장실사 종합 메모 미입력 · 담당자 확인 전",
    opinion: { working: workingReview ? `${workingReview.status} · ${workingReview.condition}` : "신청 없음", facility: facilityReview ? `${facilityReview.status} · ${facilityReview.condition}` : "신청 없음", conditions: "원본·주석·현장 우려·월별 자금수지 확인 후 금액·금리·만기·담보 검토" },
    openItems, sources, definitions,
    limitations: [
      "고객 제출 CSV·담당자 입력 · PDF 본문·감사의견 자동검증 아님",
      blocking.length ? `검산 오류 ${blocking.length}건 해소 전 재무판단 보류` : null,
      "현장 메모·첨부파일은 브라우저에만 유지 · 서버 저장·자동 판독 없음",
    ],
  };
}
