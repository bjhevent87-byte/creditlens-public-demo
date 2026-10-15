export const DEMO_COMPANY = {
  corpCode: "00999999",
  stockCode: "999999",
  name: "케이비배터리솔루션",
  industry: "2차전지 소재 제조업",
  companyInfo: { ceo_nm: "홍길동", adres: "충남 천안시", hm_url: "https://example.com", induty_code: "28202" },
};

export const DEMO_RECORDS = [
  { period: "2023", reportType: "사업보고서", fsDiv: "CFS", revenue: 165_000_000_000, operatingProfit: 12_000_000_000, netIncome: 8_100_000_000, costOfSales: 126_000_000_000, interestExpense: 2_100_000_000, totalAssets: 198_000_000_000, totalLiabilities: 91_000_000_000, equity: 107_000_000_000, currentAssets: 82_000_000_000, currentLiabilities: 61_000_000_000, cash: 18_000_000_000, accountsReceivable: 32_000_000_000, inventory: 29_000_000_000, accountsPayable: 22_000_000_000, operatingCashFlow: 17_000_000_000, investingCashFlow: -13_000_000_000, financingCashFlow: -1_000_000_000, capex: 11_000_000_000, intangibleCapex: 0, shortTermDebt: 24_000_000_000, longTermDebt: 31_000_000_000, source: "교육용 예시 데이터" },
  { period: "2024", reportType: "사업보고서", fsDiv: "CFS", revenue: 191_000_000_000, operatingProfit: 15_000_000_000, netIncome: 10_200_000_000, costOfSales: 145_000_000_000, interestExpense: 2_700_000_000, totalAssets: 235_000_000_000, totalLiabilities: 116_000_000_000, equity: 119_000_000_000, currentAssets: 96_000_000_000, currentLiabilities: 77_000_000_000, cash: 16_000_000_000, accountsReceivable: 41_000_000_000, inventory: 38_000_000_000, accountsPayable: 27_000_000_000, operatingCashFlow: 14_000_000_000, investingCashFlow: -21_000_000_000, financingCashFlow: 9_000_000_000, capex: 19_000_000_000, intangibleCapex: 0, shortTermDebt: 29_000_000_000, longTermDebt: 43_000_000_000, source: "교육용 예시 데이터" },
  { period: "2025", reportType: "사업보고서", fsDiv: "CFS", revenue: 224_000_000_000, operatingProfit: 18_000_000_000, netIncome: 11_000_000_000, costOfSales: 172_000_000_000, interestExpense: 4_200_000_000, totalAssets: 286_000_000_000, totalLiabilities: 154_000_000_000, equity: 132_000_000_000, currentAssets: 112_000_000_000, currentLiabilities: 103_000_000_000, cash: 13_000_000_000, accountsReceivable: 61_000_000_000, inventory: 59_000_000_000, accountsPayable: 33_000_000_000, operatingCashFlow: 11_500_000_000, investingCashFlow: -32_000_000_000, financingCashFlow: 18_000_000_000, capex: 29_000_000_000, intangibleCapex: 0, shortTermDebt: 42_000_000_000, longTermDebt: 57_000_000_000, source: "교육용 예시 데이터" },
];

export const DEMO_MACRO = [
  { id: "kr-base-rate", name: "한국 기준금리", unit: "%", status: "교육용", latest: { date: "202609", value: 3.0 }, previous: { date: "202608", value: 2.75 }, source: "교육용 예시 데이터" },
  { id: "usd-krw", name: "원/달러 환율", unit: "원", status: "교육용", latest: { date: "202609", value: 1260 }, previous: { date: "202608", value: 1315 }, source: "교육용 예시 데이터" },
  { id: "export-volume", name: "관련 산업 수출", unit: "% YoY", status: "교육용", latest: { date: "202609", value: -12.4 }, previous: { date: "202608", value: -8.1 }, source: "교육용 예시 데이터" },
  { id: "manufacturing-bsi", name: "제조업 업황 BSI", unit: "지수", status: "교육용", latest: { date: "202609", value: 87 }, previous: { date: "202608", value: 91 }, source: "교육용 예시 데이터" },
];
