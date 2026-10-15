function rounded(value, digits = 1) {
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function confirmationTarget(item) {
  const name = String(item.name || "");
  if (/판매액|소매|대형마트|온라인쇼핑/.test(name)) return "해당 사업부 매출·객수";
  if (/재고/.test(name)) return "해당 사업부 재고·판매속도";
  if (/수출/.test(name)) return "해외 매출·수주";
  if (/생산|출하|가동/.test(name)) return "해당 사업부 수주·가동률";
  return "해당 사업부 매출·원가";
}

export function externalInterpretations(interpretations, profileId) {
  return (Array.isArray(interpretations) ? interpretations : []).filter((item) => {
    if (item?.type !== "외부환경") return false;
    if (profileId === "manufacturing" || profileId === "general") return true;
    return !/수출|제조업|환율/.test(item.text || "");
  });
}

// An industry series is context, not a formula for the borrower's actual revenue change.
export function summarizeIndustryEvidence(item = {}) {
  const hasValue = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  if (![item.previous, item.latest, item.exposure].every(hasValue)) {
    return { tone: "unknown", label: "수치 확인 필요", movement: "비교값 없음", headline: "지표와 회사 노출을 확인해 주세요.", detail: "" };
  }
  const previous = Number(item.previous);
  const latest = Number(item.latest);
  const exposure = Number(item.exposure);
  if (![previous, latest, exposure].every(Number.isFinite) || exposure < 0 || exposure > 100) {
    return { tone: "unknown", label: "수치 확인 필요", movement: "비교값 없음", headline: "지표와 회사 노출을 확인해 주세요.", detail: "" };
  }

  const change = latest - previous;
  const trend = change > 0 ? "상승" : change < 0 ? "하락" : "변화 없음";
  const indexSeries = /지수/.test(String(item.name || "")) || /100/.test(String(item.unit || ""));
  const differenceUnit = indexSeries ? "포인트" : String(item.unit || "");
  const movement = change === 0 ? "변화 없음" : `${rounded(Math.abs(change))}${differenceUnit} ${trend}`;
  const percentage = previous > 0 ? `${change > 0 ? "+" : ""}${rounded(change / previous * 100)}%` : null;
  const favorableDirection = item.direction === "down" ? -1 : 1;
  const tone = exposure === 0 ? "unexposed" : item.comparisonWarning ? "caution" : change === 0 ? "neutral" : change * favorableDirection > 0 ? "favorable" : "adverse";
  const label = {
    adverse: "업종 보조 신호 · 불리",
    favorable: "업종 보조 신호 · 유리",
    caution: "비교조건 확인",
    neutral: "업종 보조 신호 · 변화 없음",
    unexposed: "회사 매출노출 없음",
  }[tone];
  const target = confirmationTarget(item);
  const exposureText = `회사 매출 ${rounded(exposure)}% 관련 사업 노출(담당자 입력${item.exposureBasis ? "" : "·근거 미기재"})`;
  const headline = tone === "unexposed"
    ? `지표 ${movement} · 입력된 회사 매출노출 0%. 기업 위험 신호로 연결하지 않습니다.`
    : tone === "caution"
      ? `지표 ${movement} + ${exposureText} → 비교기간을 맞춘 뒤 ${target} 대조`
    : tone === "adverse"
      ? `지표 ${movement} + ${exposureText} → ${target} 감소 여부 확인`
      : tone === "favorable"
        ? `지표 ${movement} + ${exposureText} → ${target} 개선 여부 확인`
        : `지표 변화 없음 · ${exposureText} → ${target} 추이 확인`;
  const detail = /경상지수/.test(String(item.name || ""))
    ? "경상지수는 가격변동을 포함합니다. 판매량 변화와 회사 실적은 별도 대조하세요."
    : "회사 실적·손실액은 이 지표와 노출비중만으로 계산하지 않습니다.";
  return { tone, label, movement, percentage, headline, detail };
}
