const $ = (selector) => document.querySelector(selector);
const pdfEvidence = [];
let currentAnalysis = null;
let sourceCsvText = "";
let reviewCorrections = [];
let inspectionAnswers = {};
const inspectionEvidence = new Map();
const manualPages = new Set(["source", "analysis", "inspection", "opinion"]);

function showManualPage(page) {
  const target = manualPages.has(page) ? page : "source";
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
});

$("#manual-template").addEventListener("click", () => {
  const columns = ["period", "revenue", "operatingProfit", "netIncome", "costOfSales", "operatingCashFlow", "investingCashFlow", "financingCashFlow", "cash", "totalAssets", "totalLiabilities", "equity", "currentAssets", "currentLiabilities", "accountsReceivable", "inventory", "accountsPayable", "shortTermDebt", "longTermDebt", "financeCosts", "interestExpense", "capex", "intangibleCapex"];
  const year = new Date().getFullYear() - 1;
  const blank = (period) => [period, ...columns.slice(1).map(() => "")].join(",");
  const csv = `\uFEFF${columns.join(",")}\r\n${blank(year - 1)}\r\n${blank(year)}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "CreditLens_비상장_재무입력_양식.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("#manual-sample").addEventListener("click", () => {
  const columns = ["period", "revenue", "operatingProfit", "netIncome", "costOfSales", "operatingCashFlow", "investingCashFlow", "financingCashFlow", "cash", "totalAssets", "totalLiabilities", "equity", "currentAssets", "currentLiabilities", "accountsReceivable", "inventory", "accountsPayable", "shortTermDebt", "longTermDebt", "financeCosts", "interestExpense", "capex", "intangibleCapex"];
  const rows = [
    { period: 2023, revenue: 240, operatingProfit: 22, netIncome: 15, costOfSales: 180, operatingCashFlow: 18, investingCashFlow: -15, financingCashFlow: 4, cash: 45, totalAssets: 420, totalLiabilities: 190, equity: 230, currentAssets: 180, currentLiabilities: 120, accountsReceivable: 55, inventory: 70, accountsPayable: 43, shortTermDebt: 45, longTermDebt: 75, financeCosts: 6, interestExpense: 5, capex: 14, intangibleCapex: 1 },
    { period: 2024, revenue: 265, operatingProfit: 27, netIncome: 18, costOfSales: 197, operatingCashFlow: 21, investingCashFlow: -20, financingCashFlow: 5, cash: 51, totalAssets: 455, totalLiabilities: 205, equity: 250, currentAssets: 195, currentLiabilities: 130, accountsReceivable: 65, inventory: 77, accountsPayable: 46, shortTermDebt: 50, longTermDebt: 80, financeCosts: 7, interestExpense: 6, capex: 18, intangibleCapex: 2 },
    { period: 2025, revenue: 290, operatingProfit: 20, netIncome: 11, costOfSales: 223, operatingCashFlow: 8, investingCashFlow: -25, financingCashFlow: 14, cash: 48, totalAssets: 490, totalLiabilities: 230, equity: 260, currentAssets: 205, currentLiabilities: 145, accountsReceivable: 80, inventory: 92, accountsPayable: 49, shortTermDebt: 65, longTermDebt: 85, financeCosts: 9, interestExpense: 8, capex: 23, intangibleCapex: 2 },
  ];
  const csv = `${columns.join(",")}\r\n${rows.map((row) => columns.map((column) => row[column] ?? "").join(",")).join("\r\n")}\r\n`;
  const transfer = new DataTransfer();
  transfer.items.add(new File([csv], "가상기업_재무예시.csv", { type: "text/csv" }));
  $("#manual-csv").files = transfer.files;
  $("#manual-name").value = "가상기업 에이비정밀";
  $("#manual-industry").value = "자동차부품 제조업 · 가상 사례";
  $("#manual-unit").value = "억원";
  $("#manual-working").value = "10";
  $("#manual-facility").value = "30";
  $("#manual-basis").value = "OFS";
  $("#manual-standard").value = "확인 전";
  reviewCorrections = [];
  $("#manual-status").textContent = "가상 재무자료 3개년을 채웠습니다. ‘제출 재무자료 분석’을 누르면 계산 결과를 볼 수 있습니다.";
});

function renderResult(analysis) {
  const records = Array.isArray(analysis.records) ? analysis.records : [];
  const latest = records.at(-1) || {}, previous = records.at(-2) || {};
  const flags = analysis.assessment?.redFlags || [];
  const dimensions = analysis.performance?.dimensions || [];
  const statementValidations = analysis.dataQuality?.validations || [];
  const metricRows = [
    ["매출액", "revenue"], ["영업이익", "operatingProfit"], ["영업활동현금흐름", "operatingCashFlow"],
    ["총자산", "totalAssets"], ["총부채", "totalLiabilities"], ["자기자본", "equity"],
    ["금융차입금 · 리스 제외", "totalDebt"], ["투자활동현금흐름", "investingCashFlow"],
  ];
  const issues = analysis.manualReview?.issues || [];
  const blocked = issues.some((item) => item.severity === "blocking");
  const purpose = (key, label) => {
    const item = analysis.decisionSupport?.[key];
    if (!item?.requested) return "";
    return `<article class="manual-purpose"><h3>${label}</h3><strong>${escapeHtml(item.requested.toLocaleString("ko-KR"))}억원</strong><p>${blocked ? "차주 자료 오류 해소 전 · 판단 보류" : escapeHtml(item.stance)} · 입력자료 기반 잠정 검토</p>${blocked ? `<p>필수 수치의 불일치를 먼저 해결하면 회전주기·현금창출·기존 차입 부담 계산이 표시됩니다.</p>` : (item.appliedRules || []).map((rule) => `<div class="manual-rule"><b>${escapeHtml(rule.title)}</b><span>${escapeHtml(rule.result)}</span><p>${escapeHtml(rule.calculation)}</p><p>${escapeHtml(rule.interpretation)}</p><p><b>확인자료</b> ${escapeHtml(rule.check)}</p></div>`).join("")}</article>`;
  };
  $("#manual-results").hidden = false;
  $("#manual-analysis-empty").hidden = true;
  $("#manual-results").innerHTML = `<div class="manual-result-head"><div><span class="manual-badge">${escapeHtml(analysis.manualReview?.sourceStatus || "고객제출 CSV · 원본 대조 전")}${blocked ? " · 오류 해결 전" : ""}</span><h2>${escapeHtml(analysis.company?.name)} · 재무 변화 요약</h2><p>${escapeHtml(records[0]?.period)}~${escapeHtml(latest.period)}년 ${analysis.primaryFsDiv === "CFS" ? "연결 · 그룹" : "별도 · 차주"} 재무제표 입력값 · 최근 비교 ${escapeHtml(previous.period)} → ${escapeHtml(latest.period)} · 금액 단위 억원</p></div></div>
    <div class="manual-kpis"><article><span>매출액</span><strong>${money(latest.revenue)}</strong><small>전년 대비 ${percent(latest.revenueGrowth)}</small></article><article><span>영업이익</span><strong>${money(latest.operatingProfit)}</strong><small>전년 대비 ${percent(latest.operatingProfitGrowth)}</small></article><article><span>영업활동현금흐름</span><strong>${money(latest.operatingCashFlow)}</strong><small>전년 ${money(previous.operatingCashFlow)}</small></article><article><span>부채비율</span><strong>${blocked ? "검증 대기" : Number.isFinite(latest.debtRatio) ? `${latest.debtRatio.toFixed(1)}%` : "자료없음"}</strong><small>총부채 ÷ 자기자본 × 100</small></article></div>
    <div class="manual-result-columns"><section><h3>경영성과 5개 영역</h3>${blocked ? `<p>필수 계정의 누락·불일치가 있어 영역별 개선·약화 판정을 보류합니다. 자료 검증에서 수정해 주세요.</p>` : `<ul>${dimensions.map((item) => `<li><b class="${escapeHtml(item.status?.className)}">${escapeHtml(item.name)} · ${escapeHtml(item.status?.label || "자료부족")}</b><br>${escapeHtml(item.status?.explanation || "원본 확인 필요")}</li>`).join("")}</ul>`}</section><section><h3>검증·우선 확인</h3><ul>${statementValidations.map((item) => `<li>${escapeHtml(item.period)}년 재무상태표: <b>${escapeHtml(item.balanceSheet)}</b> · 현금흐름 연결: ${escapeHtml(item.cashFlow)}</li>`).join("")}${blocked ? "<li>임계치 경고 판정 보류 · 필수 오류 해결 필요</li>" : flags.slice(0, 5).map((flag) => `<li><b>${escapeHtml(flag.title)}</b> · ${escapeHtml(flag.reason)}</li>`).join("") || "<li>자동 임계치 경고 없음. 위험 부재를 뜻하지 않습니다.</li>"}</ul></section></div>
    <div class="manual-table-wrap"><table class="manual-table"><thead><tr><th>입력·계산 계정</th>${[...records].reverse().map((row) => `<th>${escapeHtml(row.period)}년</th>`).join("")}</tr></thead><tbody>${metricRows.map(([label, key]) => `<tr><td>${escapeHtml(label)}</td>${[...records].reverse().map((row) => `<td>${money(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <h3>요청 여신별 검토</h3><div class="manual-purpose-grid">${purpose("workingCapital", "운전자금")}${purpose("facility", "시설자금") || ""}</div>
    <p class="manual-result-note">PDF ${pdfEvidence.length}건은 이 브라우저 탭에서만 원본 대조용으로 선택했습니다. 파일 내용은 서버에 전송·저장하지 않았고, 숫자도 PDF에서 자동 추출하지 않았습니다. ${blocked ? "입력 불일치 또는 필수값 누락이 있어 영향을 받는 재무 판단은 보류합니다. " : ""}CSV 계정 정의·감사의견·주석상 차입만기·담보·보증은 담당자가 원본과 대조해야 합니다. 이 결과는 승인·거절이나 적정 대출금액 제안이 아닙니다.</p>`;
}

function renderReview(analysis) {
  const issues = analysis.manualReview?.issues || [];
  const changes = analysis.manualReview?.changes || [];
  const blocking = issues.filter((issue) => issue.severity === "blocking").length;
  $("#manual-review").hidden = false;
  $("#manual-review").innerHTML = `<h2>원본 대조·수정 과제</h2><p>오류를 계산에서 숨기지 않습니다. 원본 페이지를 확인한 담당자가 값을 수정한 뒤 재계산할 수 있습니다. 수정 입력은 PDF 자동 검증을 의미하지 않습니다.</p>
    <div class="manual-review-summary"><strong>필수 오류 ${blocking}건</strong><strong>추가 확인 ${issues.length - blocking}건</strong><strong>담당자 수정 ${changes.length}건</strong></div>
    <div class="manual-issue-list">${issues.length ? issues.map((issue) => `<article class="manual-issue ${issue.severity === "blocking" ? "blocking" : ""}"><h3>${escapeHtml(issue.title)}</h3><small>${escapeHtml(issue.period || "출처·범위")} · ${issue.severity === "blocking" ? "판단 보류" : "원본 확인"}</small><p>${escapeHtml(issue.detail)}</p><p><b>영향:</b> ${escapeHtml((issue.affects || []).join(" · ") || "출처 신뢰성")}</p>${issue.fields?.length ? `<div class="manual-correction-grid">${issue.fields.map((field) => `<label>${escapeHtml(field)} · ${escapeHtml(issue.period)}년<input type="text" inputmode="decimal" data-review-period="${escapeHtml(issue.period)}" data-review-field="${escapeHtml(field)}" value="${escapeHtml(issue.values?.[field] || "")}" placeholder="원문 대조 후 입력" /></label>`).join("")}<label>원문 페이지<input type="text" data-review-page="${escapeHtml(issue.id)}" placeholder="예: 감사보고서 p.12" /></label><label>수정 근거<input type="text" data-review-note="${escapeHtml(issue.id)}" placeholder="계정명·단위 차이 기록" /></label></div>` : ""}</article>`).join("") : `<div class="manual-empty">자동 검산 오류는 없습니다. 원본과 입력값의 일치·감사의견·주석은 별도로 확인해야 합니다.</div>`}</div>
    ${changes.length ? `<h3>수정 이력 · 이 화면에만 유지</h3><ul>${changes.map((item) => `<li>${escapeHtml(item.period)}년 ${escapeHtml(item.field)}: ${money(item.previous)} → ${money(item.current)} · ${escapeHtml(item.page || "원문 페이지 미기재")} · ${escapeHtml(item.note || "근거 미기재")}</li>`).join("")}</ul>` : ""}
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

function renderInspection(analysis) {
  const items = Array.isArray(analysis.inspection) ? analysis.inspection : [];
  $("#manual-inspection-content").innerHTML = `<div class="manual-result-head"><div><h2>${escapeHtml(analysis.company?.name)} 현장실사 점검표</h2><p>공통 관리 → 업종 → 재무 위험신호 → 요청자금 목적에 따라 ${items.length}개 항목을 생성했습니다.</p></div></div><div class="manual-inspection-list">${items.map((item) => {
    const answer = inspectionAnswers[item.ruleId] || {};
    const files = inspectionEvidence.get(item.ruleId) || [];
    return `<article class="manual-inspection-item" data-inspection-id="${escapeHtml(item.ruleId)}"><small>${escapeHtml(item.category)} · ${escapeHtml(item.ruleSource)}</small><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.reason)}</p><div class="manual-inspection-fields"><label>현장 판단<select data-inspection-field="status">${["미확인", "정상 확인", "우려 확인", "자료 요청"].map((status) => `<option${(answer.status || "미확인") === status ? " selected" : ""}>${status}</option>`).join("")}</select></label><label>관찰한 사실<textarea data-inspection-field="observation" placeholder="현장 수치·면담 내용·관찰 사실">${escapeHtml(answer.observation || "")}</textarea></label><label>확인 근거·증빙<textarea data-inspection-field="evidence" placeholder="문서명·페이지·사진 파일명 등">${escapeHtml(answer.evidence || "")}</textarea></label><label>사진·스캔 PDF 선택<input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple data-inspection-files /><small>최대 3개 · 파일당 10MB · 브라우저 탭 안에서만 열람</small></label><div class="manual-evidence-list">${files.map((file) => `<a href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.name)} ↗</a>`).join("") || "선택한 파일 없음"}</div><label>심사 영향·후속조치<textarea data-inspection-field="action" placeholder="당초 우려가 해소됐는지, 추가 조치가 필요한지">${escapeHtml(answer.action || "")}</textarea></label></div></article>`;
  }).join("")}</div><p class="manual-result-note">현장 기록과 선택한 사진·PDF는 현재 브라우저 탭에만 남습니다. OCR·서버 저장은 하지 않습니다. 실제 고객자료 보관에는 조직의 승인된 절차를 따르세요.</p>`;
  $("#manual-inspection-content").querySelectorAll("[data-inspection-field]").forEach((input) => input.addEventListener("input", () => {
    const id = input.closest("[data-inspection-id]").dataset.inspectionId;
    inspectionAnswers[id] ||= {};
    inspectionAnswers[id][input.dataset.inspectionField] = input.value;
    renderOpinion(currentAnalysis);
  }));
  $("#manual-inspection-content").querySelectorAll("[data-inspection-files]").forEach((input) => input.addEventListener("change", () => {
    const files = [...input.files];
    if (files.length > 3 || files.some((file) => file.size > 10_000_000 || !/\.(pdf|png|jpe?g)$/i.test(file.name))) {
      input.value = "";
      input.closest(".manual-inspection-fields").querySelector(".manual-evidence-list").textContent = "최대 3개, PDF·PNG·JPG, 파일당 10MB 이하로 선택해 주세요.";
      return;
    }
    const id = input.closest("[data-inspection-id]").dataset.inspectionId;
    (inspectionEvidence.get(id) || []).forEach((file) => URL.revokeObjectURL(file.url));
    inspectionEvidence.set(id, files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
    input.closest(".manual-inspection-fields").querySelector(".manual-evidence-list").innerHTML = inspectionEvidence.get(id).map((file) => `<a href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.name)} ↗</a>`).join("");
    renderOpinion(currentAnalysis);
  }));
}

function renderOpinion(analysis) {
  if (!analysis) return;
  const issues = analysis.manualReview?.issues || [];
  const blocking = issues.filter((item) => item.severity === "blocking");
  const latest = analysis.records?.at(-1) || {};
  const answered = Object.entries(inspectionAnswers).filter(([, value]) => value.status && value.status !== "미확인");
  const unresolved = Object.entries(inspectionAnswers).filter(([, value]) => ["우려 확인", "자료 요청"].includes(value.status));
  const working = analysis.loanRequest?.workingAmount || 0, facility = analysis.loanRequest?.facilityAmount || 0;
  $("#manual-opinion-content").innerHTML = `<h2>${escapeHtml(analysis.company?.name)} · 여신검토 초안</h2><p>고객제출 재무자료 · ${analysis.primaryFsDiv === "OFS" ? "별도(차주 법인)" : "연결(그룹)"} · 원문 자동 대조 전</p>
    <div class="manual-opinion-section"><h3>1. 접수·자료 신뢰성</h3><p>${escapeHtml(analysis.manualReview?.accountingStandard)} · ${escapeHtml(analysis.manualReview?.auditStatus)}. ${escapeHtml(analysis.manualReview?.sourceStatus)}${analysis.manualReview?.sourceReview?.confirmed ? ` · 대조근거: ${escapeHtml(analysis.manualReview.sourceReview.note)}` : ""}. 자동 검산 과제 ${issues.length}건 중 필수 오류 ${blocking.length}건입니다. ${blocking.length ? "수치 불일치가 해소되기 전에는 영향을 받는 재무판단을 보류합니다." : "자동 검산 오류가 없어도 감사의견·주석상 차입조건 대조는 남아 있습니다."}</p><ul>${issues.slice(0, 6).map((item) => `<li>${escapeHtml(item.title)}: ${escapeHtml(item.detail)}</li>`).join("") || "<li>감사의견·주석상 만기·담보·보증 추가 확인</li>"}</ul></div>
    <div class="manual-opinion-section"><h3>2. 차주 상환능력</h3><p>${escapeHtml(latest.period)}년 매출 ${money(latest.revenue)}, 영업이익 ${money(latest.operatingProfit)}, 영업활동현금흐름 ${money(latest.operatingCashFlow)}입니다. 연간 수치만으로 만기별 원리금 상환 가능성을 확정할 수 없습니다.</p></div>
    <div class="manual-opinion-section"><h3>3. 자금용도별 검토</h3><p>${working ? `운전자금 ${working.toLocaleString("ko-KR")}억원 · ${escapeHtml(analysis.decisionSupport?.workingCapital?.stance)}. 실제 매입→판매→회수 일정과 12개월 내 기존 만기를 확인합니다. ` : "운전자금 신청 없음. "}${facility ? `시설자금 ${facility.toLocaleString("ko-KR")}억원 · ${escapeHtml(analysis.decisionSupport?.facility?.stance)}. 투자 집행→가동→추가 현금창출과 원리금 일정을 검증합니다.` : "시설자금 신청 없음."}</p></div>
    <div class="manual-opinion-section"><h3>4. 사업·현장 확인</h3><p>${answered.length}/${analysis.inspection?.length || 0}개 항목에 현장 판단을 입력했습니다. 우려·자료 요청 ${unresolved.length}건입니다.</p><ul>${answered.map(([id, answer]) => {
      const item = analysis.inspection?.find((entry) => entry.ruleId === id);
      return `<li>${escapeHtml(item?.category || id)} · ${escapeHtml(answer.status)} — 관찰: ${escapeHtml(answer.observation || "미기재")} / 근거: ${escapeHtml(answer.evidence || "미기재")}${inspectionEvidence.get(id)?.length ? ` · 선택 파일: ${escapeHtml(inspectionEvidence.get(id).map((file) => file.name).join(", "))}` : ""} / 후속: ${escapeHtml(answer.action || "미기재")}</li>`;
    }).join("") || "<li>현장실사 전 · 정성적 판단과 증빙 미입력</li>"}</ul></div>
    <div class="manual-opinion-section"><h3>5. 심사·조건·사후관리</h3><p>담당자는 누락 계정·원본 페이지·감사의견·주석을 대조하고, 우려별 증빙과 현장 조치 결과를 심사역에 전달해야 합니다. 금액·금리·만기·상환방식은 고객의 실제 현금수지와 기존 원리금표, 내부 기준을 반영해 심사역이 검토합니다. 실행 후 자금용도와 상환 징후를 추적해야 합니다.</p></div>
    <p class="manual-result-note">이 초안은 승인·거절 의견이 아니며, 입력·현장 메모는 서버에 저장되지 않습니다. 인쇄 전 고객자료 취급기준을 확인하세요.</p>`;
}

async function performAnalysis() {
  const file = $("#manual-csv").files?.[0];
  if (!file || file.size > 150_000) { $("#manual-status").textContent = "150KB 이하의 CSV를 선택해 주세요."; return; }
  const csvText = await file.text();
  if (sourceCsvText && sourceCsvText !== csvText) {
    reviewCorrections = []; inspectionAnswers = {};
    for (const files of inspectionEvidence.values()) files.forEach((file) => URL.revokeObjectURL(file.url));
    inspectionEvidence.clear();
  }
  sourceCsvText = csvText;
  const submit = $("#manual-form button[type='submit']");
  submit.disabled = true;
  $("#manual-status").textContent = "연도·계정·재무상태표를 검사하고 검증 과제를 만드는 중입니다.";
  try {
    const response = await fetch("/api/manual-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName: $("#manual-name").value, industry: $("#manual-industry").value, unit: $("#manual-unit").value, csvText, statementBasis: $("#manual-basis").value, accountingStandard: $("#manual-standard").value, auditStatus: $("#manual-audit").value, sourceReview: { confirmed: $("#manual-source-confirmed").checked, note: $("#manual-source-note").value }, overrides: reviewCorrections, loanRequest: { workingAmount: Number($("#manual-working").value), workingTermMonths: Number($("#manual-working-term").value), facilityAmount: Number($("#manual-facility").value), facilityTermMonths: Number($("#manual-facility-term").value) } }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `분석 실패 (${response.status})`);
    currentAnalysis = result;
    renderReview(result);
    renderResult(result);
    renderInspection(result);
    renderOpinion(result);
    const issues = result.manualReview?.issues || [];
    $("#manual-status").textContent = `입력값을 계산하고 검증 과제 ${issues.length}건을 표시했습니다. 원본과 대조 전이므로 모든 해석은 잠정입니다.`;
    showManualPage("source");
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
  showManualPage("opinion");
  window.print();
});

fetch("/api/health").then((response) => response.json()).then((health) => {
  $("#manual-transfer-note").textContent = health.publicDemo
    ? "공개 체험판: 기업명·CSV 수치·신청액은 분석 요청 시 Vercel 서버로 전송되지만 CreditLens 사건·파일 저장소에는 보관되지 않습니다. PDF는 브라우저 탭에만 남습니다. 포트폴리오 체험에는 가상기업 예시를 권장합니다."
    : "로컬판: 기업명·CSV 수치·신청액은 이 PC의 분석 서버에서 처리하며 사건·파일 저장소에는 보관되지 않습니다. PDF는 브라우저 탭에만 남습니다.";
}).catch(() => { $("#manual-status").textContent = "서버 상태를 확인하지 못했습니다. 분석 버튼을 누르기 전에 연결을 확인해 주세요."; });
