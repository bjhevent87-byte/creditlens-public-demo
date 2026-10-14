// 고객이 제출한 현금수지·기존 원리금 일정으로만 대출 구조를 시뮬레이션한다.
// 결과는 은행의 승인 한도나 제시 금리가 아니다.
function finite(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function series(value, length) {
  if (!Array.isArray(value) || value.length < length) return null;
  if (!value.slice(0, length).every(finite)) return null;
  const numbers = value.slice(0, length).map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

function serviceSchedule(amount, ratePct, months, graceMonths = 0, method = "equal-principal") {
  const rows = [];
  let balance = amount;
  const grace = Math.min(Math.max(Math.floor(graceMonths), 0), months - 1);
  const instalments = months - grace;
  for (let month = 1; month <= months; month += 1) {
    const interest = balance * ratePct / 100 / 12;
    const principal = method === "bullet"
      ? (month === months ? balance : 0)
      : month > grace ? (month === months ? balance : amount / instalments) : 0;
    balance = Math.max(balance - principal, 0);
    rows.push({ month, interest, principal, service: interest + principal, endingDebt: balance });
  }
  return rows;
}

function ceiling(passes) {
  if (!passes(0)) return 0;
  let high = 1;
  while (high < 100_000 && passes(high)) high *= 2;
  let low = 0;
  for (let i = 0; i < 42; i += 1) {
    const mid = (low + high) / 2;
    if (passes(mid)) low = mid; else high = mid;
  }
  return Math.floor(low * 10) / 10;
}

export function buildLoanStructure(loanRequest = {}, customer = {}) {
  const workingAmount = Number(loanRequest.workingAmount || 0);
  const facilityAmount = Number(loanRequest.facilityAmount || 0);
  const workingMonths = Math.max(1, Math.floor(Number(loanRequest.workingTermMonths || 12)));
  const facilityMonths = Math.max(1, Math.floor(Number(loanRequest.facilityTermMonths || 60)));
  const facilityYears = Math.ceil(facilityMonths / 12);
  const targetCoverage = finite(customer.targetCoverage) && Number(customer.targetCoverage) > 0 ? Number(customer.targetCoverage) : null;
  const openingCash = finite(customer.openingUnrestrictedCash) ? Number(customer.openingUnrestrictedCash) : null;
  const cashFloor = finite(customer.minimumCashBalance) ? Number(customer.minimumCashBalance) : null;
  const monthlyCash = series(customer.monthlyAvailableCash, workingMonths);
  const monthlyExisting = series(customer.monthlyExistingDebtService, workingMonths);
  const annualCash = series(customer.annualAvailableCash, facilityYears);
  const annualExisting = series(customer.annualExistingDebtService, facilityYears);
  const workingRate = finite(loanRequest.workingRatePct) ? Number(loanRequest.workingRatePct) : null;
  const facilityRate = finite(loanRequest.facilityRatePct) ? Number(loanRequest.facilityRatePct) : null;
  const workingMethod = loanRequest.workingRepayment === "equal-principal" ? "equal-principal" : "bullet";
  const facilityMethod = loanRequest.facilityRepayment === "bullet" ? "bullet" : "equal-principal";
  const facilityGrace = Math.max(0, Math.floor(Number(loanRequest.facilityGraceMonths || 0)));
  const debtRegister = Array.isArray(customer.debtRegister) ? customer.debtRegister.filter((item) => finite(item.balanceEok) && Number(item.balanceEok) >= 0 && finite(item.maturityMonths)) : [];
  const registerTotal = debtRegister.reduce((sum, item) => sum + Number(item.balanceEok), 0);
  const variableDebt = debtRegister.filter((item) => item.rateType === "floating").reduce((sum, item) => sum + Number(item.balanceEok), 0);
  const dueWithin12 = debtRegister.filter((item) => Number(item.maturityMonths) <= 12).reduce((sum, item) => sum + Number(item.balanceEok), 0);
  const publicDebt = finite(customer.publicDebtEok) ? Number(customer.publicDebtEok) : null;
  const registerSummary = {
    complete: Boolean(customer.debtRegisterComplete) && registerTotal > 0,
    totalEok: registerTotal,
    variableSharePct: registerTotal > 0 ? variableDebt / registerTotal * 100 : null,
    dueWithin12Eok: dueWithin12,
    publicDebtEok: publicDebt,
    reconciliationGapEok: publicDebt === null ? null : registerTotal - publicDebt,
    note: "만기표의 현재 잔액은 실제 잔여원금·분할상환·차환약정과 대조해야 합니다. 월별 원리금표는 별도 고객 입력입니다.",
  };
  const workingMissing = [];
  const facilityMissing = [];
  if (workingAmount > 0) {
    if (!monthlyCash) workingMissing.push(`향후 ${workingMonths}개월의 월별 상환가능현금`);
    if (!monthlyExisting) workingMissing.push(`향후 ${workingMonths}개월의 기존 원리금`);
    if (openingCash === null) workingMissing.push("사용가능 기초현금");
    if (cashFloor === null) workingMissing.push("유지할 최소현금");
    if (workingRate === null) workingMissing.push("운전자금 가정 금리");
  }
  if (facilityAmount > 0) {
    if (!annualCash) facilityMissing.push(`향후 ${facilityYears}년의 연간 상환가능현금`);
    if (!annualExisting) facilityMissing.push(`향후 ${facilityYears}년의 기존 원리금`);
    if (targetCoverage === null) facilityMissing.push("목표 원리금상환배율");
    if (facilityRate === null) facilityMissing.push("시설자금 가정 금리");
  }
  const workingSchedule = workingAmount > 0 && workingRate !== null ? serviceSchedule(workingAmount, workingRate, workingMonths, 0, workingMethod) : [];
  const facilitySchedule = facilityAmount > 0 && facilityRate !== null ? serviceSchedule(facilityAmount, facilityRate, facilityMonths, facilityGrace, facilityMethod) : [];
  const monthlyEvaluation = (amount, includeFacility = false) => {
    const schedule = serviceSchedule(amount, workingRate, workingMonths, 0, workingMethod);
    let cash = openingCash;
    const rows = schedule.map((entry, index) => {
      const facilityService = includeFacility ? facilitySchedule[index]?.service || 0 : 0;
      cash += monthlyCash[index] - monthlyExisting[index] - entry.service - facilityService;
      return { month: index + 1, availableCash: monthlyCash[index], existingService: monthlyExisting[index], newWorkingService: entry.service, newFacilityService: facilityService, endingCash: cash };
    });
    return { rows, minimumEndingCash: Math.min(...rows.map((row) => row.endingCash)), firstShortfallMonth: rows.find((row) => row.endingCash < cashFloor)?.month || null };
  };
  const working = { requested: workingAmount, termMonths: workingMonths, repayment: workingMethod, missingInputs: workingMissing, status: workingAmount ? "자료요청" : "신청 없음", rows: [] };
  if (workingAmount > 0 && !workingMissing.length) {
    const evaluation = monthlyEvaluation(workingAmount);
    working.rows = evaluation.rows;
    working.minimumEndingCash = evaluation.minimumEndingCash;
    working.firstShortfallMonth = evaluation.firstShortfallMonth;
    working.indicativeCeiling = ceiling((amount) => monthlyEvaluation(amount).firstShortfallMonth === null);
    working.status = evaluation.firstShortfallMonth ? "현금부족 재검토" : "입력자료 기준 충족";
  }
  const facilityEvaluation = (amount, includeWorking = false) => {
    const schedule = serviceSchedule(amount, facilityRate, facilityMonths, facilityGrace, facilityMethod);
    const rows = annualCash.map((availableCash, index) => {
      const newFacilityService = schedule.slice(index * 12, (index + 1) * 12).reduce((sum, row) => sum + row.service, 0);
      const newWorkingService = includeWorking ? workingSchedule.slice(index * 12, (index + 1) * 12).reduce((sum, row) => sum + row.service, 0) : 0;
      const existingService = annualExisting[index];
      const totalService = existingService + newFacilityService + newWorkingService;
      return { year: index + 1, availableCash, existingService, newFacilityService, newWorkingService, totalService, coverage: totalService > 0 ? availableCash / totalService : null };
    });
    return { rows, firstShortfallYear: rows.find((row) => row.coverage === null ? row.availableCash < 0 : row.coverage < targetCoverage)?.year || null };
  };
  const facility = { requested: facilityAmount, termMonths: facilityMonths, graceMonths: facilityGrace, repayment: facilityMethod, targetCoverage, missingInputs: facilityMissing, status: facilityAmount ? "자료요청" : "신청 없음", rows: [] };
  if (facilityAmount > 0 && !facilityMissing.length) {
    const evaluation = facilityEvaluation(facilityAmount);
    facility.rows = evaluation.rows;
    facility.firstShortfallYear = evaluation.firstShortfallYear;
    facility.indicativeCeiling = ceiling((amount) => facilityEvaluation(amount).firstShortfallYear === null);
    facility.status = evaluation.firstShortfallYear ? "상환배율 미달 재검토" : "입력자료 기준 충족";
  }
  const combined = { status: "분리 검토", firstShortfallMonth: null, firstShortfallYear: null };
  if (workingAmount > 0 && facilityAmount > 0) {
    if (workingMissing.length || facilityMissing.length) combined.status = "통합 검토자료 부족";
    else {
      combined.firstShortfallMonth = monthlyEvaluation(workingAmount, true).firstShortfallMonth;
      combined.firstShortfallYear = facilityEvaluation(facilityAmount, true).firstShortfallYear;
      combined.status = combined.firstShortfallMonth || combined.firstShortfallYear ? "통합 상환일정 재검토" : "입력자료 기준 통합 충족";
    }
  }
  const workingAlternatives = workingAmount > 0 ? [6, 12, 24].map((months) => {
    const cash = series(customer.monthlyAvailableCash, months);
    const existing = series(customer.monthlyExistingDebtService, months);
    if (!cash || !existing || openingCash === null || cashFloor === null || workingRate === null) return { termMonths: months, status: "추가 현금수지 필요" };
    const schedule = serviceSchedule(workingAmount, workingRate, months, 0, workingMethod);
    let balance = openingCash;
    let shortfallMonth = null;
    for (let index = 0; index < months; index += 1) {
      balance += cash[index] - existing[index] - schedule[index].service;
      if (balance < cashFloor && shortfallMonth === null) shortfallMonth = index + 1;
    }
    return { termMonths: months, status: shortfallMonth ? "현금부족" : "입력가정 충족", shortfallMonth, endingCash: balance };
  }) : [];
  const facilityAlternatives = facilityAmount > 0 ? [36, 60, 84].map((months) => {
    const years = Math.ceil(months / 12);
    const cash = series(customer.annualAvailableCash, years);
    const existing = series(customer.annualExistingDebtService, years);
    if (!cash || !existing || targetCoverage === null || facilityRate === null) return { termMonths: months, status: "추가 연간 현금수지 필요" };
    const schedule = serviceSchedule(facilityAmount, facilityRate, months, facilityGrace, facilityMethod);
    const coverages = cash.map((available, index) => {
      const newService = schedule.slice(index * 12, (index + 1) * 12).reduce((sum, row) => sum + row.service, 0);
      const total = existing[index] + newService;
      return total > 0 ? available / total : null;
    });
    const shortfallYear = coverages.findIndex((coverage) => coverage === null ? false : coverage < targetCoverage) + 1;
    return { termMonths: months, status: shortfallYear ? "상환배율 미달" : "입력가정 충족", shortfallYear: shortfallYear || null, minimumCoverage: Math.min(...coverages.filter(Number.isFinite)) };
  }) : [];
  const ratesAround = (rate) => rate === null ? [] : [...new Set([rate - 1, rate, rate + 1, rate + 2].filter((value) => value >= 0 && value <= 30).map((value) => Math.round(value * 100) / 100))];
  const workingRateAlternatives = workingAmount > 0 ? ratesAround(workingRate).map((ratePct) => {
    if (workingMissing.length) return { ratePct, status: "추가 현금수지 필요" };
    const schedule = serviceSchedule(workingAmount, ratePct, workingMonths, 0, workingMethod);
    let balance = openingCash;
    let shortfallMonth = null;
    schedule.forEach((row, index) => {
      balance += monthlyCash[index] - monthlyExisting[index] - row.service;
      if (balance < cashFloor && shortfallMonth === null) shortfallMonth = index + 1;
    });
    return { ratePct, status: shortfallMonth ? "현금부족" : "입력가정 충족", shortfallMonth, endingCash: balance };
  }) : [];
  const facilityRateAlternatives = facilityAmount > 0 ? ratesAround(facilityRate).map((ratePct) => {
    if (facilityMissing.length) return { ratePct, status: "추가 연간 현금수지 필요" };
    const schedule = serviceSchedule(facilityAmount, ratePct, facilityMonths, facilityGrace, facilityMethod);
    const coverages = annualCash.map((available, index) => {
      const newService = schedule.slice(index * 12, (index + 1) * 12).reduce((sum, row) => sum + row.service, 0);
      const total = annualExisting[index] + newService;
      return total > 0 ? available / total : null;
    });
    const shortfallYear = coverages.findIndex((coverage, index) => coverage === null ? annualCash[index] < 0 : coverage < targetCoverage) + 1;
    return { ratePct, status: shortfallYear ? "상환배율 미달" : "입력가정 충족", shortfallYear: shortfallYear || null, minimumCoverage: Math.min(...coverages.filter(Number.isFinite)) };
  }) : [];
  return {
    basis: "고객 입력 현금수지·원리금 일정과 금리 가정. 미검증 입력이며 승인 한도·제시 금리가 아닙니다.",
    definitions: {
      monthlyAvailableCash: "영업·필수투자 후, 금융거래 전 상환 가능한 월별 현금(억원). 신규 대출 실행액은 포함하지 않음",
      annualAvailableCash: "영업·필수투자 후, 금융거래 전 상환 가능한 연간 현금(억원). 신규 대출 실행액은 포함하지 않음",
      indicativeCeiling: "입력 현금수지와 가정한 상환방식·금리·목표 완충조건을 충족하는 단순 상한. 은행 한도가 아님",
    },
    working, facility, combined, registerSummary,
    termAlternatives: { working: workingAlternatives, facility: facilityAlternatives },
    rateAlternatives: { working: workingRateAlternatives, facility: facilityRateAlternatives },
  };
}
