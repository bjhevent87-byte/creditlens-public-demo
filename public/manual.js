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
  $("#manual-transfer-note").textContent = health.publicDemo
    ? "공개 체험판: 기업명·CSV 수치·신청액은 분석 요청 시 Vercel 서버로 전송되지만 CreditLens 사건·파일 저장소에는 보관되지 않습니다. PDF는 브라우저 탭에만 남습니다. 포트폴리오 체험에는 가상기업 예시를 권장합니다."
    : "로컬판: 기업명·CSV 수치·신청액은 이 PC의 분석 서버에서 처리하며 사건·파일 저장소에는 보관되지 않습니다. PDF는 브라우저 탭에만 남습니다.";
}).catch(() => { $("#manual-status").textContent = "서버 상태를 확인하지 못했습니다. 분석 버튼을 누르기 전에 연결을 확인해 주세요."; });
