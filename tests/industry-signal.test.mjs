import test from "node:test";
import assert from "node:assert/strict";
import { externalInterpretations, summarizeIndustryEvidence } from "../public/industry-signal.js";

test("대형마트 경상 판매액지수 하락과 회사 매출노출을 불리한 보조 신호로 연결한다", () => {
  const result = summarizeIndustryEvidence({
    name: "소매업태별 판매액지수(2020=100.0) · 경상지수 · 대형마트",
    previous: 109.8,
    latest: 107.8,
    unit: "2020＝100",
    exposure: 15,
    exposureBasis: "사업부 매출구성표",
    direction: "up",
  });
  assert.equal(result.tone, "adverse");
  assert.equal(result.label, "업종 보조 신호 · 불리");
  assert.equal(result.movement, "2.0포인트 하락");
  assert.equal(result.percentage, "-1.8%");
  assert.match(result.headline, /회사 매출 15\.0% 관련 사업 노출/);
  assert.match(result.headline, /해당 사업부 매출·객수 감소 여부 확인/);
  assert.match(result.detail, /가격변동을 포함/);
  assert.doesNotMatch(result.headline, /회사 매출 감소 확정|회사 손실액/);
});

test("같은 지표라도 방향·노출 정도에 따라 결론을 바꾼다", () => {
  const base = { name: "재고지수", previous: 109.8, latest: 107.8, unit: "2020=100", exposure: 15 };
  assert.equal(summarizeIndustryEvidence({ ...base, direction: "down" }).tone, "favorable");
  assert.equal(summarizeIndustryEvidence({ ...base, direction: "up", exposure: 0 }).tone, "unexposed");
  assert.equal(summarizeIndustryEvidence({ ...base, latest: 109.8, direction: "up" }).tone, "neutral");
  assert.equal(summarizeIndustryEvidence({ ...base, exposure: null }).tone, "unknown");
});

test("노출 근거가 없으면 담당자 입력과 근거 미기재를 분명히 남긴다", () => {
  const result = summarizeIndustryEvidence({ name: "대형마트 판매액지수", previous: 109.8, latest: 107.8, exposure: 15, direction: "up" });
  assert.match(result.headline, /담당자 입력·근거 미기재/);
});

test("계절성이 있는 원계열의 직전 월 비교는 불리로 단정하지 않는다", () => {
  const result = summarizeIndustryEvidence({ name: "대형마트 판매액지수", previous: 109.8, latest: 107.8, exposure: 15, direction: "up", comparisonWarning: "전년 동기 또는 계절조정 계열로 재확인" });
  assert.equal(result.tone, "caution");
  assert.match(result.headline, /비교기간을 맞춘 뒤/);
});

test("해석 항목이 없거나 재무 해석뿐이면 빈 외부환경 접기를 표시하지 않는다", () => {
  assert.deepEqual(externalInterpretations(undefined, "retail"), []);
  assert.deepEqual(externalInterpretations([{ text: "유동비율 하락" }], "retail"), []);
  assert.deepEqual(externalInterpretations([{ type: "외부환경", text: "환율 변화" }], "retail"), []);
  assert.equal(externalInterpretations([{ type: "외부환경", text: "기준금리 변화" }], "retail").length, 1);
});
