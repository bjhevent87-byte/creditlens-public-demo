/**
 * 담당자가 원본·면담 근거를 남긴 보고서 서술만 덮어쓴다.
 * 재무 원계정이나 자동 계산값에는 영향을 주지 않는다.
 */
export function applyReportEdits(sections, edits) {
  const result = { ...(sections || {}) };
  for (const key of ["industry", "management"]) {
    const entry = edits?.[key];
    const statement = typeof entry?.text === "string" ? entry.text.trim() : "";
    const source = typeof entry?.source === "string" ? entry.source.trim() : "";
    if (!statement || !source) continue;
    const original = result[key] && typeof result[key] === "object" ? result[key] : {};
    result[key] = {
      text: statement,
      source,
      ...(Array.isArray(original.persistentBullets) ? { bullets: original.persistentBullets } : {}),
    };
  }
  return result;
}
