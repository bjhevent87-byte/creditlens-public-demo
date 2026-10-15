import { renderFullReport, renderFullReportDocument } from "./final-report.js";
import { buildPrivateReportModel } from "./private-report-model.js";

const $ = (selector) => document.querySelector(selector);
const pdfEvidence = [];
let currentAnalysis = null;
let sourceCaseKey = "";
let reviewCorrections = [];
let inspectionAnswers = {};
let inspectionSummary = "";
let reportEdits = {};
let reportEditDirty = false;
const inspectionEvidence = new Map();
const inspectionFileVersions = new Map();
let manualScenarioResult = null;
let manualScenarioRequestId = 0;
const manualPages = new Set(["analysis", "inspection", "opinion"]);
const businessEvidenceFields = [
  ["businessModel", "manual-business-model", "주력 제품·매출구조"],
  ["customers", "manual-business-customers", "주요 거래처·수주·회수구조"],
  ["operations", "manual-business-operations", "생산·설비·인력 현황"],
  ["management", "manual-business-management", "경영진·지배구조"],
  ["industryExposure", "manual-business-industry", "업종·대외환경 노출"],
];
const csvHeaders = ["연도", "매출액", "영업이익", "당기순이익", "매출원가", "영업활동현금흐름", "투자활동현금흐름", "재무활동현금흐름", "현금및현금성자산", "자산총계", "부채총계", "자본총계", "유동자산", "유동부채", "매출채권", "재고자산", "매입채무", "단기 금융차입금", "장기 금융차입금", "금융비용", "이자비용", "유형자산 취득", "무형자산 취득"];
const csvFields = ["period", "revenue", "operatingProfit", "netIncome", "costOfSales", "operatingCashFlow", "investingCashFlow", "financingCashFlow", "cash", "totalAssets", "totalLiabilities", "equity", "currentAssets", "currentLiabilities", "accountsReceivable", "inventory", "accountsPayable", "shortTermDebt", "longTermDebt", "financeCosts", "interestExpense", "capex", "intangibleCapex"];
const fieldLabels = Object.fromEntries(csvFields.map((field, index) => [field, csvHeaders[index]]));

function showManualPage(page) {
  const target = manualPages.has(page) ? page : "analysis";
  document.querySelectorAll("[data-manual-page]").forEach((element) => { element.hidden = element.dataset.manualPage !== target; });
  document.querySelectorAll("[data-manual-nav]").forEach((element) => {
    element.classList.toggle("active", element.dataset.manualNav === target);
    if (element.tagName === "A") element.setAttribute("aria-current", element.dataset.manualNav === target ? "page" : "false");
  });
  if (location.hash !== `#manual-${target}`) history.replaceState(null, "", `#manual-${target}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-manual-nav]").forEach((element) => element.addEventListener("click", (event) => {
  event.preventDefault(); showManualPage(element.dataset.manualNav);
}));
showManualPage(location.hash.replace("#manual-", ""));
document.addEventListener("click", (event) => {
  if (event.target.closest('a[href="#manual-workspace"]')) $("#manual-workspace").open = true;
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function money(value) {
  return Number.isFinite(value) ? `${(value / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원` : "자료없음";
}

function percent(value) {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%` : "비교자료 없음";
}

function signedMoney(value) {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${money(value)}` : "자료없음";
}

function comparisonText(current, previous, name = "전년") {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return `${name} 비교자료 없음`;
  if (previous <= 0) return `${name} ${money(previous)} → 현재 ${money(current)} · 증가율 미표시`;
  return `${name} 대비 ${percent((current / previous - 1) * 100)}`;
}

function metricValue(value, unit) {
  if (!Number.isFinite(value)) return "자료없음";
  const digits = unit === "배" || unit === "회" ? 2 : 1;
  const suffix = unit === "%p" ? "%" : unit;
  return `${value.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

function metricDelta(metric) {
  const delta = metric.trend?.delta;
  if (!Number.isFinite(delta)) return "비교자료 없음";
  const suffix = metric.unit === "%" || metric.unit === "%p" ? "%p" : metric.unit;
  return `${delta > 0 ? "+" : ""}${delta.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${suffix}`;
}

function reviewState(analysis) {
  const review = analysis.manualReview || {};
  const issues = Array.isArray(review.issues) ? review.issues : [];
  const changes = Array.isArray(review.changes) ? review.changes : [];
  const blocking = issues.filter((issue) => issue.severity === "blocking");
  const missingCorrectionSources = changes.filter((change) => !String(change.page || "").trim() || !String(change.note || "").trim());
  const sourceRecorded = review.sourceReview?.confirmed === true;
  return { issues, changes, blocking, missingCorrectionSources, sourceRecorded, sourceReady: sourceRecorded && missingCorrectionSources.length === 0 };
}

function renderManualDecisionBoard(analysis) {
  const target = $("#manual-decision-board");
  const { issues, blocking, missingCorrectionSources, sourceRecorded, sourceReady } = reviewState(analysis);
  const records = Array.isArray(analysis.records) ? analysis.records : [];
  const latest = records.at(-1) || {}, previous = records.at(-2) || {};
  const dimensions = Array.isArray(analysis.performance?.dimensions) ? analysis.performance.dimensions : [];
  const primary = blocking[0];
  const issueRow = records.find((row) => row.period === primary?.period);
  const components = primary?.type === "current-assets-components" && [issueRow?.cash, issueRow?.accountsReceivable, issueRow?.inventory].every(Number.isFinite)
    ? issueRow.cash + issueRow.accountsReceivable + issueRow.inventory : null;
  const priority = primary ? {
    label: "먼저 고칠 숫자",
    title: `${primary.period || "입력자료"} · ${primary.title}`,
    detail: Number.isFinite(components) && Number.isFinite(issueRow?.currentAssets)
      ? `유동자산 ${money(issueRow.currentAssets)} < 현금·채권·재고 ${money(components)}. 원본의 정확한 계정값과 범위를 확인하세요.`
      : primary.detail,
    href: "#manual-review", action: "수정 입력",
  } : missingCorrectionSources.length ? {
    label: "수정 출처 확인",
    title: `수정값 ${missingCorrectionSources.length}건의 원문 페이지·근거가 비었습니다`,
    detail: "검산 통과는 원본 일치의 증거가 아닙니다. 수정한 값을 원문과 다시 대조하세요.",
    href: "#manual-review", action: "수정 이력 확인",
  } : !sourceRecorded ? {
    label: "다음 확인",
    title: "계산 완료 · 원본 숫자 대조 전",
    detail: "기간·계정명·금액·단위를 원본과 대조하고 문서·페이지를 기록하세요.",
    href: "#manual-workspace", action: "원본 대조 기록",
  } : {
    label: "다음 확인",
    title: "신청자금의 회수·상환 경로 확인",
    detail: "운전자금은 매입부터 입금까지, 시설자금은 투자 후 매출전환까지 확인합니다.",
    href: "#manual-purpose-review", action: "여신별 근거",
  };
  const moneyCard = (label, value, prior, signed = false) => `<div><span>${label}</span><strong>${signed ? signedMoney(value) : money(value)}</strong><small>${comparisonText(value, prior)}</small></div>`;
  const request = analysis.loanRequest || {};
  const purposeRows = [
    Number(request.workingAmount) > 0 ? `<div><b>운전자금 ${Number(request.workingAmount).toLocaleString("ko-KR")}억원</b><span>${escapeHtml(request.workingTermMonths || 12)}개월 · 회수일정·채권 연령표</span></div>` : "",
    Number(request.facilityAmount) > 0 ? `<div><b>시설자금 ${Number(request.facilityAmount).toLocaleString("ko-KR")}억원</b><span>${escapeHtml(request.facilityTermMonths || 60)}개월 · 설비계약·수주·가동률</span></div>` : "",
  ].filter(Boolean);
  const requestedTotal = Math.max(0, Number(request.workingAmount) || 0) + Math.max(0, Number(request.facilityAmount) || 0);
  const balanced = [latest.totalAssets, latest.totalLiabilities, latest.equity].every(Number.isFinite)
    && latest.equity > 0
    && Math.abs(latest.totalAssets - latest.totalLiabilities - latest.equity) <= Math.max(100_000_000, Math.abs(latest.totalAssets) * 0.001);
  const ratioImpact = !blocking.length && balanced && requestedTotal > 0
    ? `${(latest.totalLiabilities / latest.equity * 100).toFixed(2)}% → ${((latest.totalLiabilities + requestedTotal * 100_000_000) / latest.equity * 100).toFixed(2)}%`
    : "검산 후 표시";
  target.hidden = false;
  target.innerHTML = `<div class="manual-board-top"><div><p class="eyebrow">CREDIT REVIEW / AT A GLANCE</p><h2>${escapeHtml(analysis.company?.name || "기업")} · 핵심 검토</h2><p>${escapeHtml(latest.period || "최근")}년 ${analysis.primaryFsDiv === "CFS" ? "연결 · 그룹" : "별도 · 차주"} · ${escapeHtml(previous.period || "전기")} → ${escapeHtml(latest.period || "당기")} · 억원</p></div><div class="manual-board-gates"><span class="${blocking.length ? "needs-work" : "checked"}">입력값 검산 <b>${blocking.length ? `불일치 ${blocking.length}건` : "통과"}</b></span><span class="${sourceReady ? "checked" : "needs-review"}">원본 대조 <b>${sourceReady ? "담당자 기록" : missingCorrectionSources.length ? `수정 근거 ${missingCorrectionSources.length}건 필요` : "미완료"}</b></span></div></div>
    <div class="manual-board-body"><div class="manual-board-left"><div class="manual-board-priority"><small>${priority.label}</small><strong>${escapeHtml(priority.title)}</strong><p>${escapeHtml(priority.detail)}</p><a href="${priority.href}">${priority.action} →</a></div><div class="manual-board-numbers">${moneyCard("매출", latest.revenue, previous.revenue)}${moneyCard("영업이익", latest.operatingProfit, previous.operatingProfit)}${moneyCard("영업현금흐름", latest.operatingCashFlow, previous.operatingCashFlow, true)}<div><span>부채비율</span><strong>${Number.isFinite(latest.debtRatio) ? `${latest.debtRatio.toFixed(1)}%` : "자료없음"}</strong><small>${Number.isFinite(latest.debtRatio) && Number.isFinite(previous.debtRatio) ? `전년 대비 ${(latest.debtRatio - previous.debtRatio) > 0 ? "+" : ""}${(latest.debtRatio - previous.debtRatio).toFixed(1)}%p` : "비교자료 없음"}</small></div></div></div><aside class="manual-board-right"><h3>신청자금 · 받을 자료</h3>${purposeRows.join("") || "<p>신청자금을 입력하면 검토 항목이 나옵니다.</p>"}<a href="#manual-purpose-review">운전·시설 분리 검토 →</a>${requestedTotal ? `<div class="manual-board-impact"><span>요청액 전액 실행 시 부채비율</span><strong>${ratioImpact}</strong><small>${blocking.length || !balanced ? "입력값 검산 필요" : sourceReady ? "담당자 대조 기록" : "잠정 계산"} · 현금·자본 변동 없음</small></div>` : ""}</aside></div>
    <div class="manual-board-dimensions"><span>경영성과</span>${dimensions.map((item) => `<a href="#manual-performance" class="${blocking.length || !sourceReady ? "unknown" : escapeHtml(item.status?.className || "unknown")}">${escapeHtml(item.name)} <b>${blocking.length ? "보류" : !sourceReady ? `${escapeHtml(item.status?.label || "자료부족")}·잠정` : escapeHtml(item.status?.label || "자료부족")}</b></a>`).join("")}</div><p class="manual-board-footnote">검산은 입력값 사이의 관계만 확인합니다. 원본 PDF와의 일치는 담당자 대조 기록으로 따로 표시합니다.${issues.length > blocking.length ? ` <a href="#manual-review">추가 원문 확인 ${issues.length - blocking.length}건</a>` : ""}</p>`;
}

function inspectionComplete(answer = {}) {
  return answer.status && answer.status !== "미확인" && ["observation", "evidence", "action"].every((field) => String(answer[field] || "").trim());
}

function renderPdfEvidence() {
  $("#manual-pdf-list").innerHTML = pdfEvidence.length
    ? pdfEvidence.map((item) => `<div><a href="${escapeHtml(item.url)}" download="${escapeHtml(item.name)}">${escapeHtml(item.name)}</a> · SHA256 ${escapeHtml(item.sha256.slice(0, 16))}… <small>원본 대조 전 · 이 탭에만 보관</small></div>`).join("")
    : "첨부 원본 없음";
}

$("#manual-pdf").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  if (files.length > 3 || files.some((file) => file.size > 10_000_000 || !/\.pdf$/i.test(file.name))) {
    $("#manual-status").textContent = "PDF는 최대 3개, 파일당 10MB 이하만 선택할 수 있습니다.";
    event.target.value = "";
    return;
  }
  pdfEvidence.forEach((item) => URL.revokeObjectURL(item.url));
  pdfEvidence.length = 0;
  for (const file of files) {
    const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    pdfEvidence.push({ name: file.name, url: URL.createObjectURL(file), sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("") });
  }
  renderPdfEvidence();
  if (currentAnalysis) renderManualFinalReport();
});

$("#manual-template").addEventListener("click", () => {
  const year = new Date().getFullYear() - 1;
  const blank = (period) => [period, ...csvHeaders.slice(1).map(() => "")].join(",");
  const csv = `\uFEFF${csvHeaders.join(",")}\r\n${blank(year - 1)}\r\n${blank(year)}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "CreditLens_비상장_재무입력_양식.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("#manual-sample").addEventListener("click", async () => {
  let csv;
  try {
    const sampleResponse = await fetch("/가상_에이비정밀_별도재무_2023-2025_억원.csv");
    if (!sampleResponse.ok) throw new Error("가상기업 CSV 응답이 아닙니다.");
    const sampleText = (await sampleResponse.text()).replace(/^\uFEFF/, "");
    if (!sampleText.split(/\r?\n/, 1)[0].includes("연도,매출액,")) throw new Error("가상기업 CSV 내용이 아닙니다.");
    csv = `\uFEFF${sampleText}`;
  } catch {
    $("#manual-status").textContent = "가상기업 CSV를 불러오지 못했습니다. 한글 CSV 양식을 내려받아 입력해 주세요.";
    return;
  }
  const transfer = new DataTransfer();
  transfer.items.add(new File([csv], "가상_에이비정밀_별도재무_2023-2025_억원.csv", { type: "text/csv;charset=utf-8" }));
  $("#manual-csv").files = transfer.files;
  $("#manual-name").value = "가상기업 에이비정밀";
  $("#manual-industry").value = "자동차부품 제조업 · 가상 사례";
  $("#manual-unit").value = "억원";
  $("#manual-working").value = "10";
  $("#manual-facility").value = "30";
  $("#manual-basis").value = "OFS";
  $("#manual-standard").value = "확인 전";
  $("#manual-audit").value = "감사보고서 원문 대조 전";
  $("#manual-audit-opinion").value = "미확인";
  $("#manual-audit-date").value = "";
  $("#manual-audit-page").value = "";
  $("#manual-source-confirmed").checked = false;
  $("#manual-source-note").value = "";
  for (const [, inputId] of businessEvidenceFields) {
    $(`#${inputId}`).value = "";
    $(`#${inputId}-source`).value = "";
  }
  reviewCorrections = [];
  try {
    const response = await fetch("/sample-abprecision-2023-2025.pdf");
    if (!response.ok) throw new Error("가상 원본 PDF를 불러오지 못했습니다.");
    const pdfTransfer = new DataTransfer();
    pdfTransfer.items.add(new File([await response.blob()], "가상_에이비정밀_별도재무제표_2023-2025.pdf", { type: "application/pdf" }));
    $("#manual-pdf").files = pdfTransfer.files;
    $("#manual-pdf").dispatchEvent(new Event("change"));
    $("#manual-status").textContent = "가상기업 CSV와 원본 PDF를 채웠습니다. PDF 2쪽의 2025년 유동자산을 CSV와 대조해 보세요.";
  } catch {
    $("#manual-status").textContent = "가상기업 CSV를 채웠습니다. 원본 PDF는 위 링크에서 별도로 열어 주세요.";
  }
});

function renderStatementTable(records, rows) {
  const newestFirst = [...records].reverse();
  return `<div class="manual-table-wrap"><table class="manual-table"><thead><tr><th>입력·계산 계정</th>${newestFirst.map((row) => `<th>${escapeHtml(row.period)}년</th>`).join("")}</tr></thead><tbody>${rows.map(([label, key]) => `<tr><td>${escapeHtml(label)}</td>${newestFirst.map((row) => `<td>${money(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderCashFlowYear(row, maxAbs) {
  const flows = [["영업", "operatingCashFlow"], ["투자", "investingCashFlow"], ["재무", "financingCashFlow"]];
  return `<article class="manual-cash-year"><h4>${escapeHtml(row.period)}년</h4>${flows.map(([label, key]) => {
    const value = row[key];
    const width = Number.isFinite(value) ? Math.min(48, Math.abs(value) / maxAbs * 48) : 0;
    const direction = value < 0 ? "out" : "in";
    return `<div class="manual-cash-bar-row"><span>${label}활동</span><div class="manual-cash-track" aria-hidden="true">${Number.isFinite(value) && value !== 0 ? `<i class="${direction}" style="width:${width.toFixed(1)}%"></i>` : ""}</div><b>${signedMoney(value)}</b></div>`;
  }).join("")}<div class="manual-cash-year-total"><span>세 활동 합계</span><b>${signedMoney(row.cashFlowSubtotal)}</b></div></article>`;
}

function renderPerformanceMetric(metric, records, blocked) {
  const latestYear = records.at(-1)?.period || "당기";
  const previousYear = records.at(-2)?.period || "전기";
  const direction = metric.trend?.className || "unknown";
  const values = records.map((row, index) => `<span><b>${escapeHtml(row.period)}</b>${metricValue(metric.values?.[index], metric.unit)}</span>`).join("");
  const calculation = String(metric.calculation?.equation || "자료없음").replace("공시 수치", "제출 계정");
  return `<article class="manual-metric-row ${escapeHtml(direction)}"><div class="manual-metric-title"><div><b>${escapeHtml(metric.label)}</b><small>${escapeHtml(metric.definition)}</small></div><strong>${metricValue(metric.latest, metric.unit)}</strong></div><p class="manual-metric-change"><span>${blocked ? "입력오류 해소 전 · 판정 보류" : escapeHtml(metric.trend?.direction || "자료부족")}</span><b>${escapeHtml(previousYear)} → ${escapeHtml(latestYear)} · ${metricDelta(metric)}</b></p><div class="manual-metric-years">${values}</div><details><summary>산식·대입값·판정 기준 보기</summary><div class="manual-metric-proof"><p><b>산식</b> ${escapeHtml(metric.formula)}</p><p><b>${escapeHtml(latestYear)}년 대입</b> ${escapeHtml(calculation)}</p>${metric.calculation?.note ? `<p><b>보충</b> ${escapeHtml(metric.calculation.note)}</p>` : ""}<p><b>판정 기준</b> ${escapeHtml(metric.criterion)}</p><p><b>출처계정</b> ${escapeHtml(metric.account)} · 고객 제출 CSV(원본 대조 상태 별도)</p>${metric.warning ? `<p><b>해석 주의</b> ${escapeHtml(metric.warning)}</p>` : ""}</div></details></article>`;
}

function renderPurposeCard(analysis, key, label, term, blocked) {
  const item = analysis.decisionSupport?.[key];
  if (!item?.requested) return "";
  const action = key === "workingCapital" ? "받을 자료 · 월별 매입·판매·입금, 채권 연령표" : "받을 자료 · 설비 계약·집행표, 수주·가동계획";
  const rules = Array.isArray(item.appliedRules) ? item.appliedRules : [];
  return `<article class="manual-purpose"><div class="manual-purpose-head"><div><small>${key === "workingCapital" ? "SHORT TERM" : "LONG TERM"}</small><h3>${label}</h3></div><strong>${Number(item.requested).toLocaleString("ko-KR")}억원</strong></div><p class="manual-purpose-term">${Number.isFinite(Number(term)) ? `${Number(term).toLocaleString("ko-KR")}개월` : "기간 미입력"} · ${blocked ? "입력 오류 수정 전" : escapeHtml(item.stance)}</p><p class="manual-purpose-action">${action}</p><div class="manual-rule-list">${rules.map((rule) => `<details class="manual-rule"><summary><span><b>${escapeHtml(rule.title)}</b></span><strong>${escapeHtml(rule.result)}</strong></summary><div><p><b>계산</b> ${escapeHtml(rule.calculation)}</p><p><b>확인</b> ${escapeHtml(rule.check)}</p><details><summary>해석·산식</summary><p>${escapeHtml(rule.interpretation)}</p><p>${escapeHtml(rule.formula)} · ${escapeHtml(rule.explanation)}</p></details></div></details>`).join("")}</div></article>`;
}

function renderManualScenarioResult(result) {
  const target = $("#manual-scenario-result");
  if (!target) return;
  if (!result) {
    target.innerHTML = `<p class="manual-empty-inline">매출과 영업이익률의 변화 가정을 계산하는 중입니다.</p>`;
    return;
  }
  if (!result.available) {
    target.innerHTML = `<p class="manual-scenario-unavailable"><b>계산 보류</b> · ${escapeHtml(result.interpretation || "필수 제출 수치와 입력값을 확인해 주세요.")}</p>`;
    return;
  }
  const rows = [
    ["매출액", result.baseline.revenue, result.stressed.revenue, result.changes.revenue],
    ["영업이익", result.baseline.operatingProfit, result.stressed.operatingProfit, result.changes.operatingProfit],
  ];
  target.innerHTML = `<div class="manual-scenario-metrics">${rows.map(([name, base, assumed, gap]) => `<article><span>${name}</span><strong>${money(assumed)}</strong><em>${signedMoney(gap)} · 제출 ${money(base)}</em></article>`).join("")}</div><p class="manual-scenario-margin">영업이익률 ${metricValue(result.baseline.operatingMargin, "%")} → ${metricValue(result.stressed.operatingMargin, "%")} · 매출·이익률 단순 가정</p><details class="manual-scenario-proof"><summary>계산식·대입값</summary>${(result.calculationSteps || []).map((step) => `<p><b>${escapeHtml(step.label)}</b> · ${escapeHtml(step.formula)}<br>${escapeHtml(step.substitution)} = ${money(step.result)}</p>`).join("")}</details><p class="manual-method-note">신규대출 이자·원금과 승인가능액은 반영하지 않습니다.</p>`;
}

async function calculateManualScenario() {
  const analysis = currentAnalysis;
  const target = $("#manual-scenario-result");
  if (!analysis || !target) return;
  const requestId = ++manualScenarioRequestId;
  const scenario = { salesShock: Number($("#manual-sales-shock").value), marginShockPp: Number($("#manual-margin-shock").value) };
  const blocking = (analysis.manualReview?.issues || []).filter((item) => item.severity === "blocking");
  if (blocking.length) {
    manualScenarioResult = { available: false, assumptions: { salesShockPct: scenario.salesShock, marginShockPp: scenario.marginShockPp }, interpretation: `필수 입력·검산 오류 ${blocking.length}건을 원본 대조로 해소한 뒤 다시 계산합니다. 잠정 수치로 민감도를 제시하지 않습니다.`, missingInputs: ["필수 입력·검산 오류"] };
    renderManualScenarioResult(manualScenarioResult);
    renderManualFinalReport();
    return;
  }
  target.innerHTML = `<p class="manual-empty-inline">고객 제출 연간 매출·영업이익의 가정값을 계산하는 중입니다.</p>`;
  try {
    const response = await fetch("/api/stress-test/simple", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latest: analysis.records?.at(-1) || {}, scenario }) });
    const result = await response.json();
    if (!response.ok || result.simple !== true || typeof result.available !== "boolean") throw new Error(result.error || "단순 민감도 응답 형식을 확인하지 못했습니다.");
    if (requestId !== manualScenarioRequestId || currentAnalysis !== analysis) return;
    manualScenarioResult = result.available ? result : { ...result, assumptions: { salesShockPct: scenario.salesShock, marginShockPp: scenario.marginShockPp }, missingInputs: (result.missingInputs || []).map((item) => String(item).replaceAll("공시", "고객 제출")), interpretation: String(result.interpretation || "필수 값 부족").replaceAll("공시", "고객 제출") };
    renderManualScenarioResult(manualScenarioResult);
    renderManualFinalReport();
  } catch (error) {
    if (requestId !== manualScenarioRequestId || currentAnalysis !== analysis) return;
    manualScenarioResult = { available: false, assumptions: { salesShockPct: scenario.salesShock, marginShockPp: scenario.marginShockPp }, interpretation: `계산 API를 확인하지 못했습니다: ${error.message}`, missingInputs: ["계산 응답"] };
    renderManualScenarioResult(manualScenarioResult);
    renderManualFinalReport();
  }
}

function renderResult(analysis) {
  const records = Array.isArray(analysis.records) ? analysis.records : [];
  const latest = records.at(-1) || {}, previous = records.at(-2) || {};
  const issues = analysis.manualReview?.issues || [];
  const blocked = issues.some((item) => item.severity === "blocking");
  const dimensions = analysis.performance?.dimensions || [];
  const validations = analysis.dataQuality?.validations || [];
  const cashInsights = analysis.cashFlowAnalysis?.insights || [];
  const maxCashFlow = Math.max(1, ...records.flatMap((row) => [row.operatingCashFlow, row.investingCashFlow, row.financingCashFlow].filter(Number.isFinite).map(Math.abs)));
  const coreRows = [["매출액", "revenue"], ["영업이익", "operatingProfit"], ["당기순이익", "netIncome"], ["영업활동현금흐름", "operatingCashFlow"], ["투자활동현금흐름", "investingCashFlow"], ["재무활동현금흐름", "financingCashFlow"], ["단순 FCF · CFO-CAPEX", "freeCashFlow"], ["현금및현금성자산", "cash"], ["총자산", "totalAssets"], ["총부채", "totalLiabilities"], ["자기자본", "equity"], ["금융차입금 · 리스 제외", "totalDebt"]];
  const detailRows = csvFields.slice(1).map((field) => [fieldLabels[field], field]);
  const businessEvidence = (analysis.manualReview?.businessEvidence || []).filter((item) => item.text);
  const audit = analysis.manualReview?.auditReview || {};
  const hypotheses = analysis.performance?.hypotheses || [];
  $("#manual-results").hidden = false;
  $("#manual-analysis-empty").hidden = true;
  $("#manual-results").innerHTML = `<div class="manual-result-head"><div><p class="eyebrow">BORROWER DETAIL</p><h2>${escapeHtml(analysis.company?.name)} · 계산 근거</h2><p>${escapeHtml(records[0]?.period)}~${escapeHtml(latest.period)}년 ${analysis.primaryFsDiv === "CFS" ? "연결 · 그룹" : "별도 · 차주"} · 억원</p></div></div>
    ${blocked ? `<p class="manual-blocked-note"><b>검산 불일치 ${issues.filter((item) => item.severity === "blocking").length}건</b> · 방향 판정 보류 <a href="#manual-review">입력값 확인 →</a></p>` : ""}
    <section class="manual-subsection" id="manual-financials"><div class="section-heading compact"><div><p class="eyebrow">BORROWER FINANCIALS</p><h3>3개년 주요 재무</h3></div></div>${renderStatementTable(records, coreRows)}<details class="manual-full-accounts"><summary>전체 계정 ${detailRows.length}개 · 입력값 보기</summary>${renderStatementTable(records, detailRows)}</details><details class="manual-validation"><summary>연도별 자동 검산 결과</summary><ul>${validations.map((item) => `<li>${escapeHtml(item.period)}년 · 자산=부채+자본 <b>${escapeHtml(item.balanceSheet)}</b> · 현금흐름 대조 <b>${escapeHtml(item.cashFlow)}</b></li>`).join("") || "<li>검산 자료 없음</li>"}</ul><p>현금흐름 차이는 원문 조정항목을 확인합니다.</p></details></section>
    <section class="manual-subsection" id="manual-cashflow"><div class="section-heading compact"><div><p class="eyebrow">CASH FLOW / 3 YEARS</p><h3>영업·투자·재무 현금흐름</h3></div></div><div class="manual-cash-years">${[...records].reverse().map((row) => renderCashFlowYear(row, maxCashFlow)).join("")}</div><div class="manual-cash-bridge"><div><span>${escapeHtml(latest.period)}년 세 활동 합계</span><strong>${signedMoney(latest.cashFlowSubtotal)}</strong></div><div><span>현금잔액 증감</span><strong>${signedMoney(latest.cashBalanceChange)}</strong></div><div><span>차이 · 원문 확인</span><strong>${signedMoney(latest.cashFlowReconciliationGap)}</strong></div></div>${cashInsights.length ? `<div class="manual-cash-next"><b>다음 확인자료</b>${cashInsights.slice(0, 2).map((insight) => `<div><span>${escapeHtml(insight.title)}</span><strong>${escapeHtml((insight.checks || []).slice(0, 2).join(" · ") || "원문 확인")}</strong></div>`).join("")}</div><details class="manual-cash-insights-more"><summary>해석·근거 ${cashInsights.length}건</summary><div class="manual-cash-insights">${cashInsights.map((insight) => `<article><b>${escapeHtml(insight.title)}</b><p>${escapeHtml(insight.meaning)}</p><small>자료: ${escapeHtml((insight.checks || []).join(" · "))}</small></article>`).join("")}</div></details>` : ""}</section>
    <section class="manual-subsection manual-performance" id="manual-performance"><div class="section-heading compact"><div><p class="eyebrow">MANAGEMENT PERFORMANCE</p><h3>경영성과 · ${escapeHtml(previous.period)} → ${escapeHtml(latest.period)}</h3></div></div><div class="manual-dimension-grid">${dimensions.map((item) => { const keyMetric = (item.metrics || []).find((metric) => metric.trend?.className === "weakening") || (item.metrics || []).find((metric) => Number.isFinite(metric.latest)) || (item.metrics || [])[0]; return `<button type="button" class="manual-dimension ${blocked ? "unknown" : escapeHtml(item.status?.className || "unknown")}" data-manual-dimension="${escapeHtml(item.id)}"><span>${escapeHtml(item.name)}</span><strong>${blocked ? "판정 보류" : escapeHtml(item.status?.label || "자료부족")}</strong><small>${keyMetric ? `${escapeHtml(keyMetric.label)} ${metricValue(keyMetric.latest, keyMetric.unit)}` : "비교자료 없음"}</small></button>`; }).join("")}</div><div class="manual-performance-details">${dimensions.map((item) => `<details id="manual-detail-${escapeHtml(item.id)}"><summary><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.question)}</span><strong>${blocked ? "검증 전" : escapeHtml(item.status?.label || "자료부족")}</strong></summary><div class="manual-metric-list">${(item.metrics || []).map((metric) => renderPerformanceMetric(metric, records, blocked)).join("")}</div></details>`).join("")}</div><details class="manual-method-note"><summary>판정 기준</summary>${escapeHtml(analysis.performance?.rule || "전년 비교 가능 수치만 방향을 분류합니다.")}</details></section>
    <details class="manual-subsection manual-diagnosis"><summary><span>변화 원인과 검증자료</span><b>${blocked ? "입력 수정 후" : `${hypotheses.length}건`}</b></summary>${blocked ? `<p class="manual-blocked-note">검산 불일치를 먼저 수정하세요.</p>` : `<div class="manual-hypothesis-grid">${hypotheses.slice(0, 4).map((item) => `<article><small>${escapeHtml(item.priority)}</small><h4>${escapeHtml(item.category)}</h4><p><b>관찰</b> ${escapeHtml(item.observation)}</p><p><b>가설</b> ${escapeHtml(item.hypothesis)}</p><ul>${(item.verificationSteps || []).map((step) => `<li><b>${escapeHtml(step.title)}</b> · ${escapeHtml(step.data)}<br>${escapeHtml(step.question)}</li>`).join("")}</ul></article>`).join("")}</div>`}</details>
    <details class="manual-subsection manual-business-evidence"><summary><span>사업·감사 근거</span><b>감사의견 ${escapeHtml(audit.opinion || "미확인")} · 사업 근거 ${businessEvidence.length}건</b></summary><div class="manual-audit-row"><b>감사의견</b><strong>${escapeHtml(audit.opinion || "미확인")}</strong><span>${escapeHtml(audit.reportDate || "보고서일 미입력")} · ${escapeHtml(audit.sourcePage || "원문 위치 미입력")}</span></div>${businessEvidence.length ? `<div class="manual-business-grid">${businessEvidence.map((item) => `<article><h4>${escapeHtml(item.label)}</h4><p>${escapeHtml(item.text)}</p><small>담당자 입력 · 출처: ${escapeHtml(item.source || "미기재")}</small></article>`).join("")}</div>` : `<p class="manual-empty-inline">사업·거래처 설명 미입력 · <a href="#manual-workspace">상담자료에 근거 추가 →</a></p>`}</details>
    <section class="manual-subsection" id="manual-purpose-review"><div class="section-heading compact"><div><p class="eyebrow">LOAN PURPOSE</p><h3>요청여신별 검토</h3></div></div><div class="manual-purpose-grid">${renderPurposeCard(analysis, "workingCapital", "운전자금", analysis.loanRequest?.workingTermMonths, blocked)}${renderPurposeCard(analysis, "facility", "시설자금", analysis.loanRequest?.facilityTermMonths, blocked)}${!analysis.decisionSupport?.workingCapital?.requested && !analysis.decisionSupport?.facility?.requested ? `<p class="manual-empty-inline">요청금액을 입력하면 검토 근거가 나옵니다.</p>` : ""}</div></section>
    <section class="manual-subsection manual-scenario" id="manual-scenario"><div class="section-heading compact"><div><p class="eyebrow">SIMPLE SENSITIVITY</p><h3>매출·영업이익 가정</h3></div></div><div class="manual-scenario-controls"><label>매출 변화 <output id="manual-sales-value">기준 0%</output><input id="manual-sales-shock" type="range" min="-30" max="30" step="1" value="0" /><small>-30% · 0 · +30%</small></label><label>영업이익률 변화 <output id="manual-margin-value">기준 0.0%p</output><input id="manual-margin-shock" type="range" min="-20" max="20" step="0.5" value="0" /><small>-20%p · 0 · +20%p</small></label><button class="secondary-button" id="manual-scenario-recalculate" type="button">재계산</button></div><div id="manual-scenario-result" aria-live="polite"><p class="manual-empty-inline">가정값 계산 중</p></div></section>
    <p class="manual-result-note">고객 입력·담당자 대조 전 수치는 잠정값입니다. PDF ${pdfEvidence.length}건은 브라우저에만 있으며 자동 추출하지 않습니다. 승인·한도 산정에는 사용하지 않습니다.</p>`;
  $("#manual-results").querySelectorAll("[data-manual-dimension]").forEach((button) => button.addEventListener("click", () => {
    const detail = document.getElementById(`manual-detail-${button.dataset.manualDimension}`);
    if (detail) { detail.open = true; detail.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }));
  ["#manual-sales-shock", "#manual-margin-shock"].forEach((selector) => {
    const input = $(selector);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      $(selector === "#manual-sales-shock" ? "#manual-sales-value" : "#manual-margin-value").textContent = `${value === 0 ? "기준 " : ""}${value > 0 ? "+" : ""}${selector === "#manual-margin-shock" ? value.toFixed(1) : value}${selector === "#manual-margin-shock" ? "%p" : "%"}`;
    });
    input.addEventListener("change", calculateManualScenario);
  });
  $("#manual-scenario-recalculate").addEventListener("click", calculateManualScenario);
}

function renderReview(analysis) {
  const { issues, changes, blocking, missingCorrectionSources, sourceRecorded, sourceReady } = reviewState(analysis);
  const otherIssues = issues.filter((issue) => issue.severity !== "blocking");
  const renderIssue = (issue) => `<article class="manual-issue ${issue.severity === "blocking" ? "blocking" : ""}"><div class="manual-issue-head"><small>${escapeHtml(issue.period || "원본 범위")} · ${issue.severity === "blocking" ? "숫자 불일치" : "추가 확인"}</small><h3>${escapeHtml(issue.title)}</h3></div><p>${escapeHtml(issue.detail)}</p>${issue.fields?.length ? `<div class="manual-correction-grid">${issue.fields.map((field) => `<label>${escapeHtml(fieldLabels[field] || field)} · ${escapeHtml(issue.period)}년<input type="text" inputmode="decimal" data-review-period="${escapeHtml(issue.period)}" data-review-field="${escapeHtml(field)}" value="${escapeHtml(issue.values?.[field] || "")}" placeholder="원문 대조 후 입력" /></label>`).join("")}<label>원문 페이지<input type="text" data-review-page="${escapeHtml(issue.id)}" placeholder="예: 감사보고서 p.2" /></label><label>수정 근거<input type="text" data-review-note="${escapeHtml(issue.id)}" placeholder="원문 계정명·값·단위" /></label></div><small class="manual-issue-help">정확한 원문 값을 넣고 페이지·근거를 기록하세요. 검산만 통과해도 원본 일치로 표시하지 않습니다.</small>` : `<small class="manual-issue-help">${escapeHtml((issue.affects || []).join(" · ") || "출처 신뢰성")} 확인에 필요</small>`}</article>`;
  $("#manual-review").hidden = false;
  $("#manual-review").innerHTML = `<div class="manual-review-head"><div><p class="eyebrow">SOURCE CHECK</p><h2>검산 · 원본 대조</h2></div><p>숫자끼리 맞는지와 원본에 맞는지는 다른 검사입니다.</p></div>
    <div class="manual-review-gates"><div class="${blocking.length ? "needs-work" : "checked"}"><span>① 입력값 검산</span><strong>${blocking.length ? `불일치 ${blocking.length}건` : "통과"}</strong><small>입력 계정 간 관계 검사 · 원본 일치 뜻 아님</small></div><div class="${sourceReady ? "checked" : "needs-review"}"><span>② 원본 대조</span><strong>${sourceReady ? "담당자 대조 기록" : missingCorrectionSources.length ? `수정 근거 ${missingCorrectionSources.length}건 필요` : "미완료"}</strong><small>${sourceRecorded && !sourceReady ? "대조 체크와 별개로 수정값의 출처를 채워야 합니다." : "원본의 금액·계정·기간·단위 확인"}</small></div></div>
    ${blocking.length ? `<div class="manual-review-blocking"><h3>먼저 바로잡을 입력값</h3><div class="manual-issue-list">${blocking.map(renderIssue).join("")}</div></div>` : `<p class="manual-review-passed">자동 검산 불일치 0건 · 원본 PDF와의 일치는 별도 확인입니다.</p>`}
    ${otherIssues.length ? `<details class="manual-review-more"><summary>원본에서 추가 확인 ${otherIssues.length}건 <span>회계기준·감사의견·누락계정 등</span></summary><div class="manual-issue-list">${otherIssues.map(renderIssue).join("")}</div></details>` : ""}
    ${changes.length ? `<div class="manual-review-history"><h3>담당자 수정 ${changes.length}건</h3><div class="manual-history-list">${changes.map((item) => { const supported = String(item.page || "").trim() && String(item.note || "").trim(); const correction = reviewCorrections.find((entry) => entry.period === item.period && entry.field === item.field); return `<div class="manual-history-item"><div class="manual-history-title"><b>${escapeHtml(item.period)}년 ${escapeHtml(fieldLabels[item.field] || item.field)}</b><span class="${supported ? "recorded" : "provisional"}">${supported ? "원문 위치·근거 기록" : "담당자 임시 수정 · 근거 필요"}</span></div><small>CSV 원래값 ${money(item.previous)} → 현재 ${money(item.current)}</small><div class="manual-history-fields"><label>정확한 원문 값<input type="text" inputmode="decimal" data-history-value data-history-period="${escapeHtml(item.period)}" data-history-field="${escapeHtml(item.field)}" value="${escapeHtml(correction?.value ?? "")}" /></label><label>원문 페이지<input type="text" data-history-page value="${escapeHtml(item.page || "")}" placeholder="예: 재무제표 p.2" /></label><label>수정 근거<input type="text" data-history-note value="${escapeHtml(item.note || "")}" placeholder="예: 유동자산 230억원 확인" /></label></div></div>`; }).join("")}</div></div>` : ""}
    <div class="manual-review-actions"><button class="primary-button" id="manual-recalculate" type="button">수정값 적용 · 다시 계산</button><span>원본에 있는 정확한 값만 입력하세요.</span></div>`;
  $("#manual-recalculate").addEventListener("click", () => {
    const updates = new Map(reviewCorrections.map((item) => [`${item.period}:${item.field}`, item]));
    document.querySelectorAll("[data-history-value]").forEach((input) => {
      const period = input.dataset.historyPeriod, field = input.dataset.historyField;
      const value = input.value.replaceAll(",", "").trim();
      if (!value) return;
      const row = input.closest(".manual-history-item");
      updates.set(`${period}:${field}`, { period, field, value, page: row.querySelector("[data-history-page]")?.value.trim() || "", note: row.querySelector("[data-history-note]")?.value.trim() || "" });
    });
    document.querySelectorAll("[data-review-field]").forEach((input) => {
      const period = input.dataset.reviewPeriod, field = input.dataset.reviewField;
      const original = String(issues.find((issue) => issue.period === period && issue.fields?.includes(field))?.values?.[field] ?? "").replaceAll(",", "").trim();
      const value = input.value.replaceAll(",", "").trim();
      if (!value || value === original) return;
      const issue = input.closest(".manual-issue");
      updates.set(`${period}:${field}`, { period, field, value, page: issue.querySelector("[data-review-page]")?.value || "", note: issue.querySelector("[data-review-note]")?.value || "" });
    });
    reviewCorrections = [...updates.values()];
    performAnalysis();
  });
}

const manualInspectionGuidance = {
  "FI-C01": ["예: 경영진이 매출·이익 변화의 원인과 대응 일정·책임자를 어떻게 설명했는지", "예: 면담 일시·참석자, 월별 실적표와 사업계획 쪽수", "예: 설명과 실제 수주·실적의 차이를 다시 대조"],
  "FI-C02": ["예: 핵심 담당자 이탈 여부와 업무 공백 시 대체 인력 확인", "예: 조직도·인사 변동·업무 인수인계 기록", "예: 특정 인력 의존 업무의 연속성 검토"],
  "FI-C03": ["예: 주요 거래처의 발주·납품·검수 과정이 현장 설명과 일치하는지", "예: 발주서·납품확인서·입금기록의 날짜와 문서번호", "예: 제출 매출과 실제 거래 흐름 차이의 원인 요청"],
  "FI-C04": ["예: 구매 승인자·재고 기록자·자금 집행자가 분리되는지", "예: 결재권한표·발주·입고·지급 승인 기록", "예: 동일인에게 집중된 통제 구간의 보완 요청"],
  "FI-F01": ["예: 설비 위치·사양·계약 상대방·계약금 지급 여부", "예: 설비 계약서·견적서·이체증과 현장 사진", "예: 계약·실물·지급내역 불일치 시 집행 조건 재검토"],
  "FI-F02": ["예: 이전·현재 가동률의 조사기간과 생산량 산출방법", "예: 월별 생산일보·설비별 가동기록과 촬영일", "예: 유휴설비를 고려해 신규 투자 필요성 재검토"],
  "FI-F03": ["예: 증설 생산량을 어느 고객이 언제 구매할 계획인지", "예: 수주서·판매계획·납기표의 문서번호", "예: 미확정 수요는 투자 후 상환재원에서 별도 취급"],
  "FI-W01": ["예: 매입일부터 납품·검수·입금일까지 실제 소요일", "예: 매입·출고·세금계산서·입금 내역의 거래일", "예: 회수시점이 만기를 넘는다면 상환구조 재검토"],
  "FI-W02": ["예: 대출금이 지급될 공급처·품목·금액 확인", "예: 발주서·거래명세서·공급처 청구서", "예: 신청 목적과 다른 지출 가능성에 대한 집행 방식 보완"],
  "영업·회수": ["예: 납품 후 검수·청구·입금 지연이나 분쟁의 구체적 기간", "예: 채권 연령표·검수확인서·입금 내역", "예: 연체·분쟁 채권의 회수예상액 별도 검토"],
  "재고운영": ["예: 장기 보관·불량 재고를 실물과 장부 수량으로 대조", "예: 재고명세·실사표·보관구역 사진", "예: 판매가능액·손실 반영 여부 확인"],
  "생산": ["예: 가동 중인 라인과 정지 라인·병목공정 확인", "예: 생산일보·작업지시서·가동기록과 현장 사진", "예: 생산계획과 실제 가동 차이의 수주 이행 영향"],
  "품질": ["예: 불량·반품 반복 품목과 개선조치 시행 여부", "예: 품질검사표·반품·고객 불만 처리기록", "예: 품질비용과 거래지속성 추가 검토"],
  "설비": ["예: 핵심설비 고장 빈도·정지시간·예비설비 유무", "예: 정비대장·고장이력·설비 사진", "예: 예상 수선비와 조업중단 위험 반영"],
  "점포운영": ["예: 점포 방문객·매대 운영과 점포별 매출 변화 대조", "예: 점포별 매출·방문객 자료와 방문시각 사진", "예: 부진 점포의 개선비용과 회수계획 확인"],
  "상품·재고": ["예: 장기 진열·할인·폐기 상품의 비중과 실물 상태", "예: 품목별 재고기간·폐기기록·진열 사진", "예: 재고손실과 회전계획 재검토"],
  "상권·채널": ["예: 경쟁점·상권 변화 및 온라인 주문 운영 현황", "예: 채널별 매출표·배송·픽업 기록", "예: 점포 투자·철수와 수익성 영향 확인"],
  "기술·권리": ["예: 핵심기술 개발주체·특허 귀속·분쟁 가능성", "예: 등록부·라이선스 계약·분쟁 관련 서류", "예: 권리 공백의 상용화 영향 검토"],
  "개발인력": ["예: 핵심 개발자의 담당 영역과 대체·인수인계 가능성", "예: 연구개발 조직도·프로젝트 배정표", "예: 특정 인력 의존 프로젝트의 납기 위험 확인"],
  "상용화": ["예: 시제품 검증부터 양산·매출까지 남은 단계", "예: 고객 시험결과·인증서·수주서", "예: 확정계약과 예상매출을 상환재원에서 구분"],
  "사업현장": ["예: 실제 공정률과 시공상태가 사업계획과 맞는지", "예: 감리보고서·기성확인서·현장 사진", "예: 공정 지연 시 집행·회수시점 재검토"],
  "원가·공정": ["예: 자재비 상승과 공정 지연에 대비한 예비비", "예: 수정 실행예산·공정표·변경계약", "예: 비용초과의 현금수지·상환 영향 확인"],
  "분양·임대": ["예: 계약 체결·해지와 미계약 물량 현황", "예: 계약서·계약금 입금·계약현황표", "예: 미계약 물량을 보수적으로 반영"],
};

function inspectionHints(item) {
  return manualInspectionGuidance[item.ruleId] || manualInspectionGuidance[item.category] || [
    `예: ${item.question}에 대해 현장에서 관찰한 내용과 확인 시점`,
    `예: ${item.reason}을 확인할 원본 문서·페이지·사진번호`,
    "예: 확인 결과가 자금용도·상환재원에 미치는 영향과 다음 조치",
  ];
}

function updateManualInspectionProgress(analysis) {
  const items = Array.isArray(analysis.inspection) ? analysis.inspection : [];
  const complete = items.filter((item) => inspectionComplete(inspectionAnswers[item.ruleId])).length;
  const pending = items.filter((item) => inspectionAnswers[item.ruleId]?.status && inspectionAnswers[item.ruleId].status !== "미확인" && !inspectionComplete(inspectionAnswers[item.ruleId])).length;
  const progress = $("#manual-inspection-progress");
  if (progress) progress.textContent = `${complete}/${items.length}개 기록 완료${pending ? ` · ${pending}개 기재 부족` : ""}`;
  $("#manual-inspection-content").querySelectorAll("[data-inspection-id]").forEach((element) => {
    const answer = inspectionAnswers[element.dataset.inspectionId] || {};
    const state = element.querySelector("[data-inspection-state]");
    if (state) state.textContent = inspectionComplete(answer) ? "기록 완료" : answer.status && answer.status !== "미확인" ? "관찰·증빙·조치 기록 필요" : "미확인";
  });
}

function renderInspection(analysis) {
  const items = Array.isArray(analysis.inspection) ? analysis.inspection : [];
  $("#manual-print-inspection").disabled = items.length === 0;
  $("#manual-inspection-content").innerHTML = `<div class="manual-result-head"><div><h2>${escapeHtml(analysis.company?.name)} · 현장 확인 ${items.length}항목</h2></div><strong class="manual-inspection-progress" id="manual-inspection-progress"></strong></div><div class="manual-inspection-list">${items.map((item) => {
    const answer = inspectionAnswers[item.ruleId] || {};
    const files = inspectionEvidence.get(item.ruleId) || [];
    const [observationHint, evidenceHint, actionHint] = inspectionHints(item);
    return `<article class="manual-inspection-item" data-inspection-id="${escapeHtml(item.ruleId)}"><div class="manual-inspection-item-head"><span>${escapeHtml(item.category)}<small>${escapeHtml(item.ruleSource)}</small></span><div><h3>${escapeHtml(item.question)}</h3></div><label>현장 판단<select data-inspection-field="status">${["미확인", "정상 확인", "우려 확인", "자료 요청"].map((status) => `<option${(answer.status || "미확인") === status ? " selected" : ""}>${status}</option>`).join("")}</select></label></div><details class="manual-inspection-record" ${answer.status && answer.status !== "미확인" && !inspectionComplete(answer) ? "open" : ""}><summary>관찰 사실 · 증빙 · 후속조치 입력</summary><div class="manual-inspection-fields"><label>관찰한 사실<textarea data-inspection-field="observation" maxlength="2000" placeholder="${escapeHtml(observationHint)}">${escapeHtml(answer.observation || "")}</textarea></label><div class="manual-inspection-evidence"><label>확인 근거·증빙<textarea data-inspection-field="evidence" maxlength="2000" placeholder="${escapeHtml(evidenceHint)}">${escapeHtml(answer.evidence || "")}</textarea></label><label>사진·스캔 PDF 선택<input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple data-inspection-files /><small>최대 3개 · 파일당 10MB · 브라우저 탭에서만 열람</small></label><div class="manual-evidence-list">${files.map((file) => `<a href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.name)} ↗</a>`).join("") || "선택한 파일 없음"}</div></div><label>심사 영향·후속조치<textarea data-inspection-field="action" maxlength="2000" placeholder="${escapeHtml(actionHint)}">${escapeHtml(answer.action || "")}</textarea></label></div></details><small class="manual-inspection-entry-state" data-inspection-state></small></article>`;
  }).join("")}</div><label class="manual-inspection-summary">현장실사 종합 메모<textarea id="manual-inspection-summary" rows="3" maxlength="3000" placeholder="최초 우려 → 증빙 → 해소 여부 → 심사역 전달 사항">${escapeHtml(inspectionSummary)}</textarea></label><p class="manual-result-note">선택한 사진·PDF는 현재 브라우저 탭에만 남으며 자동 판독·서버 저장하지 않습니다.</p>`;
  $("#manual-inspection-content").querySelectorAll("[data-inspection-field]").forEach((input) => input.addEventListener("input", () => {
    const id = input.closest("[data-inspection-id]").dataset.inspectionId;
    inspectionAnswers[id] ||= {};
    inspectionAnswers[id][input.dataset.inspectionField] = input.value;
    if (input.dataset.inspectionField === "status" && input.value !== "미확인") input.closest("[data-inspection-id]").querySelector(".manual-inspection-record").open = true;
    updateManualInspectionProgress(analysis);
    renderOpinion(currentAnalysis);
  }));
  $("#manual-inspection-summary").addEventListener("input", (event) => { inspectionSummary = event.target.value; renderOpinion(currentAnalysis); });
  $("#manual-inspection-content").querySelectorAll("[data-inspection-files]").forEach((input) => input.addEventListener("change", async () => {
    const files = [...input.files];
    if (files.length > 3 || files.some((file) => file.size > 10_000_000 || !/\.(pdf|png|jpe?g)$/i.test(file.name))) {
      input.value = "";
      input.closest(".manual-inspection-fields").querySelector(".manual-evidence-list").textContent = "최대 3개, PDF·PNG·JPG, 파일당 10MB 이하로 선택해 주세요.";
      return;
    }
    const id = input.closest("[data-inspection-id]").dataset.inspectionId;
    const version = (inspectionFileVersions.get(id) || 0) + 1;
    inspectionFileVersions.set(id, version);
    const analysisAtSelection = currentAnalysis;
    const attachments = await Promise.all(files.map(async (file) => {
      let sha256 = "";
      try {
        const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        sha256 = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      } catch { /* 파일 본문은 서버로 보내지 않으며, 해시 실패는 빈 값으로 표시합니다. */ }
      return { name: file.name, url: URL.createObjectURL(file), sha256 };
    }));
    if (version !== inspectionFileVersions.get(id) || currentAnalysis !== analysisAtSelection) {
      attachments.forEach((file) => URL.revokeObjectURL(file.url));
      return;
    }
    (inspectionEvidence.get(id) || []).forEach((file) => URL.revokeObjectURL(file.url));
    inspectionEvidence.set(id, attachments);
    input.closest(".manual-inspection-fields").querySelector(".manual-evidence-list").innerHTML = attachments.length ? attachments.map((file) => `<a href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.name)} ↗</a><small>${file.sha256 ? `SHA-256 ${escapeHtml(file.sha256.slice(0, 16))}… · ` : "해시 계산 불가 · "}내용 자동검증 전</small>`).join("") : "선택한 파일 없음";
    renderOpinion(currentAnalysis);
  }));
  updateManualInspectionProgress(analysis);
}

function manualInspectionWorksheetMarkup(analysis) {
  const items = Array.isArray(analysis.inspection) ? analysis.inspection : [];
  const request = analysis.loanRequest || {};
  const requested = [
    Number(request.workingAmount) > 0 ? `운전자금 ${Number(request.workingAmount).toLocaleString("ko-KR")}억원` : null,
    Number(request.facilityAmount) > 0 ? `시설자금 ${Number(request.facilityAmount).toLocaleString("ko-KR")}억원` : null,
  ].filter(Boolean).join(" · ") || "신청금액 확인 전";
  return `<header class="worksheet-header"><p>CREDITLENS · FIELD VISIT WORKSHEET</p><h1>현장실사 점검지 <small>방문 전 빈 양식</small></h1><p>고객 제출자료의 원본·현장 실재성 확인용입니다. 기존 현장 답변은 출력하지 않으며, 사실과 증빙을 현장에서 직접 기록하세요.</p></header><div class="worksheet-meta"><div><b>기업명</b><span>${escapeHtml(analysis.company?.name)}</span></div><div><b>재무 범위</b><span>${analysis.primaryFsDiv === "OFS" ? "별도 · 차주 법인" : "연결 · 그룹 참고"}</span></div><div><b>신청자금</b><span>${escapeHtml(requested)}</span></div><div><b>방문일시</b><span>________년 ____월 ____일　 ____:____</span></div><div><b>방문장소</b><span>________________________________</span></div><div><b>담당자·면담자</b><span>________________________________</span></div></div><p class="worksheet-guide">업종·재무 신호·신청 목적에 따라 생성된 ${items.length}개 항목입니다. 체크만으로 완료하지 말고 관찰 사실·근거·후속조치를 기록하세요.</p><main class="worksheet-items">${items.map((item, index) => `<section class="worksheet-item"><div class="worksheet-item-head"><b>${index + 1}. ${escapeHtml(item.category)}</b><span>${escapeHtml(item.ruleSource)}</span></div><h2>${escapeHtml(item.question)}</h2><p>확인 목적: ${escapeHtml(item.reason)}</p><div class="worksheet-choices">□ 정상 확인　 □ 우려 확인　 □ 자료 요청　 □ 해당 없음</div><div class="worksheet-write"><b>관찰 사실·면담 답변</b><i></i><i></i></div><div class="worksheet-write"><b>증빙 문서·사진번호</b><i></i></div><div class="worksheet-write"><b>심사 영향·후속조치</b><i></i></div></section>`).join("")}</main><section class="worksheet-summary"><h2>현장 종합 메모 · 심사역 전달 사항</h2><i></i><i></i><i></i><p>추가 요청자료: ________________________________________________________________________________</p><p>담당자 서명: ______________________　확인일: ______________________</p></section>`;
}

function clearManualInspectionPrint() {
  document.body.classList.remove("print-inspection-form");
  const sheet = $("#manual-inspection-print-sheet");
  sheet.innerHTML = "";
}

window.addEventListener("afterprint", clearManualInspectionPrint);
$("#manual-print-inspection").addEventListener("click", () => {
  if (!currentAnalysis) return;
  $("#manual-inspection-print-sheet").innerHTML = manualInspectionWorksheetMarkup(currentAnalysis);
  document.body.classList.add("print-inspection-form");
  window.print();
});

function renderOpinion(analysis) {
  if (!analysis) return;
  const issues = analysis.manualReview?.issues || [];
  const blocking = issues.filter((item) => item.severity === "blocking");
  const latest = analysis.records?.at(-1) || {};
  const inspectionItems = Array.isArray(analysis.inspection) ? analysis.inspection : [];
  const answered = inspectionItems.map((item) => [item, inspectionAnswers[item.ruleId] || {}]).filter(([, value]) => inspectionComplete(value));
  const incomplete = inspectionItems.map((item) => [item, inspectionAnswers[item.ruleId] || {}]).filter(([, value]) => value.status && value.status !== "미확인" && !inspectionComplete(value));
  const unresolved = answered.filter(([, value]) => ["우려 확인", "자료 요청"].includes(value.status));
  const audit = analysis.manualReview?.auditReview || {};
  const businessEvidence = (analysis.manualReview?.businessEvidence || []).filter((item) => item.text);
  const working = analysis.loanRequest?.workingAmount || 0, facility = analysis.loanRequest?.facilityAmount || 0;
  $("#manual-opinion-content").innerHTML = `<h2>${escapeHtml(analysis.company?.name)} · 여신검토 초안</h2><p>고객제출 재무자료 · ${analysis.primaryFsDiv === "OFS" ? "별도(차주 법인)" : "연결(그룹)"} · 원문 자동 대조 전</p>
    <div class="manual-opinion-section"><h3>1. 접수·자료 신뢰성</h3><p>${escapeHtml(analysis.manualReview?.accountingStandard)} · ${escapeHtml(analysis.manualReview?.auditStatus)}. 감사의견 담당자 입력: ${escapeHtml(audit.opinion || "미확인")}${audit.sourcePage ? ` · ${escapeHtml(audit.sourcePage)}` : " · 원문 위치 미기재"}. ${escapeHtml(analysis.manualReview?.sourceStatus)}${analysis.manualReview?.sourceReview?.confirmed ? ` · 대조근거: ${escapeHtml(analysis.manualReview.sourceReview.note)}` : ""}. 자동 검산 과제 ${issues.length}건 중 필수 오류 ${blocking.length}건입니다. ${blocking.length ? "수치 불일치 해소 전 재무판단을 보류합니다." : "자동 검산 오류가 없어도 감사의견·주석상 차입조건의 원문 대조가 남아 있습니다."}</p><ul>${issues.slice(0, 6).map((item) => `<li>${escapeHtml(item.title)}: ${escapeHtml(item.detail)}</li>`).join("") || "<li>감사의견·주석상 만기·담보·보증 추가 확인</li>"}</ul></div>
    <div class="manual-opinion-section"><h3>2. 사업·산업 구조</h3>${businessEvidence.length ? `<ul>${businessEvidence.map((item) => `<li><b>${escapeHtml(item.label)}</b>: ${escapeHtml(item.text)} · 출처 ${escapeHtml(item.source || "미기재")} (담당자 입력, 자동검증 아님)</li>`).join("")}</ul>` : `<p>주력 사업, 거래처, 운영능력, 경영진 및 업종 노출에 관한 고객 제출 원문·면담 근거가 아직 입력되지 않았습니다. 재무 숫자만으로 사업 지속성을 판단하지 않습니다.</p>`}</div>
    <div class="manual-opinion-section"><h3>3. 차주 상환능력과 현금흐름</h3><p>${escapeHtml(latest.period)}년 매출 ${money(latest.revenue)}, 영업이익 ${money(latest.operatingProfit)}입니다. 영업·투자·재무활동현금흐름은 각각 ${signedMoney(latest.operatingCashFlow)}, ${signedMoney(latest.investingCashFlow)}, ${signedMoney(latest.financingCashFlow)}이며 단순 FCF는 ${signedMoney(latest.freeCashFlow)}입니다. 이 값들은 고객 CSV의 연간 수치이고, 만기별 실제 원리금 상환 가능성을 확정하지 않습니다.</p></div>
    <div class="manual-opinion-section"><h3>4. 자금용도별 검토</h3><p>${working ? `운전자금 ${Number(working).toLocaleString("ko-KR")}억원 · ${escapeHtml(analysis.decisionSupport?.workingCapital?.stance)}. 매입→판매→회수 기간과 만기 내 실제 입금액을 확인합니다. ` : "운전자금 신청 없음. "}${facility ? `시설자금 ${Number(facility).toLocaleString("ko-KR")}억원 · ${escapeHtml(analysis.decisionSupport?.facility?.stance)}. 투자 집행→가동→추가 현금창출과 원리금 일정을 검증합니다.` : "시설자금 신청 없음."}</p></div>
    <div class="manual-opinion-section"><h3>5. 사업·현장 확인</h3><p>${answered.length}/${inspectionItems.length}개 항목의 관찰·근거·후속조치가 기록됐습니다. 우려·자료 요청 ${unresolved.length}건${incomplete.length ? `, 상태만 선택하고 근거 기재가 부족한 항목 ${incomplete.length}건` : ""}입니다.</p><ul>${answered.map(([item, answer]) => `<li><b>${escapeHtml(item.category)} · ${escapeHtml(answer.status)}</b> — 관찰: ${escapeHtml(answer.observation)} / 근거: ${escapeHtml(answer.evidence)}${inspectionEvidence.get(item.ruleId)?.length ? ` · 선택 파일: ${escapeHtml(inspectionEvidence.get(item.ruleId).map((file) => file.name).join(", "))}` : ""} / 후속: ${escapeHtml(answer.action)}</li>`).join("") || "<li>현장실사 전 · 정성적 판단과 증빙 미입력</li>"}${incomplete.map(([item]) => `<li>${escapeHtml(item.category)} · 기록 미완료: 관찰·근거·후속조치 입력 필요</li>`).join("")}</ul>${inspectionSummary ? `<p><b>종합 메모:</b> ${escapeHtml(inspectionSummary)}</p>` : ""}</div>
    <div class="manual-opinion-section"><h3>6. 심사·조건·사후관리</h3><p>담당자는 누락 계정·원본 페이지·감사의견·주석을 대조하고, 우려별 증빙과 현장 조치 결과를 심사역에 전달해야 합니다. 금액·금리·만기·상환방식은 고객의 월별 현금수지와 기존 원리금표, 내부 기준을 반영해 심사역이 검토합니다. 실행 후 자금용도와 상환 징후를 추적해야 합니다.</p></div>
    <p class="manual-result-note">이 초안은 승인·거절 의견이 아니며, 입력·현장 메모는 서버에 저장되지 않습니다. 인쇄 전 고객자료 취급기준을 확인하세요.</p>`;
  renderManualFinalReport();
}

function currentPrivateReportModel() {
  if (!currentAnalysis) return null;
  const inspections = (currentAnalysis.inspection || []).map((item) => {
    const answer = inspectionAnswers[item.ruleId] || {};
    return {
      category: item.category,
      question: item.question,
      status: answer.status || "미확인",
      observation: answer.observation || "",
      evidence: answer.evidence || "",
      action: answer.action || "",
      files: (inspectionEvidence.get(item.ruleId) || []).map((file) => ({ name: file.name, sha256: file.sha256 || "" })),
    };
  });
  return buildPrivateReportModel(currentAnalysis, {
    csvName: $("#manual-csv").files?.[0]?.name,
    pdfFiles: pdfEvidence.map((file) => ({ name: file.name, sha256: file.sha256 })),
    inspections,
    inspectionSummary,
    reportEdits,
    scenario: manualScenarioResult ? {
      name: "고객 제출 연간 재무 · 매출·영업이익 단순 민감도",
      assumptions: `매출 ${Number(manualScenarioResult.assumptions?.salesShockPct) > 0 ? "+" : ""}${manualScenarioResult.assumptions?.salesShockPct ?? 0}%, 영업이익률 ${Number(manualScenarioResult.assumptions?.marginShockPp) > 0 ? "+" : ""}${manualScenarioResult.assumptions?.marginShockPp ?? 0}%p`,
      results: manualScenarioResult.available ? `매출 ${money(manualScenarioResult.baseline.revenue)} → ${money(manualScenarioResult.stressed.revenue)}, 영업이익 ${money(manualScenarioResult.baseline.operatingProfit)} → ${money(manualScenarioResult.stressed.operatingProfit)}` : `계산 보류 · ${manualScenarioResult.missingInputs?.join(" · ") || manualScenarioResult.interpretation}`,
      interpretation: manualScenarioResult.available ? "고객 제출 연간 수치에 선택한 매출·이익률 변화만 적용한 산술 예시입니다. 실제 현금 유입과 원리금 상환을 검증하지 않았습니다." : manualScenarioResult.interpretation,
      limitations: "원본 대조 전 수치는 잠정값입니다. 신규대출 원리금·월별 현금수지·승인가능 금액·담보조건은 계산하지 않습니다.",
    } : null,
  });
}

function renderManualFinalReport(model = currentPrivateReportModel()) {
  if (!currentAnalysis) return;
  $("#manual-final-report").innerHTML = renderFullReport(model);
}

const reportEditKeys = ["industry", "management"];
function clearReportEditInputs() {
  for (const key of reportEditKeys) {
    $(`#manual-report-${key}-text`).value = "";
    $(`#manual-report-${key}-source`).value = "";
  }
}

document.querySelectorAll("#manual-report-editor textarea, #manual-report-editor input").forEach((input) => {
  input.addEventListener("input", () => {
    reportEditDirty = true;
    $("#manual-report-edit-status").textContent = "변경 내용을 보고서에 반영하려면 버튼을 누르세요.";
  });
});

function applyManualReportEdits() {
  if (!currentAnalysis) {
    $("#manual-report-edit-status").textContent = "먼저 제출 재무자료를 분석해 주세요.";
    return false;
  }
  const next = {};
  for (const key of reportEditKeys) {
    const narrative = $(`#manual-report-${key}-text`);
    const source = $(`#manual-report-${key}-source`);
    const text = narrative.value.trim();
    const sourceText = source.value.trim();
    if (text && !sourceText) {
      $("#manual-report-edit-status").textContent = "보고서 문구를 쓰면 근거·페이지도 입력해 주세요.";
      $("#manual-report-editor").open = true;
      source.focus();
      return false;
    }
    if (sourceText && !text) {
      $("#manual-report-edit-status").textContent = "근거를 쓰면 보고서 문구도 입력해 주세요.";
      $("#manual-report-editor").open = true;
      narrative.focus();
      return false;
    }
    if (text) next[key] = { text, source: sourceText };
  }
  reportEdits = next;
  reportEditDirty = false;
  renderManualFinalReport();
  $("#manual-report-edit-status").textContent = Object.keys(next).length
    ? `${Object.keys(next).length}개 장에 담당자 작성 내용과 근거를 반영했습니다.`
    : "담당자 보완 내용을 지웠습니다.";
  return true;
}

$("#manual-apply-report-edits").addEventListener("click", applyManualReportEdits);

$("#manual-clear-report-edits").addEventListener("click", () => {
  clearReportEditInputs();
  reportEdits = {};
  reportEditDirty = false;
  renderManualFinalReport();
  $("#manual-report-edit-status").textContent = "담당자 보완 내용을 지웠습니다.";
});

async function performAnalysis() {
  manualScenarioRequestId += 1;
  const file = $("#manual-csv").files?.[0];
  if (!file || file.size > 150_000) { $("#manual-status").textContent = "150KB 이하의 CSV를 선택해 주세요."; return; }
  const csvText = await file.text();
  const caseKey = JSON.stringify([csvText, $("#manual-name").value.trim(), $("#manual-industry").value.trim(), $("#manual-basis").value]);
  if (sourceCaseKey && sourceCaseKey !== caseKey) {
    reviewCorrections = []; inspectionAnswers = {}; inspectionSummary = "";
    reportEdits = {};
    reportEditDirty = false;
    clearReportEditInputs();
    $("#manual-report-edit-status").textContent = "새 기업 분석으로 보완 내용을 초기화했습니다.";
    for (const files of inspectionEvidence.values()) files.forEach((file) => URL.revokeObjectURL(file.url));
    inspectionEvidence.clear();
  }
  sourceCaseKey = caseKey;
  const submit = $("#manual-form button[type='submit']");
  submit.disabled = true;
  $("#manual-status").textContent = "연도·계정·재무상태표를 검사하고 검증 과제를 만드는 중입니다.";
  try {
    const businessEvidence = Object.fromEntries(businessEvidenceFields.map(([key, inputId]) => [key, { text: $(`#${inputId}`).value, source: $(`#${inputId}-source`).value }]));
    const response = await fetch("/api/manual-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName: $("#manual-name").value, industry: $("#manual-industry").value, unit: $("#manual-unit").value, csvText, statementBasis: $("#manual-basis").value, accountingStandard: $("#manual-standard").value, auditStatus: $("#manual-audit").value, auditReview: { opinion: $("#manual-audit-opinion").value, reportDate: $("#manual-audit-date").value, sourcePage: $("#manual-audit-page").value }, businessEvidence, sourceReview: { confirmed: $("#manual-source-confirmed").checked, note: $("#manual-source-note").value }, overrides: reviewCorrections, loanRequest: { workingAmount: Number($("#manual-working").value), workingTermMonths: Number($("#manual-working-term").value), facilityAmount: Number($("#manual-facility").value), facilityTermMonths: Number($("#manual-facility-term").value) } }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `분석 실패 (${response.status})`);
    currentAnalysis = result;
    manualScenarioResult = null;
    renderManualDecisionBoard(result);
    renderReview(result);
    renderResult(result);
    renderInspection(result);
    renderOpinion(result);
    calculateManualScenario();
    const issues = result.manualReview?.issues || [];
    $("#manual-status").textContent = `분석 완료 · 입력값 불일치 ${issues.filter((item) => item.severity === "blocking").length}건 · 원문 추가 확인 ${issues.filter((item) => item.severity !== "blocking").length}건`;
    $("#manual-workspace").open = false;
    showManualPage("analysis");
    $("#manual-decision-board").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#manual-status").textContent = error.message;
  } finally { submit.disabled = false; }
}

$("#manual-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await performAnalysis();
});

$("#manual-print").addEventListener("click", () => {
  if (!currentAnalysis) return;
  showManualPage("opinion");
  if (reportEditDirty && !applyManualReportEdits()) return;
  renderManualFinalReport(currentPrivateReportModel());
  window.print();
});

$("#manual-save-report").addEventListener("click", async () => {
  if (!currentAnalysis) return;
  if (reportEditDirty && !applyManualReportEdits()) return;
  const button = $("#manual-save-report");
  button.disabled = true;
  try {
    const model = currentPrivateReportModel();
    renderManualFinalReport(model);
    const stylesheetResponse = await fetch(new URL("./final-report.css", import.meta.url));
    if (!stylesheetResponse.ok) throw new Error(`보고서 서식을 읽지 못했습니다 (${stylesheetResponse.status}).`);
    const stylesheet = await stylesheetResponse.text();
    if (!stylesheet.trim()) throw new Error("보고서 서식이 비어 있습니다.");
    const html = await renderFullReportDocument(model, stylesheet, $("#manual-final-report").innerHTML);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${model.company.name.replace(/[\\/:*?"<>|]/g, "_")}_최종기업분석보고서_${model.basisDate}.html`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    $("#manual-status").textContent = `전체 보고서 저장 실패: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

fetch("/api/health").then((response) => response.json()).then((health) => {
  $("#manual-public-warning").hidden = !health.publicDemo;
  $("#manual-transfer-note").textContent = health.publicDemo
    ? "공개 체험판: 기업명·CSV 수치·신청액·감사 및 사업 입력 메모는 분석 요청 시 Vercel 서버로 전송되지만 CreditLens 사건·파일 저장소에는 보관되지 않습니다. PDF는 브라우저 탭에만 남습니다. 포트폴리오 체험에는 가상기업 예시를 권장합니다."
    : "로컬판: 기업명·CSV 수치·신청액·감사 및 사업 입력 메모는 이 PC의 분석 서버에서 처리하며 사건·파일 저장소에는 보관되지 않습니다. PDF는 브라우저 탭에만 남습니다.";
}).catch(() => { $("#manual-status").textContent = "서버 상태를 확인하지 못했습니다. 분석 버튼을 누르기 전에 연결을 확인해 주세요."; });
