const present = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const won = (value) => present(value) ? `${(Number(value) / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원` : "자료 확인 필요";
const percentage = (value, digits = 1) => present(value) ? `${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits })}%` : "자료 확인 필요";
const text = (value, fallback = "자료 확인 필요") => String(value ?? "").trim() || fallback;

function evidenceLine(entry) {
  return entry?.text ? `${entry.text} · 담당자 입력 출처: ${entry.source || "출처 페이지 미기록"} (원문 자동검증 전)` : "고객 원문·면담 근거 입력 전";
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
  const request = analysis.loanRequest || {};
  const inspections = Array.isArray(context.inspections) ? context.inspections : (analysis.inspection || []).map((item) => ({ category: item.category, question: item.question, status: "미확인", observation: "", evidence: "", action: "", files: [] }));
  const completed = inspections.filter((item) => item.status && item.status !== "미확인" && item.observation?.trim() && item.evidence?.trim() && item.action?.trim()).length;
  const adverse = inspections.filter((item) => /우려|이상|자료\s*요청/.test(String(item.status || "")));
  const onsiteGate = adverse.length ? `현장 우려·자료요청 ${adverse.length}건 재판단 전 · 조건 제안 보류` : completed < inspections.length ? `현장실사 ${inspections.length - completed}건 미완료 · 조건 제안 보류` : null;
  const sourceConfirmed = review.sourceReview?.confirmed === true;
  const borrowerScope = analysis.primaryFsDiv === "OFS" ? "별도재무제표 · 차주 법인" : "연결재무제표 · 차주 별도자료 미제출";
  const confidence = blocking.length ? `필수 입력·검산 오류 ${blocking.length}건 · 재무판단 보류` : sourceConfirmed ? "담당자 원본 대조 기록 · PDF 자동검증 아님" : "고객 입력 수치 · 원본 대조 전";
  const workingRules = analysis.decisionSupport?.workingCapital?.appliedRules || [];
  const facilityRules = analysis.decisionSupport?.facility?.appliedRules || [];
  const findings = (analysis.assessment?.redFlags || []).slice(0, 8).map((flag) => ({
    title: flag.title,
    observed: flag.reason || `${flag.metric || "재무 변화"} · 원문 확인 필요`,
    interpretation: "입력 수치에 규칙을 적용한 우선 확인 신호이며 원인을 확정한 것은 아닙니다.",
    check: "고객 원본 계정·주석 및 거래·현장 증빙 대조",
  }));
  const workingReview = Number(request.workingAmount) > 0 ? {
    status: blocking.length ? "입력 오류 해소 전 · 검토 보류" : onsiteGate || analysis.decisionSupport?.workingCapital?.stance || "회수재원 확인 전",
    evidence: `${latest.period || "최근"}년 영업활동현금흐름 ${won(latest.operatingCashFlow)}, 현금전환주기 ${present(latest.cashConversionCycle) ? `${Number(latest.cashConversionCycle).toFixed(1)}일` : "산정자료 부족"}. ${workingRules.map((rule) => `${rule.title} ${rule.result}`).join("; ")}`,
    concern: "실제 매입→판매→회수 기간과 신청 만기 내 입금액을 고객 원본·월별 자금수지로 확인해야 합니다.",
    condition: "매출채권 연령표·월별 매입/판매/회수 계획과 기존 원리금을 대조한 뒤 심사역이 금액·만기를 검토합니다.",
  } : null;
  const facilityReview = Number(request.facilityAmount) > 0 ? {
    status: blocking.length ? "입력 오류 해소 전 · 검토 보류" : onsiteGate || analysis.decisionSupport?.facility?.stance || "투자 후 상환 검증 전",
    evidence: `${latest.period || "최근"}년 영업활동현금흐름 ${won(latest.operatingCashFlow)}, 유형·무형자산 취득 ${won(latest.totalCapex)}. ${facilityRules.map((rule) => `${rule.title} ${rule.result}`).join("; ")}`,
    concern: "투자 집행, 가동률, 판매처, 추가 현금창출과 기존 원리금 일정이 연결됐는지 확인해야 합니다.",
    condition: "설비 계약·자기자금·수주·가동 계획과 연도별 현금수지를 대조한 뒤 심사역이 금액·만기·상환방식을 검토합니다.",
  } : null;
  const sourceName = text(context.csvName, "고객 제출 재무 CSV");
  const pdfFiles = Array.isArray(context.pdfFiles) ? context.pdfFiles : [];
  const sources = [
    ...records.map((row) => ({ name: sourceName, period: `${row.period}년 연간`, scope: borrowerScope, status: sourceConfirmed ? "담당자 대조 기록 · 본문 자동검증 아님" : "고객 입력 · 원본 대조 전", locator: review.sourceReview?.note || "계정·페이지 기록 필요" })),
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
    { name: "부채비율", formula: "부채총계 ÷ 자기자본 × 100", accounts: "제출 재무상태표 부채총계·자본총계", period: `${latest.period || "연도 확인 필요"}년 말`, scope: borrowerScope, source: sourceName },
    { name: "유동비율", formula: "유동자산 ÷ 유동부채 × 100", accounts: "제출 재무상태표 유동자산·유동부채", period: `${latest.period || "연도 확인 필요"}년 말`, scope: borrowerScope, source: sourceName },
    { name: latest.financeCostsSource === "이자비용 대체값" ? "영업이익/이자비용(대체)" : "영업이익/금융비용", formula: `영업이익 ÷ ${latest.financeCostsSource === "이자비용 대체값" ? "제출 이자비용 대체값" : "제출 금융비용"}`, accounts: "계정 정의·이자 외 금융비용 포함 여부 원문 대조", period: `${latest.period || "연도 확인 필요"}년`, scope: borrowerScope, source: sourceName },
    { name: "단순 FCF", formula: "영업활동현금흐름 - 유형·무형자산 취득", accounts: "고객 제출 현금흐름표", period: `${latest.period || "연도 확인 필요"}년`, scope: borrowerScope, source: sourceName },
    { name: "현금전환주기", formula: "채권회수일 + 재고보유일 - 매입결제일", accounts: `${latest.workingCapitalDaysBasis || "고객 제출 매출채권·재고·매입채무"} · 계정 정의 원문 확인`, period: `${latest.period || "연도 확인 필요"}년`, scope: borrowerScope, source: sourceName },
  ];
  const scenario = context.scenario ? [context.scenario] : [];
  return {
    company: { name: analysis.company?.name || "기업명 확인 필요", industry: analysis.company?.industry || "업종 확인 필요", ceo: "고객 제출 원본 확인 필요", address: "고객 제출 원본 확인 필요", corpCode: "비상장 차주 · 법인 식별 원본 확인 필요" },
    basisDate: analysis.basisDate,
    basisLabel: borrowerScope,
    sourceLabel: "고객 제출 CSV · PDF 본문 자동 판독 전",
    verificationStatus: confidence,
    loanRequest: { ...request }, records, interim: null,
    sections: {
      summary: { text: "고객 제출 연간 재무 CSV를 잠정 계산하고 원본 PDF·감사보고서와 대조할 과제를 제시합니다. 차주 법인의 상환능력과 그룹 위험을 혼동하지 않습니다.", bullets: [changeSentence(latest.revenue, previous.revenue, "매출"), changeSentence(latest.operatingProfit, previous.operatingProfit, "영업이익"), `${latest.period || "최근"}년 영업·투자·재무활동현금흐름: ${won(latest.operatingCashFlow)} / ${won(latest.investingCashFlow)} / ${won(latest.financingCashFlow)}.`, `필수 입력·검산 오류 ${blocking.length}건, 추가 원본 확인 ${issues.length - blocking.length}건, 현장 근거 기록 ${completed}/${inspections.length}건. ${confidence}.`] },
      business: { text: `고객 제출자료의 사업설명은 담당자 입력이며 자동 추출·검증값이 아닙니다. ${review.accountingStandard || "회계기준 미확인"} · ${review.auditStatus || "감사정보 미확인"}.`, bullets: [evidenceLine(business.businessModel), evidenceLine(business.customers)] },
      industry: { text: "상장·공시기업과 같은 위험 질문을 적용하되 업종 고유지표와 회사 노출은 고객 원본·공식 통계를 연결하기 전까지 판단 근거로 확정하지 않습니다.", bullets: [evidenceLine(business.industryExposure)] },
      management: { text: `감사의견 ${audit.opinion || "미확인"} · ${audit.reportDate || "보고서일 미기록"} · ${audit.sourcePage || "출처 페이지 미기록"}. 이는 담당자 입력이며 PDF 원문 자동검증 결과가 아닙니다.`, bullets: [evidenceLine(business.management)] },
      operations: { text: "매입·생산·판매·채권 회수의 실제 흐름과 제출 재무계정을 현장에서 대조해야 합니다.", bullets: [evidenceLine(business.operations), present(latest.cashConversionCycle) ? `${latest.period}년 현금전환주기 ${Number(latest.cashConversionCycle).toFixed(1)}일. ${latest.workingCapitalDaysBasis || "고객 입력 계정"} · 원문 계정 정의 확인 전.` : "현금전환주기 계산에 필요한 계정이 부족하거나 정의 확인 전입니다."] },
      debt: { text: "고객 제출 차입 계정 합계와 금융비용은 만기별 원금상환 가능성을 확정하지 않습니다. 차입계약·보증·담보·연도별 기존 원리금이 필요합니다.", bullets: [`${latest.period || "최근"}년 제출 차입금 ${won(latest.totalDebt)}, 부채비율 ${percentage(latest.debtRatio)}, 유동비율 ${percentage(latest.currentRatio)}. 원문 계정·범위 확인 전.`, `감사의견·주석 원문 대조: ${audit.opinion || "미확인"} (${audit.sourcePage || "페이지 미기록"}); 입력값 자동검증 아님.`] },
      scenario: { text: "매출과 영업이익률의 변화 가정은 단순 민감도입니다. 원리금 상환능력·승인한도·담보 요구액이 아닙니다.", bullets: scenario.length ? [] : ["민감도를 실행하지 않았습니다. 기본 0 가정은 변화 없음이며 예상 실적을 뜻하지 않습니다."] },
      opinion: { text: `${blocking.length ? "입력·검산 오류가 남아 있어 수치 기반 결론을 보류합니다." : onsiteGate || "현장실사 근거와 고객 원문을 대조한 뒤 심사역이 최종 조건을 검토해야 합니다."} 원본 대조와 내부심사 전에는 승인·거절을 확정하지 않습니다.`, bullets: [workingReview ? `운전자금: ${workingReview.status}` : "운전자금 신청 없음", facilityReview ? `시설자금: ${facilityReview.status}` : "시설자금 신청 없음", `현장 우려·자료요청 ${adverse.length}건. 첨부만으로 우려가 해소되지 않으며 심사역의 재판단이 필요합니다.`] },
    },
    financialFindings: findings,
    loanReviews: { ...(workingReview ? { working: workingReview } : {}), ...(facilityReview ? { facility: facilityReview } : {}), integrated: { text: "운전자금과 시설자금의 집행·상환 시점이 겹치는지, 단기자금이 투자 공백을 메우는지 확인합니다. 두 용도의 금액·만기·상환방식은 별도 심사 대상입니다." } },
    scenarios: scenario,
    inspections,
    inspectionSummary: context.inspectionSummary || "현장실사 종합 메모 미입력 · 담당자 확인 전",
    opinion: { working: workingReview ? `${workingReview.status}. ${workingReview.condition}` : "신청 없음", facility: facilityReview ? `${facilityReview.status}. ${facilityReview.condition}` : "신청 없음", conditions: "고객 원본 계정·주석, 감사의견, 현장 우려·후속조치 및 월별 자금수지를 대조한 뒤 심사역이 금액·금리·만기·담보·사후관리 조건을 검토합니다." },
    openItems, sources, definitions,
    limitations: [
      "CSV 값은 고객 제출·담당자 입력이며 PDF 내용이 자동 추출되거나 외부감사 의견이 검증된 것은 아닙니다. 파일명·SHA-256은 내용 일치·진위를 증명하지 않습니다.",
      "필수 입력·검산 오류가 남아 있으면 재무지표는 잠정 참고값이며 수치 기반 우열·여신 판단을 보류해야 합니다.",
      "비상장기업의 별도재무제표가 없고 연결자료만 있다면 차주 법인의 직접 상환능력을 계산하지 않습니다.",
      "주석상 차입금 만기·금리, 담보·보증, 거래처별 회수, 월별 현금수지가 없으면 요청액의 적정성과 상환구조를 확정하지 않습니다.",
      "현장 메모와 첨부 증빙은 브라우저 탭 안의 담당자 입력입니다. 서버에 사건·증빙 파일로 저장되지 않으며 자동 판독도 하지 않습니다.",
    ],
  };
}
