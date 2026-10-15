/**
 * CreditLens 공통 기업분석 보고서 렌더러.
 *
 * 상장 공시기업과 고객 제출자료 기업은 이 함수에 같은 모양의 model을 넘긴다.
 * 이 모듈은 수신한 사실과 계산 가능한 수치만 표시하며, 사업·산업·현장 사실을
 * 추측으로 보충하지 않는다. 모든 외부 입력은 HTML 이스케이프한다.
 *
 * @param {object} model
 * @returns {string} 인라인 화면과 인쇄에 공용으로 쓰는 article HTML
 */
export function renderFullReport(model = {}) {
  const company = asObject(model.company);
  const records = sortedAnnualRecords(model.records);
  const latest = records[0] || {};
  const previous = records[1] || {};
  const sections = asObject(model.sections);
  const inspections = asArray(model.inspections);
  const sources = consolidateSources(model.sources);
  const reportName = text(company.name, "기업명 확인 필요");
  const basisLabel = text(model.basisLabel, "재무제표 범위 확인 필요");
  const sourceLabel = text(model.sourceLabel, "원자료 확인 필요");
  const annualSourceLabel = /고객\s*제출|CSV|비상장/.test(sourceLabel)
    ? "고객 제출 연간 재무자료"
    : /교육용|가상/.test(sourceLabel) ? "교육용 연간 재무자료" : "최근 연간 공시자료";
  const basisDate = text(model.basisDate, "기준일 확인 필요");
  const focusInterim = model.focusInterim && model.interim;
  const summaryFacts = focusInterim ? [
    ["최근 중간 누적 매출", model.interim.revenue, model.interim.period, false],
    ["최근 중간 누적 영업이익", model.interim.operatingProfit, model.interim.period, false],
    ["최근 중간 누적 영업현금흐름", model.interim.operatingCashFlow, model.interim.period, true],
  ] : [
    ["최근 연간 매출", latest.revenue, latest.period, false],
    ["최근 연간 영업이익", latest.operatingProfit, latest.period, false],
    ["최근 연간 영업현금흐름", latest.operatingCashFlow, latest.period, true],
  ];
  const toc = [
    ["01", "분석 범위와 핵심 요약"],
    ["02", "차주와 사업 구조"],
    ["03", "산업·시장 환경"],
    ["04", "경영진·지배구조"],
    ["05", "영업활동과 운전자본"],
    ["06", "재무제표와 세 활동 현금흐름"],
    ["07", "차입·유동성·상환위험"],
    ["08", "요청여신과 민감도"],
    ["09", "현장실사 기록과 우려 재판단"],
    ["10", "종합 심사의견"],
    ["11", "미해결 쟁점과 다음 확인"],
    ["12", "출처·산식·분석 한계"],
  ];

  return `<article class="credit-full-report" aria-label="${esc(reportName)} 기업분석 및 여신검토 보고서">
    <header class="cr-cover">
      <div class="cr-brand"><span class="cr-brand-mark">CL</span><span>CreditLens <small>기업여신 의사결정 지원</small></span></div>
      <p class="cr-kicker">CORPORATE CREDIT ANALYSIS · REPORT DRAFT</p>
      <h1>${esc(reportName)}<br><span>기업분석 및 여신검토 보고서</span></h1>
      <p class="cr-deck">차주 상환능력, 사업·산업 위험, 현장실사 결과와 미해결 과제를 한 문서에서 대조합니다.</p>
      <dl class="cr-cover-meta">
        <div><dt>분석 기준일</dt><dd>${esc(basisDate)}</dd></div>
        <div><dt>재무제표 범위</dt><dd>${esc(basisLabel)}</dd></div>
        <div><dt>자료 유형</dt><dd>${esc(sourceLabel)}</dd></div>
        <div><dt>원본 대조 상태</dt><dd>${esc(text(model.verificationStatus, "확인 필요"))}</dd></div>
      </dl>
      <p class="cr-cover-warning">본 보고서는 제출·공개자료 기반의 검토 초안입니다. 신용승인, 한도, 금리, 담보조건을 자동 확정하지 않습니다.</p>
    </header>

    <nav class="cr-toc" aria-label="보고서 목차"><h2>목차</h2><ol>${toc.map(([number, label]) => `<li><span>${number}</span><span>${label}</span></li>`).join("")}</ol></nav>

    ${reportSection("01", toc[0][1], `
      <p class="cr-lead">${esc(reportName)}의 ${esc(basisLabel)} 자료를 ${esc(basisDate)} 기준으로 검토했습니다. ${focusInterim ? `핵심 수치는 ${esc(text(model.interim.period))} 누적 실적이며 전년 동기와 비교합니다. 최근 연간 추세는 6장에서 별도로 제시합니다.` : `핵심 수치는 ${esc(annualSourceLabel)}를 기준으로 합니다.`} 원본 확인 상태에 따라 수치 해석과 의견은 달라질 수 있습니다.</p>
      <div class="cr-stat-grid">${summaryFacts.map(([label, value, period, signed]) => `<div class="cr-stat"><span>${esc(label)}</span><strong>${signed ? money(value) : unsignedMoney(value)}</strong><small>${esc(text(period, "기간 확인 필요"))} · 금액 단위 억원</small></div>`).join("")}</div>
      ${renderNarrative(sections.summary, "핵심 판단은 담당자의 원본 대조와 현장 확인 후 작성해야 합니다.")}
      ${renderRequest(asObject(model.loanRequest))}
      <p class="cr-note">연간 실적과 반기·분기 누적실적을 합산하거나 직접 증감률로 비교하지 않습니다. 결측값은 0으로 대체하지 않습니다.</p>
    `)}

    ${reportSection("02", toc[1][1], `
      <table class="cr-key-table"><tbody>
        ${keyRow("법인·차주명", company.name)}${keyRow("업종·주요 사업", company.industry)}
        ${keyRow("대표자", company.ceo)}${keyRow("주소", company.address)}${keyRow("기업·종목 식별", company.corpCode || company.stockCode)}
      </tbody></table>
      ${renderNarrative(sections.business, "사업모델·매출원·주요 고객·공급처의 확인자료가 입력되지 않았습니다. 공개 공시 또는 고객 제출자료의 사업 개요를 대조하세요.")}
    `)}

    ${reportSection("03", toc[2][1], `
      ${renderNarrative(sections.industry, "기업의 실제 매출·원가·수주 노출과 연결된 업종자료가 입력되지 않았습니다. 공통 경기지표만으로 업종위험을 단정할 수 없습니다.")}
      ${renderIndustryIndicators(model.industryIndicators)}
    `)}

    ${reportSection("04", toc[3][1], `
      ${renderNarrative(sections.management, "경영진 이력, 지배구조, 관계회사 지원·부담, 내부통제에 관한 검증된 자료가 입력되지 않았습니다. 현장 면담과 원본 문서로 확인하세요.")}
    `)}

    ${reportSection("05", toc[4][1], `
      ${renderAnnualChange(latest, previous)}
      ${renderNarrative(sections.operations, "수주, 생산·가동, 재고, 채권 회수와 매입결제 흐름의 확인자료가 입력되지 않았습니다. 현장실사 기록 및 월별 영업자료와 연결해야 합니다.")}
      ${renderFindings(model.financialFindings)}
    `)}

    ${reportSection("06", toc[5][1], `
      ${renderInterim(model.interim)}
      <h3>연간 주요 재무·손익</h3>
      ${renderFinancialTable(records, annualSourceLabel)}
      <h3>영업·투자·재무활동 현금흐름</h3>
      ${renderCashFlowTable(records)}
      <p class="cr-note">현금흐름의 부호만으로 좋고 나쁨을 확정하지 않습니다. 투자활동 유출은 설비투자·인수 등, 재무활동 유출은 차입상환·배당 등 서로 다른 원인일 수 있으므로 주석·원문에서 내역을 확인해야 합니다.</p>
    `)}

    ${reportSection("07", toc[6][1], `
      ${renderDebtAnalysis(latest)}
      ${renderNarrative(sections.debt, "차입금의 만기·금리조건·담보·보증, 월별 기존 원리금 일정은 확인자료가 입력되지 않았습니다. 총 금융비용만으로 만기별 상환가능액을 확정할 수 없습니다.")}
    `)}

    ${reportSection("08", toc[7][1], `
      ${renderLoanReviews(model.loanReviews, asObject(model.loanRequest))}
      ${renderScenarios(model.scenarios, sections.scenario)}
    `)}

    ${reportSection("09", toc[8][1], `
      ${renderInspectionSummary(inspections)}
      ${renderInspectionItems(inspections)}
      ${renderNarrative(model.inspectionSummary, "현장실사 종합 메모가 입력되지 않았습니다.")}
    `)}

    ${reportSection("10", toc[9][1], `
      ${renderOpinion(sections.opinion, model.opinion, inspections)}
      <p class="cr-note">당초 우려 → 제출·현장 증빙 → 해소/미해소 → 요청여신별 조건 변경의 순서로 심사자가 재판단해야 합니다. 이 문서의 미확인 항목은 승인 근거가 아닙니다.</p>
    `)}

    ${reportSection("11", toc[10][1], `
      ${renderOpenItems(model.openItems)}
    `)}

    ${reportSection("12", toc[11][1], `
      <h3>자료 출처와 대조 상태</h3>${renderSources(sources)}
      <h3>주요 지표 정의·계산 근거</h3>${renderDefinitions(model.definitions, latest)}
      <h3>해석의 한계</h3>${renderLimitations(model.limitations, sourceLabel)}
    `)}
    <footer class="cr-footer"><span>CreditLens · 기업여신 분석지원</span><span>${esc(reportName)} · ${esc(basisDate)} · 검토 초안</span></footer>
  </article>`;
}

const BLANK = "자료 확인 필요";
const numberFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

function asObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback = BLANK) { return value === 0 || (value !== null && value !== undefined && String(value).trim()) ? String(value).trim() : fallback; }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function amount(value) { return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null; }
function money(value) { const n = amount(value); return n === null ? BLANK : `${n > 0 ? "+" : ""}${numberFormatter.format(n / 100_000_000)}억원`; }
function unsignedMoney(value) { const n = amount(value); return n === null ? BLANK : `${numberFormatter.format(n / 100_000_000)}억원`; }
function ratio(value, unit = "%", digits = 1) { const n = amount(value); return n === null ? BLANK : `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(n)}${unit}`; }
function calculatedRatio(numerator, denominator, multiplier = 1) {
  const a = amount(numerator), b = amount(denominator);
  return a !== null && b !== null && b > 0 ? (a / b) * multiplier : null;
}
function yearLabel(record) { return text(record.period, "기간 확인 필요"); }
function sortedAnnualRecords(value) {
  return asArray(value).filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item }))
    .sort((a, b) => {
      const ay = Number(String(a.period || "").match(/\d{4}/)?.[0] || 0);
      const by = Number(String(b.period || "").match(/\d{4}/)?.[0] || 0);
      return by - ay;
    });
}
function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}
function reportSection(number, title, body) {
  return `<section class="cr-section" id="cr-section-${number}" aria-labelledby="cr-heading-${number}"><header class="cr-section-heading"><span>${number}</span><h2 id="cr-heading-${number}">${esc(title)}</h2></header>${body}</section>`;
}
function keyRow(label, value) { return `<tr><th scope="row">${esc(label)}</th><td>${esc(text(value))}</td></tr>`; }
function renderNarrative(input, fallback) {
  if (typeof input === "string" && input.trim()) return `<p class="cr-narrative">${esc(input)}</p>`;
  const data = asObject(input);
  const parts = [];
  if (data.text) parts.push(`<p class="cr-narrative">${esc(data.text)}</p>`);
  for (const label of ["facts", "bullets", "positive", "concerns", "questions"]) {
    const entries = asArray(data[label]).filter((item) => item !== null && item !== undefined && String(item).trim());
    if (!entries.length) continue;
    const title = ({ facts: "확인된 사실", bullets: "검토 내용", positive: "강점·기회", concerns: "우려·제약", questions: "검증 질문" })[label];
    parts.push(`<div class="cr-narrative-list"><h3>${title}</h3><ul>${entries.map((item) => `<li>${esc(typeof item === "string" ? item : text(item.text || item.title, BLANK))}</li>`).join("")}</ul></div>`);
  }
  return parts.length ? parts.join("") : `<p class="cr-empty">${esc(fallback)}</p>`;
}
function renderRequest(request) {
  const working = amount(request.workingAmount), facility = amount(request.facilityAmount);
  if (working === null && facility === null) return `<div class="cr-compact-callout"><b>요청여신</b><span>요청금액·기간이 입력되지 않았습니다.</span></div>`;
  const items = [];
  if (working !== null && working > 0) items.push(`<div><span>운전자금</span><strong>${ratio(working, "억원", 1)}</strong><small>${amount(request.workingTermMonths) !== null ? `${esc(request.workingTermMonths)}개월` : "기간 확인 필요"}</small></div>`);
  if (facility !== null && facility > 0) items.push(`<div><span>시설자금</span><strong>${ratio(facility, "억원", 1)}</strong><small>${amount(request.facilityTermMonths) !== null ? `${esc(request.facilityTermMonths)}개월` : "기간 확인 필요"}</small></div>`);
  return items.length ? `<div class="cr-request-grid">${items.join("")}</div>${request.purpose ? `<p><b>상담 목적:</b> ${esc(request.purpose)}</p>` : ""}` : `<p class="cr-empty">요청여신 금액이 입력되지 않았습니다.</p>`;
}
function renderIndustryIndicators(value) {
  const indicators = asArray(value);
  if (!indicators.length) return "";
  return `<h3>기업 노출과 연결한 지표</h3><div class="cr-indicator-grid">${indicators.map((item) => {
    const entry = asObject(item);
    return `<div class="cr-indicator"><b>${esc(text(entry.name))}</b><strong>${esc(text(entry.value))}</strong><small>${esc(text(entry.period))} · ${esc(text(entry.source))}</small><p>${esc(text(entry.companyExposure || entry.implication, "기업 매출·원가·수주에 미치는 경로 확인 필요"))}</p><span class="cr-tag">${esc(text(entry.verification, "원자료 대조 전"))}</span></div>`;
  }).join("")}</div>`;
}
function renderAnnualChange(latest, previous) {
  if (!Object.keys(latest).length) return `<p class="cr-empty">연간 재무자료가 없습니다. 영업활동의 기간별 변화를 계산하지 않습니다.</p>`;
  const comparable = Object.keys(previous).length > 0;
  const metrics = [
    ["매출", latest.revenue, previous.revenue],
    ["영업이익", latest.operatingProfit, previous.operatingProfit],
    ["영업현금흐름", latest.operatingCashFlow, previous.operatingCashFlow],
  ];
  return `<div class="cr-subsection"><h3>최근 연간 변화</h3><p class="cr-subtitle">${comparable ? `${esc(yearLabel(previous))} → ${esc(yearLabel(latest))}` : "직전연도 비교자료 없음"} · 연간 자료끼리만 비교</p><div class="cr-change-grid">${metrics.map(([label, current, prior]) => {
    const rate = comparable ? calculatedRatio(amount(current) === null || amount(prior) === null ? null : amount(current) - amount(prior), prior, 100) : null;
    const rateText = rate === null ? "증감률 산정 불가" : `${rate > 0 ? "+" : ""}${ratio(rate, "%", 1)}`;
    const signed = label === "영업현금흐름";
    return `<div><span>${label}</span><strong>${signed ? money(current) : unsignedMoney(current)}</strong><small>전기 ${signed ? money(prior) : unsignedMoney(prior)} · ${rateText}</small></div>`;
  }).join("")}</div><p class="cr-caption">전기 금액이 0 이하이면 증감률을 표시하지 않습니다. 영업현금흐름과 회계상 이익의 차이는 채권·재고·채무와 비현금 항목을 확인해야 원인을 설명할 수 있습니다.</p></div>`;
}
function financialCell(record, key, computed) {
  const value = amount(record[key]);
  if (value !== null) return key.endsWith("Ratio") || key === "financeCostCoverage" ? ratio(value, key === "financeCostCoverage" ? "배" : "%", 2) : unsignedMoney(value);
  return computed !== undefined ? computed : BLANK;
}
function renderFinancialTable(records, annualSourceLabel) {
  if (!records.length) return `<p class="cr-empty">연간 재무 수치가 입력되지 않았습니다. 원본 대조도 필요합니다.</p>`;
  const metrics = [
    ["매출액", "revenue"], ["영업이익", "operatingProfit"], ["당기순이익", "netIncome"],
    ["자산총계", "totalAssets"], ["부채총계", "totalLiabilities"], ["자본총계", "equity"],
    ["유동자산", "currentAssets"], ["유동부채", "currentLiabilities"],
  ];
  return `<div class="cr-table-scroll"><table class="cr-table"><thead><tr><th scope="col">계정</th>${records.map((row) => `<th scope="col">${esc(yearLabel(row))}</th>`).join("")}</tr></thead><tbody>${metrics.map(([label, key]) => `<tr><th scope="row">${label}</th>${records.map((row) => `<td>${financialCell(row, key)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="cr-caption">가장 최근의 ${esc(annualSourceLabel)}를 왼쪽에 표시합니다. 금액 단위 억원, 반올림 표시. 원문 계정명·단위·별도/연결 범위는 출처와 대조하세요.</p>`;
}
function renderCashFlowTable(records) {
  if (!records.length) return `<p class="cr-empty">세 활동 현금흐름을 표시할 연간 자료가 없습니다.</p>`;
  const metrics = [
    ["영업활동현금흐름", "operatingCashFlow"],
    ["투자활동현금흐름", "investingCashFlow"],
    ["재무활동현금흐름", "financingCashFlow"],
    ["단순 FCF(영업현금 − 유형·무형자산 취득)", "freeCashFlow"],
  ];
  return `<div class="cr-table-scroll"><table class="cr-table cr-cash-table"><thead><tr><th scope="col">현금흐름 항목</th>${records.map((row) => `<th scope="col">${esc(yearLabel(row))}</th>`).join("")}</tr></thead><tbody>${metrics.map(([label, key]) => `<tr><th scope="row">${label}</th>${records.map((row) => `<td>${money(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="cr-caption">단순 FCF의 사용 계정과 리스·배당 반영 여부를 확인해야 합니다. 영업·투자·재무활동 현금흐름의 합계와 실제 현금증감은 환율효과 등으로 다를 수 있습니다.</p>`;
}
function renderInterim(value) {
  const interim = asObject(value);
  if (!Object.keys(interim).length) return `<div class="cr-interim"><h3>최근 반기·분기 비교</h3><p class="cr-empty">동일한 보고기간의 최근 중간재무 비교자료가 입력되지 않았습니다. 연간 자료로 현재 사업연도 실적을 대체하지 않습니다.</p></div>`;
  const currentPeriod = text(interim.period, "당기 중간보고서"), priorPeriod = text(interim.comparisonPeriod || interim.previousPeriod, "전년 동기");
  const metrics = [
    ["누적 매출액", "revenue", "previousRevenue"],
    ["누적 영업이익", "operatingProfit", "previousOperatingProfit"],
    ["누적 영업현금흐름", "operatingCashFlow", "previousOperatingCashFlow"],
    ["누적 투자활동현금흐름", "investingCashFlow", "previousInvestingCashFlow"],
    ["누적 재무활동현금흐름", "financingCashFlow", "previousFinancingCashFlow"],
  ];
  const rows = metrics.filter(([, key, previousKey], index) => index < 3 || amount(interim[key]) !== null || amount(interim[previousKey]) !== null).map(([label, key, previousKey]) => {
    const current = amount(interim[key]), previous = amount(interim[previousKey]);
    const change = calculatedRatio(current !== null && previous !== null ? current - previous : null, previous, 100);
    let comparison = change === null ? "증감률 산정 불가" : `${change > 0 ? "+" : ""}${ratio(change, "%", 1)}`;
    if (key === "investingCashFlow" || key === "financingCashFlow") comparison = current !== null && previous !== null ? money(current - previous) + " 차이" : "비교자료 없음";
    const signed = key === "operatingCashFlow" || key === "investingCashFlow" || key === "financingCashFlow";
    return `<tr><th scope="row">${label}</th><td>${signed ? money(current) : unsignedMoney(current)}</td><td>${signed ? money(previous) : unsignedMoney(previous)}</td><td>${comparison}</td></tr>`;
  }).join("");
  return `<div class="cr-interim"><h3>최근 반기·분기 비교</h3><p class="cr-subtitle">${esc(priorPeriod)} → ${esc(currentPeriod)} · 동일 기간 누적액끼리 비교</p><div class="cr-table-scroll"><table class="cr-table"><thead><tr><th scope="col">계정</th><th scope="col">${esc(currentPeriod)}</th><th scope="col">${esc(priorPeriod)}</th><th scope="col">전년 동기 대비</th></tr></thead><tbody>${rows}</tbody></table></div>${renderInterimBalances(interim, currentPeriod, priorPeriod)}<p class="cr-caption">중간재무의 손익·현금흐름은 누적 실적이고, 재무상태표는 각 보고기간 말 잔액입니다. 연간 값과 합산하거나 연간 전기와 직접 비교하지 않습니다. 전년 동기 금액이 0 이하이면 증감률을 표시하지 않습니다.</p></div>`;
}
function renderInterimBalances(interim, currentPeriod, priorPeriod) {
  const fields = [
    ["자산총계", "totalAssets", "previousTotalAssets"],
    ["부채총계", "totalLiabilities", "previousTotalLiabilities"],
    ["자본총계", "equity", "previousEquity"],
    ["유동자산", "currentAssets", "previousCurrentAssets"],
    ["유동부채", "currentLiabilities", "previousCurrentLiabilities"],
    ["단기 금융차입금", "shortTermDebt", "previousShortTermDebt"],
    ["장기 금융차입금", "longTermDebt", "previousLongTermDebt"],
  ].filter(([, key, priorKey]) => amount(interim[key]) !== null || amount(interim[priorKey]) !== null);
  if (!fields.length) return "";
  const rows = fields.map(([label, key, priorKey]) => {
    const current = amount(interim[key]), prior = amount(interim[priorKey]);
    const difference = current !== null && prior !== null ? money(current - prior) : "비교자료 없음";
    return "<tr><th scope=\"row\">" + label + "</th><td>" + unsignedMoney(current) + "</td><td>" + unsignedMoney(prior) + "</td><td>" + difference + "</td></tr>";
  }).join("");
  return "<h4>보고기간 말 재무상태·차입 잔액</h4><div class=\"cr-table-scroll\"><table class=\"cr-table\"><thead><tr><th scope=\"col\">계정</th><th scope=\"col\">" + esc(currentPeriod) + " 말</th><th scope=\"col\">" + esc(priorPeriod) + " 말</th><th scope=\"col\">잔액 차이</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
}
function renderFindings(value) {
  const findings = asArray(value);
  if (!findings.length) return "";
  return `<div class="cr-finding-grid">${findings.map((item) => {
    const finding = asObject(item);
    return `<div class="cr-finding"><h3>${esc(text(finding.title))}</h3><p><b>관찰값</b> ${esc(text(finding.observed, "값·기간 확인 필요"))}</p><p><b>가능한 해석</b> ${esc(text(finding.interpretation, "원인 확인 필요"))}</p><p><b>확인자료</b> ${esc(text(finding.check, "담당자 확인 필요"))}</p></div>`;
  }).join("")}</div>`;
}
function renderDebtAnalysis(latest) {
  const interestProxy = latest.financeCostsSource === "이자비용 대체값";
  const coverageName = interestProxy ? "영업이익/이자비용(대체)" : "영업이익/금융비용";
  const costName = interestProxy ? "제출·예시 이자비용" : "포괄손익계산서 금융비용";
  const metrics = [
    { name: "부채비율", numerator: latest.totalLiabilities, denominator: latest.equity, factor: 100, unit: "%", formula: "부채총계 ÷ 자기자본 × 100" },
    { name: "유동비율", numerator: latest.currentAssets, denominator: latest.currentLiabilities, factor: 100, unit: "%", formula: "유동자산 ÷ 유동부채 × 100" },
    { name: coverageName, numerator: latest.operatingProfit, denominator: latest.financeCosts, factor: 1, unit: "배", formula: `영업이익 ÷ ${costName}` },
  ];
  return `<div class="cr-debt-head"><div><span>공시·제출 금융차입금</span><strong>${unsignedMoney(latest.totalDebt)}</strong><small>원금 만기·리스 포함 여부 확인 필요</small></div><div><span>${costName}</span><strong>${unsignedMoney(latest.financeCosts)}</strong><small>${interestProxy ? "금융비용 원계정 없음 · 대체 사용" : "순수 이자비용과 구분"}</small></div></div><div class="cr-ratio-grid">${metrics.map((metric) => {
    const derived = calculatedRatio(metric.numerator, metric.denominator, metric.factor);
    const difference = amount(latest[metric.name === "부채비율" ? "debtRatio" : metric.name === "유동비율" ? "currentRatio" : "financeCostCoverage"]);
    const mismatch = difference !== null && derived !== null && Math.abs(difference - derived) > (metric.unit === "배" ? 0.03 : 0.2);
    return `<div class="cr-ratio"><span>${metric.name}</span><strong>${ratio(derived, metric.unit, 2)}</strong><small>${metric.formula}</small><p>${unsignedMoney(metric.numerator)} ÷ ${unsignedMoney(metric.denominator)}${metric.factor === 100 ? " × 100" : ""}</p>${mismatch ? `<em>제공 비율과 재계산값 차이 확인 필요</em>` : ""}</div>`;
  }).join("")}</div><p class="cr-caption">지표는 제공된 원계정으로 단순 재계산한 값입니다. 재무제표 범위·기간과 비용 계정 정의를 원문에서 확인해야 합니다. ${interestProxy ? "이자비용을 대체 사용했으므로 포괄손익계산서 금융비용 기반 배율로 해석하지 않습니다." : "영업이익/금융비용은 주석상 이자비용만 사용한 이자보상배율과 다릅니다."}</p>`;
}
function renderLoanReviews(value, request) {
  const reviews = asObject(value);
  const requested = [
    ["working", "운전자금", request.workingAmount, "매입→판매→회수 기간과 만기 내 회수재원"],
    ["facility", "시설자금", request.facilityAmount, "집행→가동→추가 현금창출과 원리금 일정"],
  ].filter(([, , amountValue]) => amount(amountValue) !== null && Number(amountValue) > 0);
  if (!requested.length) return `<p class="cr-empty">검토할 운전자금·시설자금 요청액이 입력되지 않았습니다.</p>`;
  const cards = requested.map(([key, label, requestedAmount, focus]) => {
    const review = asObject(reviews[key]);
    return `<div class="cr-loan-card"><div class="cr-loan-card-head"><div><span>${label}</span><strong>${ratio(requestedAmount, "억원")}</strong></div><span class="cr-tag">${esc(text(review.status, "상환구조 검증 전"))}</span></div><p><b>검토 초점</b> ${focus}</p><p><b>확인된 근거</b> ${esc(text(review.evidence, "상환자료·현장 근거 확인 필요"))}</p><p><b>미해결 쟁점</b> ${esc(text(review.concern, "담당자·심사자 검토 필요"))}</p><p><b>조건 검토</b> ${esc(text(review.condition, "요청액·금리·만기·상환방식은 고객 현금수지와 기존 원리금 일정 확인 후 검토"))}</p></div>`;
  }).join("");
  return `<h3>자금용도별 분리 검토</h3><div class="cr-loan-grid">${cards}</div>${renderNarrative(reviews.integrated, "두 자금의 집행·상환 시점이 겹치는지 확인해야 합니다. 단기 운전자금이 시설투자 공백을 메우는 구조인지 별도 검증이 필요합니다.")}`;
}
function renderScenarios(value, narrative) {
  const scenarios = asArray(value);
  const introduction = renderNarrative(narrative, "시나리오를 입력하지 않았습니다. 원리금 상환가능액이나 적정 여신금액을 추정하지 않습니다.");
  if (!scenarios.length) return `<h3>민감도·스트레스 시나리오</h3>${introduction}`;
  return `<h3>민감도·스트레스 시나리오</h3>${introduction}<div class="cr-scenario-grid">${scenarios.map((item) => {
    const scenario = asObject(item);
    return `<div class="cr-scenario"><h4>${esc(text(scenario.name, "시나리오"))}</h4><p><b>가정</b> ${esc(text(scenario.assumptions, "가정값 확인 필요"))}</p><p><b>계산 결과</b> ${esc(text(scenario.results, "계산값 입력 전"))}</p><p><b>해석</b> ${esc(text(scenario.interpretation, "미래 예측값이 아님"))}</p><small>${esc(text(scenario.limitations, "민감도는 승인한도·제시금리의 근거가 아닙니다."))}</small></div>`;
  }).join("")}</div>`;
}
function inspectionComplete(raw) {
  const item = asObject(raw);
  const status = String(item.status || "").trim();
  return Boolean(status && !["미확인", "확인 전", "근거 미기록", "요청자료 미기록"].includes(status)
    && String(item.observation || "").trim()
    && String(item.evidence || "").trim()
    && String(item.action || item.followUp || "").trim());
}
function inspectionDisplayStatus(raw) {
  const item = asObject(raw);
  const selected = text(item.selectedStatus || item.status, "미확인");
  const effective = text(item.status, "미확인");
  return selected === effective ? selected : selected + " (" + effective + ")";
}
function renderOpinion(section, opinionInput, inspections) {
  const opinion = asObject(opinionInput);
  const narrative = renderNarrative(section || opinion.summary, "현장실사·원본 대조·상환자료 확인 후 종합의견을 작성해야 합니다.");
  const completed = inspections.filter(inspectionComplete).length;
  return `<div class="cr-opinion-status"><b>현장실사 근거 기록</b><strong>${completed}/${inspections.length}건</strong><small>상태 선택만으로 확인 완료로 보지 않습니다.</small></div>${narrative}${opinion.working || opinion.facility ? `<div class="cr-opinion-columns"><p><b>운전자금 의견</b><br>${esc(text(opinion.working, "상환자료 확인 전"))}</p><p><b>시설자금 의견</b><br>${esc(text(opinion.facility, "투자·상환자료 확인 전"))}</p></div>` : ""}${opinion.conditions ? `<p><b>조건·후속관리:</b> ${esc(opinion.conditions)}</p>` : ""}`;
}
function renderInspectionSummary(items) {
  const completed = items.filter(inspectionComplete).length;
  const concerns = items.filter((item) => /우려|이상|자료\s*요청/.test(String(item?.selectedStatus || item?.status || ""))).length;
  return `<div class="cr-inspection-summary"><div><span>점검 항목</span><strong>${items.length}건</strong></div><div><span>관찰·근거·후속조치 기록</span><strong>${completed}건</strong></div><div><span>우려·자료 요청</span><strong>${concerns}건</strong></div></div><p class="cr-caption">현장 판단, 관찰 사실, 확인 근거, 심사 영향·후속조치를 각각 기록했습니다. 파일명·해시는 원본 내용 검증을 의미하지 않습니다.</p>`;
}
function renderInspectionItems(items) {
  if (!items.length) return `<p class="cr-empty">현장실사 항목이 아직 생성되지 않았거나 입력되지 않았습니다.</p>`;
  return `<div class="cr-inspection-list">${items.map((raw, index) => {
    const item = asObject(raw);
    const files = asArray(item.files);
    const complete = inspectionComplete(item);
    return `<section class="cr-inspection-item"><div class="cr-inspection-item-head"><span>${String(index + 1).padStart(2, "0")} · ${esc(text(item.category, "현장 항목"))}</span><span class="cr-tag ${complete ? "cr-tag-filled" : ""}">${esc(inspectionDisplayStatus(item))}${complete ? "" : " · 기록 미완료"}</span></div><h3>${esc(text(item.question, "점검 질문 확인 필요"))}</h3><div class="cr-inspection-fields"><div><b>관찰한 사실</b><p>${esc(text(item.observation, "기록 없음"))}</p></div><div><b>확인 근거·증빙</b><p>${esc(text(item.evidence, "기록 없음"))}</p></div><div><b>심사 영향·후속조치</b><p>${esc(text(item.action || item.followUp, "기록 없음"))}</p></div></div><p class="cr-file-meta"><b>첨부 원본</b> ${files.length ? files.map((file) => {
      const entry = typeof file === "string" ? { name: file } : asObject(file);
      return `${esc(text(entry.name, "파일명 확인 필요"))}${entry.sha256 ? ` (SHA-256 ${esc(String(entry.sha256).slice(0, 16))}…)` : ""}`;
    }).join(" · ") : "선택 파일 없음"}</p></section>`;
  }).join("")}</div>`;
}
function renderOpenItems(value) {
  const items = asArray(value);
  if (!items.length) return `<p class="cr-empty">추가 확인 과제가 정리되지 않았습니다. 자동 경고가 없다는 것이 위험 부재를 뜻하지 않습니다.</p>`;
  return `<ol class="cr-open-list">${items.map((raw) => {
    const item = typeof raw === "string" ? { title: raw } : asObject(raw);
    return `<li><b>${esc(text(item.title))}</b>${item.reason ? `<p>${esc(item.reason)}</p>` : ""}${item.owner ? `<small>확인 담당: ${esc(item.owner)}</small>` : ""}</li>`;
  }).join("")}</ol>`;
}
function consolidateSources(value) {
  const entries = asArray(value).map((raw) => typeof raw === "string" ? { name: raw } : asObject(raw));
  const grouped = new Map();
  for (const entry of entries) {
    const key = [entry.name || entry.label || entry.source || "", entry.scope || "", safeUrl(entry.url) || ""].join("||");
    if (!grouped.has(key)) grouped.set(key, { name: entry.name || entry.label || entry.source, scope: entry.scope, url: safeUrl(entry.url), periods: new Set(), statuses: new Set(), locators: new Set() });
    const row = grouped.get(key);
    if (entry.period) row.periods.add(String(entry.period));
    if (entry.status || entry.verification) row.statuses.add(String(entry.status || entry.verification));
    if (entry.locator) row.locators.add(String(entry.locator));
  }
  return [...grouped.values()];
}
function renderSources(rows) {
  if (!rows.length) return `<p class="cr-empty">원문 출처 목록이 입력되지 않았습니다. 수치별 보고서·계정·페이지 또는 공식 API 응답을 대조해야 합니다.</p>`;
  return `<div class="cr-table-scroll"><table class="cr-table cr-source-table"><thead><tr><th scope="col">원자료</th><th scope="col">범위·기간</th><th scope="col">대조 상태</th></tr></thead><tbody>${rows.map((row) => `<tr><th scope="row">${row.url ? `<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(text(row.name))} ↗</a>` : esc(text(row.name))}</th><td>${esc(text(row.scope, "범위 확인 필요"))}<br><small>${esc([...row.periods].join(" · ") || "기간 확인 필요")}${row.locators.size ? ` · ${esc([...row.locators].join(" · "))}` : ""}</small></td><td>${esc([...row.statuses].join(" · ") || "원본 대조 전")}</td></tr>`).join("")}</tbody></table></div>`;
}
function renderDefinitions(value, latest) {
  const extra = asArray(value).map((item) => typeof item === "string" ? { name: item } : asObject(item));
  const interestProxy = latest.financeCostsSource === "이자비용 대체값";
  const coverageName = interestProxy ? "영업이익/이자비용(대체)" : "영업이익/금융비용";
  const defaults = [
    { name: "부채비율", formula: "부채총계 ÷ 자기자본 × 100", substitution: `${unsignedMoney(latest.totalLiabilities)} ÷ ${unsignedMoney(latest.equity)} × 100`, result: ratio(calculatedRatio(latest.totalLiabilities, latest.equity, 100), "%", 2) },
    { name: "유동비율", formula: "유동자산 ÷ 유동부채 × 100", substitution: `${unsignedMoney(latest.currentAssets)} ÷ ${unsignedMoney(latest.currentLiabilities)} × 100`, result: ratio(calculatedRatio(latest.currentAssets, latest.currentLiabilities, 100), "%", 2) },
    { name: coverageName, formula: `영업이익 ÷ ${interestProxy ? "제출·예시 이자비용" : "포괄손익계산서 금융비용"}`, substitution: `${unsignedMoney(latest.operatingProfit)} ÷ ${unsignedMoney(latest.financeCosts)}`, result: ratio(calculatedRatio(latest.operatingProfit, latest.financeCosts), "배", 2) },
  ];
  const defs = [
    ...defaults.map((standard) => {
      const supplied = extra.find((item) => item.name === standard.name);
      return supplied ? { ...standard, ...supplied, substitution: supplied.substitution || standard.substitution, result: supplied.result || standard.result } : standard;
    }),
    ...extra.filter((item) => item.name && !defaults.some((standard) => standard.name === item.name)),
  ];
  return `<div class="cr-table-scroll"><table class="cr-table cr-definition-table"><thead><tr><th scope="col">지표</th><th scope="col">산식과 사용계정</th><th scope="col">대입·결과</th></tr></thead><tbody>${defs.map((item) => `<tr><th scope="row">${esc(text(item.name))}<small>${esc(text(item.period, yearLabel(latest)))} · ${esc(text(item.scope, "현재 선택 재무범위"))}</small></th><td>${esc(text(item.formula))}${item.accounts ? `<small>계정: ${esc(item.accounts)}</small>` : ""}${item.source ? `<small>출처: ${esc(item.source)}</small>` : ""}</td><td>${esc(text(item.substitution, "대입값 확인 필요"))}${item.result ? `<strong>${esc(item.result)}</strong>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
}
function renderLimitations(value, sourceLabel) {
  const defaults = [
    "공시·제출자료의 자동 수신 또는 파일 첨부는 원본의 정확성·완전성 검증을 의미하지 않습니다. 계정 정의, 비교기간, 별도/연결 범위와 주석을 담당자가 확인해야 합니다.",
    "차입별 만기·금리, 담보·보증, 고객의 월별 현금수지 및 실제 금융조건이 없으면 요청금액의 적정성과 상환구조를 확정할 수 없습니다.",
    "현장실사 결과와 시나리오는 심사의 판단자료일 뿐, 승인·거절이나 한도·담보금액을 자동 결정하지 않습니다.",
  ];
  const extra = asArray(value).filter(Boolean).map((item) => String(item));
  return `<p class="cr-caption">자료 유형: ${esc(sourceLabel)}. 사용한 출처와 확인 시점은 위 표를 참조하세요.</p><ul class="cr-limit-list">${[...defaults, ...extra].map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

/**
 * 저장·별도 인쇄용 독립 HTML 문서. 공통 CSS를 받아 문서 안에 내장하므로
 * 내려받은 파일도 오프라인에서 동일하게 인쇄할 수 있다.
 * 두 번째 인수로 이미 읽은 CSS 문자열을 전달할 수도 있다.
 */
export async function renderFullReportDocument(model = {}, stylesheet = "") {
  const title = `${text(model.company?.name, "기업")}_기업분석보고서`;
  const fallbackCss = `*{box-sizing:border-box}body{margin:0;background:#fff;color:#17283e;font-family:Arial,"Malgun Gothic",sans-serif}.credit-full-report{max-width:1000px;margin:auto;padding:32px;line-height:1.6;font-size:15px}.cr-cover{border-top:8px solid #1769e0;padding:40px 0}.cr-brand{font-weight:800}.cr-cover h1{font-size:32px}.cr-section{margin:36px 0;break-inside:auto}.cr-section-heading{border-bottom:2px solid #1769e0;margin-bottom:15px}.cr-section-heading h2{display:inline-block;font-size:22px}.cr-table{width:100%;border-collapse:collapse}.cr-table th,.cr-table td{padding:8px;border-bottom:1px solid #dce4ef;text-align:left}.cr-table thead{background:#eef5ff}.cr-inspection-item{border:1px solid #dce4ef;padding:15px;margin:10px 0;break-inside:avoid}@page{size:A4;margin:15mm}@media print{.credit-full-report{max-width:none;padding:0}.cr-section-heading{break-after:avoid}.cr-table thead{display:table-header-group}.cr-table tr{break-inside:avoid}}`;
  let embeddedCss = stylesheet;
  if (!embeddedCss) {
    try {
      const response = await fetch(new URL("./final-report.css", import.meta.url));
      if (!response.ok) throw new Error(`stylesheet ${response.status}`);
      embeddedCss = await response.text();
    } catch {
      embeddedCss = fallbackCss;
    }
  }
  const style = String(embeddedCss).replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${style}</style></head><body>${renderFullReport(model)}</body></html>`;
}
