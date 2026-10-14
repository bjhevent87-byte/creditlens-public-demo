const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  selectedCompany: null,
  analysis: null,
  stress: null,
  report: "opinion",
  loanView: "integrated",
  financialView: null,
  performanceView: null,
  analysisDetailView: "financial",
  statementScope: "OFS",
  inspectionStatus: {},
  inspectionDetails: {},
  inspectionMemory: {},
  structure: null,
  reviewOutcome: null,
  findingReviews: {},
  attachments: [],
  industryEvidence: [],
  kosisTables: [],
  kosisSeries: [],
  pendingKosisSeries: null,
  debtRegister: [],
  caseId: null,
  caseRevision: 0,
  publicDemo: false,
};

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function formatMoney(value, digits = 0) {
  if (!hasNumber(value)) return "자료없음";
  return `${(Number(value) / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: digits })}억원`;
}

function formatSignedMoney(value, digits = 0) {
  if (!hasNumber(value)) return "자료없음";
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${formatMoney(value, digits)}`;
}

function formatNumber(value, digits = 1, suffix = "") {
  if (!hasNumber(value)) return "자료없음";
  return `${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}${suffix}`;
}

function changeText(value, suffix = "%") {
  if (!hasNumber(value)) return "비교값 없음";
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${formatNumber(Number(value), 1, suffix)}`;
}

function periodLabel(records = state.analysis?.records || []) {
  const latest = records.at(-1)?.period;
  const previous = records.at(-2)?.period;
  return previous && latest ? `${previous} → ${latest}` : latest || "비교기간 없음";
}

function industryProfile() {
  const text = `${state.analysis?.company?.industry || ""} ${state.analysis?.company?.companyInfo?.induty_code || ""}`;
  const code = (text.match(/\b(\d{2,5})\b/) || [])[1] || "";
  if (/대형마트|소매|유통|도매/.test(text) || /^(45|46|47)/.test(code)) return {
    id: "retail", label: "도·소매/유통업",
    focus: ["소매판매액지수", "서비스업생산지수", "소비자심리", "물가·금리", "온라인쇼핑 거래"],
    macroIds: ["kr-base-rate", "kr-cpi", "kr-ccsi"],
    site: "점포 생산성·재고회전·상권·임대차·온라인 전환을 중심으로 확인합니다.",
  };
  if (/건설|부동산/.test(text) || /^(41|42|68)/.test(code)) return {
    id: "construction", label: "건설/부동산업",
    focus: ["건설수주", "건설기성", "미분양", "금리", "공사비"],
    macroIds: ["kr-base-rate", "kr-3y", "kr-cpi", "kr-industrial-production"],
    site: "인허가·공정률·원가초과·분양 및 임대계획·시공능력을 중심으로 확인합니다.",
  };
  if (/정보|소프트웨어|연구|기술|바이오/.test(text) || /^(58|59|60|61|62|63|70|71|72)/.test(code)) return {
    id: "technology", label: "기술/지식서비스업",
    focus: ["R&D 투자", "핵심인력", "특허", "상용화 단계", "현금소진기간"],
    macroIds: ["kr-base-rate", "kr-3y", "kr-ccsi", "kr-industrial-production"],
    site: "핵심인력·기술권리·개발단계·고객검증·상용화 일정을 중심으로 확인합니다.",
  };
  if (/제조/.test(text) || /^(1[0-9]|2[0-9]|3[0-4])/.test(code)) return {
    id: "manufacturing", label: "제조업",
    focus: ["업종별 생산", "출하·재고", "가동률", "수출", "원재료가격"],
    macroIds: ["kr-base-rate", "kr-3y", "usd-krw", "export-volume", "manufacturing-bsi"],
    site: "생산능력·가동률·설비상태·품질관리·실재재고를 중심으로 확인합니다.",
  };
  return {
    id: "general", label: "일반 기업",
    focus: ["기준금리", "경기동향", "업종 생산·매출", "고용", "물가"],
    macroIds: ["kr-base-rate", "kr-3y", "kr-cpi", "kr-ccsi", "kr-industrial-production"],
    site: "경영진·핵심인력·주요 거래처·영업현장·제출자료의 일치 여부를 확인합니다.",
  };
}

function requestPayload(demo = false) {
  return {
    demo,
    corpCode: state.selectedCompany?.corpCode,
    endYear: Number($("#end-year").value),
    loanRequest: {
      workingAmount: Number($("#working-amount").value),
      facilityAmount: Number($("#facility-amount").value),
      workingTermMonths: Number($("#working-term").value),
      facilityTermMonths: Number($("#facility-term").value),
      workingRatePct: $("#working-rate").value === "" ? null : Number($("#working-rate").value),
      facilityRatePct: $("#facility-rate").value === "" ? null : Number($("#facility-rate").value),
      workingRateType: $("#working-rate-type").value,
      facilityRateType: $("#facility-rate-type").value,
      workingRepayment: $("#working-repayment").value,
      facilityRepayment: $("#facility-repayment").value,
      facilityGraceMonths: Number($("#facility-grace").value),
      purpose: $("#purpose").value,
    },
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `요청 실패 (${response.status})`);
  return payload;
}

async function loadConfig() {
  const [health, config] = await Promise.all([fetchJson("/api/health"), fetchJson("/api/config")]);
  const configured = config.services.filter((item) => item.configured).length;
  $("#api-summary").textContent = `${configured}/${config.services.length}개 데이터 연결`;
  $("#basis-date").textContent = `기준일 ${health.basisDate}`;
  $("#api-stack").innerHTML = config.services.map((item) => `<span class="api-chip ${item.configured ? "on" : ""}">${escapeHtml(item.name)} · ${item.configured ? "연결" : escapeHtml(item.status || "키 필요")}</span>`).join("");
  if (health.publicDemo) {
    state.publicDemo = true;
    document.body.classList.add("public-demo");
    const notice = document.createElement("span");
    notice.className = "demo-notice";
    notice.textContent = "공개 체험판";
    notice.title = "사건·증빙 서버 저장이 비활성화되어 있습니다. 실제 고객정보를 입력하지 마세요.";
    document.querySelector(".top-meta").prepend(notice);
    $("#privacy-note").hidden = false;
  } else {
    loadSavedCases().catch(() => { $("#saved-cases").textContent = "저장된 사건을 불러오지 못했습니다."; });
  }
}

function initializeForm() {
  const currentYear = new Date().getFullYear();
  $("#end-year").innerHTML = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map((year, index) => `<option value="${year}" ${index === 0 ? "selected" : ""}>${year}년</option>`).join("");
}

let searchTimer;
$("#company-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = $("#company-search").value.trim();
  if (query.length < 2) { $("#search-results").hidden = true; return; }
  searchTimer = setTimeout(async () => {
    try {
      const { companies } = await fetchJson(`/api/companies?q=${encodeURIComponent(query)}`);
      $("#search-results").innerHTML = companies.length ? companies.map((company) => `<button type="button" data-corp="${company.corpCode}" data-name="${escapeHtml(company.name)}" data-stock="${company.stockCode}"><b>${escapeHtml(company.name)}</b><span>${company.stockCode} · DART ${company.corpCode}</span></button>`).join("") : `<p class="no-risk">검색 결과가 없습니다.</p>`;
      $("#search-results").hidden = false;
    } catch (error) { setStatus(error.message, true); }
  }, 240);
});

$("#search-results").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-corp]");
  if (!button) return;
  state.selectedCompany = { corpCode: button.dataset.corp, name: button.dataset.name, stockCode: button.dataset.stock };
  $("#company-search").value = button.dataset.name;
  $("#selected-company").textContent = `${button.dataset.name} · ${button.dataset.stock} · DART ${button.dataset.corp}`;
  $("#search-results").hidden = true;
});

function setStatus(message, error = false) {
  $("#form-status").textContent = message;
  $("#form-status").classList.toggle("error", error);
}

async function analyze(demo = false) {
  if (!demo && !state.selectedCompany) return setStatus("기업을 검색해 선택해 주세요.", true);
  setStatus("공식 자료를 수집하고 재무·현금흐름 관계를 계산하는 중입니다.");
  const submit = $("#analysis-form button[type='submit']");
  submit.disabled = true;
  try {
    const analysis = await fetchJson("/api/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestPayload(demo)),
    });
    if (analysis.schemaVersion !== 2 || !analysis.statementViews || !Array.isArray(analysis.performance?.hypotheses?.[0]?.verificationSteps)) {
      throw new Error("실행 중인 4180 서버가 이전 버전입니다. START_LOCAL.cmd를 다시 실행한 뒤 새로고침해 주세요.");
    }
    const sameCompany = state.analysis?.company?.corpCode === analysis.company.corpCode;
    state.analysis = analysis;
    state.selectedCompany = state.analysis.company;
    state.statementScope = state.analysis.primaryFsDiv || "OFS";
    state.financialView = null;
    state.performanceView = null;
    state.analysisDetailView = "financial";
    state.inspectionStatus = {};
    state.inspectionDetails = {};
    state.inspectionMemory = {};
    state.structure = null;
    state.stress = null;
    state.reviewOutcome = null;
    if (!sameCompany) {
      state.report = "opinion";
      state.findingReviews = {};
      state.attachments.filter((file) => file.sessionOnly && file.objectUrl).forEach((file) => URL.revokeObjectURL(file.objectUrl));
      state.attachments = [];
      state.industryEvidence = [];
      state.debtRegister = [];
      $("#debt-register-complete").checked = false;
      delete $("#existing-variable-share").dataset.auto;
      for (const id of ["opening-cash", "minimum-cash", "monthly-cash", "monthly-existing", "annual-cash", "annual-existing"]) $("#" + id).value = "";
      if (!demo) { $("#existing-variable-share").value = ""; $("#credit-sales-share").value = ""; }
      state.caseId = null;
      state.caseRevision = 0;
    }
    renderAnalysis();
    document.body.classList.remove("show-inquiry");
    $("#analysis-search-toggle").setAttribute("aria-expanded", "false");
    $("#analysis-search-toggle").textContent = "분석 조건 변경";
    setStatus(`${state.analysis.company.name} 분석이 완료되었습니다.`);
    $("#overview").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStatus(error.message, true);
  } finally { submit.disabled = false; }
}

$("#analysis-form").addEventListener("submit", (event) => { event.preventDefault(); analyze(false); });
$("#demo-button").addEventListener("click", () => {
  $("#purpose").value = "원재료 매입 운전자금 10억원 및 신규 생산라인 시설자금 100억원";
  $("#working-amount").value = 10;
  $("#facility-amount").value = 100;
  $("#working-rate").value = 5;
  $("#facility-rate").value = 5.5;
  $("#existing-variable-share").value = 50;
  $("#credit-sales-share").value = 80;
  analyze(true);
});

function severity() {
  const flags = state.analysis.assessment.redFlags;
  if (flags.some((item) => item.level === "danger")) return { label: "중점 확인", className: "danger" };
  if (flags.some((item) => item.level === "warning")) return { label: "주의", className: "warning" };
  return { label: "일반 확인", className: "ok" };
}

function renderAnalysis() {
  const analysis = state.analysis;
  document.body.classList.add("has-analysis");
  const hasWorking = Number(analysis.loanRequest.workingAmount) > 0;
  const hasFacility = Number(analysis.loanRequest.facilityAmount) > 0;
  state.loanView = hasWorking && hasFacility ? "integrated" : hasWorking ? "working" : "facility";
  $("#empty-state").hidden = true;
  $("#analysis-content").hidden = false;
  selectWorkflow("analysis", false);
  $("#analysis-mode").textContent = analysis.mode;
  $("#company-title").textContent = analysis.company.name;
  $("#company-subtitle").textContent = `${analysis.company.industry || "업종 확인 필요"} · ${analysis.company.stockCode || "비상장"} · DART ${analysis.company.corpCode}`;
  renderStatementSwitch();
  $("#freshness").textContent = `생성 ${new Date(analysis.generatedAt).toLocaleString("ko-KR")}`;
  const quality = analysis.dataQuality;
  const interimForBasis = latestInterimView(analysis);
  const selectedInterim = interimForBasis && Number(interimForBasis.period.slice(0, 4)) === Number(analysis.dataQuality?.requestedYear) ? interimForBasis : null;
  const annualRange = analysis.records.length ? `${analysis.records[0].period}~${analysis.records.at(-1).period}년` : "가용 연도";
  $("#financial-period-note").textContent = selectedInterim ? `같은 기간 비교: ${selectedInterim.comparisonPeriod || "전년 동기"} → ${selectedInterim.period}. ${annualRange} 연간 추세는 별도 탭입니다.` : `${annualRange} 연간 사업보고서 비교입니다. 선택 연도의 중간재무 비교자료가 없으면 연간 수치만 표시합니다.`;
  $("#performance-period-note").textContent = selectedInterim ? `${selectedInterim.comparisonPeriod || "전년 동기"} → ${selectedInterim.period} 성과를 먼저 봅니다. ${annualRange} 추세·원인 가설은 연간 탭에서 분리합니다.` : `${annualRange} 연간 추세와 ${periodLabel(analysis.records)} 변화를 판정합니다.`;
  $("#financial-basis").textContent = quality.yearFallback
    ? `연간 ${quality.annualPeriods.join(" / ")} · 최신 중간 ${interimForBasis?.period || "자료없음"} · 연간과 분리`
    : `${state.statementScope === "OFS" ? "별도(차주 법인)" : "연결(그룹)"} · ${analysis.records.map((row) => row.period).join(" / ")} · 원`;
  renderSummary();
  renderDecisionHome();
  renderRecentDisclosure();
  renderEvidenceTrace();
  renderCharts();
  renderFinancialTable();
  renderInterimFinancialTable(selectedInterim);
  if (!state.financialView || (!selectedInterim && state.financialView === "interim")) state.financialView = selectedInterim ? "interim" : "annual";
  setFinancialView(state.financialView, Boolean(selectedInterim));
  renderPerformance();
  renderInterimPerformance(selectedInterim);
  if (!state.performanceView || (!selectedInterim && state.performanceView === "interim")) state.performanceView = selectedInterim ? "interim" : "annual";
  setPerformanceView(state.performanceView, Boolean(selectedInterim));
  renderRisks();
  setAnalysisDetailView(state.analysisDetailView);
  renderMacro();
  renderIndustryCatalog();
  renderIndustryEvidence();
  renderLoans();
  renderDebtRegister();
  renderStructure();
  renderInspection();
  renderEvidenceReview();
  updateReviewOutcome().catch(() => {});
  $$(".report-tabs button").forEach((item) => item.classList.toggle("active", item.dataset.report === state.report));
  renderReport();
  updateUtilization();
  runStress();
}

function renderStatementSwitch() {
  const available = state.analysis.availableStatements || [state.analysis.primaryFsDiv || "OFS"];
  $("#statement-switch").innerHTML = available.map((fsDiv) => `<button type="button" class="${state.statementScope === fsDiv ? "active" : ""}" data-statement-scope="${fsDiv}">${fsDiv === "OFS" ? "별도 · 차주 법인" : "연결 · 그룹 위험"}</button>`).join("");
}

function applyStatementScope(fsDiv) {
  const view = state.analysis.statementViews?.[fsDiv];
  if (!view || fsDiv === state.statementScope) return;
  (state.analysis.inspection || []).forEach((item, index) => {
    if (!item.ruleId) return;
    state.inspectionMemory[item.ruleId] = { status: state.inspectionStatus[index] || "미확인", detail: state.inspectionDetails[index] || {} };
  });
  state.statementScope = fsDiv;
  for (const key of ["records", "cashFlowAnalysis", "performance", "assessment", "inspection", "decisionSupport"]) state.analysis[key] = view[key];
  state.inspectionStatus = Object.fromEntries((state.analysis.inspection || []).map((item, index) => [index, state.inspectionMemory[item.ruleId]?.status || "미확인"]));
  state.inspectionDetails = Object.fromEntries((state.analysis.inspection || []).map((item, index) => [index, state.inspectionMemory[item.ruleId]?.detail || {}]));
  renderAnalysis();
}

$("#statement-switch").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-statement-scope]");
  if (button) applyStatementScope(button.dataset.statementScope);
});

$("#analysis-search-toggle").addEventListener("click", () => {
  const expanded = document.body.classList.toggle("show-inquiry");
  $("#analysis-search-toggle").setAttribute("aria-expanded", String(expanded));
  $("#analysis-search-toggle").textContent = expanded ? "분석 조건 접기" : "분석 조건 변경";
  if (expanded) $("#analysis-form").scrollIntoView({ behavior: "smooth", block: "start" });
});

function setAnalysisDetailView(view) {
  const selected = ["financial", "risks", "credit"].includes(view) ? view : "financial";
  state.analysisDetailView = selected;
  $$("#analysis-detail-tabs button").forEach((button) => {
    const active = button.dataset.analysisDetail === selected;
    button.setAttribute("aria-selected", String(active));
    button.classList.toggle("active", active);
  });
  for (const key of ["financial", "risks", "credit"]) $("#analysis-" + key + "-panel").hidden = key !== selected;
}

$("#analysis-detail-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-analysis-detail]");
  if (button) setAnalysisDetailView(button.dataset.analysisDetail);
});

$("#financial-period-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-financial-view]");
  if (button) setFinancialView(button.dataset.financialView, !$("#interim-financial-panel").dataset.unavailable);
});

$("#performance-period-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-performance-view]");
  if (button) setPerformanceView(button.dataset.performanceView, !$("#interim-performance-panel").dataset.unavailable);
});

function summaryCardsMarkup(cards) {
  return cards.map((card) => `<article class="summary-card${card.headline ? ` interim-card ${escapeHtml(card.status.className)}` : ""}"><header><span class="label">${escapeHtml(card.label)}</span><span class="status ${escapeHtml(card.status.className)}">${escapeHtml(card.status.label)}</span></header>${card.headline ? `<div class="interim-headline"><small>전년 동기 대비</small><strong>${escapeHtml(card.headline)}</strong><span>${escapeHtml(card.value)}</span></div>` : `<strong>${escapeHtml(card.value)}</strong>`}${card.sideNote ? `<p class="scope-comparison">${escapeHtml(card.sideNote)}</p>` : ""}<details class="summary-evidence"><summary>산식·공시 근거 보기</summary><dl><div><dt>계산식</dt><dd>${escapeHtml(card.formula)}</dd></div><div><dt>대입값</dt><dd>${escapeHtml(card.input)}</dd></div><div><dt>비교기간</dt><dd>${escapeHtml(card.comparison)}</dd></div></dl><p>${escapeHtml(card.meaning)}</p></details></article>`).join("");
}

function renderSummary() {
  const latest = state.analysis.records.at(-1);
  const previous = state.analysis.records.at(-2);
  const interim = latestInterimView(state.analysis);
  const requestedYear = Number(state.analysis.dataQuality?.requestedYear);
  const interimYear = Number(String(interim?.period || "").slice(0, 4));
  if (interim && requestedYear === interimYear && requestedYear > Number(latest.period)) {
    const comparison = interim.comparisonPeriod ? `${interim.comparisonPeriod} → ${interim.period}` : `${interim.period} · 전년 동기 자료없음`;
    const coverage = Number.isFinite(interim.operatingProfit) && Number.isFinite(interim.financeCosts) && interim.financeCosts > 0 ? interim.operatingProfit / interim.financeCosts : null;
    const previousCoverage = Number.isFinite(interim.previousOperatingProfit) && Number.isFinite(interim.previousFinanceCosts) && interim.previousFinanceCosts > 0 ? interim.previousOperatingProfit / interim.previousFinanceCosts : null;
    const debtRatio = interimDebtRatio(interim);
    const previousDebtRatio = interimDebtRatio(interim, true);
    const otherScope = state.statementScope === "OFS" ? "CFS" : "OFS";
    const otherTrend = state.analysis.supplementary?.interimViews?.[otherScope]?.trend;
    const otherDebtRatio = otherTrend?.period === interim.period ? interimDebtRatio(otherTrend) : null;
    const scopeName = state.statementScope === "OFS" ? "별도(차주 법인)" : "연결(그룹)";
    const otherScopeName = otherScope === "OFS" ? "별도(차주 법인)" : "연결(그룹)";
    const coverageChange = Number.isFinite(coverage) && Number.isFinite(previousCoverage) ? coverage - previousCoverage : null;
    const debtRatioChange = Number.isFinite(debtRatio) && Number.isFinite(previousDebtRatio) ? debtRatio - previousDebtRatio : null;
    const cashHeadline = Number.isFinite(interim.operatingCashFlowGrowth) ? changeText(interim.operatingCashFlowGrowth)
      : Number.isFinite(interim.operatingCashFlow) && Number.isFinite(interim.previousOperatingCashFlow) && interim.previousOperatingCashFlow <= 0 && interim.operatingCashFlow > 0 ? "흑자 전환"
        : Number.isFinite(interim.operatingCashFlow) && Number.isFinite(interim.previousOperatingCashFlow) && interim.previousOperatingCashFlow >= 0 && interim.operatingCashFlow < 0 ? "적자 전환" : null;
    const direction = (current, prior, lowerIsBetter = false) => !Number.isFinite(current) || !Number.isFinite(prior)
      ? { label: "비교자료 확인", className: "watch" }
      : current === prior ? { label: "전년 동기 유지", className: "watch" }
        : (lowerIsBetter ? current < prior : current > prior) ? { label: "전년 동기 개선", className: "ok" } : { label: "전년 동기 약화", className: "warning" };
    const cards = [
      { label: "매출액 · 누적", headline: Number.isFinite(interim.revenueGrowth) ? changeText(interim.revenueGrowth) : null, value: `${interim.period} 누적 ${formatMoney(interim.revenue)}`, formula: "당기 누적 매출액; 증감률 = (당기 ÷ 전년 동기 - 1) × 100", input: `${formatMoney(interim.previousRevenue)} → ${formatMoney(interim.revenue)} (${changeText(interim.revenueGrowth)})`, comparison, meaning: "동일한 중간보고서 기간끼리 비교합니다. 연간 매출과 합산하지 않습니다.", status: direction(interim.revenue, interim.previousRevenue) },
      { label: "영업이익 · 누적", headline: Number.isFinite(interim.operatingProfitGrowth) ? changeText(interim.operatingProfitGrowth) : null, value: `${interim.period} 누적 ${formatMoney(interim.operatingProfit)}`, formula: "당기 누적 영업이익; 증감률 = (당기 ÷ 전년 동기 - 1) × 100", input: `${formatMoney(interim.previousOperatingProfit)} → ${formatMoney(interim.operatingProfit)} (${changeText(interim.operatingProfitGrowth)})`, comparison, meaning: Number.isFinite(interim.operatingProfitGrowth) && Math.abs(interim.operatingProfitGrowth) >= 1000 ? "전년 동기 이익의 낮은 기저로 증가율이 크게 보일 수 있습니다. 절대금액과 공시 원문을 함께 확인하세요." : "전년 동기 대비 이익 방향을 확인합니다. 전기 이익이 0 이하이면 증감률을 표시하지 않습니다.", status: direction(interim.operatingProfit, interim.previousOperatingProfit) },
      { label: "영업현금흐름 · 누적", headline: cashHeadline, value: `${interim.period} 누적 ${formatMoney(interim.operatingCashFlow)}`, formula: "영업활동 현금유입 - 현금유출; 증감률 = (당기 ÷ 전년 동기 - 1) × 100 (전기 양수일 때)", input: `${formatMoney(interim.previousOperatingCashFlow)} → ${formatMoney(interim.operatingCashFlow)}${Number.isFinite(interim.operatingCashFlowGrowth) ? ` (${changeText(interim.operatingCashFlowGrowth)})` : Number.isFinite(interim.operatingCashFlow) && Number.isFinite(interim.previousOperatingCashFlow) ? ` (차이 ${formatSignedMoney(interim.operatingCashFlow - interim.previousOperatingCashFlow)})` : ""}`, comparison, meaning: "전년 동기 누적액과 비교합니다. 전기 영업현금이 0 이하이면 증감률 대신 전환 여부를 표시합니다.", status: direction(interim.operatingCashFlow, interim.previousOperatingCashFlow) },
      { label: "금융비용 완충력 · 누적", headline: Number.isFinite(coverageChange) ? changeText(coverageChange, "배") : null, value: Number.isFinite(coverage) ? `현재 ${formatNumber(coverage, 2)}배` : "자료없음", formula: "누적 영업이익 ÷ 누적 금융비용; 전년 동기 대비 차이는 배율의 차이", input: `${formatMoney(interim.operatingProfit)} ÷ ${formatMoney(interim.financeCosts)} = ${formatNumber(coverage, 2)}배; 전년 동기 ${formatNumber(previousCoverage, 2)}배`, comparison, meaning: "배율은 증가율(%)이 아닌 전년 동기 대비 배율 차이로 보여줍니다. 순수 이자비용 배율이나 원금상환능력과 구분합니다.", status: direction(coverage, previousCoverage) },
      { label: `부채비율 · ${scopeName}`, headline: Number.isFinite(debtRatioChange) ? changeText(debtRatioChange, "%p") : null, value: Number.isFinite(debtRatio) ? `현재 ${formatNumber(debtRatio, 1)}%` : "검증 불가", formula: "보고기간 말 총부채 ÷ 자기자본 × 100; 자산 = 부채 + 자본 검증 후 계산", input: `${formatMoney(interim.totalLiabilities)} ÷ ${formatMoney(interim.equity)} = ${formatNumber(debtRatio, 1)}%; 전년 동기 ${formatNumber(previousDebtRatio, 1)}%`, comparison: `${comparison} · ${scopeName}`, sideNote: Number.isFinite(otherDebtRatio) ? `참고: 같은 공시의 ${otherScopeName} ${formatNumber(otherDebtRatio, 1)}% · 서로 합산하지 않음` : "", meaning: Number.isFinite(debtRatio) ? "손익·현금흐름은 누적액, 부채비율은 각 보고기간 말 잔액입니다. 자산=부채+자본을 대조했습니다." : "필수 계정 누락 또는 자산=부채+자본 불일치로 비율을 표시하지 않습니다.", status: direction(debtRatio, previousDebtRatio, true) },
    ];
    $("#summary-period-note").textContent = `${requestedYear}년 선택 · ${scopeName} · 핵심 수치는 ${comparison} 기준입니다. 아래 재무표는 최신 반기·분기와 연간 3개년을 탭으로 분리했습니다.`;
    $("#summary-grid").innerHTML = summaryCardsMarkup(cards);
    $("#summary-grid").classList.add("interim-mode");
    return;
  }
  const risk = severity();
  const comparison = periodLabel();
  const cards = [
    { label: "금융비용 완충력", value: Number.isFinite(latest.financeCostCoverage) ? `${formatNumber(latest.financeCostCoverage, 2)}배` : "확인 필요", formula: "영업이익 ÷ 금융비용", input: `${formatMoney(latest.operatingProfit)} ÷ ${formatMoney(latest.financeCosts)}`, comparison, meaning: "포괄손익계산서 금융비용 기준입니다. 주석상 순수 이자비용 배율과 구분합니다.", status: risk },
    { label: "영업현금 창출", value: formatMoney(latest.operatingCashFlow, 0), formula: "영업활동 현금유입 - 현금유출", input: `전년 대비 ${changeText(latest.cfoGrowth)}`, comparison, meaning: latest.operatingCashFlow < 0 ? "본업에서 현금이 유출된 원인을 확인해야 합니다." : "회계이익이 실제 현금으로 전환되는지 추세를 봅니다.", status: latest.operatingCashFlow < 0 ? { label: "원인 확인", className: "danger" } : { label: "추세 확인", className: "ok" } },
    { label: "부채 부담", value: `${formatNumber(latest.debtRatio, 1)}%`, formula: "총부채 ÷ 자기자본 × 100", input: `${formatMoney(latest.totalLiabilities)} ÷ ${formatMoney(latest.equity)}`, comparison, meaning: `리스 제외 공시 차입금 ${formatMoney(latest.totalDebt)}, 리스부채 ${formatMoney(latest.leaseLiabilities)}입니다.`, status: latest.debtRatio > 200 ? { label: "부담 점검", className: "warning" } : { label: "구조 확인", className: "ok" } },
    { label: "현금전환주기", value: `${formatNumber(latest.cashConversionCycle, 1)}일`, formula: "채권회수일 + 재고보유일 - 매입결제일", input: `${formatNumber(latest.dso, 1)} + ${formatNumber(latest.dio, 1)} - ${formatNumber(latest.dpo, 1)}일`, comparison, meaning: "길어질수록 영업 과정에 묶이는 운전자금 부담이 커질 수 있습니다.", status: { label: "회전주기", className: "watch" } },
    { label: "주의해서 볼 변화", value: `${state.analysis.assessment.redFlags.length}건`, formula: "3개년 추세·임계값 규칙", input: previous ? `${previous.period}년과 ${latest.period}년 비교` : "비교값 확인 필요", comparison, meaning: "위험 확정이 아니라 담당자가 원인과 증빙을 확인할 출발점입니다.", status: risk },
    { label: "담당자 확인 과제", value: `${state.analysis.assessment.checks.length}개`, formula: "재무 신호 + 신청자금 목적", input: "고객자료·상담·현장 확인", comparison: `분석 기준 ${latest.period}년`, meaning: "확인 결과를 현장실사 점검표에 입력하면 최종 검토서에 반영됩니다.", status: { label: "확인 전", className: "watch" } },
  ];
  if (interim && Number(interim.period.slice(0, 4)) === requestedYear) cards.push({
    label: `${interim.period} 영업이익`, value: formatMoney(interim.operatingProfit),
    formula: "전년 동기 누적 영업이익 대비 증감률", input: `${formatMoney(interim.previousOperatingProfit)} → ${formatMoney(interim.operatingProfit)} (${changeText(interim.operatingProfitGrowth)})`,
    comparison: `${interim.comparisonPeriod || "전년 동기"} → ${interim.period} · 별도`,
    meaning: "현재 사업연도 공시입니다. 연간 3개년 수치와 합산하지 않고 실적 방향을 재검토합니다.",
    status: Number.isFinite(interim.operatingProfitGrowth) && interim.previousOperatingProfit > 0 && interim.operatingProfitGrowth <= -20 ? { label: "당기 둔화", className: "danger" } : { label: "당기 확인", className: "watch" },
  });
  $("#summary-period-note").textContent = requestedYear > Number(latest.period)
    ? `${requestedYear}년 연간 사업보고서가 아직 없고 현재 선택한 ${state.statementScope === "OFS" ? "별도" : "연결"} 중간 비교자료도 없어, 핵심 카드에는 ${comparison} 연간 자료를 표시합니다. 다른 재무제표 범위의 중간자료와 혼합하지 않습니다.`
    : `${comparison} 연간 사업보고서 비교입니다.`;
  $("#summary-grid").innerHTML = summaryCardsMarkup(cards);
  $("#summary-grid").classList.remove("interim-mode");
}

function latestInterimView(analysis) {
  const scoped = analysis?.supplementary?.interimViews?.[state.statementScope];
  if (scoped?.trend) return scoped.trend;
  if (scoped?.current) return { ...scoped.current, period: `${scoped.current.period} ${scoped.current.reportType}`, revenueGrowth: null, operatingProfitGrowth: null, operatingCashFlowGrowth: null, warning: "전년 동기 비교자료가 없어 중간재무 절대금액만 표시합니다." };
  const trend = analysis?.supplementary?.interimTrend;
  if (trend) return trend.fsDiv === state.statementScope ? trend : null;
  const raw = analysis?.supplementary?.interim;
  return raw && raw.fsDiv === state.statementScope ? { ...raw, period: `${raw.period} ${raw.reportType}`, revenueGrowth: null, operatingProfitGrowth: null, operatingCashFlowGrowth: null, warning: "전년 동기 비교자료가 없어 중간재무 절대금액만 표시합니다." } : null;
}

function currentComparison() {
  const analysis = state.analysis;
  const annual = analysis.records.at(-1);
  const interim = latestInterimView(analysis);
  const requestedYear = Number(analysis.dataQuality?.requestedYear);
  const useInterim = interim && Number(String(interim.period).slice(0, 4)) === requestedYear && requestedYear > Number(annual?.period);
  if (useInterim) return {
    current: interim, previous: {
      revenue: interim.previousRevenue, operatingProfit: interim.previousOperatingProfit,
      operatingCashFlow: interim.previousOperatingCashFlow, debtRatio: interimDebtRatio(interim, true),
    },
    period: interim.period, previousPeriod: interim.comparisonPeriod || "전년 동기",
    scope: interim.fsDiv === "OFS" ? "별도 · 차주 법인" : "연결 · 그룹 위험",
    debtRatio: interimDebtRatio(interim), previousDebtRatio: interimDebtRatio(interim, true),
    filing: "중간보고서", interim: true,
  };
  const previous = analysis.records.at(-2);
  return {
    current: annual, previous, period: `${annual?.period || "자료없음"} 사업보고서`,
    previousPeriod: previous ? `${previous.period} 사업보고서` : "비교자료 없음",
    scope: state.statementScope === "OFS" ? "별도 · 차주 법인" : "연결 · 그룹 위험",
    debtRatio: annual?.debtRatio, previousDebtRatio: previous?.debtRatio,
    filing: "사업보고서", interim: false,
  };
}

function ratioChange(current, previous, lowerIsBetter = false) {
  if (!hasNumber(current) || !hasNumber(previous)) return { text: "비교자료 없음", tone: "neutral" };
  const change = Number(current) - Number(previous);
  return { text: changeText(change, "%p"), tone: change === 0 ? "neutral" : ((lowerIsBetter ? change < 0 : change > 0) ? "positive" : "negative") };
}

function amountChange(current, previous) {
  if (!hasNumber(current) || !hasNumber(previous) || Number(previous) <= 0) return { text: "금액 비교 필요", tone: "neutral" };
  const change = (Number(current) / Number(previous) - 1) * 100;
  return { text: changeText(change), tone: change === 0 ? "neutral" : change > 0 ? "positive" : "negative" };
}

function decisionNarrative(view) {
  const { current, previous } = view;
  if (!current) return "공시 수치를 확인한 뒤 상환재원을 검토합니다.";
  if (hasNumber(current.revenue) && hasNumber(previous?.revenue) && hasNumber(current.operatingCashFlow) && hasNumber(previous?.operatingCashFlow)
      && current.revenue > previous.revenue && current.operatingCashFlow < previous.operatingCashFlow)
    return "매출은 늘었지만 영업현금은 줄었습니다. 판매대금 회수와 재고 변화를 먼저 확인하세요.";
  if (hasNumber(current.operatingCashFlow) && current.operatingCashFlow < 0)
    return "영업활동에서 현금이 유출됐습니다. 원리금 상환재원이 어디서 나오는지 확인하세요.";
  if (hasNumber(view.debtRatio) && hasNumber(view.previousDebtRatio) && view.debtRatio > view.previousDebtRatio + 5)
    return "부채비율이 상승했습니다. 기존 차입 만기와 신규 여신의 현금부담을 함께 확인하세요.";
  return "공시상 실적 방향과 현금창출을 확인했습니다. 요청 자금별 상환재원은 별도로 검증해야 합니다.";
}

function renderDecisionHome() {
  const view = currentComparison();
  const a = state.analysis;
  const { current, previous } = view;
  const revenueChange = amountChange(current?.revenue, previous?.revenue);
  const cashChange = amountChange(current?.operatingCashFlow, previous?.operatingCashFlow);
  const debtChange = ratioChange(view.debtRatio, view.previousDebtRatio, true);
  const cashDecline = hasNumber(current?.operatingCashFlow) && hasNumber(previous?.operatingCashFlow) && current.operatingCashFlow < previous.operatingCashFlow;
  const priorities = [];
  if (cashDecline || (hasNumber(current?.operatingCashFlow) && current.operatingCashFlow < 0)) priorities.push(["현금 회수·유출 원인", "매출채권 Aging·재고 및 현금흐름 조정표"]);
  if (hasNumber(view.debtRatio) && hasNumber(view.previousDebtRatio) && view.debtRatio > view.previousDebtRatio) priorities.push(["차입 상환 일정", "기존 차입 만기표와 신규여신 납부월 대조"]);
  if (Number(a.loanRequest.facilityAmount) > 0) priorities.push(["시설투자 수요", "수주·가동률·자기자금 및 설비 계약 확인"]);
  if (Number(a.loanRequest.workingAmount) > 0) priorities.push(["운전자금 회수", "월별 매입·판매·입금 일정 확인"]);
  if (!priorities.length) priorities.push(["원자료 대조", "공시 주석과 최신 고객자료 확인"]);
  const topPriorities = priorities.slice(0, 3);
  const reportNo = view.interim ? current?.rceptNo : current?.rceptNo;
  const reportLink = reportNo ? `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(reportNo)}" target="_blank" rel="noopener noreferrer">${escapeHtml(view.period)} 원문 ↗</a>` : `<span>${escapeHtml(view.period)} · 원문 번호 확인 필요</span>`;
  const metric = (label, value, delta) => `<div class="decision-metric"><span>${label}</span><strong>${escapeHtml(value)}</strong><small class="tone-${delta.tone}">${escapeHtml(delta.text)} <em>전년 ${view.interim ? "동기" : "대비"}</em></small></div>`;
  const working = Number(a.loanRequest.workingAmount) || 0;
  const facility = Number(a.loanRequest.facilityAmount) || 0;
  $("#decision-home").innerHTML = `
    <article class="decision-lead"><div class="decision-lead-top"><span class="decision-badge">공개자료 기반 · 추가 확인</span>${reportLink}</div>
      <h3>${escapeHtml(decisionNarrative(view))}</h3><p class="decision-period">${escapeHtml(view.previousPeriod)} → ${escapeHtml(view.period)} · ${escapeHtml(view.scope)}. 확인 전 승인·거절을 자동 판단하지 않습니다.</p>
      <div class="decision-metrics">${metric("매출액", formatMoney(current?.revenue), revenueChange)}${metric("영업현금", formatMoney(current?.operatingCashFlow), cashChange)}${metric("부채비율", formatNumber(view.debtRatio, 1, "%"), debtChange)}</div>
    </article>
    <aside class="decision-actions"><div class="decision-section-title"><h3>담당자 확인 ${topPriorities.length}가지</h3><span>우선순위</span></div><ol>${topPriorities.map(([title, detail]) => `<li><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></li>`).join("")}</ol><p>관찰 사실과 증빙을 남기면 심사의견에서 다시 검토합니다.</p></aside>
    <article class="decision-secondary"><div class="decision-section-title"><h3>같은 기간 현금 비교</h3><span>${view.interim ? "누적 · 억원" : "연간 · 억원"}</span></div><div class="decision-compare"><div><small>${escapeHtml(view.previousPeriod)}</small><strong>${formatMoney(previous?.operatingCashFlow)}</strong></div><span aria-hidden="true">→</span><div><small>${escapeHtml(view.period)}</small><strong class="${cashDecline ? "tone-negative" : ""}">${formatMoney(current?.operatingCashFlow)}</strong></div></div><p>영업현금의 증감만으로 원인을 확정하지 않습니다. 투자·재무 현금흐름은 아래 상세에서 함께 봅니다.</p></article>
    <article class="decision-secondary"><div class="decision-section-title"><h3>요청여신</h3><span>총 ${(working + facility).toLocaleString("ko-KR")}억원</span></div>${working ? `<div class="decision-loan-line"><span>운전자금 · ${a.loanRequest.workingTermMonths}개월</span><b>${working.toLocaleString("ko-KR")}억원</b></div>` : ""}${facility ? `<div class="decision-loan-line"><span>시설자금 · ${a.loanRequest.facilityTermMonths}개월</span><b>${facility.toLocaleString("ko-KR")}억원</b></div>` : ""}<button type="button" class="decision-link" data-open-detail="credit">용도별 검토 보기 →</button></article>`;
}

function renderEvidenceTrace() {
  const view = currentComparison();
  const { current, previous } = view;
  const a = state.analysis;
  const annual = a.records.at(-1);
  const sourceItem = (label, row) => `<div class="trace-document"><b>${escapeHtml(label)}</b><span>${escapeHtml(row?.source || "공시 출처 확인 필요")}</span>${row?.rceptNo ? `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(row.rceptNo)}" target="_blank" rel="noopener noreferrer">DART 원문 열기 ↗</a>` : `<small>접수번호 없음 · 공시 원문 직접 대조</small>`}</div>`;
  const cashChange = amountChange(current?.operatingCashFlow, previous?.operatingCashFlow);
  const warnings = a.assessment?.redFlags || [];
  const check = warnings.flatMap((flag) => flag.checks || []).slice(0, 2);
  if (!check.length) check.push("현금흐름 조정항목", "차입금·담보 주석");
  $("#evidence-trace").innerHTML = `<div class="trace-heading"><div><p class="eyebrow">SOURCE → CALCULATION → REVIEW</p><h2>원문·숫자·판단을 나란히</h2></div><p>같은 재무제표 범위와 기간을 대조합니다. 원인 가설은 증빙 전 확정하지 않습니다.</p></div><div class="trace-grid">
    <article class="trace-panel"><h3><span>01</span> 공시 원문</h3>${sourceItem(view.period, current)}${view.interim ? sourceItem(view.previousPeriod, a.supplementary?.interimViews?.[state.statementScope]?.prior || {}) : sourceItem(view.previousPeriod, previous)}${view.interim && annual ? `<p class="trace-note">${escapeHtml(annual.period)} 연간 수치와 중간 누적 실적은 합산하지 않습니다.</p>` : ""}</article>
    <article class="trace-panel"><h3><span>02</span> 추출·계산 수치</h3><div class="trace-number"><small>${escapeHtml(view.period)} 영업현금흐름</small><strong>${formatMoney(current?.operatingCashFlow)}</strong><em class="tone-${cashChange.tone}">${escapeHtml(cashChange.text)}</em></div><dl><div><dt>전기 같은 기간</dt><dd>${formatMoney(previous?.operatingCashFlow)}</dd></div><div><dt>매출액</dt><dd>${formatMoney(current?.revenue)}</dd></div><div><dt>부채비율</dt><dd>${formatNumber(view.debtRatio, 1, "%")}</dd></div></dl><p class="trace-note">증감률은 전기 영업현금이 양수일 때 (당기 ÷ 전기 − 1) × 100으로 계산합니다. 음수라면 금액과 전환 방향을 확인하세요.</p></article>
    <article class="trace-panel"><h3><span>03</span> 판단·추가 증빙</h3><div class="trace-judgment">${escapeHtml(decisionNarrative(view))}</div><p class="trace-note">이 문장은 공시 수치의 방향을 설명합니다. 차주의 상환능력이나 위험 원인을 확정하지 않습니다.</p><h4>다음 확인자료</h4><ul>${check.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><button type="button" class="decision-link" data-open-detail="risks">위험 수치 자세히 보기 →</button></article>
  </div>`;
}

$("#decision-home").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-open-detail]");
  if (!button) return;
  setAnalysisDetailView(button.dataset.openDetail);
  $("#analysis-detail-tabs").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#evidence-trace").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-open-detail]");
  if (!button) return;
  setAnalysisDetailView(button.dataset.openDetail);
  $("#analysis-detail-tabs").scrollIntoView({ behavior: "smooth", block: "start" });
});

function interimDebtRatio(view, previous = false) {
  if (!view) return null;
  const prefix = previous ? "previous" : "";
  const field = (name) => view[prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name];
  const assets = field("totalAssets"), liabilities = field("totalLiabilities"), equity = field("equity");
  if (![assets, liabilities, equity].every(Number.isFinite) || equity <= 0) return null;
  if (Math.abs(assets - liabilities - equity) > Math.max(100_000_000, Math.abs(assets) * 0.001)) return null;
  return liabilities / equity * 100;
}

function renderRecentDisclosure() {
  const a = state.analysis;
  const interim = latestInterimView(a);
  const audit = a.supplementary?.audit;
  const latestAnnual = a.records.at(-1);
  const reportLink = latestAnnual?.rceptNo ? `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(latestAnnual.rceptNo)}" target="_blank" rel="noopener noreferrer">${escapeHtml(latestAnnual.period)}년 사업보고서·주석 원문 ↗</a>` : "사업보고서 접수번호 없음 · DART에서 주석 직접 확인";
  const interimBlock = interim
    ? `<div class="recent-primary"><span>01 · 최신 ${interim.fsDiv === "OFS" ? "별도" : "연결"} 공시</span><strong>${escapeHtml(interim.period)}</strong><p>누적 매출 ${formatMoney(interim.revenue)} · 전년 동기 ${changeText(interim.revenueGrowth)}</p><p>누적 영업이익 ${formatMoney(interim.operatingProfit)} · 전년 동기 ${changeText(interim.operatingProfitGrowth)}</p><p>누적 영업현금 ${formatMoney(interim.operatingCashFlow)} · 전년 동기 ${changeText(interim.operatingCashFlowGrowth)}</p></div>`
    : `<div class="recent-primary"><span>01 · 최신 중간재무</span><strong>확인자료 없음</strong><p>고객의 최근 월별 손익·자금수지를 요청하세요.</p></div>`;
  const opinion = audit?.opinions?.length ? audit.opinions.join(" / ") : "확인자료 없음";
  const auditWarning = audit?.opinions?.some((item) => !String(item).includes("적정"));
  $("#recent-update").innerHTML = `<div class="recent-head"><p class="eyebrow">LATEST FILING / AUDIT</p><h2>최근 공시와 주석 확인</h2><p>최신 자료부터 왼쪽에 배치했습니다. 중간 누적실적과 연간 실적은 서로 합산하지 않습니다.</p></div>${interimBlock}<div class="recent-primary"><span>02 · 최근 연간 공시</span><strong>${escapeHtml(latestAnnual?.period || "확인 필요")} 사업보고서</strong><p>매출 ${formatMoney(latestAnnual?.revenue)} · 영업이익 ${formatMoney(latestAnnual?.operatingProfit)}</p><p>${reportLink}</p></div><div><span>03 · 감사의견</span><strong class="${auditWarning ? "tone-negative" : ""}">${escapeHtml(opinion)}</strong><p>핵심감사사항: ${escapeHtml((audit?.keyAuditMatters || []).join(" · ") || "원문 확인 필요")}</p><p>차입금·담보·보증 세부조건은 원문 확인</p></div>`;
}

function lineChart(records, series) {
  const width = 520, height = 230, left = 44, right = 25, top = 38, bottom = 34;
  const normalizedSeries = series.map((item) => {
    const actuals = records.map(item.get).filter(Number.isFinite);
    const localMin = Math.min(...actuals);
    const localMax = Math.max(...actuals);
    const localSpan = localMax - localMin;
    return { ...item, points: records.map((record) => { const actual = item.get(record); return { period: record.period, actual, index: Number.isFinite(actual) ? (localSpan ? 15 + (actual - localMin) / localSpan * 70 : 50) : null }; }) };
  });
  const values = normalizedSeries.flatMap((item) => item.points.map((point) => point.index)).filter(Number.isFinite);
  if (!values.length) return `<p class="no-risk">차트로 표시할 값이 없습니다.</p>`;
  const min = 0, max = 100, span = 100;
  const x = (index) => left + index * ((width - left - right) / Math.max(records.length - 1, 1));
  const y = (value) => top + (max - value) / span * (height - top - bottom);
  const lines = [0, .5, 1].map((ratio) => {
    const yy = top + ratio * (height - top - bottom);
    const label = ratio === 0 ? "높음" : ratio === 1 ? "낮음" : "중간";
    return `<line class="chart-grid-line" x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text class="chart-label-svg" x="4" y="${yy + 3}">${label}</text>`;
  }).join("");
  const paths = normalizedSeries.map((item, sIndex) => {
    const points = item.points.map((point, index) => ({ ...point, x: x(index), y: y(point.index), valid: Number.isFinite(point.index) })).filter((point) => point.valid);
    return `<polyline class="chart-line-${sIndex ? "b" : "a"}" points="${points.map((p) => `${p.x},${p.y}`).join(" ")}"/>${points.map((p) => `<g><circle tabindex="0" class="chart-point-${sIndex ? "b" : "a"}" cx="${p.x}" cy="${p.y}" r="6"><title>${p.period}년 ${escapeHtml(item.label)}: ${formatMoney(p.actual, 1)}</title></circle><text class="chart-value-${sIndex ? "b" : "a"}" x="${p.x}" y="${p.y + (sIndex ? 20 : -11)}" text-anchor="middle">${formatMoney(p.actual, 0)}</text></g>`).join("")}`;
  }).join("");
  const years = records.map((record, index) => `<text class="chart-label-svg" x="${x(index)}" y="${height-6}" text-anchor="middle">${record.period}</text>`).join("");
  const legend = series.map((item, index) => `<g transform="translate(${left + index * 150},16)"><circle class="chart-point-${index ? "b" : "a"}" r="4"/><text class="chart-label-svg chart-legend" x="8" y="3">${item.label}</text></g>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${series.map((item) => item.label).join(" 및 ")} 추이">${lines}${paths}${years}${legend}</svg>`;
}

function renderCharts() {
  const records = state.analysis.records;
  $("#cash-chart").innerHTML = lineChart(records, [
    { label: "매출", get: (row) => row.revenue },
    { label: "영업현금흐름", get: (row) => row.operatingCashFlow },
  ]);
  $("#debt-chart").innerHTML = lineChart(records, [
    { label: "총차입금", get: (row) => row.totalDebt },
    { label: "영업이익", get: (row) => row.operatingProfit },
  ]);
  renderCashFlowAnalysis();
}

function cashFlowBarChart(records) {
  const series = [
    { key: "operatingCashFlow", label: "영업활동", className: "cfo" },
    { key: "investingCashFlow", label: "투자활동", className: "cfi" },
    { key: "financingCashFlow", label: "재무활동", className: "cff" },
  ];
  const values = records.flatMap((row) => series.map((item) => row[item.key])).filter(Number.isFinite);
  if (!values.length) return `<p class="no-risk">현금흐름표 자료가 없습니다.</p>`;
  const width = 900, height = 300, left = 58, right = 20, top = 42, bottom = 44;
  const plotHeight = height - top - bottom;
  const zeroY = top + plotHeight / 2;
  const maxAbs = Math.max(...values.map(Math.abs), 1);
  const usableHalf = plotHeight / 2 - 18;
  const groupStep = (width - left - right) / records.length;
  const barWidth = Math.min(40, groupStep / 5);
  const gap = 7;
  const grid = [top, zeroY, height - bottom].map((y, index) => `<line class="cashflow-grid${index === 1 ? " zero" : ""}" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/>`).join("");
  const yLabels = `<text class="cashflow-axis-label" x="4" y="${top + 4}">+${formatMoney(maxAbs)}</text><text class="cashflow-axis-label" x="18" y="${zeroY + 4}">0</text><text class="cashflow-axis-label" x="4" y="${height - bottom + 4}">-${formatMoney(maxAbs)}</text>`;
  const bars = records.map((row, recordIndex) => {
    const center = left + groupStep * (recordIndex + .5);
    const groupWidth = series.length * barWidth + (series.length - 1) * gap;
    const rects = series.map((item, seriesIndex) => {
      const value = row[item.key];
      if (!Number.isFinite(value)) return "";
      const barHeight = Math.max(Math.abs(value) / maxAbs * usableHalf, value === 0 ? 1 : 3);
      const x = center - groupWidth / 2 + seriesIndex * (barWidth + gap);
      const y = value >= 0 ? zeroY - barHeight : zeroY;
      const labelY = value >= 0 ? y - 7 : y + barHeight + 14;
      return `<g><rect tabindex="0" class="cashflow-bar ${item.className}" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5"><title>${row.period}년 ${item.label}현금흐름: ${formatSignedMoney(value, 1)}</title></rect><text class="cashflow-value ${item.className}" x="${x + barWidth / 2}" y="${labelY}" text-anchor="middle">${formatSignedMoney(value)}</text></g>`;
    }).join("");
    return `${rects}<text class="cashflow-year" x="${center}" y="${height - 9}" text-anchor="middle">${row.period}</text>`;
  }).join("");
  const legend = series.map((item, index) => `<g transform="translate(${left + index * 130},17)"><rect class="cashflow-bar ${item.className}" width="11" height="11" rx="3"/><text class="cashflow-legend" x="17" y="10">${item.label}</text></g>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="3개년 영업·투자·재무활동 현금흐름 비교">${grid}${yLabels}${legend}${bars}</svg>`;
}

function cashFlowInsightFact(insight, metrics) {
  if (insight.id === "operating-deficit-financed" || insight.id === "financing-outflow") return `영업 ${formatSignedMoney(metrics.operatingCashFlow)} · 재무 ${formatSignedMoney(metrics.financingCashFlow)}`;
  if (insight.id === "investment-funded-externally" || insight.id === "investment-internally-funded") return `FCF ${formatSignedMoney(metrics.freeCashFlow)} · CFO/CAPEX ${formatNumber(metrics.capexCoverage, 2, "배")}`;
  if (insight.id === "positive-investing-cash") return `투자활동 ${formatSignedMoney(metrics.investingCashFlow)}`;
  if (insight.id === "debt-expansion") return `재무 ${formatSignedMoney(metrics.financingCashFlow)} · 차입잔액 ${formatSignedMoney(metrics.debtBalanceChange)}`;
  return insight.fact;
}

function renderCashFlowAnalysis() {
  const records = state.analysis.records;
  const analysis = state.analysis.cashFlowAnalysis;
  if (!analysis) return;
  const m = analysis.metrics;
  $("#cashflow-activity-chart").innerHTML = cashFlowBarChart(records);
  const kpis = [
    ["영업활동현금흐름", m.operatingCashFlow, "본업에서 만든 상환재원", Number.isFinite(m.operatingCashFlow) ? (m.operatingCashFlow >= 0 ? "positive" : "negative") : "context"],
    ["투자활동현금흐름", m.investingCashFlow, "설비·자산 취득 및 처분", "context"],
    ["재무활동현금흐름", m.financingCashFlow, "차입·상환·증자·배당", "context"],
    ["단순 FCF", m.freeCashFlow, "CFO - 유형·무형자산 취득", Number.isFinite(m.freeCashFlow) ? (m.freeCashFlow >= 0 ? "positive" : "negative") : "context"],
    ["리스·배당 후 잔여현금", m.debtServiceResidual, "단순 FCF - 리스원금 - 배당", Number.isFinite(m.debtServiceResidual) ? (m.debtServiceResidual >= 0 ? "positive" : "negative") : "context"],
    ["투자자금 자체조달률", m.capexCoverage, "CFO ÷ CAPEX", Number.isFinite(m.capexCoverage) && m.capexCoverage >= 1 ? "positive" : "negative", "배"],
    ["차입금 잔액 증감", m.debtBalanceChange, "당기말 - 전기말", Number.isFinite(m.debtBalanceChange) ? (m.debtBalanceChange > 0 ? "negative" : "positive") : "context"],
  ];
  $("#cashflow-kpis").innerHTML = kpis.map(([label, value, formula, tone, unit]) => `<article class="${tone}"><span>${label}</span><strong>${unit ? formatNumber(value, 2, unit) : formatSignedMoney(value)}</strong><small>${formula}</small></article>`).join("");
  const reconciliation = Number.isFinite(m.cashFlowSubtotal) && Number.isFinite(m.cashBalanceChange)
    ? `<div class="cash-reconciliation"><b>현금증감 연결 확인</b><span>세 활동 합계 ${formatSignedMoney(m.cashFlowSubtotal)} → 현금성자산 증감 ${formatSignedMoney(m.cashBalanceChange)}</span><small>차이 ${formatSignedMoney(m.reconciliationGap)} · 환율효과, 현금성자산 범위와 공시 세부항목 확인</small></div>`
    : `<div class="cash-reconciliation"><b>현금증감 연결 확인</b><span>전기 현금성자산 또는 세 활동 현금흐름 자료가 부족합니다.</span></div>`;
  $("#cashflow-insights").innerHTML = `${reconciliation}<div class="cashflow-insight-list">${analysis.insights.map((item) => `<article class="${item.tone}"><header><span>규칙 기반 해석</span><b>${escapeHtml(item.title)}</b></header><strong>${cashFlowInsightFact(item, m)}</strong><p>${escapeHtml(item.meaning)}</p><small>확인자료 · ${item.checks.map(escapeHtml).join(" · ")}</small></article>`).join("")}</div>`;
}

function renderFinancialTable() {
  const debtShareCell = (record) => Number.isFinite(record.shortTermDebtShare)
    ? `<strong>${formatNumber(record.shortTermDebtShare, 1, "%")}</strong><small>1년 내 ${formatMoney(record.shortTermDebt)} ÷ 전체 ${formatMoney(record.totalDebt)}</small>`
    : `<span class="missing-value">자료없음</span><small class="missing-reason">${escapeHtml(record.debtShareUnavailableReason || "차입금 계정 확인 필요")}</small>`;
  const rows = [
    ["매출액", (r) => formatMoney(r.revenue)], ["영업이익", (r) => formatMoney(r.operatingProfit)],
    ["영업활동현금흐름", (r) => formatSignedMoney(r.operatingCashFlow)], ["투자활동현금흐름", (r) => formatSignedMoney(r.investingCashFlow)], ["재무활동현금흐름", (r) => formatSignedMoney(r.financingCashFlow)],
    ["유형·무형 CAPEX", (r) => Number.isFinite(r.totalCapex) ? formatMoney(r.totalCapex) : "자료없음"], ["단순 FCF", (r) => formatSignedMoney(r.freeCashFlow)], ["리스·배당 후 잔여현금", (r) => formatSignedMoney(r.debtServiceResidual)], ["CFO / CAPEX", (r) => formatNumber(r.capexCoverage, 2, "배")], ["세 활동 합계", (r) => formatSignedMoney(r.cashFlowSubtotal)],
    ["매출 증가율", (r) => changeText(r.revenueGrowth)], ["CFO 증가율", (r) => changeText(r.cfoGrowth)], ["영업이익률", (r) => formatNumber(r.operatingMargin, 1, "%")],
    ["금융차입금(리스 제외)", (r) => formatMoney(r.totalDebt)], ["리스부채", (r) => formatMoney(r.leaseLiabilities)], ["리스 포함 조정차입금", (r) => formatMoney(r.adjustedDebt)], ["1년 내 금융차입 비중", debtShareCell], ["부채비율", (r) => formatNumber(r.debtRatio, 1, "%")], ["영업이익/금융비용", (r) => formatNumber(r.financeCostCoverage, 2, "배")],
    ["매출채권 회전일", (r) => formatNumber(r.dso, 1, "일")], ["재고 회전일", (r) => formatNumber(r.dio, 1, "일")], ["현금전환주기", (r) => formatNumber(r.cashConversionCycle, 1, "일")],
  ];
  const records = [...state.analysis.records].reverse();
  $("#financial-table").innerHTML = `<caption>최근 연간 공시부터 표시 · 1년 내 금융차입 비중 = 유동 차입금·사채 ÷ (유동 + 비유동 차입금·사채) × 100 · 리스 제외</caption><thead><tr><th>지표</th>${records.map((r, index) => `<th class="${index === 0 ? "latest-period" : ""}"><b>${r.period}${index === 0 ? " · 최신 연간" : ""}</b><small>${escapeHtml(r.source)}</small></th>`).join("")}</tr></thead><tbody>${rows.map(([name, get]) => `<tr><td>${name}</td>${records.map((r, index) => `<td class="${index === 0 ? "latest-period" : ""}">${get(r)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function renderInterimFinancialTable(interim) {
  const panel = $("#interim-financial-panel");
  panel.dataset.unavailable = interim ? "" : "true";
  const tab = $("#financial-period-tabs [data-financial-view='interim']");
  tab.disabled = !interim;
  if (!interim) {
    $("#interim-financial-note").textContent = "선택 연도의 같은 기간 중간재무 비교자료가 없습니다.";
    $("#interim-financial-table").innerHTML = "";
    return;
  }
  const scope = state.statementScope === "OFS" ? "별도 · 차주 법인" : "연결 · 그룹";
  const currentPeriod = interim.period;
  const priorPeriod = interim.comparisonPeriod || "전년 동기 자료없음";
  const flowRows = [
    ["매출액", "revenue"], ["영업이익", "operatingProfit"], ["순이익", "netIncome"],
    ["영업활동현금흐름", "operatingCashFlow"], ["투자활동현금흐름", "investingCashFlow"], ["재무활동현금흐름", "financingCashFlow"],
    ["금융비용", "financeCosts"],
  ];
  const balanceRows = [
    ["자산총계", "totalAssets"], ["부채총계", "totalLiabilities"], ["자본총계", "equity"],
    ["1년 내 금융차입금", "shortTermDebt"], ["1년 초과 금융차입금", "longTermDebt"],
  ];
  const previousKey = (key) => `previous${key[0].toUpperCase()}${key.slice(1)}`;
  const moneyRow = ([label, key], group) => {
    const current = interim[key], previous = interim[previousKey(key)];
    const difference = Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
    const rate = Number.isFinite(difference) && previous > 0 ? difference / previous * 100 : null;
    const change = Number.isFinite(rate) ? changeText(rate) : Number.isFinite(difference) ? formatSignedMoney(difference) : "비교값 없음";
    const display = key.endsWith("CashFlow") ? formatSignedMoney : formatMoney;
    return `<tr><th scope="row">${escapeHtml(label)}<small>${group}</small></th><td class="latest-period">${display(current)}</td><td>${display(previous)}</td><td>${change}</td></tr>`;
  };
  const currentDebtRatio = interimDebtRatio(interim);
  const previousDebtRatio = interimDebtRatio(interim, true);
  const ratioDelta = Number.isFinite(currentDebtRatio) && Number.isFinite(previousDebtRatio) ? currentDebtRatio - previousDebtRatio : null;
  const ratioRow = `<tr class="interim-ratio-row"><th scope="row">부채비율<small>각 보고기간 말 부채 ÷ 자본</small></th><td class="latest-period">${formatNumber(currentDebtRatio, 1, "%")}</td><td>${formatNumber(previousDebtRatio, 1, "%")}</td><td>${changeText(ratioDelta, "%p")}</td></tr>`;
  const shortShare = (previous = false) => {
    const short = previous ? interim.previousShortTermDebt : interim.shortTermDebt;
    const long = previous ? interim.previousLongTermDebt : interim.longTermDebt;
    return Number.isFinite(short) && Number.isFinite(long) && short >= 0 && long >= 0 && short + long > 0 ? short / (short + long) * 100 : null;
  };
  const currentShortShare = shortShare();
  const previousShortShare = shortShare(true);
  const shortShareDelta = Number.isFinite(currentShortShare) && Number.isFinite(previousShortShare) ? currentShortShare - previousShortShare : null;
  const shortShareRow = `<tr class="interim-ratio-row"><th scope="row">1년 내 금융차입 비중<small>유동 차입금·사채 ÷ 유동·비유동 합계 · 리스 제외</small></th><td class="latest-period">${formatNumber(currentShortShare, 1, "%")}</td><td>${formatNumber(previousShortShare, 1, "%")}</td><td>${changeText(shortShareDelta, "%p")}</td></tr>`;
  $("#interim-financial-note").innerHTML = `<strong>${escapeHtml(scope)} · ${escapeHtml(priorPeriod)} → ${escapeHtml(currentPeriod)}</strong><span>손익·현금흐름은 각 보고기간의 누적액, 재무상태표는 각 기말 잔액입니다. 연간 수치와 합산하지 않습니다.</span>${interim.rceptNo ? `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(interim.rceptNo)}" target="_blank" rel="noopener noreferrer">공시 원문 ↗</a>` : ""}`;
  $("#interim-financial-table").innerHTML = `<caption>${escapeHtml(scope)} · 같은 기간 중간재무 비교 · 금액: 억원, 비율: %·%p</caption><thead><tr><th>지표</th><th class="latest-period">${escapeHtml(currentPeriod)} · 최신</th><th>${escapeHtml(priorPeriod)}</th><th>전년 동기 대비</th></tr></thead><tbody><tr class="period-group-row"><th colspan="4">손익·현금흐름 · 누적</th></tr>${flowRows.map((row) => moneyRow(row, "누적")).join("")}<tr class="period-group-row"><th colspan="4">재무상태표 · 보고기간 말</th></tr>${balanceRows.map((row) => moneyRow(row, "기말")).join("")}${ratioRow}${shortShareRow}</tbody>`;
}

function setFinancialView(view, interimAvailable) {
  const selected = view === "interim" && interimAvailable ? "interim" : "annual";
  state.financialView = selected;
  $$("#financial-period-tabs button").forEach((button) => {
    const active = button.dataset.financialView === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("#interim-financial-panel").hidden = selected !== "interim";
  $("#annual-financial-panel").hidden = selected !== "annual";
}

function renderInterimPerformance(interim) {
  const panel = $("#interim-performance-panel");
  panel.dataset.unavailable = interim ? "" : "true";
  $("#performance-period-tabs [data-performance-view='interim']").disabled = !interim;
  if (!interim) { panel.innerHTML = "<p class='no-risk'>선택 연도의 같은 기간 중간실적이 없어 연간 진단만 표시합니다.</p>"; return; }
  const ratio = (numerator, denominator) => Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator * 100 : null;
  const coverage = (profit, cost) => Number.isFinite(profit) && Number.isFinite(cost) && cost > 0 ? profit / cost : null;
  const scope = state.statementScope === "OFS" ? "별도 · 차주 법인" : "연결 · 그룹";
  const metric = (label, current, prior, unit, lowerIsBetter = false, precision = 1) => ({ label, current, prior, unit, lowerIsBetter, precision });
  const groups = [
    { name: "수익성", metrics: [metric("영업이익률", ratio(interim.operatingProfit, interim.revenue), ratio(interim.previousOperatingProfit, interim.previousRevenue), "%"), metric("순이익률", ratio(interim.netIncome, interim.revenue), ratio(interim.previousNetIncome, interim.previousRevenue), "%")] },
    { name: "성장성", metrics: [metric("매출액", interim.revenue, interim.previousRevenue, "억원", false, 0), metric("영업이익", interim.operatingProfit, interim.previousOperatingProfit, "억원", false, 0)] },
    { name: "안정성", metrics: [metric("부채비율", interimDebtRatio(interim), interimDebtRatio(interim, true), "%", true), metric("유동비율", ratio(interim.currentAssets, interim.currentLiabilities), ratio(interim.previousCurrentAssets, interim.previousCurrentLiabilities), "%"), metric("영업이익/금융비용", coverage(interim.operatingProfit, interim.financeCosts), coverage(interim.previousOperatingProfit, interim.previousFinanceCosts), "배", false, 2)] },
    { name: "현금창출력", metrics: [metric("영업현금/매출", ratio(interim.operatingCashFlow, interim.revenue), ratio(interim.previousOperatingCashFlow, interim.previousRevenue), "%"), metric("영업현금흐름", interim.operatingCashFlow, interim.previousOperatingCashFlow, "억원", false, 0)] },
  ];
  const valueText = (value, item) => item.unit === "억원" ? formatMoney(value) : formatNumber(value, item.precision, item.unit);
  const metricMarkup = (item) => {
    const available = Number.isFinite(item.current) && Number.isFinite(item.prior);
    const difference = available ? item.current - item.prior : null;
    const favorable = available && (item.lowerIsBetter ? difference < 0 : difference > 0);
    const neutral = available && Math.abs(difference) < (item.unit === "억원" ? 100_000_000 : 0.05);
    const tone = !available ? "unknown" : neutral ? "neutral" : favorable ? "favorable" : "adverse";
    const delta = item.unit === "억원" && item.prior > 0 ? changeText(difference / item.prior * 100) : item.unit === "억원" ? formatSignedMoney(difference) : changeText(difference, item.unit === "%" ? "%p" : "배");
    return `<div class="interim-performance-metric ${tone}"><b>${escapeHtml(item.label)}</b><strong>${valueText(item.current, item)}</strong><span>${valueText(item.prior, item)} → ${valueText(item.current, item)}</span><em>${available ? `전년 동기 ${delta}` : "비교자료 없음"}</em></div>`;
  };
  const groupMarkup = (group) => {
    const comparable = group.metrics.filter((item) => Number.isFinite(item.current) && Number.isFinite(item.prior));
    const weakening = comparable.filter((item) => item.lowerIsBetter ? item.current > item.prior : item.current < item.prior).length;
    const improving = comparable.filter((item) => item.lowerIsBetter ? item.current < item.prior : item.current > item.prior).length;
    const verdict = !comparable.length ? "비교자료 없음" : weakening > improving ? "약화" : improving > weakening ? "개선" : "혼재·유지";
    return `<article class="interim-performance-card"><header><h3>${escapeHtml(group.name)}</h3><span class="${weakening > improving ? "adverse" : improving > weakening ? "favorable" : "neutral"}">${verdict}</span></header>${group.metrics.map(metricMarkup).join("")}</article>`;
  };
  panel.innerHTML = `<p class="period-explainer"><strong>${escapeHtml(scope)} · ${escapeHtml(interim.comparisonPeriod || "전년 동기")} → ${escapeHtml(interim.period)}</strong><span>같은 기간끼리 비교한 방향 판정입니다. 채권·재고 회전일은 기초잔액 확인 전까지 판정하지 않습니다.</span></p><div class="interim-performance-grid">${groups.map(groupMarkup).join("")}<article class="interim-performance-card unavailable"><header><h3>활동성</h3><span class="neutral">추가자료 필요</span></header><p>매출채권·재고·매입채무의 기초·기말 평균잔액을 대조해야 회전일을 비교할 수 있습니다. 연간 회전일을 반기 결과처럼 표시하지 않습니다.</p></article></div>`;
}

function setPerformanceView(view, interimAvailable) {
  const selected = view === "interim" && interimAvailable ? "interim" : "annual";
  state.performanceView = selected;
  $$("#performance-period-tabs button").forEach((button) => {
    const active = button.dataset.performanceView === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("#interim-performance-panel").hidden = selected !== "interim";
  $("#annual-performance-panel").hidden = selected !== "annual";
}

function miniTrend(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return `<span>자료없음</span>`;
  const min = Math.min(...valid), max = Math.max(...valid), span = max - min || 1;
  return `<div class="mini-trend" aria-label="3개년 추이">${values.map((value) => `<i style="height:${Number.isFinite(value) ? 5 + ((value - min) / span) * 20 : 2}px"></i>`).join("")}</div>`;
}

function renderPerformanceConclusion(performance) {
  const dimensions = Array.isArray(performance.dimensions) ? performance.dimensions : [];
  const count = (status) => dimensions.filter((item) => item.status?.className === status).length;
  const weakened = count("weakening");
  const improved = count("improving");
  const unknown = count("unknown");
  const signals = dimensions.map((dimension) => {
    const ranked = (dimension.metrics || [])
      .filter((item) => Number.isFinite(item.trend?.previous) && Number.isFinite(item.trend?.latest))
      .sort((left, right) => {
        const priority = { weakening: 3, improving: 2, neutral: 1 };
        const leftScore = priority[left.trend.className] || 0;
        const rightScore = priority[right.trend.className] || 0;
        return rightScore - leftScore || Math.abs(right.trend.delta || 0) / Math.max(right.trend.threshold || 0.2, 0.2) - Math.abs(left.trend.delta || 0) / Math.max(left.trend.threshold || 0.2, 0.2);
      });
    return { dimension, metric: ranked[0] || null };
  });
  const records = state.analysis?.records || [];
  const previousYear = records.at(-2)?.period || "전기";
  const latestYear = records.at(-1)?.period || "당기";
  const headline = unknown === dimensions.length
    ? "비교 가능한 재무자료가 부족합니다"
    : weakened ? `${dimensions.length}개 영역 중 ${weakened}개 약화` : "뚜렷한 약화는 제한적입니다";
  const summaryTone = unknown === dimensions.length ? "unknown" : weakened ? "weakening" : improved ? "improving" : "neutral";
  const summaryCount = summaryTone === "unknown" ? unknown : weakened;
  const summaryLabel = summaryTone === "unknown" ? "자료부족 영역" : "약화 영역";
  const signalCards = signals.map(({ dimension, metric }) => {
    const valueUnit = metric?.unit === "%p" ? "%" : metric?.unit || "";
    const deltaUnit = ["%", "%p"].includes(metric?.unit) ? "%p" : valueUnit;
    const digits = ["배", "회"].includes(metric?.unit) ? 2 : 1;
    const tone = dimension.status?.className || "unknown";
    return `<article class="conclusion-signal ${escapeHtml(tone)}">
      <div class="conclusion-signal-heading"><span>${escapeHtml(dimension.name)}</span><b>${escapeHtml(dimension.status?.label || "자료부족")}</b></div>
      <h4>${escapeHtml(metric?.label || "비교 가능한 지표 없음")}</h4>
      <div class="conclusion-values"><span><small>${escapeHtml(previousYear)}</small>${formatNumber(metric?.trend?.previous, digits, valueUnit)}</span><span aria-hidden="true">→</span><strong><small>${escapeHtml(latestYear)}</small>${formatNumber(metric?.trend?.latest, digits, valueUnit)}</strong></div>
      <p>전년 대비 <b>${Number.isFinite(metric?.trend?.delta) ? changeText(metric.trend.delta, deltaUnit) : "비교값 없음"}</b></p>
      <a href="#performance-${escapeHtml(dimension.id)}">계산 근거 보기 <span aria-hidden="true">↗</span></a>
    </article>`;
  }).join("");
  const statusChips = dimensions.map((item) => `<span class="conclusion-status ${escapeHtml(item.status.className)}">${escapeHtml(item.name)} <b>${escapeHtml(item.status.label)}</b></span>`).join("");
  return `<div class="conclusion-head"><div><p class="eyebrow">경영성과 핵심 요약 · ${escapeHtml(periodLabel(records))}</p><h3>${headline}</h3><p>먼저 바뀐 숫자를 보고, 원인은 아래에서 자료로 검증합니다.</p></div><div class="conclusion-count ${summaryTone}"><strong>${summaryCount}</strong><span>${summaryLabel}</span></div></div>
    <div class="conclusion-statuses" aria-label="영역별 판정">${statusChips}</div>
    ${signalCards ? `<div class="conclusion-carousel"><button type="button" class="conclusion-scroll" data-conclusion-scroll="-1" aria-label="이전 경영성과 영역">‹</button><div class="conclusion-signals" tabindex="0" aria-label="경영성과 5개 영역, 좌우로 이동">${signalCards}</div><button type="button" class="conclusion-scroll" data-conclusion-scroll="1" aria-label="다음 경영성과 영역">›</button></div>` : `<p class="conclusion-empty">직전연도와 직접 비교할 수 있는 지표가 없습니다. 자료 범위와 최근 실적을 확인하세요.</p>`}
    <div class="conclusion-footer"><p>이 화면은 전년 대비 변화 방향입니다. 원인 확정이나 대출 승인·거절 판단은 아닙니다.${improved ? ` 개선된 영역 ${improved}개도 아래에 함께 표시했습니다.` : ""}</p><details><summary>판정 기준 보기</summary><p>${escapeHtml(performance.rule || "직전연도 비교")}</p></details></div>`;
}

function renderPerformance() {
  const performance = state.analysis.performance;
  const comparison = periodLabel();
  $("#performance-grid").classList.add("compact");
  $("#performance-grid").innerHTML = performance.dimensions.map((dimension) => `<article class="performance-card compact ${escapeHtml(dimension.status.className)}" id="performance-${escapeHtml(dimension.id)}"><header><div><h3>${escapeHtml(dimension.name)}</h3><small>${escapeHtml(dimension.question)}</small></div><span class="${escapeHtml(dimension.status.className)}">${escapeHtml(dimension.status.label)}</span></header><p class="performance-verdict">${escapeHtml(dimension.status.explanation || "직전연도 비교")}</p><div class="performance-rows">${dimension.metrics.map((metric) => {
    const trend = metric.trend || {};
    const tone = trend.className === "improving" ? "favorable" : trend.className === "weakening" ? "adverse" : "neutral";
    const valueUnit = metric.unit === "%p" ? "%" : metric.unit;
    const deltaUnit = ["%", "%p"].includes(metric.unit) ? "%p" : metric.unit;
    const digits = ["배", "회"].includes(metric.unit) ? 2 : 1;
    const years = state.analysis.records.map((row, index) => `${row.period}년 ${Number.isFinite(metric.values[index]) ? formatNumber(metric.values[index], digits, valueUnit) : "자료없음"}`).join(" · ");
    const calculations = (metric.calculations || []).map((item, index) => `<p><b>${escapeHtml(state.analysis.records[index]?.period || "전기")}년</b> ${escapeHtml(item.equation)}${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</p>`).join("");
    return `<div class="performance-row ${tone}"><div class="performance-row-main"><b>${escapeHtml(metric.label)}</b><strong>${Number.isFinite(metric.latest) ? formatNumber(metric.latest, digits, valueUnit) : "자료없음"}</strong><em>${escapeHtml(trend.direction || "자료부족")}${Number.isFinite(trend.delta) ? ` · ${changeText(trend.delta, deltaUnit)}` : ""}</em></div><details><summary>3개년·계산 근거</summary><p>${escapeHtml(years)}</p><p>${escapeHtml(metric.definition)}</p>${calculations}<p><b>판정</b> ${escapeHtml(metric.criterion)}</p><p><b>산식</b> ${escapeHtml(metric.formula)} · <b>사용계정</b> ${escapeHtml(metric.account)}</p>${metric.warning ? `<p>${escapeHtml(metric.warning)}</p>` : ""}</details></div>`;
  }).join("")}</div><small class="performance-period">연간 비교 ${escapeHtml(comparison)}</small></article>`).join("");
  $("#hypothesis-list").innerHTML = performance.hypotheses.map((item) => `<article class="diagnostic-narrative"><header><div><span>${escapeHtml(item.priority)}</span><h4>${escapeHtml(item.category)}</h4></div></header><section><b>1. 관찰된 사실</b><p>${escapeHtml(item.observation)}</p><div class="evidence">${item.evidence.map((evidence) => `<span>${escapeHtml(evidence)}</span>`).join("")}</div></section><section><b>2. 가능한 원인 가설</b><p>${escapeHtml(item.hypothesis)}</p></section><section><b>3. 검증할 자료와 질문</b><div class="verification-steps">${item.verificationSteps.map((step) => `<div><strong>${escapeHtml(step.title)}</strong><p><b>자료</b> ${escapeHtml(step.data)}</p><p><b>질문</b> ${escapeHtml(step.question)}</p></div>`).join("")}</div></section></article>`).join("");
  $("#performance-conclusion").innerHTML = renderPerformanceConclusion(performance);
}

$("#performance-conclusion").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-conclusion-scroll]");
  if (!button) return;
  const carousel = $("#performance-conclusion .conclusion-signals");
  carousel?.scrollBy({ left: Number(button.dataset.conclusionScroll) * (carousel.clientWidth * 0.82), behavior: "smooth" });
});

function renderRisks() {
  const risks = state.analysis.assessment.redFlags;
  $("#risk-count").textContent = `${risks.length}개 확인 항목`;
  $("#analysis-risk-tab-note").textContent = `${risks.length}개 연간 확인 수치 · 업종지표`;
  const hasCurrentInterim = latestInterimView(state.analysis)?.period?.startsWith(String(state.analysis.dataQuality?.requestedYear));
  $("#risk-period-note").textContent = `${periodLabel()} 연간 공시 기반 규칙${hasCurrentInterim ? " · 위 반기 성과와 분리해 해석" : ""}`;
  const thresholds = {
    "negative-cfo": "CFO < 0원", "profit-cfo-gap": "순이익 > 0원이며 CFO < 0원",
    "sales-cfo-divergence": "매출증가율 - CFO증가율 ≥ 15%p", "receivables-ahead": "채권증가율 - 매출증가율 ≥ 10%p",
    "inventory-ahead": "재고증가율 - 매출증가율 ≥ 10%p", "low-finance-cost-coverage": "영업이익/금융비용 < 1.5배",
    "debt-surge": "총차입금 증가율 ≥ 20%", "low-current-ratio": "유동비율 < 100%",
  };
  const valueText = (risk, value) => {
    if (!Number.isFinite(value)) return "비교값 없음";
    if (/CFO|차입금/.test(risk.metric) && Math.abs(value) > 1_000_000) return formatMoney(value, 1);
    if (/배율/.test(risk.metric)) return formatNumber(value, 2, "배");
    if (/비율|증가율/.test(risk.metric)) return formatNumber(value, 1, risk.metric.includes(" - ") ? "%p" : "%");
    return formatNumber(value, 1);
  };
  $("#risk-list").innerHTML = risks.length ? risks.map((risk) => {
    const delta = Number.isFinite(risk.current) && Number.isFinite(risk.previous) ? risk.current - risk.previous : null;
    const period = periodLabel();
    const deltaDisplay = Number.isFinite(delta) ? (/비율|증가율/.test(risk.metric) ? changeText(delta, "%p") : `${delta > 0 ? "+" : ""}${valueText(risk, delta)}`) : "";
    return `<article class="risk-card ${risk.level}"><div class="risk-bar"></div><div class="risk-title"><h3>${escapeHtml(risk.title)}</h3><span>${risk.level === "danger" ? "우선 확인" : risk.level === "warning" ? "주의 깊게 확인" : "추가 확인"}</span><div class="risk-evidence"><small>${escapeHtml(risk.metric)}</small><strong>${valueText(risk, risk.current)}</strong><p>${Number.isFinite(risk.previous) ? `${escapeHtml(period)} · ${valueText(risk, risk.previous)} → ${valueText(risk, risk.current)}${Number.isFinite(delta) ? ` (${deltaDisplay})` : ""}` : "현재 관찰값"}</p><em>관찰 기준 ${escapeHtml(thresholds[risk.id] || "규칙 임계치")} · 은행 승인 기준 아님</em></div></div><div><h4>왜 먼저 확인하는가</h4><p>${escapeHtml(risk.reason)}</p></div><div><h4>확인할 원자료</h4><div class="tag-list">${risk.checks.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></div></article>`;
  }).join("") : `<div class="no-risk">현재 규칙에서 우선 확인할 변화는 발견되지 않았습니다. 공시 이후 실적과 비재무 정보는 별도로 확인해야 합니다.</div>`;
}

function macroDateLabel(value) {
  const raw = String(value || "");
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : /^\d{6}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw || "자료없음";
}

function macroDeltaText(value, unit = "") {
  if (!Number.isFinite(value)) return "비교값 없음";
  const suffix = String(unit).includes("%") ? "%p" : unit === "원" ? "원" : unit === "지수" || String(unit).includes("=100") ? "포인트" : "";
  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}${suffix}`;
}

function macroTrendMarkup(item) {
  const observations = (Array.isArray(item.history) && item.history.length >= 2 ? item.history : [item.previous, item.latest])
    .filter((point) => point && Number.isFinite(Number(point.value)) && point.date);
  if (observations.length < 2) return `<div class="macro-trend"><b>최근 동향 자료 부족</b><p>직전 수록치와 최신 수록치를 함께 확인할 수 없습니다.</p></div>`;
  const values = observations.map((point) => Number(point.value));
  const min = Math.min(...values), max = Math.max(...values);
  const spread = max - min;
  const points = values.map((value, index) => `${8 + index * 184 / (values.length - 1)},${spread ? 55 - (value - min) / spread * 42 : 34}`).join(" ");
  const delta = values.at(-1) - values[0];
  const direction = delta > 0 ? "상승" : delta < 0 ? "하락" : "변화 없음";
  const basis = observations.length === 2 ? "최근 2회 수록" : item.frequency === "D" ? "최근 90일 수록" : "최근 6개 수록월";
  const start = macroDateLabel(observations[0].date), end = macroDateLabel(observations.at(-1).date);
  const lastY = spread ? 55 - (values.at(-1) - min) / spread * 42 : 34;
  return `<div class="macro-trend"><div class="macro-trend-head"><span>${escapeHtml(basis)} · ${escapeHtml(direction)}</span><b>${macroDeltaText(delta, item.unit)}</b></div><svg viewBox="0 0 200 68" role="img" aria-label="${escapeHtml(item.name)} ${escapeHtml(start)}부터 ${escapeHtml(end)}까지 ${escapeHtml(direction)}"><polyline class="macro-trend-line" points="${points}"/><circle class="macro-trend-dot" cx="192" cy="${lastY}" r="4"/></svg><div class="macro-trend-periods"><span>${escapeHtml(start)} · ${formatNumber(values[0], 2)} ${escapeHtml(item.unit || "")}</span><span>${escapeHtml(end)} · ${formatNumber(values.at(-1), 2)} ${escapeHtml(item.unit || "")}</span></div><p>이 추세만으로 기업에 유리·불리를 단정하지 않습니다. 아래 노출경로를 확인하세요.</p></div>`;
}

function renderMacro() {
  const profile = industryProfile();
  const allMacro = state.analysis.macro;
  const selectedIds = new Set(profile.macroIds || ["kr-base-rate"]);
  const macro = allMacro.filter((item) => selectedIds.has(item.id));
  $("#industry-profile").textContent = profile.label;
  const pending = profile.id === "retail" ? "KOSIS 소매판매·온라인쇼핑 지표는 아직 미연결" : "업종 고유지표는 추가 연결 필요";
  $("#industry-guide").innerHTML = `<div><b>${escapeHtml(profile.label)}에 맞춰 보는 지표</b><p>${profile.focus.map(escapeHtml).join(" · ")}</p><small>${escapeHtml(pending)} · 관련 없는 제조업·수출지표는 표시하지 않습니다.</small></div><span>현재 연결 가능한 지표 ${macro.length}개</span>`;
  $("#macro-grid").innerHTML = macro.map((item) => {
    const delta = item.latest && item.previous ? item.latest.value - item.previous.value : null;
    const compact = item.latest?.date || "";
    const published = compact.length === 8 ? `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}` : compact.length === 6 ? `${compact.slice(0,4)}-${compact.slice(4,6)}` : compact || "기준일 없음";
    const basis = new Date(`${state.analysis.basisDate}T00:00:00`);
    const publishedDate = compact.length === 8 ? new Date(`${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}T00:00:00`) : compact.length === 6 ? new Date(`${compact.slice(0,4)}-${compact.slice(4,6)}-01T00:00:00`) : null;
    const ageDays = publishedDate ? Math.floor((basis - publishedDate) / 86_400_000) : Infinity;
    const timely = item.frequency === "D" ? ageDays <= 7 : ageDays <= 70;
    const narrative = macroNarrative(item, profile, delta);
    return `<article class="macro-card"><div class="macro-card-head"><span class="macro-name">${escapeHtml(item.name)}</span><span class="freshness-tag ${timely ? "current" : "lagged"}">${timely ? "최신권" : "공표시차 확인"}</span></div><strong>${item.latest ? `${formatNumber(item.latest.value, 2)} ${escapeHtml(item.unit)}` : escapeHtml(item.status)}</strong><p>최신 수록 <b>${escapeHtml(published)}</b></p><p>${escapeHtml(item.source || "출처 확인 필요")} · ${item.paginationComplete === false ? "일부 수집" : "전체조회"}</p>${macroTrendMarkup(item)}<div class="delta">${Number.isFinite(delta) ? `직전 수록치 대비 ${macroDeltaText(delta, item.unit)}` : escapeHtml(item.message || "비교값 없음")}</div><div class="macro-relevance"><p><b>왜 확인하나</b>${escapeHtml(narrative.why)}</p><p><b>현재 우려·기회</b>${escapeHtml(narrative.concern)}</p><p><b>기업자료로 확인</b>${escapeHtml(narrative.verify)}</p></div></article>`;
  }).join("");
  if (!macro.length) $("#macro-grid").innerHTML = `<div class="no-risk">현재 이 업종에 맞는 최신 외부지표가 연결되지 않았습니다. 관련 없는 제조업·수출지표는 표시하지 않습니다.</div>`;
  const items = state.analysis.assessment.interpretations.filter((item) => {
    if (item.type !== "외부환경") return false;
    if (profile.id === "manufacturing" || profile.id === "general") return true;
    return !/수출|제조업|환율/.test(item.text || "");
  });
  $("#interpretation-list").innerHTML = items.map((item) => `<div class="interpretation"><b>[${escapeHtml(item.type || "해석")}]</b><span>${escapeHtml(item.text)}</span><small>${escapeHtml(item.source || item.confidence || "규칙 기반")}</small></div>`).join("");
}

function macroNarrative(item, profile, delta) {
  const rising = Number.isFinite(delta) && delta > 0;
  const falling = Number.isFinite(delta) && delta < 0;
  const rows = {
    "kr-base-rate": {
      why: "차입금의 변동금리·차환금리와 소비자의 구매여력에 영향을 줍니다.",
      concern: rising ? "금리 상승은 이자부담과 소비 둔화를 동시에 키울 수 있습니다." : falling ? "금리 하락은 금융비용 부담을 낮출 수 있으나 실제 차입금리에 반영되는 시차를 확인해야 합니다." : "직전 수록치와 같아 현재는 기업별 가산금리와 만기구조가 더 중요합니다.",
      verify: "변동금리 비중, 12개월 내 만기, 실제 가산금리",
    },
    "kr-3y": { why: "중장기 시장금리와 시설자금 조달비용의 방향을 보여줍니다.", concern: rising ? "장기 시설자금의 신규 조달·차환비용 상승이 우려됩니다." : "시장금리 하락이 실제 대출조건 개선으로 이어지는지 확인합니다.", verify: "장기차입 만기, 고정금리 비중, 신규 시설자금 견적금리" },
    "usd-krw": { why: "수출대금의 원화환산액과 수입원재료 원가를 동시에 바꿉니다.", concern: rising ? "원화 약세는 수입원가 부담을 높일 수 있습니다." : "원화 강세는 수출환산매출에 부담이 될 수 있습니다.", verify: "수출매출·수입원가 비중, 결제통화, 환헤지" },
    "kr-cpi": { why: profile.id === "retail" ? "상품 매입원가와 소비자의 실질 구매력을 함께 보여주는 보조지표입니다." : "원재료·인건비·판매가격 전가 여건을 확인하는 보조지표입니다.", concern: rising ? "물가 상승분을 판매가격에 전가하지 못하면 마진이 줄 수 있습니다." : "물가압력 완화가 매입원가 개선으로 이어지는지 확인합니다.", verify: "상품군별 매입원가율, 판매단가, 매출총이익률" },
    "kr-ccsi": { why: "가계의 소비심리 변화는 유통·서비스 기업의 객수와 객단가에 영향을 줍니다.", concern: falling ? "소비심리 하락이 객수·비필수품 매출 둔화로 이어질 수 있습니다." : "소비심리 개선이 실제 동일점 매출 증가로 연결되는지 확인합니다.", verify: "동일점 매출, 객수, 객단가, 상품군별 매출" },
    "kr-industrial-production": { why: "전반적인 생산·서비스 활동의 경기 방향을 보여줍니다.", concern: falling ? "경기 둔화가 주문과 가동률 하락으로 전이될 수 있습니다." : "경기 개선이 실제 수주·매출로 연결되는지 확인합니다.", verify: "수주잔고, 가동률, 월별 매출" },
    "export-volume": { why: "수출기업의 외부수요와 물량 변화를 보여주는 보조지표입니다.", concern: falling ? "수출물량 둔화 시 가동률과 운전자금 회수가 악화될 수 있습니다." : "수출 증가가 회사의 수주·매출에도 나타나는지 확인합니다.", verify: "수출매출 비중, 국가·고객별 수주, 가동률" },
    "manufacturing-bsi": { why: "제조기업이 체감하는 수요·가동 전망을 확인합니다.", concern: falling ? "업황심리 약화가 수주·재고 부담으로 이어질 수 있습니다." : "업황 개선의 지속성과 회사의 실제 주문 증가를 확인합니다.", verify: "수주잔고, 재고일수, 설비가동률" },
  };
  return rows[item.id] || { why: "기업의 매출·원가·자금조달 경로와 연결되는지 확인합니다.", concern: "지표 방향만으로 기업 영향을 확정할 수 없습니다.", verify: "기업별 노출비중과 최근 월별 실적" };
}

function industryIndicatorCatalog() {
  const code = String(state.analysis?.company?.companyInfo?.induty_code || "");
  const profile = industryProfile().id;
  const kosis = { source: "KOSIS 국가통계포털", url: "https://kosis.kr/index/index.do" };
  const customs = { source: "관세청 빅데이터 포털", url: "https://bigdata.customs.go.kr/web/anaySrvc/selectExpStat.do" };
  const ecos = { source: "한국은행 ECOS", url: "https://ecos.bok.or.kr/" };
  const kosisSuggestions = {
    "auto-production": { searchQuery: "광공업생산지수", seriesQuery: "생산지수(계절조정) 전국 자동차", suggestedTableId: "DT_1F02001" },
    "auto-inventory": { searchQuery: "광공업생산지수", seriesQuery: "재고지수(계절조정) 전국 자동차", suggestedTableId: "DT_1F02001" },
    "large-mart-sales": { searchQuery: "소매업태별 판매액지수", seriesQuery: "대형마트", suggestedTableId: "DT_1K41013" },
    "retail-sales": { searchQuery: "소매판매액지수", seriesQuery: "총지수" },
    "online-shopping": { searchQuery: "온라인쇼핑 거래액", seriesQuery: "" },
  };
  const row = (id, name, why, direction, provider) => ({ id, name, why, direction, ...provider, ...(provider.source === "KOSIS 국가통계포털" ? kosisSuggestions[id] || {} : {}) });
  if (/^301/.test(code)) return [
    row("auto-production", "자동차 생산지수", "완성차 생산량과 공급여건을 회사 가동률과 대조", "up", kosis),
    row("auto-exports", "자동차 수출액·물량", "회사의 해외매출·수출계약 노출과 연결", "up", customs),
    row("auto-inventory", "자동차 재고지수", "재고 증가와 판매 둔화 가능성을 회사 재고회전과 대조", "down", kosis),
  ];
  if (profile === "retail") return [
    row("large-mart-sales", "대형마트 판매액지수", "점포 매출·객수와 비교", "up", kosis),
    row("retail-sales", "소매판매액지수", "소비 수요 변화와 동일점 매출을 대조", "up", kosis),
    row("online-shopping", "온라인쇼핑 거래액", "온라인 전환과 오프라인 점포의 경쟁 영향을 확인", "up", kosis),
  ];
  if (profile === "construction") return [
    row("construction-orders", "건설수주액", "향후 수주·매출 파이프라인 확인", "up", kosis),
    row("construction-output", "건설기성액", "기존 공사의 진행과 현금화 속도 확인", "up", kosis),
    row("unsold-housing", "미분양 주택", "분양대금 회수와 재고 부담 확인", "down", kosis),
  ];
  if (profile === "manufacturing") return [
    row("industry-output", "해당 세부업종 생산지수", "회사 가동률·수주와 업종 생산 방향을 대조", "up", kosis),
    row("industry-exports", "해당 품목 수출액·물량", "품목·국가별 해외수요와 회사 수출노출 확인", "up", customs),
    row("industry-inventory", "해당 세부업종 재고율", "재고 적체와 현금회수 지연 가능성 확인", "down", kosis),
  ];
  if (profile === "technology") return [
    row("ict-output", "정보통신업 생산지수", "고객사의 매출·프로젝트 수주와 대조", "up", kosis),
    row("ict-exports", "ICT 관련 품목 수출액", "해외 고객·제품 노출에 맞춰 확인", "up", customs),
    row("service-output", "서비스업 생산지수", "업종 전체의 수요 방향을 보조 확인", "up", ecos),
  ];
  return [row("sector-output", "해당 세부업종 생산·매출 지표", "기업의 실제 사업부문과 맞는 통계표를 선택", "up", kosis)];
}

function renderIndustryCatalog() {
  const catalog = industryIndicatorCatalog();
  $("#industry-template").innerHTML = `<option value="">관련 지표 선택</option>${catalog.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.source)}</option>`).join("")}`;
  $("#industry-source-help").textContent = "지표를 고르면 기업과 연결할 이유를 보여줍니다. KOSIS 통계는 실제 표와 계열을 선택해 공식 수치를 불러올 수 있습니다.";
  $("#kosis-tool").hidden = true;
}

$("#industry-template").addEventListener("change", (event) => {
  const item = industryIndicatorCatalog().find((entry) => entry.id === event.target.value);
  state.pendingKosisSeries = null;
  $("#kosis-tool").hidden = !item || item.source !== "KOSIS 국가통계포털";
  if (!item) return;
  $("#industry-name").value = item.name;
  $("#industry-source").value = item.url;
  $("#industry-direction").value = item.direction;
  for (const id of ["industry-period", "industry-latest", "industry-previous", "industry-exposure", "industry-exposure-basis"]) $("#" + id).value = "";
  $("#industry-source-help").innerHTML = `${escapeHtml(item.why)} · <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.source)} 원자료 ↗</a>`;
  if (item.source === "KOSIS 국가통계포털") {
    $("#kosis-search").value = item.searchQuery || item.name;
    $("#kosis-series-filter").value = item.seriesQuery || "";
    setKosisStatus("통계표를 검색한 뒤 회사 사업에 맞는 세부 계열을 선택하세요.");
  }
});

function setKosisStatus(message, error = false) {
  $("#kosis-status").textContent = message;
  $("#kosis-status").classList.toggle("error", error);
}

async function searchKosisTables() {
  const query = $("#kosis-search").value.trim();
  if (query.length < 2) return setKosisStatus("검색어를 2자 이상 입력해 주세요.", true);
  setKosisStatus("KOSIS 통계표를 검색하고 있습니다…");
  $("#kosis-search-button").disabled = true;
  try {
    const result = await fetchJson(`/api/kosis/search?q=${encodeURIComponent(query)}`);
    const suggestedId = industryIndicatorCatalog().find((item) => item.id === $("#industry-template").value)?.suggestedTableId;
    state.kosisTables = (result.tables || []).sort((a, b) => Number(b.tblId === suggestedId) - Number(a.tblId === suggestedId));
    $("#kosis-table").innerHTML = `<option value="">${state.kosisTables.length ? "통계표를 선택하세요" : "일치하는 통계표 없음"}</option>${state.kosisTables.map((row, index) => `<option value="${index}">${row.tblId === suggestedId ? "추천 · " : ""}${escapeHtml(row.tableName)} · ${escapeHtml(row.organization)}</option>`).join("")}`;
    $("#kosis-frequency").innerHTML = '<option value="">통계표 선택 후 표시</option>';
    $("#kosis-series").innerHTML = '<option value="">계열 선택 전</option>';
    $("#kosis-apply").disabled = true;
    setKosisStatus(state.kosisTables.length ? `${state.kosisTables.length}개 통계표를 찾았습니다. 회사 사업과 맞는 표를 선택하세요.` : "일치하는 통계표가 없습니다. 검색어를 바꿔 주세요.");
  } catch (error) { setKosisStatus(error.message, true); }
  finally { $("#kosis-search-button").disabled = false; }
}

$("#kosis-search-button").addEventListener("click", searchKosisTables);
$("#kosis-search").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); searchKosisTables(); } });

$("#kosis-table").addEventListener("change", async (event) => {
  const table = state.kosisTables[Number(event.target.value)];
  state.kosisSeries = [];
  $("#kosis-apply").disabled = true;
  if (!table || event.target.value === "") return;
  setKosisStatus("수록주기와 통계표 정보를 확인하고 있습니다…");
  try {
    const result = await fetchJson(`/api/kosis/table?orgId=${encodeURIComponent(table.orgId)}&tblId=${encodeURIComponent(table.tblId)}`);
    $("#kosis-frequency").innerHTML = result.frequencies.length
      ? result.frequencies.map((frequency) => `<option value="${escapeHtml(frequency)}">${({ M: "월", Q: "분기", Y: "연", H: "반기", D: "일" })[frequency] || frequency}</option>`).join("")
      : '<option value="">수록주기 확인 불가</option>';
    if (!result.frequencies.length) return setKosisStatus("이 통계표에서 사용 가능한 수록주기를 찾지 못했습니다. 다른 표를 선택해 주세요.", true);
    await loadKosisSeries();
  } catch (error) { setKosisStatus(error.message, true); }
});

async function loadKosisSeries() {
  const table = $("#kosis-table").value === "" ? null : state.kosisTables[Number($("#kosis-table").value)];
  const frequency = $("#kosis-frequency").value;
  if (!table || !frequency) return;
  setKosisStatus("최신 수록값과 직전 수록값을 확인하고 있습니다…");
  $("#kosis-apply").disabled = true;
  try {
    const query = $("#kosis-series-filter").value.trim();
    const result = await fetchJson(`/api/kosis/series?orgId=${encodeURIComponent(table.orgId)}&tblId=${encodeURIComponent(table.tblId)}&frequency=${encodeURIComponent(frequency)}&q=${encodeURIComponent(query)}`);
    state.kosisSeries = result.series || [];
    $("#kosis-series").innerHTML = `<option value="">${state.kosisSeries.length ? "세부 계열 선택" : "비교 가능한 두 수록값 없음"}</option>${state.kosisSeries.map((row, index) => `<option value="${index}">${escapeHtml(row.name)} · ${escapeHtml(row.previousPeriod)} → ${escapeHtml(row.latestPeriod)} (${escapeHtml(row.unit)})</option>`).join("")}`;
    setKosisStatus(state.kosisSeries.length ? `${state.kosisSeries.length}개 계열을 찾았습니다. 기업의 제품·시장에 맞는 항목을 선택하세요.` : "비교 가능한 두 수록값이 없습니다. 세부 계열 검색어를 줄이거나 다른 표·주기를 선택해 주세요.");
  } catch (error) { setKosisStatus(error.message, true); }
}

$("#kosis-frequency").addEventListener("change", loadKosisSeries);
$("#kosis-series-button").addEventListener("click", loadKosisSeries);
$("#kosis-series-filter").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); loadKosisSeries(); } });
$("#kosis-series").addEventListener("change", (event) => { $("#kosis-apply").disabled = event.target.value === ""; });
$("#kosis-apply").addEventListener("click", () => {
  const index = $("#kosis-series").value;
  const item = index === "" ? null : state.kosisSeries[Number(index)];
  if (!item) return;
  $("#industry-name").value = `${item.tableName} · ${item.name}`;
  $("#industry-period").value = `${item.previousPeriod} → ${item.latestPeriod}`;
  $("#industry-previous").value = item.previous;
  $("#industry-latest").value = item.latest;
  $("#industry-source").value = item.source;
  state.pendingKosisSeries = item;
  setKosisStatus(`공식 수치 ${item.previous} → ${item.latest} ${item.unit}를 적용했습니다. 회사 노출비중과 근거를 확인해 입력하세요.${item.comparisonWarning ? ` ${item.comparisonWarning}` : ""}`);
});

function renderIndustryEvidence() {
  const items = state.industryEvidence;
  $("#industry-evidence-count").textContent = items.length ? `· ${items.length}개 입력` : "";
  if (items.length) $(".industry-evidence").open = true;
  $("#industry-evidence-list").innerHTML = items.length ? items.map((item, index) => {
    const change = item.latest - item.previous;
    const favorable = item.direction === "up" ? change > 0 : change < 0;
    const sourceStatus = item.sourceType === "kosis" ? "KOSIS 공식 수치" : "담당자 입력 · 원자료 미검증";
    return `<article class="industry-evidence-item"><div><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.period)} · ${escapeHtml(item.unit || "단위 미기재")} · ${escapeHtml(sourceStatus)}</span><span>${escapeHtml(item.source)}</span></div><strong class="${item.comparisonWarning || change === 0 ? "tone-neutral" : favorable ? "tone-positive" : "tone-negative"}">${formatNumber(item.previous, 2)} → ${formatNumber(item.latest, 2)} ${escapeHtml(item.unit || "")} (${changeText(change, "")})</strong><p>기업 매출 노출 ${formatNumber(item.exposure, 1)}% · ${item.exposureBasis ? `노출 근거: ${escapeHtml(item.exposureBasis)}` : "노출 근거 미입력"} · ${item.comparisonWarning ? escapeHtml(item.comparisonWarning) : change === 0 ? "직전 수록시점 대비 변화 없음. 기업 영향은 별도 확인이 필요합니다." : `${favorable ? "유리한 방향" : "불리한 방향"}의 보조신호. 기업 영향은 별도 확인이 필요합니다.`}</p><button type="button" data-remove-industry="${index}" aria-label="지표 제거">×</button></article>`;
  }).join("") : `<p class="no-risk">기업의 실제 업종 노출을 연결한 지표가 없습니다. 공통 거시지표만으로 업종위험을 단정하지 않습니다.</p>`;
}

$("#add-industry-evidence").addEventListener("click", () => {
  const name = $("#industry-name").value.trim();
  const period = $("#industry-period").value.trim();
  const source = $("#industry-source").value.trim();
  const latest = Number($("#industry-latest").value);
  const previous = Number($("#industry-previous").value);
  const exposure = Number($("#industry-exposure").value);
  const exposureBasis = $("#industry-exposure-basis").value.trim();
  if (!state.analysis || !name || !period || !source || !$("#industry-latest").value || !$("#industry-previous").value || !$("#industry-exposure").value || ![latest, previous, exposure].every(Number.isFinite) || exposure < 0 || exposure > 100) {
    alert("분석 후 지표명·기간·두 수치·회사 노출비중·출처를 모두 입력해 주세요."); return;
  }
  const official = state.pendingKosisSeries;
  const sourceType = official && name === `${official.tableName} · ${official.name}` && period === `${official.previousPeriod} → ${official.latestPeriod}` && source === official.source && latest === official.latest && previous === official.previous ? "kosis" : "manual";
  state.industryEvidence.push({ id: crypto.randomUUID(), templateId: $("#industry-template").value || null, name, period, source, latest, previous, exposure, exposureBasis, direction: $("#industry-direction").value, sourceType, unit: sourceType === "kosis" ? official.unit : "", comparisonWarning: sourceType === "kosis" ? official.comparisonWarning : "", orgId: sourceType === "kosis" ? official.orgId : null, tblId: sourceType === "kosis" ? official.tblId : null, verification: sourceType === "kosis" ? "KOSIS 공식 수치 · 회사 노출 별도 확인" : "담당자 입력 · 원자료 검증 전" });
  state.pendingKosisSeries = null;
  renderIndustryEvidence(); renderEvidenceReview(); updateReviewOutcome().catch(() => {}); renderReport();
});
$("#industry-evidence-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove-industry]");
  if (!button) return;
  state.industryEvidence.splice(Number(button.dataset.removeIndustry), 1);
  renderIndustryEvidence(); renderEvidenceReview(); updateReviewOutcome().catch(() => {}); renderReport();
});

function ruleList(rules = []) {
  return `<div class="loan-rule-list compact">${rules.map((rule) => `<details class="loan-rule"><summary><span>${escapeHtml(rule.title)}</span><strong>${escapeHtml(rule.result)}</strong><small>근거 보기</small></summary><p class="loan-rule-meaning">${escapeHtml(rule.interpretation || rule.explanation || "고객자료와 비교해 판단합니다.")}</p><div class="loan-rule-detail"><p><b>계산</b> ${escapeHtml(rule.calculation || rule.formula)}</p><p><b>의미</b> ${escapeHtml(rule.explanation || "계산 결과의 의미를 추가 확인합니다.")}</p><p><b>확인할 자료</b> ${escapeHtml(rule.check)}</p></div></details>`).join("")}</div>`;
}

function renderLoans() {
  const support = state.analysis.decisionSupport;
  const a = state.analysis;
  const latest = a.records.at(-1);
  const comparison = currentComparison();
  const cashPeriod = comparison.interim ? `${comparison.period} 누적` : `${latest.period}년 연간`;
  const annualPeriod = `${latest.period}년 연간 사업보고서`;
  const working = Number(a.loanRequest.workingAmount) > 0;
  const facility = Number(a.loanRequest.facilityAmount) > 0;
  renderLoanOverview();
  const tabs = [
    working && ["working", "운전자금 검토"],
    facility && ["facility", "시설자금 검토"],
    working && facility && ["integrated", "통합 검토"],
  ].filter(Boolean);
  $("#loan-tabs").innerHTML = tabs.map(([id, label]) => `<button type="button" role="tab" data-loan-view="${id}" class="${state.loanView === id ? "active" : ""}">${label}</button>`).join("");
  if (state.loanView === "working") {
    const netOperatingInvestment = [latest.accountsReceivable, latest.inventory, latest.accountsPayable].every(Number.isFinite)
      ? latest.accountsReceivable + latest.inventory - latest.accountsPayable : null;
    $("#loan-grid").innerHTML = `<article class="loan-detail-card"><header><div><p class="eyebrow">WORKING CAPITAL / SHORT TERM</p><h3>운전자금 ${a.loanRequest.workingAmount.toLocaleString("ko-KR")}억원</h3></div><span>${a.loanRequest.workingTermMonths}개월</span></header><div class="loan-period-banner"><strong>영업활동현금흐름은 ${escapeHtml(cashPeriod)} ${formatMoney(comparison.current?.operatingCashFlow)}</strong>입니다. 회전일·운전자산과 아래 자동 규칙은 ${escapeHtml(annualPeriod)} 기준으로 따로 표시합니다. 두 기간의 금액을 직접 합산하지 않습니다.</div><div class="stance">${escapeHtml(support.workingCapital.stance)}</div><div class="loan-metric-grid"><div><span>현금전환주기 · ${escapeHtml(annualPeriod)}</span><strong>${formatNumber(latest.cashConversionCycle, 1)}일</strong><small>채권회수일 + 재고보유일 - 매입결제일</small></div><div><span>순영업운전자산 · ${escapeHtml(annualPeriod)}</span><strong>${formatMoney(netOperatingInvestment)}</strong><small>매출채권 + 재고 - 매입채무</small></div><div><span>영업활동현금흐름 · ${escapeHtml(cashPeriod)}</span><strong>${formatMoney(comparison.current?.operatingCashFlow)}</strong><small>${comparison.interim ? "반기·분기 누적 실적 · 전년 동기와 비교" : "연간 실적"} · 단기 상환재원의 출발점</small></div></div><h4>자동 적용된 검토 규칙 · ${escapeHtml(annualPeriod)}</h4>${ruleList(support.workingCapital.appliedRules)}<div class="loan-columns"><div><h4>중점 판단</h4><ul><li>요청금액이 실제 운전자금 공백과 맞는지</li><li>매출채권 회수와 재고판매로 기간 내 상환 가능한지</li><li>시설투자·관계회사 지원 등 다른 용도로 유출되지 않는지</li></ul></div><div><h4>필요 확인자료</h4><ul><li>월별 자금수지와 운전자금 산정표</li><li>매출채권 연령분석 및 상위 매출처</li><li>재고 명세와 장기체화 재고</li><li>매입·매출 결제조건</li></ul></div></div></article>`;
  } else if (state.loanView === "facility") {
    const capexCoverage = Number(latest.totalCapex) > 0 ? Number(latest.operatingCashFlow) / Number(latest.totalCapex) : null;
    $("#loan-grid").innerHTML = `<article class="loan-detail-card"><header><div><p class="eyebrow">FACILITY / LONG TERM</p><h3>시설자금 ${a.loanRequest.facilityAmount.toLocaleString("ko-KR")}억원</h3></div><span>${a.loanRequest.facilityTermMonths}개월</span></header><div class="loan-period-banner">아래 투자규모·영업활동현금흐름·부채비율과 자동 규칙은 모두 <strong>${escapeHtml(annualPeriod)}</strong> 기준입니다. ${comparison.interim ? `${escapeHtml(comparison.period)} 최신 실적은 위 요청여신 카드와 재무·성과 탭에서 별도로 확인합니다.` : ""}</div><div class="stance">${escapeHtml(support.facility.stance)}</div><div class="loan-metric-grid"><div><span>최근 유형·무형 CAPEX · 연간</span><strong>${formatMoney(latest.totalCapex)}</strong><small>투자현금흐름·주석과 교차확인</small></div><div><span>영업활동현금흐름 / CAPEX · 연간</span><strong>${Number.isFinite(capexCoverage) ? formatNumber(capexCoverage, 2, "배") : "자료없음"}</strong><small>내부창출 현금의 투자부담 흡수 정도</small></div><div><span>추가 차입 전 부채비율 · 연말</span><strong>${formatNumber(latest.debtRatio, 1, "%")}</strong><small>자기자금·담보와 함께 판단</small></div></div><h4>자동 적용된 검토 규칙 · ${escapeHtml(annualPeriod)}</h4>${ruleList(support.facility.appliedRules)}<div class="loan-columns"><div><h4>중점 판단</h4><ul><li>시설투자의 필요성과 기존시설 중복 여부</li><li>투자 후 생산·판매 증가의 객관적 근거</li><li>자기자금 투입과 비용초과 대응능력</li><li>시설 완료 후 장기 원리금 상환 가능성</li></ul></div><div><h4>필요 확인자료</h4><ul><li>계약서·견적서·인허가·공정계획</li><li>자기자금 조달 증빙</li><li>향후 3개년 추정손익과 자금수지</li><li>수주·판매계약 및 설비 잔존가치</li></ul></div></div></article>`;
  } else {
    const newDebt = (a.loanRequest.workingAmount + a.loanRequest.facilityAmount) * 100_000_000;
    const afterDebtRatio = Number.isFinite(latest.totalLiabilities) && Number.isFinite(latest.equity) && latest.equity > 0
      ? (latest.totalLiabilities + newDebt) / latest.equity * 100 : null;
    $("#loan-grid").innerHTML = `<article class="loan-detail-card integrated"><header><div><p class="eyebrow">INTEGRATED CREDIT VIEW</p><h3>운전자금과 시설자금 통합 검토</h3></div><span>총 ${(a.loanRequest.workingAmount + a.loanRequest.facilityAmount).toLocaleString("ko-KR")}억원</span></header><div class="loan-metric-grid"><div><span>운전자금</span><strong>${a.loanRequest.workingAmount.toLocaleString("ko-KR")}억원</strong><small>${a.loanRequest.workingTermMonths}개월 · 단기 회전재원</small></div><div><span>시설자금</span><strong>${a.loanRequest.facilityAmount.toLocaleString("ko-KR")}억원</strong><small>${a.loanRequest.facilityTermMonths}개월 · 장기 창출재원</small></div><div><span>신규여신 반영 부채비율</span><strong>${Number.isFinite(afterDebtRatio) ? formatNumber(afterDebtRatio, 1, "%") : "자료없음"}</strong><small>단순 가정: 신규여신 전액을 부채에 가산</small></div></div><div class="integrated-flow"><div><b>단기 검토</b><p>${escapeHtml(support.workingCapital.stance)}</p></div><span>＋</span><div><b>장기 검토</b><p>${escapeHtml(support.facility.stance)}</p></div><span>→</span><div><b>통합 확인</b><p>단기 회전자금이 시설투자 공백을 메우는 구조가 아닌지, 두 대출의 상환시점이 겹쳐 현금부담이 집중되지 않는지 확인합니다.</p></div></div><h4>운전자금 적용 규칙</h4>${ruleList(support.workingCapital.appliedRules)}<h4>시설자금 적용 규칙</h4>${ruleList(support.facility.appliedRules)}</article>`;
  }
  $("#decision-disclaimer").textContent = support.disclaimer;
}

function renderLoanOverview() {
  const a = state.analysis;
  const view = currentComparison();
  const { current, previous } = view;
  const requestedWorking = Number(a.loanRequest.workingAmount) || 0;
  const requestedFacility = Number(a.loanRequest.facilityAmount) || 0;
  const fact = (label, value, change) => `<div class="loan-glance-fact"><span>${label}</span><strong>${escapeHtml(value)}</strong><small class="tone-${change.tone}">${escapeHtml(change.text)} · 전년 ${view.interim ? "동기" : "대비"}</small></div>`;
  const workingCard = requestedWorking ? `<article class="loan-glance-card"><div class="loan-glance-head"><div><span class="loan-term">단기 · ${a.loanRequest.workingTermMonths}개월</span><h3>운전자금</h3></div><strong>${requestedWorking.toLocaleString("ko-KR")}억원</strong></div><div class="loan-glance-facts">${fact("매출액", formatMoney(current?.revenue), amountChange(current?.revenue, previous?.revenue))}${fact(`영업활동현금흐름 · ${view.interim ? "중간 누적" : "연간"}`, formatMoney(current?.operatingCashFlow), amountChange(current?.operatingCashFlow, previous?.operatingCashFlow))}</div><p class="loan-glance-judgment"><b>우선 확인</b> · 매입부터 입금까지의 실제 회전기간이 신청 만기와 맞는지 확인해야 합니다.</p><p><b>받을 자료</b> · 월별 매입·판매·회수 계획, 매출채권 Aging</p><button type="button" data-loan-glance="working">운전자금 계산·규칙 보기 →</button></article>` : "";
  const facilityCard = requestedFacility ? `<article class="loan-glance-card"><div class="loan-glance-head"><div><span class="loan-term">장기 · ${a.loanRequest.facilityTermMonths}개월</span><h3>시설자금</h3></div><strong>${requestedFacility.toLocaleString("ko-KR")}억원</strong></div><div class="loan-glance-facts">${fact("영업이익", formatMoney(current?.operatingProfit), amountChange(current?.operatingProfit, previous?.operatingProfit))}${fact("부채비율", formatNumber(view.debtRatio, 1, "%"), ratioChange(view.debtRatio, view.previousDebtRatio, true))}</div><p class="loan-glance-judgment"><b>우선 확인</b> · 신규 설비가 장기 원리금 상환재원을 만드는지 확인 전입니다.</p><p><b>받을 자료</b> · 설비 계약·견적, 자기자금, 수주·가동률 계획</p><button type="button" data-loan-glance="facility">시설자금 계산·규칙 보기 →</button></article>` : "";
  $("#loan-overview").innerHTML = `<p class="loan-overview-period">${escapeHtml(view.period)} · ${escapeHtml(view.scope)} · ${view.interim ? "전년 동기" : "전년"} 비교. 공개자료의 관찰값이며 대출 승인·적정 금액 판단은 아닙니다.</p><div class="loan-glance-grid">${workingCard}${facilityCard}</div>${requestedWorking && requestedFacility ? `<div class="loan-combined"><strong>두 자금을 함께 보면</strong><span>운전자금 회수월과 시설자금 원리금 납부월이 겹치는지 확인</span><span>기존 차입 만기표를 받아 월별 현금부담 대조</span></div>` : ""}`;
}

$("#loan-overview").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-loan-glance]");
  if (!button) return;
  state.loanView = button.dataset.loanGlance;
  renderLoans();
  $("#loan-tabs").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("#loan-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-loan-view]");
  if (!button) return;
  state.loanView = button.dataset.loanView;
  renderLoans();
});

function appliedLoanRequest() {
  const form = requestPayload().loanRequest;
  return { ...state.analysis.loanRequest,
    workingRatePct: form.workingRatePct, facilityRatePct: form.facilityRatePct,
    workingRateType: form.workingRateType, facilityRateType: form.facilityRateType,
    workingRepayment: form.workingRepayment, facilityRepayment: form.facilityRepayment,
    facilityGraceMonths: form.facilityGraceMonths,
  };
}

function parseNumberSeries(id) {
  const text = $(id).value.trim();
  if (!text) return null;
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.some((part) => !Number.isFinite(Number(part)))) throw new Error(`${id}에 숫자가 아닌 값이 있습니다. 쉼표로 구분해 입력해 주세요.`);
  return parts.map(Number);
}

function customerInputPayload() {
  return {
    openingUnrestrictedCash: $("#opening-cash").value === "" ? null : Number($("#opening-cash").value),
    minimumCashBalance: $("#minimum-cash").value === "" ? null : Number($("#minimum-cash").value),
    monthlyAvailableCash: parseNumberSeries("#monthly-cash"),
    monthlyExistingDebtService: parseNumberSeries("#monthly-existing"),
    annualAvailableCash: parseNumberSeries("#annual-cash"),
    annualExistingDebtService: parseNumberSeries("#annual-existing"),
    targetCoverage: $("#target-coverage").value === "" ? null : Number($("#target-coverage").value),
    debtRegister: state.debtRegister,
    debtRegisterComplete: $("#debt-register-complete").checked,
    publicDebtEok: Number.isFinite(state.analysis?.records?.at(-1)?.totalDebt) ? state.analysis.records.at(-1).totalDebt / 100_000_000 : null,
  };
}

function debtRegisterSummary() {
  const total = state.debtRegister.reduce((sum, item) => sum + item.balanceEok, 0);
  const variable = state.debtRegister.filter((item) => item.rateType === "floating").reduce((sum, item) => sum + item.balanceEok, 0);
  const publicDebt = state.analysis?.records?.at(-1)?.totalDebt;
  const publicEok = Number.isFinite(publicDebt) ? publicDebt / 100_000_000 : null;
  const gap = publicEok === null ? null : total - publicEok;
  const reconciled = gap !== null && Math.abs(gap) <= Math.max(publicEok * .05, 1);
  const dueWithin12 = state.debtRegister.filter((item) => item.maturityMonths <= 12).reduce((sum, item) => sum + item.balanceEok, 0);
  return { total, variableShare: total > 0 ? variable / total * 100 : null, publicEok, gap, dueWithin12, trusted: $("#debt-register-complete").checked && total > 0 && reconciled };
}

function renderDebtRegister() {
  const summary = debtRegisterSummary();
  const shareInput = $("#existing-variable-share");
  if (summary.trusted) { shareInput.value = summary.variableShare.toFixed(2); shareInput.dataset.auto = "1"; }
  else if (shareInput.dataset.auto === "1") { shareInput.value = ""; delete shareInput.dataset.auto; }
  shareInput.readOnly = summary.trusted;
  if (!state.debtRegister.length) {
    $("#debt-register-list").innerHTML = `<p class="debt-register-summary">상세 명세 미입력 · 기본 분석은 공시 총차입금 ${summary.publicEok === null ? "자료없음" : `${formatNumber(summary.publicEok, 1)}억원`}과 금융비용으로 진행합니다. 금리변화에 따른 비용과 12개월 내 만기집중을 정밀 검토할 때만 차입별 자료를 입력하세요.</p>`;
    return;
  }
  $("#debt-register-list").innerHTML = state.debtRegister.map((item, index) => `<div class="debt-register-item"><b>${escapeHtml(item.lender)}<small>${escapeHtml(item.source)}</small></b><span>잔액 ${formatNumber(item.balanceEok, 2)}억원</span><span>${item.maturityMonths}개월 후 만기</span><span>${formatNumber(item.ratePct, 2)}% · ${item.rateType === "floating" ? "변동" : "고정"}</span><span>${escapeHtml(item.collateral || "담보·보증 미기재")}</span><button type="button" data-remove-debt="${index}" aria-label="차입 삭제">×</button></div>`).join("") + `<div class="debt-register-summary">입력 잔액 ${formatNumber(summary.total, 2)}억원 · 12개월 내 만기 잔액 ${formatNumber(summary.dueWithin12, 2)}억원 · 변동금리 비중 ${summary.variableShare === null ? "자료없음" : formatNumber(summary.variableShare, 1, "%")}${summary.publicEok !== null ? ` · 공시 차입금 ${formatNumber(summary.publicEok, 2)}억원과 차이 ${formatNumber(summary.gap, 2)}억원` : ""}<br>${summary.trusted ? "전체 명세 확인 표시: 스트레스 테스트에 비중 반영" : "전체 명세와 공시 잔액을 대조하기 전에는 비중을 자동 반영하지 않습니다."}</div>`;
}

$("#add-debt").addEventListener("click", () => {
  const lender = $("#debt-lender").value.trim();
  const balanceEok = Number($("#debt-balance").value);
  const maturityMonths = Number($("#debt-maturity").value);
  const ratePct = Number($("#debt-rate").value);
  const source = $("#debt-source").value.trim();
  if (!lender || !source || !$("#debt-balance").value || !$("#debt-maturity").value || !$("#debt-rate").value || ![balanceEok, maturityMonths, ratePct].every(Number.isFinite) || balanceEok < 0 || maturityMonths < 1 || ratePct < 0 || ratePct > 30) { alert("차입명·잔액·남은 만기·금리·출처를 정확히 입력해 주세요."); return; }
  state.debtRegister.push({ lender, balanceEok, maturityMonths, ratePct, rateType: $("#debt-rate-type").value, collateral: $("#debt-collateral").value.trim(), source });
  for (const id of ["debt-lender", "debt-balance", "debt-maturity", "debt-rate", "debt-collateral", "debt-source"]) $("#" + id).value = "";
  state.structure = null; renderDebtRegister(); renderStructure(); updateReviewOutcome().catch(() => {}); if (state.analysis) runStress();
});
$("#debt-register-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove-debt]");
  if (!button) return;
  state.debtRegister.splice(Number(button.dataset.removeDebt), 1);
  state.structure = null; renderDebtRegister(); renderStructure(); updateReviewOutcome().catch(() => {}); if (state.analysis) runStress();
});
$("#debt-register-complete").addEventListener("change", () => { state.structure = null; renderDebtRegister(); renderStructure(); updateReviewOutcome().catch(() => {}); if (state.analysis) runStress(); });

function renderStructure() {
  const root = $("#structure-result");
  const result = state.structure;
  if (!result) { root.innerHTML = "<p>고객의 월별·연도별 상환가능현금과 기존 원리금을 입력한 뒤 계산해 주세요.</p>"; return; }
  const missing = (item) => item.missingInputs?.length ? `<p class="structure-missing">필요자료: ${item.missingInputs.map(escapeHtml).join(" · ")}</p>` : "";
  const working = result.working;
  const facility = result.facility;
  const workingRows = working.rows?.length ? `<details><summary>월별 현금잔액과 원리금 일정 보기</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>월</th><th>상환가능현금</th><th>기존 원리금</th><th>신규 운전자금</th><th>월말 현금</th></tr></thead><tbody>${working.rows.map((row) => `<tr><td>${row.month}</td><td>${formatNumber(row.availableCash, 2)}억원</td><td>${formatNumber(row.existingService, 2)}억원</td><td>${formatNumber(row.newWorkingService, 2)}억원</td><td class="${row.endingCash < 0 ? "tone-negative" : ""}">${formatNumber(row.endingCash, 2)}억원</td></tr>`).join("")}</tbody></table></div></details>` : "";
  const facilityRows = facility.rows?.length ? `<details><summary>연도별 원리금상환배율 보기</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>연도</th><th>상환가능현금</th><th>기존 원리금</th><th>신규 시설자금</th><th>합계 원리금</th><th>상환배율</th></tr></thead><tbody>${facility.rows.map((row) => `<tr><td>${row.year}년차</td><td>${formatNumber(row.availableCash, 2)}억원</td><td>${formatNumber(row.existingService, 2)}억원</td><td>${formatNumber(row.newFacilityService, 2)}억원</td><td>${formatNumber(row.totalService, 2)}억원</td><td class="${row.coverage !== null && row.coverage < facility.targetCoverage ? "tone-negative" : ""}">${row.coverage === null ? "산정불가" : formatNumber(row.coverage, 2, "배")}</td></tr>`).join("")}</tbody></table></div></details>` : "";
  root.innerHTML = `<div class="structure-overview"><div><span>운전자금 ${formatNumber(working.requested, 1)}억원</span><strong>${escapeHtml(working.status)}</strong>${Number.isFinite(working.indicativeCeiling) ? `<p>입력가정상 상한 ${formatNumber(working.indicativeCeiling, 1)}억원 · ${working.firstShortfallMonth ? `${working.firstShortfallMonth}개월차 부족` : "신청액 충족"}</p>` : ""}${missing(working)}</div><div><span>시설자금 ${formatNumber(facility.requested, 1)}억원</span><strong>${escapeHtml(facility.status)}</strong>${Number.isFinite(facility.indicativeCeiling) ? `<p>입력가정상 상한 ${formatNumber(facility.indicativeCeiling, 1)}억원 · ${facility.firstShortfallYear ? `${facility.firstShortfallYear}년차 미달` : "신청액 충족"}</p>` : ""}${missing(facility)}</div><div><span>두 대출 통합</span><strong>${escapeHtml(result.combined.status)}</strong><p>${result.combined.firstShortfallMonth ? `${result.combined.firstShortfallMonth}개월차 현금부족 · ` : ""}${result.combined.firstShortfallYear ? `${result.combined.firstShortfallYear}년차 상환배율 미달` : "월별·연도별 자료를 함께 검토"}</p></div></div>${result.registerSummary?.totalEok ? `<p class="debt-register-summary">기존 차입명세 ${formatNumber(result.registerSummary.totalEok, 1)}억원 · 12개월 내 만기 잔액 ${formatNumber(result.registerSummary.dueWithin12Eok, 1)}억원 · 공시 차입금과 차이 ${formatNumber(result.registerSummary.reconciliationGapEok, 1)}억원. 월별 기존 원리금 입력과 별도 대조 필요.</p>` : ""}${workingRows}${facilityRows}<p class="structure-basis">${escapeHtml(result.basis)} 상한은 현금수지 입력값이 바뀌면 달라지므로 증빙 확인 전 대출 제안에 사용하지 마세요.</p>`;
  const alt = result.termAlternatives;
  if (alt?.working?.length || alt?.facility?.length) root.insertAdjacentHTML("beforeend", `<div class="term-alternatives"><h3>만기 변경 시 어떻게 달라지나</h3><p>같은 신청금액·가정금리·상환방식을 유지한 비교입니다. 더 긴 기간은 그 기간의 현금수지가 입력돼야 평가합니다.</p><div>${(alt.working || []).map((item) => `<article><span>운전자금 ${item.termMonths}개월</span><strong>${escapeHtml(item.status)}</strong><small>${item.shortfallMonth ? `${item.shortfallMonth}개월차 현금부족` : Number.isFinite(item.endingCash) ? `만기 후 현금 ${formatNumber(item.endingCash, 1)}억원` : "기간별 자료 필요"}</small></article>`).join("")}${(alt.facility || []).map((item) => `<article><span>시설자금 ${item.termMonths}개월</span><strong>${escapeHtml(item.status)}</strong><small>${item.shortfallYear ? `${item.shortfallYear}년차 상환배율 미달` : Number.isFinite(item.minimumCoverage) ? `최저 상환배율 ${formatNumber(item.minimumCoverage, 2)}배` : "기간별 자료 필요"}</small></article>`).join("")}</div></div>`);
  const rates = result.rateAlternatives;
  if (rates?.working?.length || rates?.facility?.length) root.insertAdjacentHTML("beforeend", `<div class="term-alternatives"><h3>금리 가정별 상환 여력</h3><p>신청금액·만기·상환방식은 그대로 두고 입력금리 주변 ±1~2%p를 계산합니다. 은행 제시금리나 실제 금리전망이 아닙니다.</p><div>${(rates.working || []).map((item) => `<article><span>운전자금 가정 ${formatNumber(item.ratePct, 2)}%</span><strong>${escapeHtml(item.status)}</strong><small>${item.shortfallMonth ? `${item.shortfallMonth}개월차 현금부족` : Number.isFinite(item.endingCash) ? `만기 후 현금 ${formatNumber(item.endingCash, 1)}억원` : "기간별 자료 필요"}</small></article>`).join("")}${(rates.facility || []).map((item) => `<article><span>시설자금 가정 ${formatNumber(item.ratePct, 2)}%</span><strong>${escapeHtml(item.status)}</strong><small>${item.shortfallYear ? `${item.shortfallYear}년차 상환배율 미달` : Number.isFinite(item.minimumCoverage) ? `최저 상환배율 ${formatNumber(item.minimumCoverage, 2)}배` : "기간별 자료 필요"}</small></article>`).join("")}</div></div>`);
}

async function calculateStructure() {
  if (!state.analysis) return;
  $("#calculate-structure").disabled = true;
  try {
    state.analysis.loanRequest = appliedLoanRequest();
    state.structure = await fetchJson("/api/loan-structure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loanRequest: state.analysis.loanRequest, customerInputs: customerInputPayload() }) });
    renderStructure();
    await updateReviewOutcome();
    renderReport();
  } catch (error) {
    const message = /API를 찾을 수 없습니다|404/.test(error.message)
      ? "현재 실행 중인 4180 서버에 상환구조 계산 기능이 없습니다. START_LOCAL.cmd로 서버를 다시 실행한 뒤 페이지를 새로고침해 주세요."
      : error.message;
    $("#structure-result").innerHTML = `<p class="stress-error">${escapeHtml(message)}</p>`;
  }
  finally { $("#calculate-structure").disabled = false; }
}
$("#calculate-structure").addEventListener("click", calculateStructure);

let stressRunId = 0;
async function runStress() {
  if (!state.analysis) return;
  const runId = ++stressRunId;
  const scenario = { salesShock: Number($("#sales-shock").value), marginShockPp: Number($("#margin-shock").value) };
  $("#run-stress").disabled = true;
  try {
    const response = await fetchJson("/api/stress-test/simple", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latest: state.analysis.records.at(-1), scenario }) });
    if (runId !== stressRunId) return;
    state.stress = response;
    const result = state.stress;
    if (result?.simple !== true || typeof result.available !== "boolean") throw new Error("간단한 민감도 계산 응답을 확인하지 못했습니다. 서버를 다시 시작해 주세요.");
    if (!result.available) {
      $("#stress-result").innerHTML = `<div class="stress-error"><b>공시 수치가 부족합니다.</b><p>${escapeHtml(result.interpretation)}</p></div>`;
      try { renderReport(); } catch (reportError) { console.error("리포트 갱신 오류", reportError); }
      return;
    }
    const calculations = result.calculationSteps.map((step) => `<p><b>${escapeHtml(step.label)}</b> · ${escapeHtml(step.substitution)} = ${formatMoney(step.result, 1)}</p>`).join("");
    $("#stress-result").innerHTML = `<p class="eyebrow">${escapeHtml(result.label)}</p><h3>가정에 따른 변화</h3><div class="stress-metrics simple"><div><span>매출</span><small>공시 ${formatMoney(result.baseline.revenue)}</small><strong>${formatMoney(result.stressed.revenue)}</strong><em>${formatSignedMoney(result.changes.revenue)}</em></div><div><span>영업이익</span><small>공시 ${formatMoney(result.baseline.operatingProfit)}</small><strong>${formatMoney(result.stressed.operatingProfit)}</strong><em>${formatSignedMoney(result.changes.operatingProfit)}</em></div></div><p class="stress-comment">기존 영업이익률 ${formatNumber(result.baseline.operatingMargin, 1)}% → 가정 ${formatNumber(result.stressed.operatingMargin, 1)}%. ${escapeHtml(result.interpretation)}</p><details class="stress-calculations"><summary>계산 근거 보기</summary>${calculations}</details>`;
    try { renderReport(); } catch (reportError) { console.error("리포트 갱신 오류", reportError); }
  } catch (error) {
    if (runId === stressRunId) $("#stress-result").innerHTML = `<div class="stress-error"><b>재계산하지 못했습니다.</b><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    if (runId === stressRunId) $("#run-stress").disabled = false;
  }
}

$("#run-stress").addEventListener("click", runStress);
for (const id of ["working-rate", "facility-rate", "working-rate-type", "facility-rate-type", "working-repayment", "facility-repayment", "facility-grace"]) $("#" + id).addEventListener("change", () => {
  if (!state.analysis) return;
  state.structure = null;
  renderStructure();
  updateReviewOutcome().catch(() => {});
  runStress();
});
for (const id of ["existing-variable-share", "credit-sales-share"]) $("#" + id).addEventListener("change", () => { if (state.analysis) runStress(); });
let stressTimer;
for (const [id, label, formatter] of [
  ["sales-shock", "sales-shock-label", (v) => `${Number(v) > 0 ? "+" : ""}${v}%`],
  ["margin-shock", "margin-shock-label", (v) => `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(1)}%p`],
  ["rate-shock", "rate-shock-label", (v) => `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}%p`],
  ["collection-delay", "delay-label", (v) => `${Number(v) > 0 ? "+" : ""}${v}일`],
]) {
  $(`#${id}`).addEventListener("input", (event) => {
    $(`#${label}`).textContent = formatter(event.target.value);
    clearTimeout(stressTimer);
    stressTimer = setTimeout(runStress, 180);
  });
}

const INSPECTION_GUIDANCE = {
  "FI-C01": ["예: 경영진이 최근 실적 변화의 원인과 대응 일정·책임자를 설명했는지 기록", "예: 면담 일시·참석자, 월별 실적표와 승인된 사업계획의 해당 쪽", "예: 제시한 회복 일정과 실제 수주·실적의 차이를 재확인"],
  "FI-C02": ["예: 핵심 담당자 이탈 여부와 공백 시 업무를 맡을 사람을 면담으로 확인", "예: 조직도, 인사 변동 내역, 업무 인수인계 기록", "예: 대체 인력이 없는 핵심 업무의 운영 위험을 심사역에게 전달"],
  "FI-C03": ["예: 주요 거래처의 발주·납품·검수 흐름이 현장 설명과 일치하는지 기록", "예: 발주서·납품확인서·거래처 면담 기록의 날짜와 문서번호", "예: 제출 매출자료와 실제 거래 흐름이 다른 부분의 원인을 요청"],
  "FI-C04": ["예: 구매 승인자와 자금 집행자가 분리되어 있는지 담당자별로 확인", "예: 결재권한표, 발주·입고·지급 승인 기록", "예: 승인·기록을 한 사람이 맡는 구간의 통제 보완 요청"],
  "FI-F01": ["예: 구입 예정 설비의 위치·사양·계약 상대방과 계약금 지급 여부 확인", "예: 설비 견적서·계약서·계약금 이체증과 현장 사진", "예: 계약과 실물·지급내역이 다르면 시설자금 집행 조건 재검토"],
  "FI-F02": ["예: 이전·현재 가동률의 조사 기간과 생산량 산출 방식을 대조", "예: 월별 생산일보, 설비별 가동기록, 현장 확인 사진", "예: 기존 설비의 유휴율을 반영해 신규 투자 필요성 재검토"],
  "FI-F03": ["예: 증설 후 늘어나는 생산량을 어느 고객이 언제 구매하는지 확인", "예: 수주서·구매의향서·판매계획과 납기 일정", "예: 확정 수요가 부족하면 투자 후 상환재원 추정을 보수적으로 수정"],
  "FI-W01": ["예: 원재료 매입일부터 납품·검수·입금일까지 실제 소요일을 확인", "예: 매입·출고·세금계산서·입금 내역의 거래일자", "예: 회수시점이 대출 만기를 넘으면 만기·상환방식 재검토"],
  "FI-W02": ["예: 신청자금이 지급될 공급처와 실제 구매 품목·금액 확인", "예: 발주서·거래명세서·공급처 청구서·지급 계좌", "예: 신청 목적과 다른 지출 가능성이 있으면 집행 방식 보완 요청"],
  "재고운영": ["예: 장기 보관·불량 재고를 현장에서 구분하고 장부 수량과 대조", "예: 재고명세·실사표·보관구역 사진과 촬영일", "예: 장기재고의 판매 가능액과 손실 반영 여부 확인"],
  "영업·회수": ["예: 주요 거래처의 납품 후 검수·청구·입금 지연 사유 확인", "예: 매출채권 연령표, 검수확인서, 입금 내역", "예: 연체·분쟁 채권을 회수 예상액에서 별도 검토"],
  "생산": ["예: 실제 가동 중인 라인과 멈춘 라인, 병목공정을 현장에서 확인", "예: 생산일보·작업지시서·설비별 가동기록과 현장 사진", "예: 생산계획과 실제 가동 차이가 수주 이행에 미치는 영향 확인"],
  "품질": ["예: 불량·반품이 반복되는 품목과 최근 개선조치의 실행 여부 확인", "예: 품질검사표·반품 기록·고객 클레임 처리내역", "예: 품질비용과 거래처 이탈 가능성을 추가 검토"],
  "설비": ["예: 핵심설비의 고장 빈도·정지 시간과 예비설비 유무 확인", "예: 정비대장·고장 이력·설비 사진과 점검일", "예: 예상 수선비와 조업중단 위험을 투자계획에 반영"],
  "점포운영": ["예: 주요 점포의 유동 고객·매대 운영이 제출된 매출 추세와 맞는지 확인", "예: 점포별 매출·방문객 자료, 현장 사진과 방문 시간", "예: 매출 부진 점포의 개선계획과 비용 부담 확인"],
  "상품·재고": ["예: 장기 진열·할인·폐기 상품의 비중과 실제 관리 상태 확인", "예: 상품별 재고기간표·폐기 기록·진열 사진", "예: 재고손실 가능액과 재고 회전계획을 검토"],
  "상권·채널": ["예: 경쟁점·상권 변화와 온라인 주문 처리 현황을 현장에서 확인", "예: 상권 분석자료, 채널별 매출표, 배송·픽업 운영기록", "예: 점포별 투자·철수 계획이 수익성에 미칠 영향 확인"],
  "기술·권리": ["예: 핵심기술의 개발 주체와 특허 사용·귀속 관계를 면담으로 확인", "예: 특허등록부·라이선스 계약·분쟁 관련 서류", "예: 권리 공백이 상용화와 매출에 미칠 영향 검토"],
  "개발인력": ["예: 핵심 개발자의 담당 영역과 퇴사 시 인수인계 가능성 확인", "예: 연구개발 조직도·인수인계 문서·프로젝트 배정표", "예: 특정 인력 의존 프로젝트의 납기 위험 확인"],
  "상용화": ["예: 시제품 검증에서 양산·매출까지 남은 단계와 일정 확인", "예: 고객 테스트 결과·인증서·수주서·출하계획", "예: 확정 계약이 아닌 예상 매출은 상환재원과 구분"],
  "사업현장": ["예: 현장 공정률과 실제 시공 상태가 사업계획과 일치하는지 확인", "예: 감리보고서·기성확인서·인허가 문서·현장 사진", "예: 공정 지연에 따른 자금 집행·회수시점 재검토"],
  "원가·공정": ["예: 자재비 상승과 공정 지연에 대응할 예비비·책임자 확인", "예: 수정 실행예산·공정표·하도급 변경계약", "예: 추가 공사비가 현금수지와 대출 상환에 미칠 영향 확인"],
  "분양·임대": ["예: 분양·임대 계약의 실제 체결·해지 현황과 미계약 물량 확인", "예: 계약 현황표·계약서·계약금 입금 내역", "예: 미계약 물량을 보수적으로 반영해 회수재원 재검토"],
};

function inspectionGuidance(item) {
  return INSPECTION_GUIDANCE[item.ruleId] || INSPECTION_GUIDANCE[item.category] || [
    `예: ${item.question}에 대해 현장에서 직접 확인한 사실과 시점을 기록`,
    `예: ${item.reason}을 확인한 원자료명·문서번호·쪽수 또는 사진`,
    "예: 확인 결과가 자금용도·상환재원에 미치는 영향과 다음 조치",
  ];
}

function inspectionAttachments(item) {
  return state.attachments.filter((file) => file.inspectionId === item.ruleId);
}

function renderInspection() {
  const items = state.analysis.inspection;
  const profile = industryProfile();
  const counts = items.reduce((map, item) => map.set(item.ruleSource, (map.get(item.ruleSource) || 0) + 1), new Map());
  const utilizationBox = $("#utilization-box");
  $("#inspection-context").after(utilizationBox);
  $("#inspection-context").innerHTML = `<div><b>${escapeHtml(profile.label)} 현장실사 관점</b><p>${escapeHtml(profile.site)}</p>${state.publicDemo ? "<p>PDF·사진은 이 브라우저 탭에서만 임시 첨부합니다. 서버에 보내거나 보관하지 않으며, 탭을 닫으면 파일이 사라집니다. 실제 고객자료는 올리지 마세요.</p>" : ""}</div><div class="inspection-rules"><b>체크리스트 생성 규칙</b><p>공통통제 → 업종 → 재무 위험신호 → 신청 자금용도 순으로 항목을 합치고 중복 질문을 제거합니다.</p>${[...counts].map(([name, count]) => `<span>${escapeHtml(name)} ${count}개</span>`).join("")}</div>`;
  utilizationBox.hidden = profile.id !== "manufacturing";
  $("#inspection-list").innerHTML = items.map((item, index) => {
    const detail = state.inspectionDetails[index] || {};
    const selected = state.inspectionStatus[index] || "미확인";
    const [observationHint, evidenceHint, followUpHint] = inspectionGuidance(item);
    const files = inspectionAttachments(item);
    const fileList = files.length ? `<ul class="inspection-attached-files">${files.map((file) => `<li><a href="${file.sessionOnly ? escapeHtml(file.objectUrl) : `/api/cases/${encodeURIComponent(state.caseId)}/evidence/${encodeURIComponent(file.id)}`}" download="${escapeHtml(file.name)}">${escapeHtml(file.name)}</a><small>${file.sessionOnly ? "브라우저 탭에만 임시 첨부" : "로컬 사건에 저장"} · 검증 전 · SHA256 ${escapeHtml(file.sha256?.slice(0, 12))}…</small></li>`).join("")}</ul>` : "";
    const upload = `<div class="inspection-file-upload"><input type="file" data-inspection-file="${index}" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" hidden /><button type="button" class="secondary-button" data-inspection-upload="${index}">PDF·사진 첨부</button><small>${state.publicDemo ? "이 탭에서만 임시 첨부 · 서버 저장 없음 · 실제 고객자료 금지" : "이 항목에 연결해 로컬 저장"} · 파일당 10MB 이하 · 자동 판독 없음</small>${fileList}</div>`;
    const options = [["미확인", "미확인"], ["확인", "정상 확인"], ["이상징후", "우려 확인"], ["자료요청", "자료 요청"]].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
    return `<article class="inspection-item"><div class="inspection-item-head"><span class="category">${escapeHtml(item.category)}<small>${escapeHtml(item.ruleSource)}</small></span><div><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.reason)}</p></div><label>현장 판단<select data-inspection="${index}">${options}</select></label></div><div class="inspection-detail-fields"><label>관찰한 사실<textarea data-inspection-note="${index}" data-field="observation" rows="2" placeholder="${escapeHtml(observationHint)}">${escapeHtml(detail.observation || "")}</textarea></label><div class="inspection-evidence-field"><label>확인 근거·증빙<textarea data-inspection-note="${index}" data-field="evidence" rows="2" placeholder="${escapeHtml(evidenceHint)}">${escapeHtml(detail.evidence || "")}</textarea></label>${upload}</div><label>심사 영향·후속조치<textarea data-inspection-note="${index}" data-field="followUp" rows="2" placeholder="${escapeHtml(followUpHint)}">${escapeHtml(detail.followUp || "")}</textarea></label></div><small class="inspection-entry-state" data-inspection-state="${index}"></small></article>`;
  }).join("");
  if (!utilizationBox.hidden) {
    const targetIndex = items.findIndex((item) => item.category === "생산" && /가동|생산라인/.test(item.question));
    const fallbackIndex = items.findIndex((item) => /가동률/.test(item.question));
    const target = $("#inspection-list").children[targetIndex >= 0 ? targetIndex : fallbackIndex];
    if (target) target.append(utilizationBox);
  }
  updateInspectionProgress();
}

function inspectionWorksheetMarkup() {
  const analysis = state.analysis;
  const request = analysis.loanRequest || {};
  const requested = [
    Number(request.workingAmount) > 0 ? `운전자금 ${formatNumber(request.workingAmount, 0)}억원` : null,
    Number(request.facilityAmount) > 0 ? `시설자금 ${formatNumber(request.facilityAmount, 0)}억원` : null,
  ].filter(Boolean).join(" · ") || "신청금액 확인 전";
  const utilization = industryProfile().id === "manufacturing" ? `<div class="worksheet-utilization"><b>가동률 현장 확인</b><span>이전 가동률 ______ %</span><span>현재 가동률 ______ %</span><span>산출자료·조사시점 ________________________________________</span></div>` : "";
  const items = (analysis.inspection || []).map((item, index) => `<section class="worksheet-item"><div class="worksheet-item-head"><b>${index + 1}. ${escapeHtml(item.category)}</b><span>${escapeHtml(item.ruleSource)}</span></div><h2>${escapeHtml(item.question)}</h2><p>확인 목적: ${escapeHtml(item.reason)}</p><div class="worksheet-choices">□ 정상 확인　 □ 우려 확인　 □ 자료 요청　 □ 해당 없음</div><div class="worksheet-write"><b>현장 관찰·담당자 답변</b><i></i><i></i></div><div class="worksheet-write"><b>확인 근거·증빙번호</b><i></i></div><div class="worksheet-write"><b>심사 영향·후속조치</b><i></i></div></section>`).join("");
  return `<header class="worksheet-header"><p>CREDITLENS · FIELD VISIT WORKSHEET</p><h1>현장실사 점검지 <small>방문 전 빈 양식</small></h1><p>자동 판정 결과나 기존 현장 메모를 넣지 않았습니다. 현장에서 사실·근거·후속조치를 직접 기록하세요.</p></header><div class="worksheet-meta"><div><b>기업명</b><span>${escapeHtml(analysis.company.name)}</span></div><div><b>재무 범위</b><span>${state.statementScope === "OFS" ? "별도 · 차주 법인" : "연결 · 그룹 관점"}</span></div><div><b>신청자금</b><span>${escapeHtml(requested)}</span></div><div><b>방문일시</b><span>________년 ____월 ____일　 ____:____</span></div><div><b>방문장소</b><span>________________________________</span></div><div><b>담당자·면담자</b><span>________________________________</span></div></div><p class="worksheet-guide">업종·재무 신호·신청 자금용도에 따라 생성된 ${analysis.inspection.length}개 항목입니다. 체크만으로 결론을 내리지 말고 관찰 사실과 확인자료를 함께 남기세요.</p>${utilization}<main class="worksheet-items">${items}</main><section class="worksheet-summary"><h2>현장 종합 메모 · 심사역 전달 사항</h2><i></i><i></i><i></i><i></i><p>추가 요청자료: ________________________________________________________________________________</p><p>담당자 서명: ______________________　확인일: ______________________</p></section>`;
}

function clearInspectionPrint() {
  document.body.classList.remove("print-inspection-form");
  const sheet = $("#inspection-print-sheet");
  sheet.hidden = true;
  sheet.innerHTML = "";
}

window.addEventListener("afterprint", clearInspectionPrint);
$("#print-inspection-form").addEventListener("click", () => {
  if (!state.analysis) return;
  const sheet = $("#inspection-print-sheet");
  sheet.innerHTML = inspectionWorksheetMarkup();
  sheet.hidden = false;
  document.body.classList.add("print-inspection-form");
  window.print();
});

$("#inspection-list").addEventListener("change", (event) => {
  const select = event.target.closest("select[data-inspection]");
  if (!select) return;
  state.inspectionStatus[select.dataset.inspection] = select.value;
  updateInspectionProgress();
  renderReport();
});
$("#inspection-list").addEventListener("input", (event) => {
  const field = event.target.closest("textarea[data-inspection-note]");
  if (!field) return;
  const index = field.dataset.inspectionNote;
  state.inspectionDetails[index] ||= {};
  state.inspectionDetails[index][field.dataset.field] = field.value.slice(0, 2000);
  updateInspectionProgress();
  if (state.report === "inspection" || state.report === "opinion") renderReport();
});

$("#inspection-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-inspection-upload]");
  if (!button) return;
  $("#inspection-list").querySelector(`input[data-inspection-file="${button.dataset.inspectionUpload}"]`)?.click();
});

$("#inspection-list").addEventListener("change", async (event) => {
  const input = event.target.closest("input[data-inspection-file]");
  if (!input || !input.files?.[0]) return;
  const index = Number(input.dataset.inspectionFile);
  const item = state.analysis?.inspection?.[index];
  if (!item) return;
  const button = $("#inspection-list").querySelector(`button[data-inspection-upload="${index}"]`);
  if (button) button.disabled = true;
  try {
    const file = input.files[0];
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) throw new Error("PDF·PNG·JPG 파일만 첨부할 수 있습니다.");
    if (file.size > 10_000_000) throw new Error("파일당 10MB 이하여야 합니다.");
    if (!state.publicDemo && !state.caseId) await saveCurrentCase();
    const attachment = await uploadEvidenceFile(file, { inspectionId: item.ruleId, findingId: item.ruleId.startsWith("FI-R-") ? item.ruleId.slice(5) : "" });
    state.attachments.push(attachment);
    if (!state.publicDemo) await saveCurrentCase();
    renderInspection();
    renderEvidenceReview();
    renderReport();
  } catch (error) {
    alert(`현장 증빙 첨부 실패: ${error.message}`);
    input.value = "";
    if (button) button.disabled = false;
  }
});

function inspectionEffectiveStatus(index) {
  const status = state.inspectionStatus[index] || "미확인";
  const detail = state.inspectionDetails[index] || {};
  if (status === "미확인") return status;
  if (["확인", "이상징후"].includes(status) && (!detail.observation?.trim() || !detail.evidence?.trim())) return "근거 미기록";
  if (status === "자료요청" && !detail.followUp?.trim()) return "요청자료 미기록";
  return status;
}

function inspectionCompletedCount() {
  return (state.analysis?.inspection || []).filter((_, index) => !["미확인", "근거 미기록", "요청자료 미기록"].includes(inspectionEffectiveStatus(index))).length;
}

function updateInspectionProgress() {
  const total = state.analysis?.inspection.length || 0;
  const done = inspectionCompletedCount();
  $("#inspection-progress").textContent = `${done}/${total} 근거 기록`;
  $("#inspection-list").querySelectorAll("[data-inspection-state]").forEach((element) => {
    const status = inspectionEffectiveStatus(element.dataset.inspectionState);
    element.textContent = status === "근거 미기록" ? "정상·우려 판단에는 관찰한 사실과 확인 근거가 모두 필요합니다." : status === "요청자료 미기록" ? "요청할 자료와 후속조치를 적어 주세요." : status === "미확인" ? "현장 확인 전" : `${status} · 근거 기록됨`;
  });
}

function updateUtilization() {
  const previousInput = $("#previous-utilization").value;
  const currentInput = $("#current-utilization").value;
  if (previousInput === "" || currentInput === "") {
    $("#utilization-result").innerHTML = `<span>변화</span><strong>자료 입력 전</strong><small>이전·현재 가동률을 확인한 뒤 입력하세요.</small>`;
    if (state.analysis) renderReport();
    return;
  }
  const previous = Number(previousInput);
  const current = Number(currentInput);
  const delta = current - previous;
  $("#utilization-result").innerHTML = `<span>변화</span><strong>${delta > 0 ? "+" : ""}${formatNumber(delta, 1)}%p</strong><small>${delta <= -5 ? "시설투자·수요 근거 추가 검증" : "변화 원인 확인"}</small>`;
  if (state.analysis) renderReport();
}
$("#previous-utilization").addEventListener("input", updateUtilization);
$("#current-utilization").addEventListener("input", updateUtilization);
$("#inspection-notes").addEventListener("input", () => {
  if (state.analysis && state.report === "opinion") renderReport();
});

function combinedReviewAssessment() {
  const base = state.analysis?.assessment || { redFlags: [] };
  const extras = [];
  const interim = latestInterimView(state.analysis);
  const audit = state.analysis?.supplementary?.audit;
  if (interim && Number.isFinite(interim.operatingCashFlow) && interim.operatingCashFlow < 0) extras.push({ id: "recent-interim-cfo", title: "최근 중간영업현금 적자", level: "warning", metric: "중간 CFO", reason: `${interim.period} 영업현금 ${formatMoney(interim.operatingCashFlow)}. 전년 동기 및 최근 월별 자금수지와 대조해야 합니다.` });
  if (interim && Number.isFinite(interim.operatingProfitGrowth) && interim.operatingProfitGrowth <= -20 && interim.operatingProfit > 0 && interim.previousOperatingProfit > 0) extras.push({ id: "recent-interim-profit", title: "최근 중간영업이익 둔화", level: "warning", metric: "중간 영업이익 전년 동기 증감", reason: `${interim.period} 영업이익 ${formatMoney(interim.operatingProfit)}, 전년 동기 대비 ${changeText(interim.operatingProfitGrowth)}. 당해연도 실적 둔화가 연간 재무 판단을 바꾸는지 확인해야 합니다. 판정 기준: 전년 동기 대비 -20% 이하.` });
  if (interim && Number.isFinite(interim.revenueGrowth) && interim.revenueGrowth <= -10 && interim.revenue > 0) extras.push({ id: "recent-interim-sales", title: "최근 중간매출 둔화", level: "warning", metric: "중간 매출 전년 동기 증감", reason: `${interim.period} 매출 ${formatMoney(interim.revenue)}, 전년 동기 대비 ${changeText(interim.revenueGrowth)}. 수주·판매량·가격 변화를 확인해야 합니다. 판정 기준: 전년 동기 대비 -10% 이하.` });
  if (audit?.opinions?.some((opinion) => !String(opinion).includes("적정"))) extras.push({ id: "audit-opinion", title: "감사의견 원문 확인", level: "danger", metric: "감사의견", reason: `${audit.opinions.join(" / ")}. 의견 근거와 계속기업 관련 문구를 원문에서 확인해야 합니다.` });
  const debt = debtRegisterSummary();
  const cfoWon = state.analysis?.records?.at(-1)?.operatingCashFlow;
  const annualCfoEok = Number.isFinite(cfoWon) ? cfoWon / 100_000_000 : null;
  if (debt.trusted && Number.isFinite(annualCfoEok) && debt.dueWithin12 > Math.max(annualCfoEok, 0)) extras.push({ id: "maturity-concentration", title: "12개월 내 차입 만기집중", level: "warning", metric: "만기명세 vs 연간 CFO", reason: `12개월 내 만기 잔액 ${formatNumber(debt.dueWithin12, 1)}억원이 최근 연간 영업현금 ${formatNumber(annualCfoEok, 1)}억원보다 큽니다. 실제 분할상환·차환약정·사용가능 현금과 대조해야 합니다.` });
  state.industryEvidence.forEach((item, index) => {
    const adverse = item.direction === "up" ? item.latest < item.previous : item.latest > item.previous;
    if (adverse && item.sourceType === "kosis" && !item.comparisonWarning && item.exposureBasis && item.exposure >= 20) extras.push({ id: `industry-${item.id || index}`, title: `${item.name} 악화와 기업 노출`, level: "warning", metric: item.name, reason: `${item.period} ${item.previous} → ${item.latest}${item.unit || ""}, 기업 매출노출 ${item.exposure}% (KOSIS 공식 수치·노출비중 담당자 입력). 노출 근거 ${item.exposureBasis}와 실제 매출·수주·원가 영향을 대조해야 합니다.` });
  });
  return { ...base, redFlags: [...extras.filter((item) => item.id.startsWith("recent-interim")), ...(base.redFlags || []), ...extras.filter((item) => !item.id.startsWith("recent-interim"))] };
}

function currentFindingReviews() {
  return Object.fromEntries(combinedReviewAssessment().redFlags.map((flag) => [flag.id, state.findingReviews[`${state.statementScope}:${flag.id}`] || {}]));
}

function renderEvidenceReview() {
  if (!state.analysis) return;
  const flags = combinedReviewAssessment().redFlags;
  $("#evidence-finding").innerHTML = flags.length ? flags.map((flag) => `<option value="${escapeHtml(flag.id)}">${escapeHtml(flag.title)}</option>`).join("") : `<option value="general">일반 확인자료</option>`;
  $("#evidence-review-list").innerHTML = flags.length ? flags.map((flag) => {
    const entry = state.findingReviews[`${state.statementScope}:${flag.id}`] || {};
    const count = state.attachments.filter((file) => file.findingId === flag.id).length;
    const options = ["미확인", "자료요청", "잔존위험", "해소"].map((value) => `<option value="${value}" ${entry.status === value ? "selected" : ""}>${value}</option>`).join("");
    return `<article class="evidence-review-item"><div><span class="status ${escapeHtml(flag.level)}">${escapeHtml(flag.level === "danger" ? "우선" : "추가")}</span><h3>${escapeHtml(flag.title)}</h3><p>${escapeHtml(flag.reason)}</p><small>첨부 증빙 ${count}건 · ${escapeHtml(flag.metric)}</small></div><label>검증 상태<select data-review-status="${escapeHtml(flag.id)}">${options}</select></label><label class="wide">담당자 판단 근거<textarea data-review-note="${escapeHtml(flag.id)}" rows="2" placeholder="제출자료의 어떤 수치·사실이 우려를 해소하거나 남기는지 적으세요.">${escapeHtml(entry.note || "")}</textarea></label></article>`;
  }).join("") : `<p class="no-risk">자동 경고가 없더라도 최신 실적·차입만기·담보 관련 자료는 확인해야 합니다.</p>`;
  $("#attachment-list").innerHTML = state.attachments.length ? state.attachments.map((file) => `<div class="attachment-row"><b>${state.caseId ? `<a href="/api/cases/${encodeURIComponent(state.caseId)}/evidence/${encodeURIComponent(file.id)}" download="${escapeHtml(file.name)}">${escapeHtml(file.name)}</a>` : escapeHtml(file.name)}</b><span>${escapeHtml(file.status)} · SHA256 ${escapeHtml(file.sha256?.slice(0, 12))}…</span></div>`).join("") : `<p>첨부된 고객자료가 없습니다.</p>`;
  renderReviewOutcome();
}

let reviewRunId = 0;
async function updateReviewOutcome() {
  if (!state.analysis) return;
  const runId = ++reviewRunId;
  const awaiting = { working: state.analysis.loanRequest.workingAmount > 0 ? { status: "자료요청", missingInputs: ["월별 현금수지"] } : { status: "신청 없음" }, facility: state.analysis.loanRequest.facilityAmount > 0 ? { status: "자료요청", missingInputs: ["연간 현금수지"] } : { status: "신청 없음" } };
  const response = await fetchJson("/api/review-outcome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assessment: combinedReviewAssessment(), reviews: currentFindingReviews(), attachments: state.publicDemo ? [] : state.attachments, structure: state.structure || awaiting }) });
  if (runId !== reviewRunId) return;
  state.reviewOutcome = response;
  renderReviewOutcome(); renderReport();
}

function renderReviewOutcome() {
  const result = state.reviewOutcome;
  if (!result) { $("#review-outcome").innerHTML = "<p>검증 상태를 입력하면 조건 검토에 반영됩니다.</p>"; return; }
  $("#review-progress").textContent = `${result.resolvedCount}/${result.findings.length} 해소 근거 확인`;
  $("#review-outcome").innerHTML = `<div><span>운전자금 판단</span><strong>${escapeHtml(result.working.status)}</strong><p>${escapeHtml(result.working.explanation)}</p></div><div><span>시설자금 판단</span><strong>${escapeHtml(result.facility.status)}</strong><p>${escapeHtml(result.facility.explanation)}</p></div><p>${escapeHtml(result.disclaimer)}</p>`;
}

let reviewTimer;
$("#evidence-review-list").addEventListener("input", (event) => {
  const control = event.target.closest("[data-review-status], [data-review-note]");
  if (!control) return;
  const id = control.dataset.reviewStatus || control.dataset.reviewNote;
  const key = `${state.statementScope}:${id}`;
  const entry = state.findingReviews[key] || {};
  if (control.dataset.reviewStatus) entry.status = control.value;
  else entry.note = control.value;
  state.findingReviews[key] = entry;
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(() => updateReviewOutcome().catch((error) => { $("#review-outcome").textContent = error.message; }), 250);
});
$("#evidence-review-list").addEventListener("change", (event) => {
  if (event.target.matches("[data-review-status]")) updateReviewOutcome().catch(() => {});
});

async function uploadEvidenceFile(file, association = {}) {
  if (file.size > 10_000_000) throw new Error("파일당 10MB 이하여야 합니다.");
  if (state.publicDemo) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return { id: crypto.randomUUID(), name: file.name, size: file.size, sha256, status: "임시 첨부 · 서버 미전송", uploadedAt: new Date().toISOString(), objectUrl: URL.createObjectURL(file), sessionOnly: true, ...association };
  }
  if (!state.caseId) throw new Error("먼저 사건을 저장해 주세요.");
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
  return fetchJson(`/api/cases/${state.caseId}/evidence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, base64, ...association }) });
}

$("#upload-evidence").addEventListener("click", async () => {
  const file = $("#evidence-file").files?.[0];
  if (!state.caseId) { alert("증빙을 보관하려면 현재 사건을 먼저 저장해 주세요."); return; }
  if (!file) { alert("첨부할 파일을 선택해 주세요."); return; }
  try {
    const attachment = await uploadEvidenceFile(file, { findingId: $("#evidence-finding").value });
    state.attachments.push(attachment);
    $("#evidence-file").value = "";
    renderEvidenceReview();
    await updateReviewOutcome();
    await saveCurrentCase();
  } catch (error) { alert(`첨부 실패: ${error.message}`); }
});

function baseReportContent(type) {
  const a = state.analysis;
  const latest = a.records.at(-1);
  const flags = a.assessment.redFlags;
  const meta = `<p class="report-meta">${escapeHtml(a.company.name)} · 기준일 ${escapeHtml(a.basisDate)} · ${state.statementScope === "OFS" ? "별도재무제표(차주 법인)" : "연결재무제표(그룹)"} · ${escapeHtml(a.mode)} · 금액 단위 억원</p>`;
  const companyInfo = a.company.companyInfo || {};
  const overviewTable = `<table class="report-overview-table"><tbody><tr><th>기업명</th><td>${escapeHtml(a.company.name)}</td><th>대표자</th><td>${escapeHtml(companyInfo.ceo_nm || "공시 확인 필요")}</td></tr><tr><th>업종</th><td>${escapeHtml(a.company.industry || "확인 필요")}</td><th>법인등록번호</th><td>${escapeHtml(companyInfo.jurir_no || "공시 확인 필요")}</td></tr><tr><th>주소</th><td colspan="3">${escapeHtml(companyInfo.adres || "공시 확인 필요")}</td></tr></tbody></table>`;
  const financialRows = [
    ["매출액", (row) => formatMoney(row.revenue)], ["영업이익", (row) => formatMoney(row.operatingProfit)],
    ["영업활동현금흐름", (row) => formatSignedMoney(row.operatingCashFlow)], ["투자활동현금흐름", (row) => formatSignedMoney(row.investingCashFlow)],
    ["재무활동현금흐름", (row) => formatSignedMoney(row.financingCashFlow)], ["단순 FCF", (row) => formatSignedMoney(row.freeCashFlow)], ["리스·배당 후 잔여현금", (row) => formatSignedMoney(row.debtServiceResidual)],
    ["CFO / CAPEX", (row) => formatNumber(row.capexCoverage, 2, "배")], ["금융차입금(리스 제외)", (row) => formatMoney(row.totalDebt)], ["리스부채", (row) => formatMoney(row.leaseLiabilities)],
    ["부채비율", (row) => formatNumber(row.debtRatio, 1, "%")], ["유동비율", (row) => formatNumber(row.currentRatio, 1, "%")],
    ["영업이익/금융비용", (row) => formatNumber(row.financeCostCoverage, 2, "배")], ["현금전환주기", (row) => formatNumber(row.cashConversionCycle, 1, "일")],
  ];
  const newestFirst = [...a.records].reverse();
  const financialComparison = `<table class="source-table report-financial-table"><thead><tr><th>주요 재무지표</th>${newestFirst.map((row) => `<th>${escapeHtml(row.period)}</th>`).join("")}</tr></thead><tbody>${financialRows.map(([label, formatter]) => `<tr><th>${label}</th>${newestFirst.map((row) => `<td>${formatter(row)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const cashFlowFindings = `<ul>${a.cashFlowAnalysis.insights.map((item) => `<li><b>${escapeHtml(item.title)}</b> · ${escapeHtml(cashFlowInsightFact(item, a.cashFlowAnalysis.metrics))}<br>${escapeHtml(item.meaning)}</li>`).join("")}</ul>`;
  if (type === "sources") {
    const audit = a.supplementary?.audit;
    const interim = a.supplementary?.interim;
    const validations = a.dataQuality.validations || [];
    const dateLabel = (value) => { const raw = String(value || ""); return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : /^\d{6}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw || "자료없음"; };
    const statementRows = Object.entries(a.statementViews || {}).map(([scope, view]) => ({
      scope: scope === "OFS" ? "별도(차주)" : "연결(그룹)",
      periods: (view.records || []).map((row) => `${row.period}년`).join(" · ") || "자료없음",
      source: view.records?.at(-1)?.source || "출처 확인 필요",
      rceptNo: view.records?.at(-1)?.rceptNo || null,
    }));
    const macroRows = Array.isArray(a.macro) ? a.macro : [];
    const receivedMacro = macroRows.filter((item) => Number.isFinite(item.latest?.value)).length;
    const attention = validations.filter((item) => item.balanceSheet !== "일치" || !["대체로 일치", "일치"].includes(item.cashFlow));
    const statementHtml = statementRows.map((item) => `<div><b>${escapeHtml(item.scope)}</b><span>${escapeHtml(item.periods)}</span><small>${escapeHtml(item.source)}</small>${item.rceptNo ? `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(item.rceptNo)}" target="_blank" rel="noopener noreferrer">최신 사업보고서 원문 ↗</a>` : ""}</div>`).join("");
    const latestDates = macroRows.map((item) => item.latest?.date).filter(Boolean).sort();
    const macroPeriod = latestDates.length ? `${dateLabel(latestDates[0])} ~ ${dateLabel(latestDates.at(-1))}` : "수록 시점 없음";
    const macroSources = [...new Set(macroRows.map((item) => item.source).filter(Boolean))].join(" · ") || "출처 확인 필요";
    const macroDetails = macroRows.map((item) => `<tr><td><b>${escapeHtml(item.name)}</b></td><td>${escapeHtml(dateLabel(item.latest?.date))}</td><td>${escapeHtml(item.source || "출처 확인 필요")}</td><td>${item.status === "교육용" ? "교육용" : Number.isFinite(item.latest?.value) ? "수신" : escapeHtml(item.status || "자료없음")}</td></tr>`).join("");
    return `<h3>데이터 출처와 품질 상태</h3>${meta}<p class="source-intro">같은 기관을 수록일마다 반복하지 않고, 재무공시 범위와 거시지표의 최신성·검증 상태를 먼저 요약했습니다.</p>
      <div class="source-summary-grid"><article><span>재무공시 · ${escapeHtml(statementRows[0]?.source || "출처 확인 필요")}</span><strong>${statementRows.length}개 재무 범위</strong><div class="source-statement-list">${statementHtml || "연간 공시자료 없음"}</div></article><article><span>거시지표 · ${escapeHtml(macroSources)}</span><strong>${receivedMacro}/${macroRows.length}개 수신</strong><p>지표별 수록기간 ${escapeHtml(macroPeriod)}<br>날짜가 같아도 지표와 갱신주기는 다를 수 있습니다.</p></article><article><span>자동 검증 · 연간 ${validations.length}개년</span><strong>${attention.length ? `${attention.length}개년 추가 확인` : "중요 차이 없음"}</strong><p>재무상태표 일치와 현금증감 연결을 점검했습니다. 수신 자료의 정확성을 보증하는 검증은 아닙니다.</p></article></div>
      <h4>최신 공시와 감사</h4><div class="source-recency"><p><b>중간재무</b> ${interim ? `${escapeHtml(interim.period)}년 ${escapeHtml(interim.reportType)} · ${escapeHtml(interim.fsDiv)}` : "구조화 API에서 확인되지 않음"}</p><p><b>감사의견</b> ${audit ? `${escapeHtml(audit.auditor || "감사인 확인 필요")} · ${escapeHtml((audit.opinions || []).join(" / ") || "의견 확인 필요")}` : "확인자료 없음"}</p></div>
      <details class="source-details"><summary>지표별 수록시점 확인 · ${macroRows.length}개</summary><div class="table-wrap"><table class="source-table"><thead><tr><th>지표</th><th>최신 수록</th><th>기관·원자료</th><th>수신 상태</th></tr></thead><tbody>${macroDetails || "<tr><td colspan='4'>수신된 거시지표가 없습니다.</td></tr>"}</tbody></table></div></details>
      <details class="source-details"><summary>연도별 자동 검증과 자료 한계</summary><div class="table-wrap"><table class="source-table"><thead><tr><th>연도</th><th>자산=부채+자본</th><th>현금흐름 합계와 현금증감</th></tr></thead><tbody>${validations.map((item) => `<tr><td>${escapeHtml(item.period)}</td><td>${escapeHtml(item.balanceSheet)}</td><td>${escapeHtml(item.cashFlow)}</td></tr>`).join("")}</tbody></table></div><ul>${(a.dataQuality.notices || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>
      <p class="source-caveat">차입금 만기, 고정·변동금리, 담보·보증·약정, 순수 이자비용은 주석 또는 고객자료로 보완해야 합니다. 결측값을 0으로 처리하지 않습니다.</p>`;
  }
  if (type === "inspection") return `<h3>현장실사 점검표</h3>${meta}<p>${escapeHtml(industryProfile().site)}</p><ol>${a.inspection.map((item, index) => `<li><b>[${escapeHtml(item.category)}]</b> ${escapeHtml(item.question)} - ${escapeHtml(state.inspectionStatus[index] || "미확인")}</li>`).join("")}</ol>${industryProfile().id === "manufacturing" ? `<h4>가동률 확인</h4><p>이전 ${escapeHtml($("#previous-utilization").value)}% → 현재 ${escapeHtml($("#current-utilization").value)}%. 변화 원인과 수주·생산계획의 정합성을 확인합니다.</p>` : ""}<h4>현장 메모</h4><p>${escapeHtml($("#inspection-notes").value || "아직 입력된 현장 메모가 없습니다.")}</p>`;
  if (type === "opinion") return `<h3>현장실사 결과 반영 여신검토서</h3>${meta}<h4>1 기업 및 신청 개요</h4><p>${escapeHtml(a.company.name)}은(는) ${escapeHtml(a.company.industry || "업종 확인 필요")} 기업으로, 운전자금 ${a.loanRequest.workingAmount}억원과 시설자금 ${a.loanRequest.facilityAmount}억원을 요청했습니다.</p><h4>2 차주 상환능력과 세 활동 현금흐름</h4><p>[사실] ${latest.period}년 매출은 ${formatMoney(latest.revenue)}, 영업이익은 ${formatMoney(latest.operatingProfit)}입니다. 영업·투자·재무활동현금흐름은 각각 ${formatSignedMoney(latest.operatingCashFlow)}, ${formatSignedMoney(latest.investingCashFlow)}, ${formatSignedMoney(latest.financingCashFlow)}이며 단순 FCF는 ${formatSignedMoney(latest.freeCashFlow)}입니다. 리스 제외 금융차입금은 ${formatMoney(latest.totalDebt)}, 영업이익/금융비용은 ${formatNumber(latest.financeCostCoverage, 2)}배입니다.</p>${cashFlowFindings}<h4>3 그룹 위험과 최신 공시</h4><p>${a.statementViews?.CFS ? "연결 탭에서 종속회사 포함 그룹의 지원·부담 가능성을 별도로 확인했습니다." : "연결재무제표 구조화 자료가 없어 그룹 위험은 추가 확인이 필요합니다."} ${a.supplementary?.interim ? `최신 ${escapeHtml(a.supplementary.interim.reportType)}도 출처 탭에 연결했습니다.` : "최신 중간재무는 확인되지 않았습니다."}</p><h4>4 업종·거시 및 요청여신별 검토</h4><p>외부지표는 기업의 매출·원가·조달금리 노출경로가 확인되는 경우에만 보조 근거로 사용합니다. 운전자금은 회전기간과 만기 내 회수재원, 시설자금은 투자 후 장기 현금창출력을 분리 검토합니다.</p><h4>5 경영성과와 우선 확인수치</h4><p>[해석] ${escapeHtml(a.performance.conclusion.text)}</p><ul>${flags.length ? flags.map((item) => `<li><b>${escapeHtml(item.title)}</b>: ${escapeHtml(item.reason)}</li>`).join("") : "<li>규칙 기반 우선 확인 항목 없음. 최신 비재무자료 확인 필요.</li>"}</ul><h4>6 현장실사 결과</h4><ul>${a.inspection.map((item, index) => `<li><b>${escapeHtml(item.category)}</b>: ${escapeHtml(state.inspectionStatus[index] || "미확인")} - ${escapeHtml(item.question)}</li>`).join("")}</ul><p><b>현장 메모:</b> ${escapeHtml($("#inspection-notes").value || "입력 없음")}</p><h4>7 스트레스 테스트와 종합의견</h4><p>[시나리오] ${escapeHtml(state.stress?.interpretation || "시나리오 미실행")}</p><p>[해석] 최종 승인 여부와 담보금액은 내부등급·정책·담보평가와 주석상 만기·금리조건을 반영해 별도 결정합니다.</p>`;
  return `<h3>기업분석 요약보고서</h3>${meta}<h4>1. 기업개요</h4>${overviewTable}<h4>2. 요청 자금</h4><p>운전자금 ${a.loanRequest.workingAmount}억원 / ${a.loanRequest.workingTermMonths}개월, 시설자금 ${a.loanRequest.facilityAmount}억원 / ${a.loanRequest.facilityTermMonths}개월.</p><h4>3. 차주 상환능력: 최근 3개년 재무현황</h4>${financialComparison}<h4>4. 그룹 위험</h4><p>${a.statementViews?.CFS ? "연결재무제표를 별도 탭으로 제공하며 종속회사 손실·지원부담과 그룹 현금의 차주 귀속 가능성을 구분합니다." : "연결재무제표 자료가 없어 그룹 위험 추가 확인이 필요합니다."}</p><h4>5. 세 활동 현금흐름 판단</h4>${cashFlowFindings}<p>※ 단순 FCF와 리스·배당 후 잔여현금을 구분하며, 투자·재무활동현금흐름은 부호만으로 평가하지 않습니다.</p><h4>6. 경영성과와 심사 우선수치</h4><p>[해석] ${escapeHtml(a.performance.conclusion.text)}</p><ul>${flags.length ? flags.slice(0, 6).map((item) => `<li><b>${escapeHtml(item.title)}</b> · ${escapeHtml(item.metric)} ${Number.isFinite(item.current) ? formatNumber(item.current, 1) : "자료없음"}<br>${escapeHtml(item.reason)}</li>`).join("") : "<li>설정 임계치 내 즉시 경고 신호 없음</li>"}</ul><h4>7. 업종·거시와 요청여신별 확인</h4><p>외부지표는 기업 노출경로와 연결해 보조 근거로 사용합니다. 운전자금은 회전과 단기 회수재원, 시설자금은 투자 타당성과 장기 현금창출력을 구분합니다.</p><h4>8. 상담·현장 확인과 최종의견</h4><ul>${a.assessment.checks.slice(0, 10).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function conciseOpinionReport() {
  const a = state.analysis;
  const annual = a.records.at(-1);
  const interim = latestInterimView(a);
  const checked = inspectionCompletedCount();
  const exceptions = (a.inspection || []).map((item, index) => ({ item, index, selected: state.inspectionStatus[index] || "미확인", status: inspectionEffectiveStatus(index) })).filter(({ selected }) => ["이상징후", "자료요청"].includes(selected));
  const risks = combinedReviewAssessment().redFlags.slice(0, 4);
  const request = a.loanRequest;
  const review = state.reviewOutcome;
  const interimText = interim ? `<p><b>최신 ${escapeHtml(interim.period)}:</b> 매출 ${formatMoney(interim.revenue)}(전년 동기 ${changeText(interim.revenueGrowth)}), 영업이익 ${formatMoney(interim.operatingProfit)}(전년 동기 ${changeText(interim.operatingProfitGrowth)}), 영업현금 ${formatMoney(interim.operatingCashFlow)}(전년 동기 ${changeText(interim.operatingCashFlowGrowth)}). 같은 기간끼리 비교했으며 연간 수치와 합산하지 않았습니다.</p>` : `<p>최신 중간재무가 없어 현재 사업연도의 실적 검증이 필요합니다.</p>`;
  const cashText = `<p>공개자료만으로 신청금액·금리·만기를 확정하지 않습니다. 담당자는 상환재원과 고객 제출자료를 확인하고, 적정 조건은 심사역이 별도로 검토해야 합니다.</p>`;
  const stressText = state.stress?.available && state.stress.simple
    ? `단순 민감도: 연간 공시 매출 ${formatMoney(state.stress.baseline.revenue)} → 가정 ${formatMoney(state.stress.stressed.revenue)}, 영업이익 ${formatMoney(state.stress.baseline.operatingProfit)} → 가정 ${formatMoney(state.stress.stressed.operatingProfit)}. 신규대출 원리금과 승인가능 금액은 계산하지 않았습니다.`
    : `매출·영업이익 단순 민감도는 ${state.stress?.missingInputs?.length ? `공시 수치 부족(${state.stress.missingInputs.map(escapeHtml).join(" · ")})으로 계산하지 못했습니다.` : "아직 계산하지 않았습니다."}`;
  const industryText = state.industryEvidence.length ? `${state.industryEvidence.length}개 업종지표를 고객 매출노출과 연결했습니다. KOSIS 조회 수치와 담당자 직접 입력 수치를 구분하며, 기업 노출은 별도 검증이 필요합니다.` : "기업의 실제 매출노출과 연결된 세부 업종지표는 아직 없습니다. 공통 경기지표로 업종위험을 단정하지 않습니다.";
  return `<h3>기업여신 검토 의견 · ${checked ? "현장확인 반영" : "현장확인 전 초안"}</h3><p class="report-meta">${escapeHtml(a.company.name)} · 기준일 ${escapeHtml(a.basisDate)} · ${state.statementScope === "OFS" ? "별도(차주 법인)" : "연결(그룹 위험)"} · 승인 여부 판단 전 자료</p><h4>1. 신청과 확인된 재무</h4><p>${escapeHtml(a.company.name)}의 신청액은 운전자금 ${formatNumber(request.workingAmount, 0)}억원, 시설자금 ${formatNumber(request.facilityAmount, 0)}억원입니다. 최근 연간 ${escapeHtml(annual.period)}년 매출 ${formatMoney(annual.revenue)}, 영업이익 ${formatMoney(annual.operatingProfit)}, 영업현금 ${formatMoney(annual.operatingCashFlow)}, 리스 제외 금융차입금 ${formatMoney(annual.totalDebt)}, 영업이익/금융비용 ${formatNumber(annual.financeCostCoverage, 2)}배입니다.</p>${interimText}<h4>2. 우선 검증할 쟁점</h4>${risks.length ? `<ul>${risks.map((item) => `<li><b>${escapeHtml(item.title)}</b> · ${escapeHtml(item.reason)}</li>`).join("")}</ul>` : "<p>설정된 수치 임계치를 넘는 자동 경고는 없습니다. 이것이 위험 부재를 의미하지는 않습니다.</p>"}<p>${escapeHtml(industryText)}</p><h4>3. 자금용도별 상환 검토</h4>${cashText}<p>${escapeHtml(stressText)}</p><h4>4. 현장·증빙 확인 상태</h4><p>현장 점검 ${checked}/${(a.inspection || []).length}건 근거 기록${checked ? "" : " · 아직 현장실사 결과가 입력되지 않았습니다"}. ${exceptions.length ? `추가 조치 ${exceptions.length}건:` : "우려·자료요청으로 표시한 항목 없음."}</p>${exceptions.length ? `<ul>${exceptions.slice(0, 5).map(({ item, index, selected, status }) => `<li>${escapeHtml(selected)}${status !== selected ? ` (${escapeHtml(status)})` : ""} · ${escapeHtml(item.question)}<br>관찰: ${escapeHtml(state.inspectionDetails[index]?.observation || "기록 없음")} · 근거: ${escapeHtml(state.inspectionDetails[index]?.evidence || "기록 없음")} · 후속조치: ${escapeHtml(state.inspectionDetails[index]?.followUp || "기록 없음")}</li>`).join("")}</ul>` : ""}<p>증빙 ${state.attachments.length}건 첨부 · ${escapeHtml(review?.pendingCount ?? "검증 전")}건 미해소. 파일 첨부만으로 우려가 해소되지는 않습니다.</p><h4>5. 현재 조건부 의견</h4><p>운전자금: <b>${escapeHtml(review?.working?.status || "검토 전")}</b> · 시설자금: <b>${escapeHtml(review?.facility?.status || "검토 전")}</b>. ${escapeHtml(review?.working?.explanation || "고객 현금수지·현장자료 확인 후 조건을 재검토합니다.")}</p><p>${exceptions.length ? "현장에서 표시한 우려·자료요청은 자동 승인조건으로 전환하지 않았으며, 심사자가 기록과 증빙을 검토해야 합니다. " : ""}최종 금액·금리·만기·담보 및 승인 여부는 고객 증빙, 주석상 차입조건, 내부등급·은행 정책 검토 후 결정합니다.</p>`;
}

function inspectionDetailReport() {
  const a = state.analysis;
  const previousUtilization = $("#previous-utilization").value;
  const currentUtilization = $("#current-utilization").value;
  const utilizationText = industryProfile().id === "manufacturing" && previousUtilization !== "" && currentUtilization !== ""
    ? `<h4>현장 가동률 확인값</h4><p>이전 ${escapeHtml(previousUtilization)}% → 현재 ${escapeHtml(currentUtilization)}% · 변화 ${formatNumber(Number(currentUtilization) - Number(previousUtilization), 1, "%p")}. 조사 시점·가동률 산출 근거는 항목별 기록과 대조해야 합니다.</p>`
    : "";
  const rows = (a.inspection || []).map((item, index) => {
    const detail = state.inspectionDetails[index] || {};
    const selected = state.inspectionStatus[index] || "미확인";
    const effective = inspectionEffectiveStatus(index);
    const files = inspectionAttachments(item);
    const attachmentText = files.length ? files.map((file) => `${escapeHtml(file.name)} (SHA256 ${escapeHtml(file.sha256?.slice(0, 12))}…)`).join(" · ") : "없음";
    return `<li><b>${escapeHtml(item.category)} · ${escapeHtml(selected)}${effective !== selected ? ` (${escapeHtml(effective)})` : ""}</b><p>${escapeHtml(item.question)}</p><p>관찰한 사실: ${escapeHtml(detail.observation || "미기록")}</p><p>확인 근거·증빙: ${escapeHtml(detail.evidence || "미기록")}</p><p>첨부 원본: ${attachmentText}</p><p>심사 영향·후속조치: ${escapeHtml(detail.followUp || "미기록")}</p></li>`;
  }).join("");
  return `<h3>현장실사 점검 리포트</h3><p class="report-meta">${escapeHtml(a.company.name)} · ${escapeHtml(a.basisDate)} · ${inspectionCompletedCount()}/${(a.inspection || []).length}건 근거 기록</p><p>‘정상 확인’만 선택하고 관찰 사실·근거를 적지 않은 항목은 확인 완료로 보지 않습니다. 현장 기록은 심사자의 별도 검토 대상입니다.</p>${utilizationText}<ol class="inspection-report-items">${rows}</ol><h4>현장 종합 메모</h4><p>${escapeHtml($("#inspection-notes").value || "미기록")}</p>`;
}

function reportContent(type) {
  if (type === "opinion") return conciseOpinionReport();
  if (type === "inspection") return inspectionDetailReport();
  const base = baseReportContent(type);
  if (!state.analysis || type === "inspection") return base;
  const recent = latestInterimView(state.analysis);
  const latestAnnual = state.analysis.records.at(-1);
  const sourceLink = latestAnnual?.rceptNo ? `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(latestAnnual.rceptNo)}" target="_blank" rel="noopener noreferrer">${escapeHtml(latestAnnual.period)}년 사업보고서·주석 원문</a>` : "사업보고서 접수번호 확인 필요";
  const recentText = recent ? `${escapeHtml(recent.period)} 매출 ${formatMoney(recent.revenue)}(전년 동기 ${changeText(recent.revenueGrowth)}), 영업이익 ${formatMoney(recent.operatingProfit)}, 영업현금 ${formatMoney(recent.operatingCashFlow)}. 연간 수치와 직접 비교하지 않음.` : "최근 중간재무 비교자료 없음. 고객의 최신 월별 실적 요청 필요.";
  const structure = state.structure;
  const terms = state.analysis.loanRequest;
  const structureText = structure ? `<p><b>운전자금:</b> ${escapeHtml(structure.working.status)}${Number.isFinite(structure.working.indicativeCeiling) ? ` · 입력가정상 상한 ${formatNumber(structure.working.indicativeCeiling, 1)}억원` : ""}. <b>시설자금:</b> ${escapeHtml(structure.facility.status)}${Number.isFinite(structure.facility.indicativeCeiling) ? ` · 입력가정상 상한 ${formatNumber(structure.facility.indicativeCeiling, 1)}억원` : ""}. <b>통합:</b> ${escapeHtml(structure.combined.status)}.</p><p>가정조건: 운전자금 ${formatNumber(terms.workingRatePct, 2)}%·${terms.workingTermMonths}개월·${terms.workingRepayment === "bullet" ? "만기일시" : "원금균등"}, 시설자금 ${formatNumber(terms.facilityRatePct, 2)}%·${terms.facilityTermMonths}개월·${terms.facilityRepayment === "bullet" ? "만기일시" : "원금균등"}·거치 ${terms.facilityGraceMonths || 0}개월. 실제 은행 제시 조건이 아님.</p><p>${escapeHtml(structure.basis)}</p>` : "<p>고객 현금수지·기존 원리금 일정 미입력. 적정금액·상환구조 산정 불가.</p>";
  const schedule = structure?.facility?.rows?.length ? `<table class="source-table"><thead><tr><th>연차</th><th>상환가능현금</th><th>기존 원리금</th><th>신규 시설자금</th><th>원리금상환배율</th></tr></thead><tbody>${structure.facility.rows.map((row) => `<tr><td>${row.year}</td><td>${formatNumber(row.availableCash, 2)}억원</td><td>${formatNumber(row.existingService, 2)}억원</td><td>${formatNumber(row.newFacilityService, 2)}억원</td><td>${row.coverage === null ? "산정불가" : formatNumber(row.coverage, 2, "배")}</td></tr>`).join("")}</tbody></table>` : "";
  const industry = state.industryEvidence.length ? `<ul>${state.industryEvidence.map((item) => `<li>${escapeHtml(item.name)} ${escapeHtml(item.period)}: ${formatNumber(item.previous, 2)} → ${formatNumber(item.latest, 2)} ${escapeHtml(item.unit || "")}, 기업 매출노출 ${formatNumber(item.exposure, 1)}%. ${escapeHtml(item.verification || "원자료 검증 전")} · 노출 근거 ${escapeHtml(item.exposureBasis || "미입력")} · 출처 ${escapeHtml(item.source)}</li>`).join("")}</ul>` : "<p>기업 노출을 확인한 업종지표가 입력되지 않았습니다.</p>";
  const review = state.reviewOutcome;
  const findings = review?.findings?.length ? `<ul>${review.findings.map((item) => `<li><b>${escapeHtml(item.title)} · ${escapeHtml(item.status)}</b><br>당초 우려: ${escapeHtml(item.originalConcern)}<br>담당자 검증: ${escapeHtml(item.note || "기록 없음")}<br>제출 증빙: ${(Array.isArray(item.evidence) ? item.evidence : []).map((file) => escapeHtml(file.name)).join(" · ") || "없음"}</li>`).join("")}</ul>` : "<p>검증할 자동 경고가 없거나 검증 상태가 기록되지 않았습니다.</p>";
  const appendix = `<h4>최근 실적과 업종 노출</h4><p>${recentText} · 원문: ${sourceLink}</p>${industry}<h4>우려 → 증빙 → 재판단</h4>${findings}<p>운전자금: ${escapeHtml(review?.working?.status || "검증 전")} · 시설자금: ${escapeHtml(review?.facility?.status || "검증 전")}. 요청금액·상환구조는 이 화면에서 산정하지 않으며, 내부 심사와 고객 제출자료 검증이 필요합니다.</p>`;
  return `${base}${appendix}`;
}

function renderReport() {
  if (!state.analysis) return;
  $("#report-sheet").innerHTML = reportContent(state.report);
}

$(".report-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-report]");
  if (!button) return;
  state.report = button.dataset.report;
  $$(".report-tabs button").forEach((item) => item.classList.toggle("active", item === button));
  renderReport();
});

$("#print-report").addEventListener("click", () => window.print());
$("#save-report").addEventListener("click", () => {
  if (!state.analysis) return;
  const title = `${state.analysis.company.name} 여신검토 리포트`;
  const exportStyles = `*{box-sizing:border-box}body{margin:0;background:#eef3f8;color:#17233d;font-family:"Malgun Gothic",sans-serif;line-height:1.72}.page{max-width:960px;min-height:1120px;margin:32px auto;padding:54px 62px;background:#fff;box-shadow:0 18px 60px #183b6b1a;border-top:8px solid #1769e0}.brand{color:#1769e0;font-size:14px;font-weight:800;letter-spacing:.08em}.report-sheet h3{margin:18px 0 8px;font-size:30px}.report-sheet h4{margin:30px 0 10px;padding-bottom:8px;border-bottom:2px solid #e8eef7;font-size:20px}.report-meta{color:#607189;font-size:14px}.report-sheet p,.report-sheet li{font-size:16px}.report-sheet table{width:100%;border-collapse:collapse;font-size:15px}.report-sheet th,.report-sheet td{padding:11px;border-bottom:1px solid #dce4ef;text-align:left;vertical-align:top}.report-sheet th{background:#eff5ff}.source-intro{color:#526983}.source-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.source-summary-grid article{padding:17px;border:1px solid #dce6f2;border-radius:10px;background:#f9fcff}.source-summary-grid article>span{color:#5d7187;font-size:14px}.source-summary-grid article>strong{display:block;margin:8px 0;color:#153e74;font-size:21px}.source-statement-list>div{display:grid;padding-top:7px;border-top:1px solid #e1e9f3;font-size:14px}.source-statement-list small{color:#61748a}.source-recency{display:grid;grid-template-columns:1fr 1fr;gap:10px}.source-recency p{padding:13px;border:1px solid #e1e9f3}.source-recency b{display:block;color:#1769e0}.source-details{margin-top:15px;padding:15px;border:1px solid #dce6f2;border-radius:9px}.source-details summary{color:#145eae;font-size:16px;font-weight:800;cursor:pointer}.source-details .table-wrap,.source-details ul{margin-top:12px}.source-caveat{padding:14px;border-left:4px solid #e9a52c;background:#fffaf0}@media(max-width:680px){.page{margin:0;padding:28px}.source-summary-grid,.source-recency{grid-template-columns:1fr}}@media print{body{background:#fff}.page{max-width:none;min-height:0;margin:0;padding:24px 28px;box-shadow:none}.source-details{break-inside:avoid}}`;
  const documentHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>${exportStyles}</style></head><body><main class="page"><div class="brand">CREDITLENS · CREDIT REVIEW WORKBOOK</div><article class="report-sheet">${reportContent(state.report)}</article></main></body></html>`;
  const blob = new Blob([documentHtml], { type: "text/html;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${state.analysis.company.name.replace(/[\\/:*?"<>|]/g, "_")}_${state.report}_${state.analysis.basisDate}.html`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
});
$("#download-json").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ ...state.analysis, stress: state.stress, inspectionStatus: state.inspectionStatus, inspectionDetails: state.inspectionDetails, inspectionMemory: state.inspectionMemory }, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${state.analysis.company.name}_여신검토_${state.analysis.basisDate}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
});

function caseInputValues() {
  return Object.fromEntries([
    "company-search", "working-amount", "facility-amount", "working-term", "facility-term", "working-rate", "facility-rate", "working-rate-type", "facility-rate-type", "working-repayment", "facility-repayment", "facility-grace", "end-year", "purpose", "opening-cash", "minimum-cash", "monthly-cash", "monthly-existing", "annual-cash", "annual-existing", "target-coverage", "existing-variable-share", "credit-sales-share", "sales-shock", "margin-shock", "rate-shock", "collection-delay", "previous-utilization", "current-utilization", "inspection-notes",
  ].map((id) => [id, $("#" + id).value]));
}

async function saveCurrentCase() {
  if (!state.analysis) throw new Error("먼저 기업을 분석해 주세요.");
  const summary = `${state.reviewOutcome?.working?.status || "운전자금 미검토"} / ${state.reviewOutcome?.facility?.status || "시설자금 미검토"}`;
  const response = await fetchJson("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    id: state.caseId, companyName: state.analysis.company.name, corpCode: state.analysis.company.corpCode, summary,
    snapshot: { analysis: state.analysis, structure: state.structure, stress: state.stress, reviewOutcome: state.reviewOutcome, findingReviews: state.findingReviews, attachments: state.attachments, industryEvidence: state.industryEvidence, debtRegister: state.debtRegister, debtRegisterComplete: $("#debt-register-complete").checked, inspectionStatus: state.inspectionStatus, inspectionDetails: state.inspectionDetails, inspectionMemory: state.inspectionMemory, inputValues: caseInputValues(), statementScope: state.statementScope, report: state.report },
  }) });
  state.caseId = response.id;
  state.caseRevision = response.revision;
  $("#case-status").textContent = `${state.analysis.company.name} · 사건 ${response.id} · ${response.revision}차 저장 · ${new Date(response.updatedAt).toLocaleString("ko-KR")}`;
  await Promise.all([loadSavedCases(), loadCaseRevisions()]);
  return response;
}

$("#save-case").addEventListener("click", async () => {
  try { await saveCurrentCase(); }
  catch (error) { $("#case-status").textContent = `저장 실패: ${error.message}`; }
});

async function loadSavedCases() {
  const { cases } = await fetchJson("/api/cases");
  $("#saved-cases").innerHTML = cases.length ? cases.map((item) => `<button type="button" data-load-case="${escapeHtml(item.id)}"><b>${escapeHtml(item.companyName)}</b><span>${escapeHtml(item.summary)} · ${item.revision}차 · ${new Date(item.updatedAt).toLocaleDateString("ko-KR")}</span></button>`).join("") : `<p>저장된 사건이 없습니다.</p>`;
}

async function loadCaseRevisions() {
  if (!state.caseId) { $("#case-revisions").innerHTML = "<p>사건을 저장하면 변경 이력이 남습니다.</p>"; return; }
  const { revisions } = await fetchJson(`/api/cases/${state.caseId}/revisions`);
  $("#case-revisions").innerHTML = revisions.map((item, index) => {
    const prior = revisions[index - 1]?.decisions;
    const now = item.decisions;
    const changes = [];
    if (prior && now) {
      for (const purpose of ["working", "facility"]) if (prior[purpose]?.status !== now[purpose]?.status) changes.push(`${purpose === "working" ? "운전자금" : "시설자금"}: ${prior[purpose]?.status || "미기록"} → ${now[purpose]?.status || "미기록"}`);
      const previousFindings = new Map((prior.findings || []).map((finding) => [finding.id, finding.status]));
      for (const finding of now.findings || []) if (previousFindings.get(finding.id) !== finding.status) changes.push(`${finding.title}: ${previousFindings.get(finding.id) || "미기록"} → ${finding.status}`);
    }
    return `<div><b>${item.revision}차 · ${new Date(item.updatedAt).toLocaleString("ko-KR")}</b><p>${escapeHtml(item.summary)}</p>${changes.length ? `<ul>${changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>` : `<small>${index ? "판단 상태 변화 없음 · 증빙·메모 수정 여부 확인" : "최초 저장"}</small>`}</div>`;
  }).reverse().join("");
}

$("#saved-cases").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-load-case]");
  if (!button) return;
  try {
    const record = await fetchJson(`/api/cases/${button.dataset.loadCase}`);
    const saved = record.snapshot || {};
    if (!saved.analysis?.statementViews) throw new Error("저장된 분석 형식이 올바르지 않습니다.");
    for (const [id, value] of Object.entries(saved.inputValues || {})) { const control = $("#" + id); if (control) control.value = value; }
    state.analysis = saved.analysis;
    state.selectedCompany = saved.analysis.company;
    state.structure = saved.structure || null;
    state.stress = saved.stress || null;
    state.reviewOutcome = saved.reviewOutcome || null;
    state.findingReviews = saved.findingReviews || {};
    state.attachments = saved.attachments || [];
    state.industryEvidence = saved.industryEvidence || [];
    state.debtRegister = saved.debtRegister || [];
    $("#debt-register-complete").checked = Boolean(saved.debtRegisterComplete);
    delete $("#existing-variable-share").dataset.auto;
    state.inspectionStatus = saved.inspectionStatus || {};
    state.inspectionDetails = saved.inspectionDetails || {};
    state.inspectionMemory = saved.inspectionMemory || {};
    state.statementScope = saved.statementScope || saved.analysis.primaryFsDiv || "OFS";
    state.report = saved.report || "consultation";
    state.caseId = record.id;
    state.caseRevision = record.revision;
    $("#selected-company").textContent = `${saved.analysis.company.name} · DART ${saved.analysis.company.corpCode}`;
    renderAnalysis();
    $("#inspection-list").querySelectorAll("select[data-inspection]").forEach((select) => { select.value = state.inspectionStatus[select.dataset.inspection] || "미확인"; });
    $$(".report-tabs button").forEach((item) => item.classList.toggle("active", item.dataset.report === state.report));
    renderReport();
    $("#case-status").textContent = `${record.companyName} · ${record.revision}차 저장본을 열었습니다.`;
    await loadCaseRevisions();
    $("#overview").scrollIntoView({ behavior: "smooth" });
  } catch (error) { $("#case-status").textContent = `불러오기 실패: ${error.message}`; }
});

function selectWorkflow(name, scroll = true) {
  const target = ["analysis", "inspection", "opinion"].includes(name) ? name : "analysis";
  $$("[data-workflow-page]").forEach((page) => { page.hidden = page.dataset.workflowPage !== target; });
  $$("[data-workflow-nav]").forEach((control) => {
    const active = control.dataset.workflowNav === target;
    control.classList.toggle("active", active);
    if (control.tagName === "BUTTON") control.setAttribute("aria-current", active ? "step" : "false");
  });
  if (scroll) (state.analysis ? $("#overview") : $("#inquiry")).scrollIntoView({ behavior: "smooth", block: "start" });
}
document.addEventListener("click", (event) => {
  const control = event.target.closest("[data-workflow-nav]");
  if (!control) return;
  event.preventDefault();
  selectWorkflow(control.dataset.workflowNav);
});

initializeForm();
loadConfig().catch((error) => setStatus(error.message, true));
if (new URLSearchParams(location.search).get("demo") === "1") {
  $("#purpose").value = "원재료 매입 운전자금 10억원 및 신규 생산라인 시설자금 100억원";
  analyze(true);
}
