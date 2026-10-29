// Run: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../calc.js');

function generator(overrides) {
  return { level: 0, price: NaN, cps: NaN, unlockCost: NaN, candyUnlock: false, ...overrides };
}

function candyParams(o = {}) {
  return {
    bank: o.bank ?? 0,
    curseSpent: o.curseSpent ?? 0,
    genGrowthBase: o.genGrowthBase ?? 1.25,
    genGrowthStep: o.genGrowthStep ?? 0.005,
    boost: { level: 0, max: 25, price: 1000, mult: 1.25, growth: 2, ...o.boost },
    speed: { level: 0, max: 20, price: 2500, mult: 1.1, growth: 2.5, ...o.speed },
    generators: o.generators ?? [
      generator({ level: 1, price: 100, cps: 10 }),
      generator({ candyUnlock: true, unlockCost: 100e3 }),
      generator({ candyUnlock: true, unlockCost: 25e9 }),
      generator(),
      generator()
    ]
  };
}

function spiderParams(o = {}) {
  return {
    bank: o.bank ?? 0,
    perReset: o.perReset ?? 10,
    runMinutes: o.runMinutes ?? 10,
    exponent: o.exponent ?? 0.5,
    genGrowthBase: 1.25,
    genGrowthStep: 0.005,
    genLevelRef: o.genLevelRef ?? 40,
    ccBoost: { level: 0, max: 50, price: 1, mult: 1.35, growth: 1.5, ...o.ccBoost },
    spiderBoost: { level: 0, max: 30, price: 5, mult: 1.2, growth: 1.5, ...o.spiderBoost },
    genCost: { level: 0, max: 15, price: 20, mult: 1.3, growth: 1.5, ...o.genCost },
    gen4: { planned: true, cost: 75e3, effect: 1, ...o.gen4 },
    gen5: { planned: false, cost: 100e6, effect: 1, ...o.gen5 }
  };
}

// Every distinct order of a multiset given as { id: count }.
function* orders(counts) {
  const ids = Object.keys(counts).filter((id) => counts[id] > 0);
  if (ids.length === 0) { yield []; return; }
  for (const id of ids) {
    for (const rest of orders({ ...counts, [id]: counts[id] - 1 })) yield [id, ...rest];
  }
}

function mulberry32(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertClose(actual, expected, message) {
  const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
}

// ---------- numbers ----------

test('parseAmount_ShouldReadGameNotation_WhenSuffixOrExponentGiven', () => {
  assert.equal(calc.parseAmount('25B'), 25e9);
  assert.equal(calc.parseAmount('1.5Qa'), 1.5e15);
  assert.equal(calc.parseAmount('1,5k'), 1500);
  assert.equal(calc.parseAmount('100 000'), 100000);
  assert.equal(calc.parseAmount('1,000,000'), 1e6);
  assert.equal(calc.parseAmount('2e12'), 2e12);
  assert.equal(calc.parseAmount('0'), 0);
  assert.ok(Number.isNaN(calc.parseAmount('')));
  assert.ok(Number.isNaN(calc.parseAmount('abc')));
  assert.ok(Number.isNaN(calc.parseAmount('5Zz')));
});

test('formatAmount_ShouldUseGameSuffixes_WhenNumberIsLarge', () => {
  assert.equal(calc.formatAmount(25e9), '25B');
  assert.equal(calc.formatAmount(1500), '1.5K');
  assert.equal(calc.formatAmount(999999), '1M');
  assert.equal(calc.formatAmount(123.456), '123');
  assert.equal(calc.formatAmount(0), '0');
  assert.equal(calc.formatAmount(1.2346e15, 4), '1.235Qa');
  assert.equal(calc.parseAmount(calc.formatAmount(6.25e3, 4)), 6250);
});

test('formatDuration_ShouldShowThreeLargestUnits_WhenLongerThanAMinute', () => {
  assert.equal(calc.formatDuration(3725), '1ч 2мин 5с');
  assert.equal(calc.formatDuration(90061), '1д 1ч 1мин');
  assert.equal(calc.formatDuration(5.25), '5.3с');
  assert.equal(calc.formatDuration(0), '0с');
});

// ---------- shared search ----------

test('fastestOrder_ShouldMatchBruteForce_WhenChainsAreSmall', () => {
  const random = mulberry32(7);
  for (let run = 0; run < 30; run++) {
    const chain = (n) => {
      const costs = []; const factors = [1];
      for (let i = 0; i < n; i++) {
        costs.push(10 + random() * 300);
        factors.push(factors[i] * (1 + random() * 0.6));
      }
      return { costs, factors };
    };
    const chains = [{ ...chain(3), required: true }, { ...chain(2), required: true }, { ...chain(4), required: false }];
    const bank = random() < 0.5 ? 0 : random() * 200;
    const rate = 1 + random() * 5;
    const timeOf = (order) => {
      const pos = [0, 0, 0]; let spent = 0; let t = 0;
      for (const d of order) {
        const factor = chains.reduce((f, c, i) => f * c.factors[pos[i]], 1);
        const cost = chains[d].costs[pos[d]];
        t += Math.max(0, cost - Math.max(0, bank - spent)) / (rate * factor);
        spent += cost; pos[d] += 1;
      }
      return t;
    };
    let best = Infinity;
    for (let k = 0; k <= 4; k++) for (const o of orders({ 0: 3, 1: 2, 2: k })) best = Math.min(best, timeOf(o.map(Number)));
    const found = calc.fastestOrder(chains, bank, rate);
    assertClose(timeOf(found.order), best, `run ${run}`);
  }
});

// ---------- Candy Corn board ----------

test('simulateCandy_ShouldReproduceGamePrices_WhenGeneratorLevelsUp', () => {
  const gen1 = candyParams({ generators: [generator({ level: 38, price: 562.41e3, cps: 100 }), generator(), generator(), generator(), generator()] });
  const gen1Prices = calc.simulateCandy(gen1, ['gen1', 'gen1', 'gen1', 'gen1']).steps.map((s) => calc.formatAmount(s.cost));
  assert.deepEqual(gen1Prices, ['562K', '810K', '1.17M', '1.7M']);
  const other = candyParams({ generators: [generator({ level: 27, price: 2.57e6, cps: 100 }), generator(), generator(), generator(), generator()] });
  const otherPrices = calc.simulateCandy(other, ['gen1', 'gen1', 'gen1']).steps.map((s) => calc.formatAmount(s.cost));
  assert.deepEqual(otherPrices, ['2.57M', '3.56M', '4.95M']);
});

test('generatorStartPrice_ShouldRecoverLevelOnePrice_WhenGivenGamePrices', () => {
  const p = candyParams();
  assert.equal(Math.round(calc.generatorStartPrice(p, 40, 1.17e6)), 10);
  assert.equal(Math.round(calc.generatorStartPrice(p, 31, 9.663e6)), 2000);
  assert.equal(calc.formatAmount(calc.generatorPriceAt(p, 10, 40)), '1.17M');
  assert.equal(calc.formatAmount(calc.generatorPriceAt(p, 2000, 28)), '3.56M');
});

test('candyRunTotal_ShouldSumEverythingPaid_WhenLevelsAreKnown', () => {
  // Export "11th Spider just given": Gain 20, Speed 13, Gen 1 lvl 42, Gen 2 lvl 31, nothing on hand.
  const p = candyParams({
    boost: { level: 20, price: 52.4e6 },
    speed: { level: 13, price: 29.8e6 },
    generators: [
      generator({ level: 42, price: 2.468e6, cps: 28.71e3 }),
      generator({ level: 31, price: 9.667e6, cps: 211.6e3, candyUnlock: true, unlockCost: 100e3 }),
      generator({ candyUnlock: true, unlockCost: 25e9 }), generator(), generator()
    ]
  });
  assert.ok(Math.abs(calc.candyRunTotal(p) - 103e6) < 0.2e6, `total ${calc.candyRunTotal(p)}`);
  assert.equal(calc.candyRunTotal(candyParams()), 0);
});

test('optimizeCandy_ShouldMatchBruteForce_WhenOneGenerator', () => {
  const random = mulberry32(42);
  for (let run = 0; run < 30; run++) {
    const p = candyParams({
      bank: random() < 0.5 ? 0 : random() * 500,
      boost: { level: 22, price: 50 + random() * 500, growth: 1.5 + random() * 1.5, mult: 1.1 + random() * 0.4 },
      speed: { level: 18, price: 50 + random() * 500, growth: 1.5 + random() * 1.5, mult: 1.05 + random() * 0.3 },
      generators: [generator({ level: 1 + Math.floor(random() * 4), price: 20 + random() * 300, cps: 1 + random() * 20 }),
        generator(), generator(), generator(), generator()],
      genGrowthBase: 1.25 + random() * 0.3,
      genGrowthStep: random() * 0.01
    });
    const result = calc.optimizeCandy(p);
    const k = result.finalLevels[0] - result.startLevels[0];
    assert.ok(k <= 9, `run ${run}: too many generator levels for brute force (${k})`);
    let best = Infinity;
    for (let g = 0; g <= k + 2; g++) {
      for (const o of orders({ boost: 3, speed: 2, gen1: g })) best = Math.min(best, calc.simulateCandy(p, o).totalTime);
    }
    assertClose(result.totalTime, best, `run ${run}`);
  }
});

test('optimizeCandy_ShouldStayNearBruteForce_WhenGeneratorOrderIsFree', () => {
  const random = mulberry32(99);
  let worstGap = 0;
  for (let run = 0; run < 12; run++) {
    const p = candyParams({
      bank: random() < 0.5 ? 0 : random() * 300,
      boost: { level: 23, price: 200 + random() * 800, growth: 2, mult: 1.25 },
      speed: { level: 19, price: 200 + random() * 800, growth: 2.5, mult: 1.1 },
      generators: [
        generator({ level: 1 + Math.floor(random() * 3), price: 30 + random() * 200, cps: 2 + random() * 10 }),
        generator({ candyUnlock: true, unlockCost: 100 + random() * 600, price: 50 + random() * 300, cps: 5 + random() * 40 }),
        generator(), generator(), generator()
      ]
    });
    const result = calc.optimizeCandy(p);
    let best = Infinity;
    for (let g1 = 0; g1 <= 4; g1++) {
      for (let g2 = 0; g2 <= 4; g2++) {
        for (const o of orders({ boost: 2, speed: 1, gen1: g1, gen2: g2 })) {
          best = Math.min(best, calc.simulateCandy(p, o).totalTime);
        }
      }
    }
    worstGap = Math.max(worstGap, result.totalTime / best - 1);
  }
  assert.ok(worstGap < 0.01, `worst gap ${(worstGap * 100).toFixed(3)}%`);
});

test('optimizeCandy_ShouldUnlockGenerator_WhenItsStatsAreKnown', () => {
  const p = candyParams();
  p.generators[1] = generator({ candyUnlock: true, unlockCost: 100e3, price: 5e3, cps: 2e3 });
  const result = calc.optimizeCandy(p);
  const unlock = result.steps.find((s) => s.id === 'gen2' && s.unlock);
  assert.ok(unlock, 'Generator 2 is unlocked in the plan');
  assert.equal(unlock.cost, 100e3);
  assert.ok(result.finalLevels[1] > 1);
  assert.equal(result.notes.length, 1, 'Generator 3 has no stats');
});

test('optimizeCandy_ShouldIgnoreLockedGenerators_WhenStatsAreMissing', () => {
  const result = calc.optimizeCandy(candyParams());
  assert.equal(result.steps.filter((s) => s.id !== 'gen1' && s.kind === 'gen').length, 0);
  assert.equal(result.notes.length, 2);
  const last = result.steps[result.steps.length - 1];
  assert.notEqual(last.kind, 'gen');
  assert.equal(result.steps.filter((s) => s.id === 'boost').length, 25);
  assert.equal(result.steps.filter((s) => s.id === 'speed').length, 20);
});

test('optimizeCandy_ShouldKeepOrder_WhenOnlyProductionScales', () => {
  const slow = candyParams({ bank: 5000 });
  const fast = candyParams({ bank: 5000 });
  fast.generators[0] = generator({ level: 1, price: 100, cps: 10000 });
  const a = calc.optimizeCandy(slow);
  const b = calc.optimizeCandy(fast);
  assert.deepEqual(a.steps.map((s) => s.id), b.steps.map((s) => s.id));
  assertClose(a.totalTime, b.totalTime * 1000, 'time scales with 1/production');
});

test('optimizeCandy_ShouldReturnNoSteps_WhenBoardIsMaxed', () => {
  const result = calc.optimizeCandy(candyParams({ boost: { level: 25 }, speed: { level: 20 } }));
  assert.deepEqual(result.steps, []);
  assert.equal(result.totalTime, 0);
});

test('optimizeCandy_ShouldReportProblems_WhenInputIsInvalid', () => {
  const p = candyParams();
  p.generators[0] = generator({ level: 1, price: 100, cps: NaN });
  p.boost.level = 26;
  const result = calc.optimizeCandy(p);
  assert.equal(result.problems.length, 2);
  assert.equal(result.steps, undefined);
});

// ---------- Spider board ----------

test('optimizeSpiders_ShouldMatchBruteForce_WhenBoardIsSmall', () => {
  const random = mulberry32(5);
  for (let run = 0; run < 25; run++) {
    const p = spiderParams({
      bank: random() < 0.5 ? 0 : random() * 30,
      exponent: random(),
      ccBoost: { level: 47, price: 1 + random() * 20, growth: 1.2 + random() },
      spiderBoost: { level: 28, price: 1 + random() * 20, growth: 1.2 + random() },
      genCost: { level: 14, price: 1 + random() * 20, growth: 1.2 + random() },
      gen4: { planned: true, cost: 5 + random() * 50, effect: 1 + random() * 3 }
    });
    const result = calc.optimizeSpiders(p);
    let best = Infinity;
    for (const o of orders({ ccBoost: 3, spiderBoost: 2, genCost: 1, gen4: 1 })) {
      best = Math.min(best, calc.simulateSpiders(p, o).totalTime);
    }
    assertClose(result.totalTime, best, `run ${run}`);
  }
});

test('optimizeSpiders_ShouldBuySpidersBoostFirst_WhenSpidersDoNotDependOnCandyCorn', () => {
  const result = calc.optimizeSpiders(spiderParams({ exponent: 0 }));
  const ids = result.steps.map((s) => s.id);
  assert.equal(ids.slice(0, 30).every((id) => id === 'spiderBoost'), true);
  assert.equal(ids.length, 50 + 30 + 15 + 1);
});

test('optimizeSpiders_ShouldPutUnknownUnlockLast_WhenEffectIsOne', () => {
  const result = calc.optimizeSpiders(spiderParams({ exponent: 0.5, gen4: { planned: true, cost: 10, effect: 1 } }));
  assert.equal(result.steps[result.steps.length - 1].id, 'gen4');
});

test('optimizeSpiders_ShouldReportProblems_WhenInputIsInvalid', () => {
  const result = calc.optimizeSpiders(spiderParams({ perReset: 0, gen4: { planned: true, cost: 0, effect: 1 } }));
  assert.equal(result.problems.length, 2);
});

test('spidersForRun_ShouldMatchGameReadings_WhenSpidersBoostIsBought', () => {
  assert.equal(calc.spidersForRun(14.949e9, Math.pow(1.2, 3), 0.45), 130);
  assert.equal(calc.spidersForRun(15.949e9, Math.pow(1.2, 3), 0.45), 134);
  assert.equal(calc.spidersForRun(246.71e6, 1.2, 0.45), 14);
  assert.equal(calc.spidersForRun(140.03e6, 1.2, 0.45), 11);
  assert.equal(calc.spidersForRun(1e6, 1, 0.45), 1);
  assert.equal(calc.spidersForRun(0.99e6, 1, 0.45), 0);
});

function exportF(bank) {
  // In-game state with Gen 3 open, Spiders Boost level 3 and Gen Cost level 2: 7B on hand → +130, 8B → +134.
  return candyParams({
    bank: bank,
    boost: { level: 25, price: 1.677e9 },
    speed: { level: 19, price: 7.282e9 },
    generators: [
      generator({ level: 45, price: 4.594e6, cps: 656.3e3 }),
      generator({ level: 37, price: 46.37e6, cps: 5.399e6, candyUnlock: true, unlockCost: 100e3 }),
      generator({ level: 20, price: 430.3e6, cps: 35.06e6, candyUnlock: true, unlockCost: 25e9 }),
      generator(), generator()
    ]
  });
}

test('candyRunTotal_ShouldGiveGameSpiders_WhenGeneratorUnlocksAreLeftOut', () => {
  const mult = Math.pow(1.2, 3);
  assert.equal(calc.spidersForRun(calc.candyRunTotal(exportF(7e9)), mult, 0.45), 130);
  assert.equal(calc.spidersForRun(calc.candyRunTotal(exportF(8e9)), mult, 0.45), 134);
});

test('spiderMilestones_ShouldIgnoreUnlockSpending_WhenGeneratorIsUnlocked', () => {
  // 1M/s; at t = 10 an unlock for 5M is paid, so 25M collected counts only as 20M.
  const events = [{ time: 0, rate: 1e6, unlockSpent: 0 }, { time: 10, rate: 1e6, unlockSpent: 5e6 }, { time: 100, rate: 1e6, unlockSpent: 5e6 }];
  const milestones = calc.spiderMilestones(events, 0, 0, 1, 0.5);
  assert.equal(Math.round(milestones.find((m) => m.spiders === 3).time), 9, 'before the unlock nothing is taken out');
  assert.equal(Math.round(milestones.find((m) => m.spiders === 5).time), 30, '25M counted needs 30M collected');
});

test('simulateCandy_ShouldReportUnlockCost_WhenPlanUnlocksGenerator', () => {
  const p = exportD();
  const result = calc.simulateCandy(p, ['gen3', 'gen1']);
  assert.equal(result.unlockCost, 25e9);
  assert.ok(result.totalCost > result.unlockCost);
});

// ---------- reset timing ----------

function exportD(overrides) {
  // In-game state at "+13 Spiders" with Spiders Boost ×1.2.
  return candyParams({
    bank: 30e6,
    boost: { level: 21, price: 104.8e6 },
    speed: { level: 14, price: 74.55e6 },
    generators: [
      generator({ level: 41, price: 1.695e6, cps: 58.51e3 }),
      generator({ level: 33, price: 19.18e6, cps: 471.2e3, candyUnlock: true, unlockCost: 100e3 }),
      generator({ candyUnlock: true, unlockCost: 25e9 }), generator(), generator()
    ],
    ...overrides
  });
}

test('resetCandyParams_ShouldReturnFirstPrices_WhenRunIsReset', () => {
  const fresh = calc.resetCandyParams(exportD());
  assert.equal(calc.formatAmount(fresh.boost.price), '50');
  assert.equal(fresh.boost.level, 0);
  assert.equal(calc.formatAmount(fresh.speed.price), '200');
  assert.equal(fresh.generators[0].level, 1);
  assert.equal(Math.round(fresh.generators[0].price), 10);
  assert.equal(fresh.generators[1].level, 1, 'Gen 2 stays open');
  assert.equal(calc.formatAmount(fresh.generators[1].price), '2K');
  assert.equal(fresh.generators[2].level, 0, 'Gen 3 stays locked');
  assert.equal(fresh.bank, 0);
});

test('resetCandyParams_ShouldKeepGen3Open_WhenItWasUnlocked', () => {
  const fresh = calc.resetCandyParams(exportF(7e9));
  const gen3 = fresh.generators[2];
  assert.equal(gen3.level, 1);
  assertClose(calc.generatorPriceAt(fresh, gen3.price, 20), 430.3e6, 'level-1 price grows back to the game price');
  assert.equal(calc.candyRunTotal(fresh), 0, 'a fresh run has collected nothing');
});

test('spiderMilestones_ShouldFollowFormula_WhenRateIsConstant', () => {
  const events = [{ time: 0, rate: 1e6 }, { time: 100, rate: 1e6 }];
  const times = calc.spiderMilestones(events, 0, 0, 1, 0.5).map((m) => Math.round(m.time));
  assert.deepEqual(times, [1, 4, 9, 16, 25, 36, 49, 64, 81, 100]);
});

test('resetAdvice_ShouldAimAtBestRun_WhenRunJustStarted', () => {
  const fresh = calc.resetCandyParams(exportD());
  const advice = calc.resetAdvice(fresh, calc.optimizeCandy(fresh), 1.2, 0.45);
  assert.equal(advice.spidersNow, 0);
  assert.equal(advice.resetNow, false);
  assert.equal(advice.target.spiders, advice.bestRun.spiders);
  assert.ok(advice.bestRun.rate > 0);
});

test('resetAdvice_ShouldSayResetNow_WhenRunIsFarPastBestPoint', () => {
  const p = exportD({ bank: 1e13 });
  const advice = calc.resetAdvice(p, calc.optimizeCandy(p), 1.2, 0.45);
  assert.ok(advice.spidersNow > advice.bestRun.spiders);
  assert.equal(advice.resetNow, true);
  assert.equal(advice.target, null);
});

test('candyRunTotal_ShouldAddCurseSpending_WhenItIsTypedIn', () => {
  const base = calc.candyRunTotal(exportD());
  assertClose(calc.candyRunTotal(exportD({ curseSpent: 5e6 })), base + 5e6, 'curses are collected Candy Corn');
  assert.equal(calc.resetCandyParams(exportD({ curseSpent: 5e6 })).curseSpent, 0);
});

test('resetAdvice_ShouldListGeneratorsAfterBoard_WhenBoardIsFinished', () => {
  const p = exportD({ boost: { level: 25, price: 1.678e9 }, speed: { level: 20, price: 1.82e10 } });
  const plan = calc.optimizeCandy(p);
  const advice = calc.resetAdvice(p, plan, 1.2, 0.45);
  assert.equal(plan.steps.length, 0);
  assert.ok(advice.afterBoard.length >= 25);
  assert.ok(advice.afterBoard.every((id) => id === 'gen1' || id === 'gen2'));
  const steps = calc.simulateCandy(p, advice.afterBoard).steps;
  assert.ok(steps.every((s, i) => i === 0 || s.elapsed >= steps[i - 1].elapsed));
});

test('resetAdvice_ShouldGiveResetAfterBoard_WhenBestResetIsMidBoard', () => {
  const p = exportD();
  const plan = calc.optimizeCandy(p);
  const advice = calc.resetAdvice(p, plan, 1.2, 0.45);
  assert.ok(advice.target.time < plan.totalTime, 'best reset comes before the board is done');
  assert.ok(advice.finishTarget.time >= plan.totalTime);
  assert.ok(advice.finishTarget.spiders > advice.target.spiders);
  assert.ok(advice.afterBoard.length >= 25);
});
