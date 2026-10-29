/*
 * Candy Corn & Spider board optimizer (Halloween Part 3) — pure logic, no DOM.
 * Number parsing/formatting, a shared exact search over upgrade chains, and the two boards.
 * Loads as a browser global (window.CandyCalc) or as a CommonJS module (tests).
 */
(function (root) {
  'use strict';

  // ---------- numbers ----------

  var SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
    'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg'];
  var SUFFIX_EXPONENT = {};
  SUFFIXES.forEach(function (suffix, i) { SUFFIX_EXPONENT[suffix.toLowerCase()] = i * 3; });

  // "25B", "1.5Qa", "1,5k", "2e12", "100 000" -> number; NaN when unreadable.
  function parseAmount(text) {
    var s = String(text === undefined || text === null ? '' : text).replace(/\s+/g, '');
    var commas = (s.match(/,/g) || []).length;
    s = commas === 1 && s.indexOf('.') === -1 ? s.replace(',', '.') : s.replace(/,/g, '');
    var m = /^(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?([a-z]*)$/i.exec(s);
    if (!m) return NaN;
    var exponent = SUFFIX_EXPONENT[m[3].toLowerCase()];
    if (exponent === undefined) return NaN;
    return Number(m[1] + 'e' + ((m[2] ? parseInt(m[2], 10) : 0) + exponent));
  }

  // 25e9 -> "25B", 1500 -> "1.5K"; `digits` = significant digits (default 3).
  function formatAmount(n, digits) {
    var precision = digits || 3;
    if (isNaN(n)) return '—';
    if (!isFinite(n)) return '∞';
    if (n < 0) return '-' + formatAmount(-n, precision);
    var tier = n < 1000 ? 0 : Math.floor(Math.log10(n) / 3);
    var mantissa = parseFloat((n / Math.pow(10, tier * 3)).toPrecision(precision));
    if (mantissa >= 1000) {
      tier += 1;
      mantissa = parseFloat((mantissa / 1000).toPrecision(precision));
    }
    if (tier >= SUFFIXES.length) return n.toExponential(precision - 1).replace('e+', 'e');
    return String(mantissa) + SUFFIXES[tier];
  }

  // 3725 -> "1ч 2мин 5с"; shows the three largest units.
  function formatDuration(seconds) {
    if (isNaN(seconds)) return '—';
    if (!isFinite(seconds)) return '∞';
    if (seconds < 59.5) return (seconds < 10 ? parseFloat(seconds.toFixed(1)) : Math.round(seconds)) + 'с';
    var total = Math.round(seconds);
    var days = Math.floor(total / 86400);
    if (days >= 1000) return formatAmount(days) + 'д';
    var units = [
      [days, 'д'],
      [Math.floor((total % 86400) / 3600), 'ч'],
      [Math.floor((total % 3600) / 60), 'мин'],
      [total % 60, 'с']
    ];
    var first = 0;
    while (units[first][0] === 0) first++;
    return units.slice(first, first + 3).map(function (u) { return u[0] + u[1]; }).join(' ');
  }

  // ---------- exact search over upgrade chains ----------

  // Safety net for the open-ended generator sequence (only odd inputs get near it).
  var STEP_CAP = 3000;

  function geometricCosts(price, growth, count) {
    var costs = new Float64Array(count);
    for (var n = 0; n < count; n++) costs[n] = price * Math.pow(growth, n);
    return costs;
  }

  // Income factor after n levels of an upgrade with a fixed multiplier per level.
  function constantFactors(mult, count) {
    var factors = new Float64Array(count + 1);
    for (var n = 0; n <= count; n++) factors[n] = Math.pow(mult, n);
    return factors;
  }

  function runningTotals(costs) {
    var spent = new Float64Array(costs.length + 1);
    for (var n = 0; n < costs.length; n++) spent[n + 1] = spent[n] + costs[n];
    return spent;
  }

  function sum(values) {
    var total = 0;
    for (var i = 0; i < values.length; i++) total += values[i];
    return total;
  }

  // Odometer step over chain positions (last chain changes fastest, like the state index).
  function advance(pos, sizes) {
    for (var d = pos.length - 1; d >= 0; d--) {
      pos[d] += 1;
      if (pos[d] < sizes[d]) return;
      pos[d] = 0;
    }
  }

  function spentAt(spent, pos) {
    var total = 0;
    for (var d = 0; d < pos.length; d++) total += spent[d][pos[d]];
    return total;
  }

  function factorAt(chains, pos) {
    var factor = 1;
    for (var d = 0; d < pos.length; d++) factor *= chains[d].factors[pos[d]];
    return factor;
  }

  // Purchases happen as soon as they are affordable, so the bank is max(0, start bank - spent).
  function waitTime(startBank, spentBefore, cost, rate) {
    return Math.max(0, cost - Math.max(0, startBank - spentBefore)) / rate;
  }

  /*
   * Fastest order of purchases over several upgrade chains paid with one currency.
   * chain = { costs: [...], factors: [...] (income factor after n purchases, factors[0] = 1), required }
   * The bank and the income depend only on how many purchases of each chain are made,
   * so this is an exact DP: the fastest way to a state is the fastest way to one of its
   * predecessors plus one purchase. Required chains must be finished; optional ones may stop anywhere.
   * Returns { order: [chain index, ...], counts: [purchases per chain] }.
   */
  function fastestOrder(chains, startBank, startRate) {
    var dims = chains.length;
    var sizes = chains.map(function (c) { return c.costs.length + 1; });
    var spent = chains.map(function (c) { return runningTotals(c.costs); });
    var strides = new Array(dims);
    var total = 1;
    for (var d = dims - 1; d >= 0; d--) {
      strides[d] = total;
      total *= sizes[d];
    }

    var time = new Float64Array(total).fill(Infinity);
    var via = new Uint8Array(total);
    var pos = new Int32Array(dims);
    time[0] = 0;

    for (var id = 1; id < total; id++) {
      advance(pos, sizes);
      var best = Infinity;
      var move = 0;
      for (d = 0; d < dims; d++) {
        if (pos[d] === 0) continue;
        pos[d] -= 1;
        var t = time[id - strides[d]] +
          waitTime(startBank, spentAt(spent, pos), chains[d].costs[pos[d]], startRate * factorAt(chains, pos));
        pos[d] += 1;
        if (t < best) {
          best = t;
          move = d + 1;
        }
      }
      time[id] = best;
      via[id] = move;
    }

    // Every required chain finished; on (near) ties prefer fewer optional purchases.
    var bestId = -1;
    for (id = 0; id < total; id++) {
      var complete = true;
      for (d = 0; d < dims && complete; d++) {
        complete = !chains[d].required || Math.floor(id / strides[d]) % sizes[d] === sizes[d] - 1;
      }
      if (complete && (bestId < 0 || time[id] < time[bestId] * (1 - 1e-12))) bestId = id;
    }

    var order = [];
    for (var cur = bestId; cur !== 0 && via[cur] !== 0; cur -= strides[via[cur] - 1]) order.push(via[cur] - 1);
    order.reverse();
    return {
      order: order,
      counts: chains.map(function (c, i) { return Math.floor(bestId / strides[i]) % sizes[i]; })
    };
  }

  // ---------- validation helpers ----------

  function isWhole(n) {
    return Number.isInteger(n) && n >= 0;
  }

  function checkLeveledUpgrade(u, name, problems) {
    if (!isWhole(u.max) || u.max < 1) {
      problems.push(name + ': максимум уровней — целое число ≥ 1');
      return;
    }
    if (!isWhole(u.level) || u.level > u.max) problems.push(name + ': уровень — целое число от 0 до ' + u.max);
    if (u.level < u.max && !(u.price > 0)) problems.push(name + ': цена следующего уровня должна быть > 0');
    if (!(u.mult >= 1)) problems.push(name + ': множитель за уровень должен быть ≥ 1');
    if (!(u.growth >= 1)) problems.push(name + ': рост цены должен быть ≥ 1');
  }

  // ---------- Candy Corn board ----------

  /*
   * Generator price multiplier from level L to L+1. Fitted to in-game prices:
   * base 1.25 + step 0.005 per level (×1.3 at level 10, ×1.44 at 38, ×1.45 at 40).
   */
  function generatorGrowth(p, level) {
    return p.genGrowthBase + p.genGrowthStep * level;
  }

  // Price of level 1 → 2, recovered from the current level and price (undoes the growth above).
  function generatorStartPrice(p, level, price) {
    var start = price;
    for (var l = level - 1; l >= 1; l--) start /= generatorGrowth(p, l);
    return start;
  }

  // Price of the next level at `level`, starting from the level-1 price (inverse of the above).
  function generatorPriceAt(p, startPrice, level) {
    var price = startPrice;
    for (var l = 1; l < level; l++) price *= generatorGrowth(p, l);
    return price;
  }

  /*
   * Candy Corn collected this run as far as the calculator can see: everything paid for the current
   * board and generator levels (prices recovered back to level 1), plus what is on hand, plus what
   * was spent outside the calculator this run (curses and the like, typed in by hand).
   */
  function candyRunTotal(p) {
    var total = p.bank + (p.curseSpent > 0 ? p.curseSpent : 0);
    [p.boost, p.speed].forEach(function (u) {
      if (!(u.level > 0)) return;
      var base = u.price / Math.pow(u.growth, u.level);
      total += u.growth === 1 ? base * u.level : base * (Math.pow(u.growth, u.level) - 1) / (u.growth - 1);
    });
    p.generators.forEach(function (g) {
      if (!(g.level >= 1)) return;
      if (g.candyUnlock) total += g.unlockCost;
      var price = generatorStartPrice(p, g.level, g.price);
      for (var level = 1; level < g.level; level++) {
        total += price;
        price *= generatorGrowth(p, level);
      }
    });
    return total;
  }

  function checkGeneratorGrowth(p, problems) {
    if (!(p.genGrowthBase >= 1) || !(p.genGrowthStep >= 0) || !(generatorGrowth(p, 1) > 1)) {
      problems.push('Рост цены генераторов: база ≥ 1, шаг ≥ 0, и вместе больше 1');
    }
  }

  // A locked generator joins the plan when it is unlocked with Candy Corn and its stats after unlock are known.
  function isPlannedUnlock(g) {
    return g.level === 0 && g.candyUnlock && g.unlockCost > 0 && g.cps > 0 && g.price > 0;
  }

  function startProduction(p) {
    return p.generators.reduce(function (total, g) { return g.level >= 1 ? total + g.cps : total; }, 0);
  }

  function validateCandy(p) {
    var problems = [];
    var notes = [];
    if (!(p.bank >= 0)) problems.push('Candy Corn сейчас: введи число ≥ 0');
    checkLeveledUpgrade(p.boost, 'Candy Corn Gain', problems);
    checkLeveledUpgrade(p.speed, 'Generator Speed', problems);
    checkGeneratorGrowth(p, problems);
    p.generators.forEach(function (g, i) {
      var name = 'Generator ' + (i + 1);
      if (!isWhole(g.level)) {
        problems.push(name + ': уровень — целое число ≥ 0 (0 = закрыт)');
      } else if (g.level >= 1) {
        if (!(g.price > 0)) problems.push(name + ': цена следующего уровня должна быть > 0');
        if (!(g.cps > 0)) problems.push(name + ': CC/s должен быть > 0');
      } else if (g.candyUnlock && !isPlannedUnlock(g)) {
        notes.push(name + ' закрыт и не учтён: впиши его CC/s и цену 2-го уровня сразу после открытия.');
      }
    });
    if (problems.length === 0 && !(startProduction(p) > 0)) problems.push('Нужен хотя бы один открытый генератор с CC/s > 0');
    return { problems: problems, notes: notes };
  }

  /*
   * Next purchase block of a generator and its key (smaller = buy sooner) at production P.
   * Key = cost of the block, discounted by the production it already adds while being bought,
   * divided by the share of production it adds: Σ cost·P/P_before / (1 − P/P_after).
   * For one level that is cost·(P + gain)/gain — two neighbouring purchases are in the right
   * order exactly when their keys are. A locked generator's block is the unlock plus the levels
   * right after it that give the smallest key.
   */
  function nextBlock(chain, p, production) {
    if (!chain.locked) return { size: 1, key: chain.price * (production + chain.gain) / chain.gain };
    var best = null;
    var discounted = chain.unlockCost;
    var current = production + chain.gain;
    var price = chain.price;
    for (var level = 1; level <= STEP_CAP; level++) {
      var key = discounted * current / (current - production);
      if (best && key >= best.key) break;
      best = { size: level, key: key };
      discounted += price * production / current;
      current += chain.gain;
      price *= generatorGrowth(p, level);
    }
    return best;
  }

  /*
   * All generator purchases merged into one sequence by the key above.
   * Board upgrades scale every generator equally, so this order does not depend on them.
   * Each level adds the same CC/s (production is proportional to level, i.e. ×(1 + 1/L)).
   * Stops after `maxSteps` or once a block's key exceeds `stopKey` (it can no longer pay off).
   */
  function generatorSequence(p, maxSteps, stopKey) {
    var chains = [];
    var production = 0;
    p.generators.forEach(function (g, index) {
      if (g.level >= 1) {
        production += g.cps;
        chains.push({ index: index, locked: false, gain: g.cps / g.level, level: g.level, price: g.price });
      } else if (isPlannedUnlock(g)) {
        chains.push({ index: index, locked: true, gain: g.cps, level: 0, price: g.price, unlockCost: g.unlockCost });
      }
    });

    var steps = [];
    while (steps.length < maxSteps && chains.length) {
      var pick = null;
      for (var i = 0; i < chains.length; i++) {
        var block = nextBlock(chains[i], p, production);
        if (!pick || block.key < pick.block.key) pick = { chain: chains[i], block: block };
      }
      if (pick.block.key > stopKey) break;
      for (var n = 0; n < pick.block.size && steps.length < maxSteps; n++) {
        var chain = pick.chain;
        var cost = chain.locked ? chain.unlockCost : chain.price;
        if (chain.locked) {
          chain.locked = false;
        } else {
          chain.price *= generatorGrowth(p, chain.level);
        }
        chain.level += 1;
        production += chain.gain;
        steps.push({ gen: chain.index, cost: cost, production: production });
      }
    }
    return steps;
  }

  function solveCandy(p, sequence, production) {
    var nA = p.boost.max - p.boost.level;
    var nB = p.speed.max - p.speed.level;
    var genFactors = new Float64Array(sequence.length + 1);
    genFactors[0] = 1;
    sequence.forEach(function (s, k) { genFactors[k + 1] = s.production / production; });
    var found = fastestOrder([
      { costs: geometricCosts(p.boost.price, p.boost.growth, nA), factors: constantFactors(p.boost.mult, nA), required: true },
      { costs: geometricCosts(p.speed.price, p.speed.growth, nB), factors: constantFactors(p.speed.mult, nB), required: true },
      { costs: Float64Array.from(sequence, function (s) { return s.cost; }), factors: genFactors, required: false }
    ], p.bank, production);
    var next = 0;
    var order = found.order.map(function (d) {
      if (d === 0) return 'boost';
      if (d === 1) return 'speed';
      next += 1;
      return 'gen' + (sequence[next - 1].gen + 1);
    });
    return { order: order, generatorSteps: found.counts[2] };
  }

  /*
   * Replays an order of purchases ('boost', 'speed', 'gen1'..'gen5'; a 'genN' step on a locked
   * generator unlocks it at level 1) and returns every step with costs and timings.
   */
  function simulateCandy(p, order) {
    var gens = p.generators.map(function (g) {
      return { level: g.level, gain: g.level >= 1 ? g.cps / g.level : g.cps, price: g.price, unlockCost: g.unlockCost };
    });
    var bought = { boost: 0, speed: 0 };
    var waitByKind = { boost: 0, speed: 0, gen: 0 };
    var production = startProduction(p);
    var rate = production;
    var bank = p.bank;
    var elapsed = 0;
    var totalCost = 0;

    var steps = order.map(function (id) {
      var step = { id: id };
      if (id === 'boost' || id === 'speed') {
        var u = p[id];
        step.kind = id;
        step.from = u.level + bought[id];
        step.cost = u.price * Math.pow(u.growth, bought[id]);
        bought[id] += 1;
      } else {
        var g = gens[Number(id.slice(3)) - 1];
        step.kind = 'gen';
        step.from = g.level;
        step.unlock = g.level === 0;
        step.cost = step.unlock ? g.unlockCost : g.price;
        if (!step.unlock) g.price *= generatorGrowth(p, g.level);
        g.level += 1;
        production += g.gain;
      }
      var newRate = production * Math.pow(p.boost.mult, bought.boost) * Math.pow(p.speed.mult, bought.speed);
      step.to = step.from + 1;
      step.wait = Math.max(0, step.cost - bank) / rate;
      bank = Math.max(0, bank - step.cost);
      elapsed += step.wait;
      totalCost += step.cost;
      waitByKind[step.kind] += step.wait;
      step.elapsed = elapsed;
      step.mult = newRate / rate;
      step.rateAfter = newRate;
      rate = newRate;
      return step;
    });

    // Level of the generator that produces the most at the end (used to value Gen Cost).
    var top = 0;
    gens.forEach(function (g, i) { if (g.gain * g.level > gens[top].gain * gens[top].level) top = i; });

    return {
      steps: steps,
      totalTime: elapsed,
      totalCost: totalCost,
      startRate: startProduction(p),
      finalRate: rate,
      waitByKind: waitByKind,
      startLevels: p.generators.map(function (g) { return g.level; }),
      finalLevels: gens.map(function (g) { return g.level; }),
      bankLeft: bank,
      referenceLevel: gens[top].level
    };
  }

  // Total time of an order, without building step details (used by the local improvement below).
  function candyTime(p, order) {
    var levels = p.generators.map(function (g) { return g.level; });
    var prices = p.generators.map(function (g) { return g.price; });
    var gains = p.generators.map(function (g) { return g.level >= 1 ? g.cps / g.level : g.cps; });
    var production = startProduction(p);
    var rate = production;
    var bank = p.bank;
    var elapsed = 0;
    var boostBought = 0;
    var speedBought = 0;
    for (var t = 0; t < order.length; t++) {
      var id = order[t];
      var cost;
      if (id === 'boost') {
        cost = p.boost.price * Math.pow(p.boost.growth, boostBought);
        boostBought += 1;
      } else if (id === 'speed') {
        cost = p.speed.price * Math.pow(p.speed.growth, speedBought);
        speedBought += 1;
      } else {
        var i = Number(id.slice(3)) - 1;
        if (levels[i] === 0) {
          cost = p.generators[i].unlockCost;
        } else {
          cost = prices[i];
          prices[i] *= generatorGrowth(p, levels[i]);
        }
        levels[i] += 1;
        production += gains[i];
      }
      elapsed += Math.max(0, cost - bank) / rate;
      bank = Math.max(0, bank - cost);
      rate = production * Math.pow(p.boost.mult, boostBought) * Math.pow(p.speed.mult, speedBought);
    }
    return elapsed;
  }

  var MOVE_WINDOW = 4;
  var MAX_PASSES = 20;

  function tryOrder(p, state, candidate) {
    var t = candyTime(p, candidate);
    if (t >= state.time * (1 - 1e-12)) return false;
    state.order = candidate;
    state.time = t;
    return true;
  }

  /*
   * Local improvement of a purchase order: drop or add one generator purchase, or move one purchase
   * a few places, whenever that finishes the board sooner. Covers what a single merged generator
   * sequence cannot express (e.g. one level less of one generator, one more of another near the end).
   */
  function polishCandy(p, order) {
    var genIds = [];
    p.generators.forEach(function (g, i) { if (g.level >= 1 || isPlannedUnlock(g)) genIds.push('gen' + (i + 1)); });
    var state = { order: order, time: candyTime(p, order) };
    for (var pass = 0; pass < MAX_PASSES; pass++) {
      var improved = false;
      for (var i = state.order.length - 1; i >= 0; i--) {
        var id = state.order[i];
        if (id === 'boost' || id === 'speed') continue;
        improved = tryOrder(p, state, state.order.slice(0, i).concat(state.order.slice(i + 1))) || improved;
      }
      for (var g = 0; g < genIds.length; g++) {
        for (var j = 0; j < state.order.length; j++) {
          improved = tryOrder(p, state, state.order.slice(0, j).concat([genIds[g]], state.order.slice(j))) || improved;
        }
      }
      for (i = 0; i < state.order.length; i++) {
        for (j = Math.max(0, i - MOVE_WINDOW); j <= Math.min(state.order.length - 1, i + MOVE_WINDOW); j++) {
          if (j === i || state.order[i] === state.order[j]) continue;
          var moved = state.order.slice();
          moved.splice(j, 0, moved.splice(i, 1)[0]);
          improved = tryOrder(p, state, moved) || improved;
        }
      }
      if (!improved) break;
    }
    return state.order;
  }

  function optimizeCandy(p) {
    var check = validateCandy(p);
    if (check.problems.length) return { problems: check.problems, notes: check.notes };
    var production = startProduction(p);
    var boardCost = sum(geometricCosts(p.boost.price, p.boost.growth, p.boost.max - p.boost.level)) +
      sum(geometricCosts(p.speed.price, p.speed.growth, p.speed.max - p.speed.level));

    // A generator block pays off only while cost × (P + gain) / gain is below what is left to buy
    // after it (≤ the whole board cost). 4× margin; widened if the optimum uses the whole sequence.
    var sequence = generatorSequence(p, STEP_CAP, 4 * boardCost);
    var found = solveCandy(p, sequence, production);
    while (found.generatorSteps === sequence.length && sequence.length < STEP_CAP) {
      sequence = generatorSequence(p, Math.min(STEP_CAP, Math.max(1, sequence.length) * 2), Infinity);
      found = solveCandy(p, sequence, production);
    }

    var result = simulateCandy(p, polishCandy(p, found.order));
    result.problems = [];
    result.notes = check.notes;
    result.capped = found.generatorSteps === STEP_CAP;
    return result;
  }

  // ---------- Spider board ----------

  var SPIDER_UPGRADES = ['ccBoost', 'spiderBoost', 'genCost'];
  var SPIDER_UNLOCKS = ['gen4', 'gen5'];

  /*
   * How much one purchase multiplies Spider income, with Spiders ∝ (CC per run)^exponent:
   * CC Boost ×m to CC; Spiders Boost ×m to Spiders directly; Gen Cost ÷m on generator prices
   * = log(m)/log(price growth at level L) extra levels for every generator, i.e. ×(1 + that / L)
   * to CC; a generator unlock multiplies CC by its effect.
   */
  function spiderFactor(p, id) {
    if (id === 'ccBoost') return Math.pow(p.ccBoost.mult, p.exponent);
    if (id === 'spiderBoost') return p.spiderBoost.mult;
    if (id === 'genCost') {
      var extraLevels = Math.log(p.genCost.mult) / Math.log(generatorGrowth(p, p.genLevelRef));
      return Math.pow(1 + extraLevels / p.genLevelRef, p.exponent);
    }
    return Math.pow(p[id].effect, p.exponent);
  }

  function spiderRate(p) {
    return p.perReset / (p.runMinutes * 60);
  }

  function validateSpiders(p) {
    var problems = [];
    if (!(p.bank >= 0)) problems.push('Spiders сейчас: введи число ≥ 0');
    if (!(p.perReset > 0)) problems.push('+Spiders за ресет пока 0: план появится, когда за забег соберётся 1M CC (вкладка Candy Corn)');
    if (!(p.runMinutes > 0)) problems.push('Длина забега: введи число минут больше 0');
    if (!(p.exponent >= 0) || !isFinite(p.exponent)) problems.push('Степень k: введи число ≥ 0');
    checkLeveledUpgrade(p.ccBoost, 'CC Boost', problems);
    checkLeveledUpgrade(p.spiderBoost, 'Spiders Boost', problems);
    checkLeveledUpgrade(p.genCost, 'Gen Cost', problems);
    checkGeneratorGrowth(p, problems);
    if (!(p.genLevelRef >= 1)) problems.push('Уровень генераторов к концу забега должен быть ≥ 1');
    SPIDER_UNLOCKS.forEach(function (id) {
      var name = id === 'gen4' ? 'Generator 4' : 'Generator 5';
      if (!p[id].planned) return;
      if (!(p[id].cost > 0)) problems.push(name + ': цена открытия должна быть > 0');
      if (!(p[id].effect >= 1)) problems.push(name + ': эффект на CC/s должен быть ≥ 1 (1 = неизвестно)');
    });
    return problems;
  }

  // Replays an order ('ccBoost', 'spiderBoost', 'genCost', 'gen4', 'gen5') and returns every step.
  function simulateSpiders(p, order) {
    var bought = { ccBoost: 0, spiderBoost: 0, genCost: 0, gen4: 0, gen5: 0 };
    var waitById = { ccBoost: 0, spiderBoost: 0, genCost: 0, gen4: 0, gen5: 0 };
    var startRate = spiderRate(p);
    var rate = startRate;
    var bank = p.bank;
    var elapsed = 0;
    var totalCost = 0;

    var steps = order.map(function (id) {
      var step = { id: id, factor: spiderFactor(p, id) };
      if (SPIDER_UPGRADES.indexOf(id) >= 0) {
        var u = p[id];
        step.from = u.level + bought[id];
        step.cost = u.price * Math.pow(u.growth, bought[id]);
        step.effect = u.mult;
      } else {
        step.from = 0;
        step.unlock = true;
        step.cost = p[id].cost;
        step.effect = p[id].effect;
      }
      bought[id] += 1;
      step.to = step.from + 1;
      step.wait = Math.max(0, step.cost - bank) / rate;
      bank = Math.max(0, bank - step.cost);
      elapsed += step.wait;
      totalCost += step.cost;
      waitById[id] += step.wait;
      rate = startRate * Object.keys(bought).reduce(function (f, key) {
        return f * Math.pow(spiderFactor(p, key), bought[key]);
      }, 1);
      step.elapsed = elapsed;
      step.perResetAfter = p.perReset * rate / startRate;
      return step;
    });

    return {
      steps: steps,
      totalTime: elapsed,
      totalCost: totalCost,
      runSeconds: p.runMinutes * 60,
      startPerReset: p.perReset,
      finalPerReset: p.perReset * rate / startRate,
      waitById: waitById
    };
  }

  function optimizeSpiders(p) {
    var problems = validateSpiders(p);
    if (problems.length) return { problems: problems };
    var ids = SPIDER_UPGRADES.concat(SPIDER_UNLOCKS.filter(function (id) { return p[id].planned; }));
    var chains = ids.map(function (id) {
      if (SPIDER_UPGRADES.indexOf(id) < 0) {
        return { costs: Float64Array.of(p[id].cost), factors: Float64Array.of(1, spiderFactor(p, id)), required: true };
      }
      var u = p[id];
      var count = u.max - u.level;
      return { costs: geometricCosts(u.price, u.growth, count), factors: constantFactors(spiderFactor(p, id), count), required: true };
    });
    var found = fastestOrder(chains, p.bank, spiderRate(p));
    var result = simulateSpiders(p, found.order.map(function (d) { return ids[d]; }));
    result.problems = [];
    return result;
  }

  /*
   * Spiders for a reset: ⌊ multiplier × (Candy Corn collected this run / 1M)^exponent ⌋.
   * Fitted to in-game readings: exponent 0.449, multiplier = Spiders Boost (×1.2 per level);
   * e.g. 236.8M with ×1.2 → 13, 246.8M → 14, 140.1M → 11. First Spider at 1M.
   */
  function spidersForRun(collected, multiplier, exponent) {
    if (!(collected >= 1e6)) return 0;
    return Math.floor(multiplier * Math.pow(collected / 1e6, exponent) + 1e-9);
  }

  // ---------- reset timing ----------

  // Generator purchases simulated after the board is maxed (more than enough to pass the best reset).
  var EXTRA_GENERATOR_STEPS = 600;
  // Generator purchases shown after the board at least, even when resetting right after it is better.
  var MIN_AFTER_BOARD = 25;

  function resetBoardUpgrade(u) {
    return Object.assign({}, u, { level: 0, price: u.level > 0 ? u.price / Math.pow(u.growth, u.level) : u.price });
  }

  /*
   * The Candy Corn side right after a reset: board at level 0 with the first prices; generators at
   * level 1 with level-1 prices and CC/s without Gain/Speed; Gen 2–3 (bought with Candy Corn) locked
   * again with their after-unlock stats; nothing on hand. Spider upgrades and Gen 4–5 stay.
   */
  function resetCandyParams(p) {
    var boardFactor = Math.pow(p.boost.mult, p.boost.level) * Math.pow(p.speed.mult, p.speed.level);
    return Object.assign({}, p, {
      bank: 0,
      curseSpent: 0,
      boost: resetBoardUpgrade(p.boost),
      speed: resetBoardUpgrade(p.speed),
      generators: p.generators.map(function (g) {
        if (!(g.level >= 1)) return Object.assign({}, g, { cps: g.cps / boardFactor });
        return Object.assign({}, g, {
          level: g.candyUnlock ? 0 : 1,
          price: generatorStartPrice(p, g.level, g.price),
          cps: g.cps / g.level / boardFactor
        });
      })
    });
  }

  /*
   * Production over time if the run follows `order` and then keeps buying generators (the block with
   * the smallest key, each as soon as affordable). Spending never lowers the Candy Corn collected,
   * so buying as early as possible is what brings Spiders soonest.
   * Returns { events, tail }: rate changes [{ time, rate }] (each holds until the next entry, the last
   * one forever; events[i + 1] follows the i-th purchase) and the generator ids bought after `order`.
   */
  function candyTimeline(p, order, extraSteps) {
    var gens = p.generators.map(function (g, index) {
      var open = g.level >= 1;
      return {
        id: 'gen' + (index + 1), usable: open || isPlannedUnlock(g), locked: !open, level: g.level,
        gain: open ? g.cps / g.level : g.cps, price: g.price, unlockCost: g.unlockCost
      };
    });
    var tail = [];
    var production = startProduction(p);
    var boostBought = 0;
    var speedBought = 0;
    var bank = p.bank;
    var time = 0;
    var events = [{ time: 0, rate: production }];

    function buy(cost) {
      time += Math.max(0, cost - bank) / events[events.length - 1].rate;
      bank = Math.max(0, bank - cost);
    }
    function buyGenerator(g) {
      buy(g.locked ? g.unlockCost : g.price);
      if (g.locked) g.locked = false;
      else g.price *= generatorGrowth(p, g.level);
      g.level += 1;
      production += g.gain;
    }
    function record() {
      events.push({ time: time, rate: production * Math.pow(p.boost.mult, boostBought) * Math.pow(p.speed.mult, speedBought) });
    }

    order.forEach(function (id) {
      if (id === 'boost') {
        buy(p.boost.price * Math.pow(p.boost.growth, boostBought));
        boostBought += 1;
      } else if (id === 'speed') {
        buy(p.speed.price * Math.pow(p.speed.growth, speedBought));
        speedBought += 1;
      } else {
        buyGenerator(gens[Number(id.slice(3)) - 1]);
      }
      record();
    });
    for (var n = 0; n < extraSteps; n++) {
      var pick = null;
      for (var i = 0; i < gens.length; i++) {
        if (!gens[i].usable) continue;
        var key = nextBlock(gens[i], p, production).key;
        if (!pick || key < pick.key) pick = { gen: gens[i], key: key };
      }
      if (!pick) break;
      buyGenerator(pick.gen);
      tail.push(pick.gen.id);
      record();
    }
    return { events: events, tail: tail };
  }

  /*
   * When Spiders reach fromSpiders+1, +2, ... along a timeline that starts with `collected` Candy Corn
   * already collected. Stops at the last simulated purchase (after it production no longer grows).
   */
  function spiderMilestones(events, collected, fromSpiders, multiplier, exponent) {
    var out = [];
    var i = 0;
    var atEvent = collected;
    var lastTime = events[events.length - 1].time;
    for (var n = fromSpiders + 1; n <= fromSpiders + STEP_CAP; n++) {
      var target = 1e6 * Math.pow(n / multiplier, 1 / exponent);
      while (i < events.length - 1) {
        var next = atEvent + events[i].rate * (events[i + 1].time - events[i].time);
        if (next >= target) break;
        atEvent = next;
        i += 1;
      }
      var time = events[i].time + (target - atEvent) / events[i].rate;
      if (time > lastTime && out.length > 0) break;
      out.push({ spiders: n, time: time, collected: target });
    }
    return out;
  }

  /*
   * When to reset. A fresh run (from the reset state, following its own optimal board plan) gives
   * the most Spiders per second when reset at `bestRun`. Continuing the current run to milestone m
   * is worth it while (m − Spiders now) − bestRate × time to m > 0; the best m is the target.
   * No positive m left → reset now. Returns null when either run cannot be planned.
   */
  function resetAdvice(p, currentPlan, multiplier, exponent) {
    if (!currentPlan || currentPlan.problems.length || !(multiplier > 0) || !(exponent > 0)) return null;
    var fresh = resetCandyParams(p);
    var freshPlan = optimizeCandy(fresh);
    if (freshPlan.problems.length) return null;
    var freshLine = candyTimeline(fresh, freshPlan.steps.map(stepId), EXTRA_GENERATOR_STEPS);
    var bestRun = null;
    spiderMilestones(freshLine.events, 0, 0, multiplier, exponent).forEach(function (m) {
      if (!bestRun || m.spiders / m.time > bestRun.rate) {
        bestRun = { spiders: m.spiders, time: m.time, collected: m.collected, rate: m.spiders / m.time };
      }
    });
    if (!bestRun) return null;

    var collectedNow = candyRunTotal(p);
    var spidersNow = spidersForRun(collectedNow, multiplier, exponent);
    var board = currentPlan.steps.map(stepId);
    var line = candyTimeline(p, board, EXTRA_GENERATOR_STEPS);
    var ahead = spiderMilestones(line.events, collectedNow, spidersNow, multiplier, exponent);
    var target = bestMilestone(ahead, spidersNow, bestRun.rate, 0);
    // If the board is finished first anyway: the best reset after it (events[i + 1] follows purchase i).
    var boardEnd = line.events[board.length].time;
    var finishTarget = target && target.time >= boardEnd ? target :
      bestMilestone(ahead.filter(function (m) { return m.time >= boardEnd; }), spidersNow, bestRun.rate, -Infinity);
    var untilFinish = finishTarget ? line.tail.filter(function (id, j) {
      return line.events[board.length + j + 1].time <= finishTarget.time;
    }).length : 0;
    var afterBoard = line.tail.slice(0, Math.max(untilFinish, MIN_AFTER_BOARD));
    return {
      spidersNow: spidersNow,
      collectedNow: collectedNow,
      bestRun: bestRun,
      target: target,
      resetNow: !target && spidersNow > 0,
      finishTarget: finishTarget,
      afterBoard: afterBoard
    };
  }

  // Milestone with the largest (Spiders gained − rate × time); null when none beats `floor`.
  function bestMilestone(milestones, spidersNow, rate, floor) {
    var best = null;
    var bestGain = floor;
    milestones.forEach(function (m) {
      var gain = (m.spiders - spidersNow) - rate * m.time;
      if (gain >= bestGain - 1e-9 * Math.max(1, m.spiders)) {
        bestGain = gain;
        best = m;
      }
    });
    return best;
  }

  function stepId(step) {
    return step.id;
  }

  var api = {
    SUFFIXES: SUFFIXES,
    parseAmount: parseAmount,
    formatAmount: formatAmount,
    formatDuration: formatDuration,
    fastestOrder: fastestOrder,
    generatorGrowth: generatorGrowth,
    generatorStartPrice: generatorStartPrice,
    generatorPriceAt: generatorPriceAt,
    candyRunTotal: candyRunTotal,
    optimizeCandy: optimizeCandy,
    simulateCandy: simulateCandy,
    optimizeSpiders: optimizeSpiders,
    simulateSpiders: simulateSpiders,
    spiderFactor: spiderFactor,
    spidersForRun: spidersForRun,
    resetCandyParams: resetCandyParams,
    candyTimeline: candyTimeline,
    spiderMilestones: spiderMilestones,
    resetAdvice: resetAdvice
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CandyCalc = api;
})(this);
