import test from "node:test";
import assert from "node:assert/strict";
import { KosisService, extractKosisSeries } from "../src/services/kosis-service.mjs";

test("KOSIS 검색은 통계표 ID와 기관명을 반환하고 인증키는 결과에 포함하지 않는다", async () => {
  const calls = [];
  const service = new KosisService({
    apiKey: "private-test-key",
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(JSON.stringify([{ ORG_ID: "101", TBL_ID: "DT_AUTO", TBL_NM: "자동차 생산지수", ORG_NM: "국가데이터처", END_PRD_DE: "202609" }]), { status: 200 });
    },
  });
  const rows = await service.search("자동차 생산");
  assert.equal(rows[0].tblId, "DT_AUTO");
  assert.equal(rows[0].tableName, "자동차 생산지수");
  assert.equal(calls[0].searchParams.get("apiKey"), "private-test-key");
  assert.equal(calls[0].searchParams.get("searchNm"), "자동차 생산");
  assert.ok(!JSON.stringify(rows).includes("private-test-key"));
});

test("KOSIS 통계표 메타에서 실제 수록주기를 선택한다", async () => {
  const service = new KosisService({
    apiKey: "private-test-key",
    fetchImpl: async (url) => new Response(JSON.stringify(url.searchParams.get("type") === "PRD"
      ? [{ PRD_SE: "년", END_PRD_DE: "2025" }, { PRD_SE: "월", END_PRD_DE: "2026.09" }]
      : [{ TBL_NM: "자동차 생산지수" }]), { status: 200 }),
  });
  const table = await service.table({ orgId: "101", tblId: "DT_AUTO" });
  assert.deepEqual(table.frequencies, ["M", "Y"]);
  assert.equal(table.tableName, "자동차 생산지수");
});

test("KOSIS 수치는 같은 계열의 최신·직전 수록시점만 비교하고 결측을 0으로 바꾸지 않는다", () => {
  const series = extractKosisSeries([
    { ITM_ID: "I1", ITM_NM: "생산지수", C1: "CAR", C1_NM: "자동차", PRD_DE: "202609", DT: "153.4", UNIT_NM: "2020=100" },
    { ITM_ID: "I1", ITM_NM: "생산지수", C1: "CAR", C1_NM: "자동차", PRD_DE: "202608", DT: "149.2", UNIT_NM: "2020=100" },
    { ITM_ID: "I1", ITM_NM: "생산지수", C1: "CAR", C1_NM: "자동차", PRD_DE: "202607", DT: "..", UNIT_NM: "2020=100" },
    { ITM_ID: "I1", ITM_NM: "생산지수", C1: "SHIP", C1_NM: "선박", PRD_DE: "202609", DT: "90" },
  ], { orgId: "101", tblId: "DT_AUTO", tableName: "업종별 생산", frequency: "M" });
  assert.equal(series.length, 1);
  assert.equal(series[0].name, "생산지수 · 자동차");
  assert.equal(series[0].latest, 153.4);
  assert.equal(series[0].previous, 149.2);
  assert.equal(series[0].latestPeriod, "2026-09");
  assert.equal(series[0].source, "https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_AUTO");
  assert.match(series[0].comparisonWarning, /계절성/);
});

test("계절조정 월별 계열은 계절성 경고 없이 비교한다", () => {
  const series = extractKosisSeries([
    { ITM_ID: "T10", ITM_NM: "생산지수(계절조정)", C1: "00", C1_NM: "전국", C2: "C30", C2_NM: "자동차", PRD_DE: "202608", DT: "101.9" },
    { ITM_ID: "T10", ITM_NM: "생산지수(계절조정)", C1: "00", C1_NM: "전국", C2: "C30", C2_NM: "자동차", PRD_DE: "202607", DT: "135.5" },
  ], { orgId: "101", tblId: "DT_1F02001", tableName: "광공업생산지수", frequency: "M" });
  assert.equal(series[0].comparisonWarning, "");
  assert.equal(series[0].previous, 135.5);
  assert.equal(series[0].latest, 101.9);
});

test("KOSIS 계열 조회는 메타의 분류 차원을 사용해 공식 Param API로 요청한다", async () => {
  const calls = [];
  const service = new KosisService({
    apiKey: "private-test-key",
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.searchParams.get("type") === "ITM") return new Response(JSON.stringify([{ OBJ_ID: "ITEM" }, { OBJ_ID: "A" }, { OBJ_ID: "B" }]));
      if (url.searchParams.get("type") === "TBL") return new Response(JSON.stringify([{ TBL_NM: "광공업생산지수" }]));
      return new Response(JSON.stringify([
        { ITM_ID: "T10", ITM_NM: "생산지수(계절조정)", C1: "00", C1_NM: "전국", C2: "C30", C2_NM: "자동차", PRD_DE: "202608", DT: "101.9" },
        { ITM_ID: "T10", ITM_NM: "생산지수(계절조정)", C1: "00", C1_NM: "전국", C2: "C30", C2_NM: "자동차", PRD_DE: "202607", DT: "135.5" },
      ]));
    },
  });
  const result = await service.series({ orgId: "101", tblId: "DT_1F02001", frequency: "M", query: "전국 자동차" });
  const dataUrl = calls.find((url) => url.pathname.endsWith("/Param/statisticsParameterData.do"));
  assert.ok(dataUrl);
  assert.equal(dataUrl.searchParams.get("itmId"), "ALL");
  assert.equal(dataUrl.searchParams.get("objL1"), "ALL");
  assert.equal(dataUrl.searchParams.get("objL2"), "ALL");
  assert.equal(dataUrl.searchParams.get("newEstPrdCnt"), "2");
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].latest, 101.9);
  assert.ok(!JSON.stringify(result).includes("private-test-key"));
});

test("키가 없거나 통계표 ID가 잘못된 경우 안전하게 차단한다", async () => {
  const service = new KosisService();
  await assert.rejects(() => service.search("자동차"), /KOSIS_API_KEY/);
  const configured = new KosisService({ apiKey: "private-test-key", fetchImpl: async () => { throw new Error("sensitive-url"); } });
  await assert.rejects(() => configured.table({ orgId: "101/../", tblId: "DT_AUTO" }), /기관 ID/);
  await assert.rejects(() => configured.search("자동차"), /KOSIS 서버/);
});
