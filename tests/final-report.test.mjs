import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { renderFullReport, renderFullReportDocument } from "../public/final-report.js";
import { buildListedReportModel } from "../public/listed-report-model.js";
import { buildPrivateReportModel } from "../public/private-report-model.js";
import { parseManualStatementsCsv } from "../src/services/manual-statement-service.mjs";

const sample = {
  company: { name: "가상기업 에이비정밀", industry: "자동차 부품 제조업", ceo: "홍길동" },
  basisDate: "2026-10-15",
  basisLabel: "별도 · 차주 법인",
  sourceLabel: "고객 제출 CSV · 원본 대조 전",
  verificationStatus: "필수 오류 수정 후 원본 확인 진행 중",
  loanRequest: { workingAmount: 10, workingTermMonths: 12, facilityAmount: 30, facilityTermMonths: 60 },
  records: [
    { period: "2023", revenue: 8_000_000_000, operatingProfit: 500_000_000, operatingCashFlow: 100_000_000, investingCashFlow: -300_000_000, financingCashFlow: 250_000_000 },
    { period: "2024", revenue: 9_000_000_000, operatingProfit: 600_000_000, operatingCashFlow: 200_000_000, investingCashFlow: -500_000_000, financingCashFlow: 350_000_000 },
    { period: "2025", revenue: 10_000_000_000, operatingProfit: 800_000_000, operatingCashFlow: 300_000_000, investingCashFlow: -600_000_000, financingCashFlow: 400_000_000, totalAssets: 8_000_000_000, totalLiabilities: 4_000_000_000, equity: 4_000_000_000, currentAssets: 3_000_000_000, currentLiabilities: 2_000_000_000, financeCosts: 100_000_000, totalDebt: 2_000_000_000 },
  ],
  interim: { period: "2026 반기", comparisonPeriod: "2025 반기", revenue: 5_500_000_000, previousRevenue: 5_000_000_000, operatingProfit: 400_000_000, previousOperatingProfit: 300_000_000, operatingCashFlow: 150_000_000, previousOperatingCashFlow: 120_000_000 },
  sections: {
    summary: { facts: ["매출 증가"], concerns: ["운전자금 회수 자료 확인 필요"] },
    business: "정밀부품 가공",
    industry: "완성차 생산과 고객 수주를 대조해야 합니다.",
    management: "대표자 면담 필요",
    operations: "가동률 현장 확인 예정",
    debt: "차입 만기표 확인 전",
    scenario: "신규여신 원리금 일정 미입력",
    opinion: "현장 우려 해소 여부 확인 후 심사역 재판단",
  },
  inspections: [
    { category: "경영진", question: "실적 변화의 원인을 설명하는가?", status: "우려 확인", observation: "최근 수주 취소 1건", evidence: "면담록 2쪽", action: "월별 수주잔고 확인", files: [{ name: "현장사진.jpg", sha256: "abcdef0123456789abcdef0123456789" }] },
    { category: "설비", question: "핵심설비가 실제 가동되는가?", status: "정상 확인" },
  ],
  sources: [
    { name: "고객 제출 재무제표", period: "2024", scope: "별도", status: "원본 대조 전" },
    { name: "고객 제출 재무제표", period: "2025", scope: "별도", status: "원본 대조 전" },
    { name: "고객 제출 현장사진", period: "2026-10", scope: "현장", status: "내용 검증 전", url: "https://example.com/evidence" },
  ],
  openItems: [{ title: "수주 취소의 현금흐름 영향", reason: "월별 수주잔고·입금 계획 대조", owner: "기업금융 담당자" }],
};

test("공통 전체 보고서는 12개 장과 현장실사 항목별 기록을 포함한다", () => {
  const html = renderFullReport(sample);
  assert.equal((html.match(/class="cr-section"/g) || []).length, 12);
  for (const title of ["차주와 사업 구조", "산업·시장 환경", "영업활동과 운전자본", "현장실사 기록", "미해결 쟁점과 다음 확인", "출처·산식·분석 한계"]) assert.ok(html.includes(title), title);
  assert.match(html, /수주 취소 1건/);
  assert.match(html, /면담록 2쪽/);
  assert.match(html, /현장사진\.jpg/);
  assert.match(html, /월별 수주잔고 확인/);
  assert.match(html, /정상 확인 · 기록 미완료/);
  assert.match(html, /승인·거절/);
});

test("반기 누적은 전년 동기와 비교하고 연간 보고서와 섞지 않는다", () => {
  const html = renderFullReport(sample);
  assert.match(html, /2025 반기 → 2026 반기/);
  assert.match(html, /동일 기간 누적액끼리 비교/);
  assert.match(html, /전년 동기 대비/);
  assert.match(html, /\+10%/);
  assert.match(html, /고객 제출 연간 재무자료를 왼쪽에 표시/);
  assert.ok(html.indexOf("2025</th>") < html.indexOf("2024</th>"), "annual latest must be first");
});

test("중간재무에 있는 투자·재무현금과 기말 재무상태도 같은 기간끼리 표시한다", () => {
  const html = renderFullReport({
    ...sample,
    interim: {
      ...sample.interim,
      investingCashFlow: -3e8, previousInvestingCashFlow: -2e8,
      financingCashFlow: 2e8, previousFinancingCashFlow: 1e8,
      totalAssets: 80e8, previousTotalAssets: 75e8,
      totalLiabilities: 40e8, previousTotalLiabilities: 38e8,
      equity: 40e8, previousEquity: 37e8,
    },
  });
  assert.match(html, /누적 투자활동현금흐름/);
  assert.match(html, /누적 재무활동현금흐름/);
  assert.match(html, /보고기간 말 재무상태·차입 잔액/);
  assert.match(html, /2026 반기 말/);
  assert.match(html, /재무상태표는 각 보고기간 말 잔액/);
});

test("동일 원자료는 출처 표에서 통합되고 누락값을 0으로 바꾸지 않는다", () => {
  const html = renderFullReport(sample);
  const sourceStart = html.indexOf("<h3>자료 출처와 대조 상태</h3>");
  const sourceEnd = html.indexOf("<h3>주요 지표 정의");
  const sourceHtml = html.slice(sourceStart, sourceEnd);
  assert.equal((sourceHtml.match(/<th scope="row">고객 제출 재무제표<\/th>/g) || []).length, 1);
  assert.match(sourceHtml, /2024 · 2025/);
  assert.match(renderFullReport({ company: { name: "가상기업" } }), /자료 확인 필요/);
  assert.doesNotMatch(renderFullReport({ company: { name: "가상기업" } }), /NaN|Infinity/);
});

test("현장 완료에는 판단·관찰·근거·후속조치가 모두 있어야 한다", () => {
  const html = renderFullReport({
    company: { name: "가상 차주" },
    inspections: [
      { category: "수주", question: "수주 공백은?", selectedStatus: "이상징후", status: "근거 미기록", observation: "취소 1건", evidence: "", action: "추가 수주자료 요청" },
      { category: "설비", question: "설비는 가동 중인가?", status: "정상 확인", observation: "가동 중", evidence: "현장사진 1쪽", action: "" },
      { category: "경영진", question: "개선계획은?", status: "자료 요청", observation: "계획 미제출", evidence: "면담록 2쪽", action: "계획서 요구" },
    ],
  });
  assert.match(html, /<strong>1\/3건<\/strong>/);
  assert.match(html, /이상징후 \(근거 미기록\) · 기록 미완료/);
  assert.match(html, /정상 확인 · 기록 미완료/);
  assert.match(html, /우려·자료 요청<\/span><strong>2건/);
});

test("방문 전 빈 점검지는 최종 보고서에서 요약하고 기록된 항목만 상세 표시한다", () => {
  const inspections = Array.from({ length: 14 }, (_, index) => ({ category: `항목 ${index + 1}`, question: `확인 질문 ${index + 1}`, status: "미확인" }));
  const html = renderFullReport({
    company: { name: "가상 차주" },
    inspections,
    openItems: inspections.map((item) => ({ title: `${item.category} 현장 재확인`, reason: `${item.question} · 미확인; 관찰·증빙·후속조치 대조` })),
  });
  assert.match(html, /방문 전 점검 대상 · 14건/);
  assert.match(html, /현장 미확인 14건/);
  assert.equal((html.match(/class="cr-inspection-item"/g) || []).length, 0);
  assert.equal((html.match(/<li><b>항목 \d+ 현장 재확인/g) || []).length, 0);
  assert.match(html, /확인 질문 14/);
});

test("사용자 정의 지표의 원계정·기간·범위·출처를 기본 대입값과 병합한다", () => {
  const html = renderFullReport({
    company: { name: "가상 차주" },
    records: [{ period: "2025", operatingProfit: 8e8, financeCosts: 1e8, totalLiabilities: 4e9, equity: 4e9, currentAssets: 3e9, currentLiabilities: 2e9 }],
    definitions: [
      { name: "부채비율", accounts: "제출 재무상태표 부채총계·자본총계", period: "2025년 말", scope: "별도 · 차주", source: "감사보고서 p.8" },
      { name: "영업이익/금융비용", accounts: "이자 외 비용 포함", period: "2025년", scope: "별도 · 차주", source: "감사보고서 p.12" },
    ],
  });
  const definitions = html.split("<h3>주요 지표 정의·계산 근거</h3>")[1];
  assert.match(definitions, /감사보고서 p\.8/);
  assert.match(definitions, /감사보고서 p\.12/);
  assert.match(definitions, /제출 재무상태표 부채총계·자본총계/);
  assert.match(definitions, /2025년 말 · 별도 · 차주/);
  assert.match(definitions, /40억원 ÷ 40억원 × 100/);
});

test("이자비용 대체값은 금융비용 배율이라고 표기하지 않는다", () => {
  const html = renderFullReport({
    company: { name: "가상 차주" },
    records: [{ period: "2025", operatingProfit: 8e8, financeCosts: 1e8, financeCostsSource: "이자비용 대체값" }],
    definitions: [{ name: "영업이익/이자비용(대체)", source: "감사보고서 p.12", scope: "별도" }],
  });
  assert.match(html, /영업이익\/이자비용\(대체\)/);
  assert.match(html, /금융비용 원계정 없음 · 대체 사용/);
  assert.match(html, /감사보고서 p\.12/);
  assert.doesNotMatch(html, /영업이익\/금융비용은 주석상 이자비용만/);
});

test("금융비용 배율 옆에는 미산정 상환위험을 명시한다", () => {
  const html = renderFullReport(sample);
  assert.match(html, /이 배율만으로 상환능력을 판단할 수 없습니다/);
  assert.match(html, /순수 이자비용 기준 이자보상배율은 별도로 산정하지 않았습니다/);
  assert.match(html, /1년 내 원리금 만기액, 담보·보증, 관계회사 지원·우발채무도 아직 확정되지 않았습니다/);
});

test("실제 가상 CSV 기반 비상장 모델도 상장 모델과 같은 12개 장을 쓴다", async () => {
  const csv = await readFile(new URL("../public/가상_에이비정밀_별도재무_2023-2025_억원.csv", import.meta.url), "utf8");
  const records = parseManualStatementsCsv(csv, { unit: "억원", sourceName: "가상 제출 CSV" });
  const privateModel = buildPrivateReportModel({
    company: { name: "가상기업 에이비정밀", industry: "자동차 부품 제조업" },
    records, basisDate: "2026-10-15", primaryFsDiv: "OFS",
    loanRequest: { workingAmount: 10, workingTermMonths: 12, facilityAmount: 30, facilityTermMonths: 60 },
    manualReview: { issues: [], sourceReview: { confirmed: false }, businessEvidence: [] },
    inspection: [{ category: "경영진", question: "수주 변화의 원인은?", ruleId: "FI-C01" }],
  }, { csvName: "가상 제출 CSV", inspections: [{ category: "경영진", question: "수주 변화의 원인은?", status: "미확인" }] });
  const listedRecord = { period: "2025", revenue: 10e9, operatingProfit: 8e8, operatingCashFlow: 3e8, investingCashFlow: -6e8, financingCashFlow: 4e8, totalAssets: 8e9, totalLiabilities: 4e9, equity: 4e9, currentAssets: 3e9, currentLiabilities: 2e9, totalDebt: 2e9, financeCosts: 1e8, source: "OpenDART 2025 사업보고서 별도" };
  const listedModel = buildListedReportModel({
    mode: "공식 API", basisDate: "2026-10-15", company: { name: "가상 공시기업", industry: "제조업", companyInfo: {} },
    loanRequest: { workingAmount: 10, workingTermMonths: 12, facilityAmount: 30, facilityTermMonths: 60 },
    primaryFsDiv: "OFS", statementViews: { OFS: { records: [listedRecord], assessment: { redFlags: [] }, decisionSupport: {} } },
    dataQuality: { validations: [] },
  });
  const privateHtml = renderFullReport(privateModel);
  const listedHtml = renderFullReport(listedModel);
  const headingSequence = (html) => [...html.matchAll(/<h2 id="cr-heading-\d+">([^<]+)<\/h2>/g)].map((match) => match[1]);
  assert.deepEqual(headingSequence(privateHtml), headingSequence(listedHtml));
  assert.equal(headingSequence(privateHtml).length, 12);
  assert.match(privateHtml, /고객 제출 연간 재무자료/);
  assert.doesNotMatch(privateHtml, /최근 연간 공시/);
  assert.match(privateHtml, /원본 대조 전/);
  assert.match(listedHtml, /최근 연간 공시자료/);
  assert.match(privateHtml, /단순 FCF/);
  assert.match(privateHtml, /현장실사 기록과 우려 재판단/);
  assert.match(privateHtml, /방문 전 점검 대상 · 1건/);
});

test("비상장 수정값은 원본 CSV와 구분해 보고서 출처에 남긴다", () => {
  const model = buildPrivateReportModel({
    company: { name: "가상기업" }, records: [{ period: "2025", currentAssets: 22_000_000_000 }],
    manualReview: { issues: [], sourceReview: { confirmed: false }, changes: [{ period: "2025", field: "currentAssets", label: "유동자산", previous: 20_500_000_000, current: 22_000_000_000, page: "", note: "" }] },
  }, { csvName: "고객 제출.csv" });
  assert.match(model.sourceLabel, /담당자 수정 1건/);
  assert.ok(model.sources.some((source) => source.name === "2025년 유동자산 담당자 수정" && /원문 근거 미기록/.test(source.status) && /205억원 → 220억원/.test(source.locator)));
  assert.ok(model.definitions.every((definition) => /담당자 수정 1건/.test(definition.source)));
});

test("사용자 입력과 원자료 URL은 HTML 또는 스크립트로 실행되지 않는다", () => {
  const html = renderFullReport({
    company: { name: "<script>alert(1)</script>" },
    sections: { business: "<img src=x onerror=alert(1)>" },
    inspections: [{ question: "<svg onload=alert(1)>", files: [{ name: '"><script>x</script>' }] }],
    sources: [{ name: "위험 링크", url: "javascript:alert(1)" }],
  });
  assert.doesNotMatch(html, /<script>|<svg onload|<img src=x|href="javascript:/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
});

test("저장용 HTML은 CSS를 내장하며 원본 보고서를 재사용한다", async () => {
  const html = await renderFullReportDocument(sample, ".credit-full-report{color:#123f36}");
  assert.match(html, /<!doctype html>/);
  assert.match(html, /<style>\.credit-full-report\{color:#123f36\}<\/style>/);
  assert.match(html, /가상기업 에이비정밀/);
  assert.doesNotMatch(html, /href="\/final-report\.css"/);
});

test("스타일시트 수신 실패 시에도 오프라인 인쇄용 기본 CSS를 포함한다", async () => {
  const html = await renderFullReportDocument({ company: { name: "가상기업" } });
  assert.match(html, /<style>\*\{box-sizing:border-box\}/);
  assert.match(html, /@page\{size:A4;margin:15mm\}/);
  assert.match(html, /<article class="credit-full-report"/);
});

test("인쇄 배경색이 꺼져도 표지·표 머리글·의견 상태가 읽힌다", async () => {
  const css = await readFile(new URL("../public/final-report.css", import.meta.url), "utf8");
  assert.match(css, /@page\s*\{\s*size:\s*A4 portrait/);
  assert.match(css, /\.credit-full-report \.cr-cover \{[^}]*color: #172b27; background: #fff;/);
  assert.match(css, /\.credit-full-report \.cr-table thead th \{[^}]*color: #172b27;[^}]*background: #fff;/);
  assert.match(css, /\.credit-full-report \.cr-opinion-status \{[^}]*color: #172b27;[^}]*background: #fff;/);
  assert.match(css, /\.credit-full-report \.cr-table thead \{ display: table-header-group; \}/);
});
