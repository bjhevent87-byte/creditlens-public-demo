import { renderFullReport, renderFullReportDocument } from "./final-report.js";
import { buildPrivateReportModel } from "./private-report-model.js";

const $ = (selector) => document.querySelector(selector);
const pdfEvidence = [];
let currentAnalysis = null;
let sourceCaseKey = "";
let reviewCorrections = [];
let inspectionAnswers = {};
let inspectionSummary = "";
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
  const question = key === "workingCapital" ? "실제 매입→판매→회수 기간 안에 상환할 수 있는가" : "투자 집행→가동→매출전환 이후 원리금을 감당할 수 있는가";
  const rules = Array.isArray(item.appliedRules) ? item.appliedRules : [];
  return `<article class="manual-purpose"><div class="manual-purpose-head"><div><small>${key === "workingCapital" ? "SHORT TERM / 회전자금" : "LONG TERM / 투자자금"}</small><h3>${label}</h3></div><strong>${Number(item.requested).toLocaleString("ko-KR")}억원</strong></div><p class="manual-purpose-term">신청기간 ${Number.isFinite(Number(term)) ? `${Number(term).toLocaleString("ko-KR")}개월` : "미입력"} · ${escapeHtml(question)}</p><p class="manual-purpose-stance">${blocked ? "필수 오류 해소 전 · 잠정 수치만 표시" : escapeHtml(item.stance)}. 신청액의 적정성이나 승인조건을 자동 확정하지 않습니다.</p><div class="manual-rule-list">${rules.map((rule, index) => `<details class="manual-rule" ${index === 0 ? "open" : ""}><summary><span><b>${escapeHtml(rule.title)}</b><small>${escapeHtml(rule.formula)}</small></span><strong>${escapeHtml(rule.result)}</strong></summary><div><p><b>실제 계산</b> ${escapeHtml(rule.calculation)}</p><p><b>현재 해석</b> ${escapeHtml(rule.interpretation)}</p><p><b>담당자 확인</b> ${escapeHtml(rule.check)}</p><p class="manual-rule-caveat">${escapeHtml(rule.explanation)}</p></div></details>`).join("")}</div></article>`;
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
  target.innerHTML = `<div class="manual-scenario-metrics">${rows.map(([name, base, assumed, gap]) => `<article><span>${name}</span><small>제출값 ${money(base)}</small><strong>가정값 ${money(assumed)}</strong><em>차이 ${signedMoney(gap)}</em></article>`).join("")}</div><p class="manual-scenario-margin">영업이익률 ${metricValue(result.baseline.operatingMargin, "%")} → ${metricValue(result.stressed.operatingMargin, "%")} · 고객 제출 연간 실적을 기준으로 한 산술 예시입니다.</p><details class="manual-scenario-proof"><summary>계산식·대입값 보기</summary>${(result.calculationSteps || []).map((step) => `<p><b>${escapeHtml(step.label)}</b> · ${escapeHtml(step.formula)}<br>${escapeHtml(step.substitution)} = ${money(step.result)}</p>`).join("")}</details><p class="manual-method-note">신규대출 원리금, 실제 영업현금, 승인가능 금액은 계산하지 않습니다. 매출·이익이 늘어도 상환능력 개선을 자동 확정하지 않습니다.</p>`;
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
  $("#manual-results").innerHTML = `<div class="manual-result-head"><div><span class="manual-badge">${escapeHtml(analysis.manualReview?.sourceStatus || "고객제출 CSV · 원본 대조 전")}${blocked ? " · 오류 해결 전" : ""}</span><h2>${escapeHtml(analysis.company?.name)} · 차주 상환능력</h2><p>${escapeHtml(records[0]?.period)}~${escapeHtml(latest.period)}년 ${analysis.primaryFsDiv === "CFS" ? "연결 · 그룹" : "별도 · 차주"} 입력자료 · 최근 비교 ${escapeHtml(previous.period)} → ${escapeHtml(latest.period)} · 단위 억원</p></div></div>
    ${blocked ? `<p class="manual-blocked-note"><b>필수 원본 대조 과제 ${issues.filter((item) => item.severity === "blocking").length}건</b> · 아래 숫자는 고객 제출 CSV로 계산한 잠정값입니다. 개선·약화 및 여신 판단은 오류 수정·재계산 전까지 보류합니다. <a href="#manual-review">수정 과제로 이동 →</a></p>` : ""}
    <div class="manual-kpis"><article><span>매출액</span><strong>${money(latest.revenue)}</strong><small>${comparisonText(latest.revenue, previous.revenue)}</small></article><article><span>영업이익</span><strong>${money(latest.operatingProfit)}</strong><small>${comparisonText(latest.operatingProfit, previous.operatingProfit)}</small></article><article><span>영업활동현금흐름</span><strong>${signedMoney(latest.operatingCashFlow)}</strong><small>${comparisonText(latest.operatingCashFlow, previous.operatingCashFlow)}</small></article><article><span>부채비율</span><strong>${Number.isFinite(latest.debtRatio) ? `${latest.debtRatio.toFixed(1)}%` : "자료없음"}</strong><small>${escapeHtml(latest.period)}년 부채총계 ÷ 자본총계 × 100 · ${blocked ? "검증 대기" : "잠정"}</small></article></div>
    <section class="manual-subsection" id="manual-financials"><div class="section-heading compact"><div><p class="eyebrow">BORROWER FINANCIALS / 3 YEARS</p><h3>3개년 재무·현금흐름</h3><p>최신 연도를 왼쪽에 두고 손익·재무상태·세 활동 현금흐름을 함께 봅니다.</p></div></div>${renderStatementTable(records, coreRows)}<details class="manual-full-accounts"><summary>고객 제출 전체 계정 ${detailRows.length}개 보기</summary>${renderStatementTable(records, detailRows)}</details><div class="manual-validation"><h4>입력값 자동 검산</h4><ul>${validations.map((item) => `<li>${escapeHtml(item.period)}년 · 자산=부채+자본 <b>${escapeHtml(item.balanceSheet)}</b> · 세 활동 현금흐름과 현금증감 <b>${escapeHtml(item.cashFlow)}</b></li>`).join("") || "<li>검산 자료 없음</li>"}</ul><p>현금흐름 합계와 현금잔액 증감은 환율효과·연결범위 등 조정항목 때문에 다를 수 있습니다. 차이는 원문에서 확인합니다.</p></div></section>
    <section class="manual-subsection" id="manual-cashflow"><div class="section-heading compact"><div><p class="eyebrow">THREE CASH-FLOW ACTIVITIES</p><h3>현금은 어디에서 들어오고 나갔나</h3><p>가운데 0축 기준 오른쪽은 유입, 왼쪽은 유출입니다. 투자·재무활동의 부호만으로 좋고 나쁨을 판정하지 않습니다.</p></div></div><div class="manual-cash-years">${[...records].reverse().map((row) => renderCashFlowYear(row, maxCashFlow)).join("")}</div><div class="manual-cash-bridge"><div><span>${escapeHtml(latest.period)}년 세 활동 합계</span><strong>${signedMoney(latest.cashFlowSubtotal)}</strong></div><div><span>기말 현금 증감 · ${escapeHtml(previous.period)} → ${escapeHtml(latest.period)}</span><strong>${signedMoney(latest.cashBalanceChange)}</strong></div><div><span>차이 · 원문 조정항목 확인</span><strong>${signedMoney(latest.cashFlowReconciliationGap)}</strong></div></div><div class="manual-cash-insights">${cashInsights.map((insight) => `<article><b>${escapeHtml(insight.title)}</b><p>${escapeHtml(insight.meaning)}</p><small>확인자료: ${escapeHtml((insight.checks || []).join(" · "))}</small></article>`).join("")}</div></section>
    <section class="manual-subsection manual-performance" id="manual-performance"><div class="section-heading compact"><div><p class="eyebrow">MANAGEMENT PERFORMANCE</p><h3>경영성과 5개 영역</h3><p>${escapeHtml(previous.period)}년 → ${escapeHtml(latest.period)}년 · 모든 방향 판정은 입력값과 원본 대조 상태를 전제로 합니다.</p></div></div><div class="manual-dimension-grid">${dimensions.map((item) => { const keyMetric = (item.metrics || []).find((metric) => metric.trend?.className === "weakening") || (item.metrics || []).find((metric) => Number.isFinite(metric.latest)) || (item.metrics || [])[0]; return `<button type="button" class="manual-dimension ${blocked ? "unknown" : escapeHtml(item.status?.className || "unknown")}" data-manual-dimension="${escapeHtml(item.id)}"><span>${escapeHtml(item.name)}</span><strong>${blocked ? "판정 보류" : escapeHtml(item.status?.label || "자료부족")}</strong><small>${keyMetric ? `${escapeHtml(keyMetric.label)} ${metricValue(keyMetric.latest, keyMetric.unit)}` : "비교자료 없음"}</small><em>지표·계산 근거 보기 →</em></button>`; }).join("")}</div><div class="manual-performance-details">${dimensions.map((item) => `<details id="manual-detail-${escapeHtml(item.id)}"><summary><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.question)}</span><strong>${blocked ? "검증 전" : escapeHtml(item.status?.label || "자료부족")}</strong></summary><div class="manual-metric-list">${(item.metrics || []).map((metric) => renderPerformanceMetric(metric, records, blocked)).join("")}</div></details>`).join("")}</div><p class="manual-method-note">자동 분류 기준: ${escapeHtml(analysis.performance?.rule || "전년 비교 가능 수치만 방향을 분류합니다.")} 고객 제출자료는 공시 원문 자동 검증이 아닙니다.</p></section>
    <section class="manual-subsection manual-diagnosis"><div class="section-heading compact"><div><p class="eyebrow">CAUSES TO VERIFY</p><h3>변화 원인 가설과 확인 순서</h3><p>관찰된 수치와 가능한 원인을 분리합니다. 아래 원인은 확정 사실이 아닙니다.</p></div></div>${blocked ? `<p class="manual-blocked-note">입력 불일치를 먼저 해소한 뒤 가설을 다시 계산합니다.</p>` : `<div class="manual-hypothesis-grid">${hypotheses.slice(0, 4).map((item) => `<article><small>${escapeHtml(item.priority)}</small><h4>${escapeHtml(item.category)}</h4><p><b>관찰</b> ${escapeHtml(item.observation)}</p><p><b>가설</b> ${escapeHtml(item.hypothesis)}</p><ul>${(item.verificationSteps || []).map((step) => `<li><b>${escapeHtml(step.title)}</b> · ${escapeHtml(step.data)}<br>${escapeHtml(step.question)}</li>`).join("")}</ul></article>`).join("")}</div>`}</section>
    <section class="manual-subsection manual-business-evidence"><div class="section-heading compact"><div><p class="eyebrow">BUSINESS / SOURCE FIRST</p><h3>사업·감사 근거</h3><p>고객 제출자료·면담을 담당자가 적은 내용입니다. 원문 페이지가 있어도 플랫폼이 내용의 진위를 검증한 것은 아닙니다.</p></div></div><div class="manual-audit-row"><b>감사의견 입력</b><strong>${escapeHtml(audit.opinion || "미확인")}</strong><span>${escapeHtml(audit.reportDate || "보고서일 미입력")} · ${escapeHtml(audit.sourcePage || "원문 위치 미입력")}</span></div>${businessEvidence.length ? `<div class="manual-business-grid">${businessEvidence.map((item) => `<article><h4>${escapeHtml(item.label)}</h4><p>${escapeHtml(item.text)}</p><small>담당자 입력 · 출처: ${escapeHtml(item.source || "미기재")}</small></article>`).join("")}</div>` : `<p class="manual-empty-inline">사업·거래처·경영진·업종 노출 설명이 아직 입력되지 않았습니다. 고객 자료와 면담 근거를 확인하면 보고서에 함께 담을 수 있습니다.</p>`}</section>
    <section class="manual-subsection" id="manual-purpose-review"><div class="section-heading compact"><div><p class="eyebrow">LOAN PURPOSE ANALYSIS</p><h3>요청 여신별 예비검토</h3><p>운전자금은 회전·단기 회수재원, 시설자금은 투자성과·장기 현금창출력을 별도로 검토합니다.</p></div></div><div class="manual-purpose-grid">${renderPurposeCard(analysis, "workingCapital", "운전자금", analysis.loanRequest?.workingTermMonths, blocked)}${renderPurposeCard(analysis, "facility", "시설자금", analysis.loanRequest?.facilityTermMonths, blocked)}${!analysis.decisionSupport?.workingCapital?.requested && !analysis.decisionSupport?.facility?.requested ? `<p class="manual-empty-inline">요청금액을 입력하면 자금용도별 검토 근거가 나옵니다.</p>` : ""}</div></section>
    <section class="manual-subsection manual-scenario" id="manual-scenario"><div class="section-heading compact"><div><p class="eyebrow">SIMPLE SENSITIVITY / NOT A LOAN LIMIT</p><h3>매출·영업이익 단순 민감도</h3><p>기업금융 담당자가 추가 서류 없이 매출 변화와 영업이익률 변화만 가정해 볼 수 있습니다. 미래 예측·상환한도는 아닙니다.</p></div></div><div class="manual-scenario-controls"><label>매출 변화 <output id="manual-sales-value">기준 0%</output><input id="manual-sales-shock" type="range" min="-30" max="30" step="1" value="0" /><small>감소 -30% · 기준 0 · 증가 +30%</small></label><label>영업이익률 변화 <output id="manual-margin-value">기준 0.0%p</output><input id="manual-margin-shock" type="range" min="-20" max="20" step="0.5" value="0" /><small>하락 -20%p · 기준 0 · 상승 +20%p</small></label><button class="secondary-button" id="manual-scenario-recalculate" type="button">가정값 재계산</button></div><div id="manual-scenario-result" aria-live="polite"><p class="manual-empty-inline">매출과 영업이익률의 변화 가정을 계산하는 중입니다.</p></div></section>
    <p class="manual-result-note">PDF ${pdfEvidence.length}건은 이 브라우저 탭에서만 원본 대조용으로 선택했습니다. 파일 내용은 서버에 전송·저장하지 않았고, 숫자도 PDF에서 자동 추출하지 않았습니다. CSV 계정 정의·감사의견·주석상 차입만기·담보·보증 및 월별 현금수지는 담당자가 원본과 대조해야 합니다. 이 결과는 승인·거절이나 적정 대출금액 제안이 아닙니다.</p>`;
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
  const issues = analysis.manualReview?.issues || [];
  const changes = analysis.manualReview?.changes || [];
  const blocking = issues.filter((issue) => issue.severity === "blocking").length;
  $("#manual-review").hidden = false;
  $("#manual-review").innerHTML = `<h2>원본 대조·수정 과제</h2><p>오류를 계산에서 숨기지 않습니다. 원본 페이지를 확인한 담당자가 값을 수정한 뒤 재계산할 수 있습니다. 수정 입력은 PDF 자동 검증을 의미하지 않습니다.</p>
    <div class="manual-review-summary"><strong>필수 오류 ${blocking}건</strong><strong>추가 확인 ${issues.length - blocking}건</strong><strong>담당자 수정 ${changes.length}건</strong></div>
    <div class="manual-issue-list">${issues.length ? issues.map((issue) => `<article class="manual-issue ${issue.severity === "blocking" ? "blocking" : ""}"><h3>${escapeHtml(issue.title)}</h3><small>${escapeHtml(issue.period || "출처·범위")} · ${issue.severity === "blocking" ? "판단 보류" : "원본 확인"}</small><p>${escapeHtml(issue.detail)}</p><p><b>영향:</b> ${escapeHtml((issue.affects || []).join(" · ") || "출처 신뢰성")}</p>${issue.fields?.length ? `<div class="manual-correction-grid">${issue.fields.map((field) => `<label>${escapeHtml(fieldLabels[field] || field)} · ${escapeHtml(issue.period)}년<input type="text" inputmode="decimal" data-review-period="${escapeHtml(issue.period)}" data-review-field="${escapeHtml(field)}" value="${escapeHtml(issue.values?.[field] || "")}" placeholder="원문 대조 후 입력" /></label>`).join("")}<label>원문 페이지<input type="text" data-review-page="${escapeHtml(issue.id)}" placeholder="예: 감사보고서 p.12" /></label><label>수정 근거<input type="text" data-review-note="${escapeHtml(issue.id)}" placeholder="계정명·단위 차이 기록" /></label></div>` : ""}</article>`).join("") : `<div class="manual-empty">자동 검산 오류는 없습니다. 원본과 입력값의 일치·감사의견·주석은 별도로 확인해야 합니다.</div>`}</div>
    ${changes.length ? `<h3>수정 이력 · 이 화면에만 유지</h3><ul>${changes.map((item) => `<li>${escapeHtml(item.period)}년 ${escapeHtml(fieldLabels[item.field] || item.field)}: ${money(item.previous)} → ${money(item.current)} · ${escapeHtml(item.page || "원문 페이지 미기재")} · ${escapeHtml(item.note || "근거 미기재")}</li>`).join("")}</ul>` : ""}
    <div class="manual-review-actions"><button class="primary-button" id="manual-recalculate" type="button">원문 대조값 적용·재계산 →</button><p>계정값을 수정하지 않았다면 검증 과제는 그대로 남습니다.</p></div>`;
  $("#manual-recalculate").addEventListener("click", () => {
    const updates = new Map(reviewCorrections.map((item) => [`${item.period}:${item.field}`, item]));
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
    if (state) state.textContent = inspectionComplete(answer) ? "관찰·근거·후속조치 기록 완료 · 증빙 진위는 별도 확인" : answer.status && answer.status !== "미확인" ? "판단만 선택됨 · 관찰한 사실·근거·후속조치를 모두 적어야 기록 완료" : "현장 확인 전";
  });
}

function renderInspection(analysis) {
  const items = Array.isArray(analysis.inspection) ? analysis.inspection : [];
  $("#manual-print-inspection").disabled = items.length === 0;
  $("#manual-inspection-content").innerHTML = `<div class="manual-result-head"><div><h2>${escapeHtml(analysis.company?.name)} 현장실사 점검표</h2><p>공통 관리 → 업종 → 재무 위험신호 → 요청자금 목적에 따라 ${items.length}개 항목을 생성했습니다.</p></div><strong class="manual-inspection-progress" id="manual-inspection-progress"></strong></div><div class="manual-inspection-list">${items.map((item) => {
    const answer = inspectionAnswers[item.ruleId] || {};
    const files = inspectionEvidence.get(item.ruleId) || [];
    const [observationHint, evidenceHint, actionHint] = inspectionHints(item);
    return `<article class="manual-inspection-item" data-inspection-id="${escapeHtml(item.ruleId)}"><div class="manual-inspection-item-head"><span>${escapeHtml(item.category)}<small>${escapeHtml(item.ruleSource)}</small></span><div><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.reason)}</p></div><label>현장 판단<select data-inspection-field="status">${["미확인", "정상 확인", "우려 확인", "자료 요청"].map((status) => `<option${(answer.status || "미확인") === status ? " selected" : ""}>${status}</option>`).join("")}</select></label></div><div class="manual-inspection-fields"><label>관찰한 사실<textarea data-inspection-field="observation" maxlength="2000" placeholder="${escapeHtml(observationHint)}">${escapeHtml(answer.observation || "")}</textarea></label><div class="manual-inspection-evidence"><label>확인 근거·증빙<textarea data-inspection-field="evidence" maxlength="2000" placeholder="${escapeHtml(evidenceHint)}">${escapeHtml(answer.evidence || "")}</textarea></label><label>사진·스캔 PDF 선택<input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple data-inspection-files /><small>최대 3개 · 파일당 10MB · 브라우저 탭 안에서만 열람 · 자동 판독 없음</small></label><div class="manual-evidence-list">${files.map((file) => `<a href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.name)} ↗</a>`).join("") || "선택한 파일 없음"}</div></div><label>심사 영향·후속조치<textarea data-inspection-field="action" maxlength="2000" placeholder="${escapeHtml(actionHint)}">${escapeHtml(answer.action || "")}</textarea></label></div><small class="manual-inspection-entry-state" data-inspection-state></small></article>`;
  }).join("")}</div><label class="manual-inspection-summary">현장실사 종합 메모<textarea id="manual-inspection-summary" rows="4" maxlength="3000" placeholder="최초 우려 → 현장 관찰·증빙 → 해소 여부 → 심사역 전달 사항을 구분해 기록하세요.">${escapeHtml(inspectionSummary)}</textarea></label><p class="manual-result-note">현장 기록과 선택한 사진·PDF는 현재 브라우저 탭에만 남습니다. OCR·서버 저장은 하지 않습니다. 실제 고객자료 보관에는 조직의 승인된 절차를 따르세요.</p>`;
  $("#manual-inspection-content").querySelectorAll("[data-inspection-field]").forEach((input) => input.addEventListener("input", () => {
    const id = input.closest("[data-inspection-id]").dataset.inspectionId;
    inspectionAnswers[id] ||= {};
    inspectionAnswers[id][input.dataset.inspectionField] = input.value;
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
    scenario: manualScenarioResult ? {
      name: "고객 제출 연간 재무 · 매출·영업이익 단순 민감도",
      assumptions: `매출 ${Number(manualScenarioResult.assumptions?.salesShockPct) > 0 ? "+" : ""}${manualScenarioResult.assumptions?.salesShockPct ?? 0}%, 영업이익률 ${Number(manualScenarioResult.assumptions?.marginShockPp) > 0 ? "+" : ""}${manualScenarioResult.assumptions?.marginShockPp ?? 0}%p`,
      results: manualScenarioResult.available ? `매출 ${money(manualScenarioResult.baseline.revenue)} → ${money(manualScenarioResult.stressed.revenue)}, 영업이익 ${money(manualScenarioResult.baseline.operatingProfit)} → ${money(manualScenarioResult.stressed.operatingProfit)}` : `계산 보류 · ${manualScenarioResult.missingInputs?.join(" · ") || manualScenarioResult.interpretation}`,
      interpretation: manualScenarioResult.available ? "고객 제출 연간 수치에 선택한 매출·이익률 변화만 적용한 산술 예시입니다. 실제 현금 유입과 원리금 상환을 검증하지 않았습니다." : manualScenarioResult.interpretation,
      limitations: "원본 대조 전 수치는 잠정값입니다. 신규대출 원리금·월별 현금수지·승인가능 금액·담보조건은 계산하지 않습니다.",
    } : null,
  });
}

function renderManualFinalReport() {
  if (!currentAnalysis) return;
  $("#manual-final-report").innerHTML = renderFullReport(currentPrivateReportModel());
}

async function performAnalysis() {
  manualScenarioRequestId += 1;
  const file = $("#manual-csv").files?.[0];
  if (!file || file.size > 150_000) { $("#manual-status").textContent = "150KB 이하의 CSV를 선택해 주세요."; return; }
  const csvText = await file.text();
  const caseKey = JSON.stringify([csvText, $("#manual-name").value.trim(), $("#manual-industry").value.trim(), $("#manual-basis").value]);
  if (sourceCaseKey && sourceCaseKey !== caseKey) {
    reviewCorrections = []; inspectionAnswers = {}; inspectionSummary = "";
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
    renderReview(result);
    renderResult(result);
    renderInspection(result);
    renderOpinion(result);
    calculateManualScenario();
    const issues = result.manualReview?.issues || [];
    $("#manual-status").textContent = `입력값을 계산하고 검증 과제 ${issues.length}건을 표시했습니다. 원본과 대조 전이므로 모든 해석은 잠정입니다.`;
    showManualPage("analysis");
    $("#manual-review").scrollIntoView({ behavior: "smooth", block: "start" });
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
  renderManualFinalReport();
  window.print();
});

$("#manual-save-report").addEventListener("click", async () => {
  if (!currentAnalysis) return;
  const button = $("#manual-save-report");
  button.disabled = true;
  try {
    const model = currentPrivateReportModel();
    const html = await renderFullReportDocument(model);
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
  $("#manual-transfer-note").textContent = health.publicDemo
    ? "공개 체험판: 기업명·CSV 수치·신청액·감사 및 사업 입력 메모는 분석 요청 시 Vercel 서버로 전송되지만 CreditLens 사건·파일 저장소에는 보관되지 않습니다. PDF는 브라우저 탭에만 남습니다. 포트폴리오 체험에는 가상기업 예시를 권장합니다."
    : "로컬판: 기업명·CSV 수치·신청액·감사 및 사업 입력 메모는 이 PC의 분석 서버에서 처리하며 사건·파일 저장소에는 보관되지 않습니다. PDF는 브라우저 탭에만 남습니다.";
}).catch(() => { $("#manual-status").textContent = "서버 상태를 확인하지 못했습니다. 분석 버튼을 누르기 전에 연결을 확인해 주세요."; });
