function scopeForFlag(id) {
  if (["receivables-ahead", "inventory-ahead", "sales-cfo-divergence"].includes(id)) return ["working", "facility"];
  return ["working", "facility"];
}

export function buildReviewOutcome(assessment = {}, reviews = {}, attachments = [], structure = {}) {
  const findings = (assessment.redFlags || []).map((flag) => {
    const entry = reviews[flag.id] || {};
    const evidence = attachments.filter((item) => item.findingId === flag.id);
    const note = String(entry.note || "").trim();
    const requestedStatus = entry.status || "미확인";
    const status = requestedStatus === "해소" && (!evidence.length || note.length < 10) ? "해소 근거 부족" : requestedStatus;
    return { id: flag.id, title: flag.title, level: flag.level, originalConcern: flag.reason, scope: scopeForFlag(flag.id), status, note, evidence: evidence.map(({ id, name, sha256 }) => ({ id, name, sha256 })) };
  });
  const pending = findings.filter((item) => item.status !== "해소");
  const scope = (key, structurePart) => {
    if (!structurePart || structurePart.status === "신청 없음") return { status: "신청 없음", explanation: "해당 자금 신청이 없습니다." };
    const unresolved = pending.filter((item) => item.scope.includes(key));
    if (structurePart.missingInputs?.length) return { status: "조건 제안 보류", explanation: `상환자료 부족: ${structurePart.missingInputs.join("·")}`, unresolvedIds: unresolved.map((item) => item.id) };
    if (unresolved.length) return { status: "조건 제안 보류", explanation: `미해소 우려 ${unresolved.length}건의 증빙·현장 확인 후 조건을 재검토해야 합니다.`, unresolvedIds: unresolved.map((item) => item.id) };
    if (structurePart.firstShortfallMonth || structurePart.firstShortfallYear) return { status: "금액·만기 재검토", explanation: "입력 현금수지에서 상환부족 시점이 확인됩니다. 금액·기간·자기자금 또는 상환방식 조정이 필요합니다.", unresolvedIds: [] };
    return { status: "심사부 검토자료 준비", explanation: "입력 자료와 검증 표시상 주요 우려가 해소됐습니다. 내부등급·담보·정책 심사는 별도로 필요합니다.", unresolvedIds: [] };
  };
  return {
    findings,
    resolvedCount: findings.length - pending.length,
    pendingCount: pending.length,
    working: scope("working", structure.working),
    facility: scope("facility", structure.facility),
    disclaimer: "제출 파일만으로 위험이 해소되지는 않습니다. 담당자의 내용 검증과 은행 내부 심사가 필요합니다.",
  };
}
