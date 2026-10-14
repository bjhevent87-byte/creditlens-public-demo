const $ = (selector) => document.querySelector(selector);
const pdfEvidence = [];

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
  $("#manual-results").hidden = false;
  $("#manual-results").innerHTML = `<div class="manual-result-head"><div><span class="manual-badge">고객제출 CSV · 원본 미검증</span><h2>${escapeHtml(analysis.company?.name)} · 재무 변화 요약</h2><p>${escapeHtml(records[0]?.period)}~${escapeHtml(latest.period)}년 별도재무제표 입력값 · 최근 비교 ${escapeHtml(previous.period)} → ${escapeHtml(latest.period)} · 금액 단위 억원</p></div></div>
    <div class="manual-kpis"><article><span>매출액</span><strong>${money(latest.revenue)}</strong><small>전년 대비 ${percent(latest.revenueGrowth)}</small></article><article><span>영업이익</span><strong>${money(latest.operatingProfit)}</strong><small>전년 대비 ${percent(latest.operatingProfitGrowth)}</small></article><article><span>영업활동현금흐름</span><strong>${money(latest.operatingCashFlow)}</strong><small>전년 ${money(previous.operatingCashFlow)}</small></article><article><span>부채비율</span><strong>${Number.isFinite(latest.debtRatio) ? `${latest.debtRatio.toFixed(1)}%` : "자료없음"}</strong><small>총부채 ÷ 자기자본 × 100</small></article></div>
    <div class="manual-result-columns"><section><h3>경영성과 5개 영역</h3><ul>${dimensions.map((item) => `<li><b class="${escapeHtml(item.status?.className)}">${escapeHtml(item.name)} · ${escapeHtml(item.status?.label || "자료부족")}</b><br>${escapeHtml(item.status?.explanation || "원본 확인 필요")}</li>`).join("")}</ul></section><section><h3>검증·우선 확인</h3><ul>${statementValidations.map((item) => `<li>${escapeHtml(item.period)}년 재무상태표: <b>${escapeHtml(item.balanceSheet)}</b> · 현금흐름 연결: ${escapeHtml(item.cashFlow)}</li>`).join("")}${flags.slice(0, 5).map((flag) => `<li><b>${escapeHtml(flag.title)}</b> · ${escapeHtml(flag.reason)}</li>`).join("") || "<li>자동 임계치 경고 없음. 위험 부재를 뜻하지 않습니다.</li>"}</ul></section></div>
    <div class="manual-table-wrap"><table class="manual-table"><thead><tr><th>입력·계산 계정</th>${[...records].reverse().map((row) => `<th>${escapeHtml(row.period)}년</th>`).join("")}</tr></thead><tbody>${metricRows.map(([label, key]) => `<tr><td>${escapeHtml(label)}</td>${[...records].reverse().map((row) => `<td>${money(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="manual-result-note">PDF ${pdfEvidence.length}건은 이 브라우저 탭에서만 원본 대조용으로 선택했습니다. 파일 내용은 서버에 전송·저장하지 않았고, 숫자도 PDF에서 자동 추출하지 않았습니다. CSV 계정 정의·감사의견·주석상 차입만기·담보·보증은 담당자가 원본과 대조한 뒤 심사의견에 반영해야 합니다. 이 요약은 승인·거절이나 적정 대출금액 제안이 아닙니다.</p>`;
  $("#manual-results").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#manual-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("#manual-csv").files?.[0];
  if (!file || file.size > 150_000) { $("#manual-status").textContent = "150KB 이하의 CSV를 선택해 주세요."; return; }
  const submit = $("#manual-form button[type='submit']");
  submit.disabled = true;
  $("#manual-status").textContent = "연도·금액·재무상태표를 검증하고 분석하는 중입니다.";
  try {
    const response = await fetch("/api/manual-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName: $("#manual-name").value, industry: $("#manual-industry").value, unit: $("#manual-unit").value, csvText: await file.text(), loanRequest: { workingAmount: Number($("#manual-working").value), facilityAmount: Number($("#manual-facility").value) } }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `분석 실패 (${response.status})`);
    renderResult(result);
    $("#manual-status").textContent = "입력값을 계산했습니다. PDF 원본과 대조 전이므로 모든 해석은 검증 전입니다.";
  } catch (error) {
    $("#manual-results").hidden = true;
    $("#manual-status").textContent = error.message;
  } finally { submit.disabled = false; }
});

fetch("/api/health").then((response) => response.json()).then((health) => {
  if (health.publicDemo) $("#manual-public-lock").hidden = false;
  else $("#manual-workspace").hidden = false;
}).catch(() => { $("#manual-status").textContent = "서버 상태를 확인하지 못했습니다. 로컬판 연결을 확인해 주세요."; });
