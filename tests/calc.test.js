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

test('fitExponent_ShouldRecoverPower_WhenTwoReadingsGiven', () => {
  assertClose(calc.fitExponent(1e6, 10, 1e8, 100), 0.5, 'k');
  assert.ok(Number.isNaN(calc.fitExponent(1e6, 10, 1e6, 20)));
  assert.ok(Number.isNaN(calc.fitExponent(0, 10, 1e6, 20)));
});
