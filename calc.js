/*
 * Candy Corn board optimizer (Halloween Part 3) — pure logic, no DOM.
 * Number parsing/formatting and the fastest purchase order until the board is maxed.
 * Loads as a browser global (window.CandyCalc) or as a CommonJS module (tests).
 */
(function (root) {
  'use strict';

  var SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
    'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg'];
  var SUFFIX_EXPONENT = {};
  SUFFIXES.forEach(function (suffix, i) { SUFFIX_EXPONENT[suffix.toLowerCase()] = i * 3; });

  // Safety net for the generator dimension of the search (only odd inputs get near it).
  var GENERATOR_LEVEL_CAP = 3000;

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

  function isWhole(n) {
    return Number.isInteger(n) && n >= 0;
  }

  function checkBoardUpgrade(u, name, problems) {
    if (!isWhole(u.max) || u.max < 1) {
      problems.push(name + ': максимум уровней — целое число ≥ 1');
      return;
    }
    if (!isWhole(u.level) || u.level > u.max) problems.push(name + ': уровень — целое число от 0 до ' + u.max);
    if (u.level < u.max && !(u.price > 0)) problems.push(name + ': цена следующего уровня должна быть > 0');
    if (!(u.mult >= 1)) problems.push(name + ': множитель за уровень должен быть ≥ 1');
    if (!(u.growth >= 1)) problems.push(name + ': рост цены должен быть ≥ 1');
  }

  function validate(p) {
    var problems = [];
    if (!(p.bank >= 0)) problems.push('Candy Corn сейчас: введи число ≥ 0');
    if (!(p.rate > 0)) problems.push('CC/s: введи число больше 0');
    checkBoardUpgrade(p.boost, 'Candy Corn Gain', problems);
    checkBoardUpgrade(p.speed, 'Generator Speed', problems);
    if (!isWhole(p.generator.level) || p.generator.level < 1) problems.push('Generator: уровень — целое число ≥ 1');
    if (!(p.generator.price > 0)) problems.push('Generator: цена следующего уровня должна быть > 0');
    if (!(p.generator.growth > 1)) problems.push('Generator: рост цены должен быть > 1');
    return problems;
  }

  // Costs of the next `count` levels and running totals (spent[n] = cost of the first n levels).
  function geometricChain(price, growth, count) {
    var costs = new Float64Array(count);
    var spent = new Float64Array(count + 1);
    for (var n = 0; n < count; n++) {
      costs[n] = price * Math.pow(growth, n);
      spent[n + 1] = spent[n] + costs[n];
    }
    return { costs: costs, spent: spent };
  }

  function powers(base, count) {
    var out = new Float64Array(count + 1);
    for (var n = 0; n <= count; n++) out[n] = Math.pow(base, n);
    return out;
  }

  // CC/s after buying `boost`, `speed` and `generator` levels from the starting state.
  function rateAfter(p, boostPower, speedPower, generatorBought) {
    return p.rate * boostPower * speedPower * (p.generator.level + generatorBought) / p.generator.level;
  }

  // Purchases happen as soon as they are affordable, so the bank is max(0, start bank - spent).
  function waitTime(startBank, spentBefore, cost, rate) {
    return Math.max(0, cost - Math.max(0, startBank - spentBefore)) / rate;
  }

  /*
   * Exact search over states (boost levels bought, speed levels bought, generator levels bought).
   * The bank and the rate depend only on the state, so the fastest way to reach each state
   * is the fastest way to reach one of its three predecessors plus one more purchase.
   */
  function searchOrder(p, generatorLimit) {
    var A = geometricChain(p.boost.price, p.boost.growth, p.boost.max - p.boost.level);
    var B = geometricChain(p.speed.price, p.speed.growth, p.speed.max - p.speed.level);
    var G = geometricChain(p.generator.price, p.generator.growth, generatorLimit);
    var nA = A.costs.length;
    var nB = B.costs.length;
    var strideJ = generatorLimit + 1;
    var strideI = (nB + 1) * strideJ;
    var time = new Float64Array((nA + 1) * strideI).fill(Infinity);
    var via = new Uint8Array(time.length);
    var boostPow = powers(p.boost.mult, nA);
    var speedPow = powers(p.speed.mult, nB);
    time[0] = 0;

    for (var i = 0; i <= nA; i++) {
      for (var j = 0; j <= nB; j++) {
        for (var k = 0; k <= generatorLimit; k++) {
          var id = i * strideI + j * strideJ + k;
          if (id === 0) continue;
          var best = Infinity;
          var move = 0;
          var t;
          if (i > 0) {
            t = time[id - strideI] + waitTime(p.bank, A.spent[i - 1] + B.spent[j] + G.spent[k],
              A.costs[i - 1], rateAfter(p, boostPow[i - 1], speedPow[j], k));
            if (t < best) { best = t; move = 1; }
          }
          if (j > 0) {
            t = time[id - strideJ] + waitTime(p.bank, A.spent[i] + B.spent[j - 1] + G.spent[k],
              B.costs[j - 1], rateAfter(p, boostPow[i], speedPow[j - 1], k));
            if (t < best) { best = t; move = 2; }
          }
          if (k > 0) {
            t = time[id - 1] + waitTime(p.bank, A.spent[i] + B.spent[j] + G.spent[k - 1],
              G.costs[k - 1], rateAfter(p, boostPow[i], speedPow[j], k - 1));
            if (t < best) { best = t; move = 3; }
          }
          time[id] = best;
          via[id] = move;
        }
      }
    }

    // Board maxed with k generator levels; prefer fewer generator levels on (near) ties.
    var end = nA * strideI + nB * strideJ;
    var bestK = 0;
    for (var g = 1; g <= generatorLimit; g++) {
      if (time[end + g] < time[end + bestK] * (1 - 1e-12)) bestK = g;
    }

    var order = [];
    var cur = end + bestK;
    while (cur !== 0 && via[cur] !== 0) {
      if (via[cur] === 1) { order.push('boost'); cur -= strideI; }
      else if (via[cur] === 2) { order.push('speed'); cur -= strideJ; }
      else { order.push('generator'); cur -= 1; }
    }
    order.reverse();
    return { order: order, generatorBought: bestK };
  }

  /*
   * A generator level (cost c, level lv, multiplier 1 + 1/lv) only pays off when
   * c * (lv + 1) is below what is still left to buy after it, so it never pays off
   * above the whole remaining board cost. 4x margin; optimize() widens the limit if it is hit.
   */
  function remainingCost(u) {
    var spent = geometricChain(u.price, u.growth, u.max - u.level).spent;
    return spent[spent.length - 1];
  }

  function initialGeneratorLimit(p) {
    var boardCost = remainingCost(p.boost) + remainingCost(p.speed);
    var k = 0;
    while (k < GENERATOR_LEVEL_CAP &&
      p.generator.price * Math.pow(p.generator.growth, k) * (p.generator.level + k + 1) <= 4 * boardCost) {
      k++;
    }
    return Math.max(k, 1);
  }

  // Replays an order of purchases and returns every step with costs and timings.
  function simulate(p, order) {
    var bought = { boost: 0, speed: 0, generator: 0 };
    var waitById = { boost: 0, speed: 0, generator: 0 };
    var bank = p.bank;
    var rate = p.rate;
    var elapsed = 0;
    var totalCost = 0;
    var steps = order.map(function (id) {
      var u = p[id];
      var level = u.level + bought[id];
      var cost = u.price * Math.pow(u.growth, bought[id]);
      var mult = id === 'generator' ? (level + 1) / level : u.mult;
      var wait = Math.max(0, cost - bank) / rate;
      bank = Math.max(0, bank - cost);
      elapsed += wait;
      totalCost += cost;
      waitById[id] += wait;
      bought[id] += 1;
      rate = rateAfter(p, Math.pow(p.boost.mult, bought.boost), Math.pow(p.speed.mult, bought.speed), bought.generator);
      return { id: id, from: level, to: level + 1, cost: cost, mult: mult, wait: wait, elapsed: elapsed, rateAfter: rate };
    });
    return {
      steps: steps,
      totalTime: elapsed,
      totalCost: totalCost,
      finalRate: rate,
      waitById: waitById,
      generatorFrom: p.generator.level,
      generatorTo: p.generator.level + bought.generator
    };
  }

  function optimize(p) {
    var problems = validate(p);
    if (problems.length) return { problems: problems };
    var limit = initialGeneratorLimit(p);
    var found = searchOrder(p, limit);
    while (found.generatorBought === limit && limit < GENERATOR_LEVEL_CAP) {
      limit = Math.min(GENERATOR_LEVEL_CAP, limit * 2);
      found = searchOrder(p, limit);
    }
    var result = simulate(p, found.order);
    result.problems = [];
    result.capped = found.generatorBought === GENERATOR_LEVEL_CAP;
    return result;
  }

  var api = {
    SUFFIXES: SUFFIXES,
    parseAmount: parseAmount,
    formatAmount: formatAmount,
    formatDuration: formatDuration,
    validate: validate,
    simulate: simulate,
    optimize: optimize
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CandyCalc = api;
})(this);
