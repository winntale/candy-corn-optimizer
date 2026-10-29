// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../calc.js');

function makeParams(overrides) {
  const o = overrides || {};
  return {
    bank: o.bank ?? 0,
    rate: o.rate ?? 10,
    boost: { level: 0, max: 25, price: 1000, mult: 1.25, growth: 2, ...o.boost },
    speed: { level: 0, max: 20, price: 2500, mult: 1.1, growth: 2.5, ...o.speed },
    generator: { level: 1, price: 100, growth: 1.3, ...o.generator }
  };
}

// Every distinct order of the multiset {boost x a, speed x b, generator x g}.
function* orders(a, b, g) {
  if (a + b + g === 0) { yield []; return; }
  if (a > 0) for (const rest of orders(a - 1, b, g)) yield ['boost', ...rest];
  if (b > 0) for (const rest of orders(a, b - 1, g)) yield ['speed', ...rest];
  if (g > 0) for (const rest of orders(a, b, g - 1)) yield ['generator', ...rest];
}

function bruteForceBest(p, maxGenerators) {
  const a = p.boost.max - p.boost.level;
  const b = p.speed.max - p.speed.level;
  let best = Infinity;
  for (let g = 0; g <= maxGenerators; g++) {
    for (const order of orders(a, b, g)) best = Math.min(best, calc.simulate(p, order).totalTime);
  }
  return best;
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

test('parseAmount_ShouldReadGameNotation_WhenSuffixOrExponentGiven', () => {
  assert.equal(calc.parseAmount('25B'), 25e9);
  assert.equal(calc.parseAmount('1.5Qa'), 1.5e15);
  assert.equal(calc.parseAmount('1,5k'), 1500);
  assert.equal(calc.parseAmount('100 000'), 100000);
  assert.equal(calc.parseAmount('1,000,000'), 1e6);
  assert.equal(calc.parseAmount('2e12'), 2e12);
  assert.equal(calc.parseAmount('10T'), 1e13);
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

test('optimize_ShouldMatchBruteForce_WhenInstancesAreSmall', () => {
  const random = mulberry32(42);
  for (let run = 0; run < 40; run++) {
    const p = makeParams({
      bank: random() < 0.5 ? 0 : random() * 500,
      rate: 1 + random() * 20,
      boost: { level: 22, price: 50 + random() * 500, growth: 1.5 + random() * 1.5, mult: 1.1 + random() * 0.4 },
      speed: { level: 18, price: 50 + random() * 500, growth: 1.5 + random() * 1.5, mult: 1.05 + random() * 0.3 },
      generator: { level: 1 + Math.floor(random() * 4), price: 20 + random() * 300, growth: 1.3 + random() * 0.4 }
    });
    const result = calc.optimize(p);
    const generatorsBought = result.generatorTo - result.generatorFrom;
    assert.ok(generatorsBought <= 9, `run ${run}: too many generators for brute force (${generatorsBought})`);
    assertClose(result.totalTime, bruteForceBest(p, generatorsBought + 2), `run ${run}`);
  }
});

test('optimize_ShouldEndWithBoardUpgrade_WhenGeneratorsAreBought', () => {
  const result = calc.optimize(makeParams());
  const last = result.steps[result.steps.length - 1];
  assert.notEqual(last.id, 'generator');
  assert.equal(result.steps.filter((s) => s.id === 'boost').length, 25);
  assert.equal(result.steps.filter((s) => s.id === 'speed').length, 20);
  assert.ok(result.generatorTo > result.generatorFrom);
  assert.equal(result.capped, false);
});

test('optimize_ShouldKeepOrder_WhenOnlyRateChanges', () => {
  const slow = calc.optimize(makeParams({ rate: 1, bank: 5000 }));
  const fast = calc.optimize(makeParams({ rate: 1000, bank: 5000 }));
  assert.deepEqual(slow.steps.map((s) => s.id), fast.steps.map((s) => s.id));
  assertClose(slow.totalTime, fast.totalTime * 1000, 'time scales with 1/rate');
});

test('optimize_ShouldReturnNoSteps_WhenBoardIsMaxed', () => {
  const result = calc.optimize(makeParams({ boost: { level: 25 }, speed: { level: 20 } }));
  assert.deepEqual(result.steps, []);
  assert.equal(result.totalTime, 0);
});

test('optimize_ShouldTakeNoTime_WhenBankCoversEverything', () => {
  const result = calc.optimize(makeParams({ bank: 1e30 }));
  assert.equal(result.totalTime, 0);
  assert.equal(result.generatorTo, result.generatorFrom);
});

test('optimize_ShouldReportProblems_WhenInputIsInvalid', () => {
  const result = calc.optimize(makeParams({ rate: 0, generator: { level: 0 } }));
  assert.equal(result.problems.length, 2);
  assert.equal(result.steps, undefined);
});
