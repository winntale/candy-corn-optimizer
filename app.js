/* UI for the Candy Corn & Spider board optimizer: reads inputs, renders both plans, keeps state in the browser. */
(function () {
  'use strict';

  var calc = window.CandyCalc;
  var fmt = calc.formatAmount;
  var dur = calc.formatDuration;
  var STORAGE_KEY = 'candy-corn-board-v1';
  var GEN_NUMBERS = [1, 2, 3, 4, 5];
  var SPIDER_GROWTH_PLACEHOLDER = '1.5';

  var DEFAULTS = {
    activeTab: 'candy',
    // Candy Corn
    bank: '0',
    curseSpent: '0',
    boostLevel: '0',
    boostPrice: '50',
    speedLevel: '0',
    speedPrice: '200',
    gen1Level: '1',
    gen1Price: '10',
    gen1Cps: '1',
    gen2Level: '0',
    gen2Price: '2K',
    gen2Cps: '10',
    gen3Level: '0',
    gen3Price: '',
    gen3Cps: '',
    gen4Level: '0',
    gen4Price: '',
    gen4Cps: '',
    gen5Level: '0',
    gen5Price: '',
    gen5Cps: '',
    boostMult: '1.25',
    boostGrowth: '2',
    boostMax: '25',
    speedMult: '1.1',
    speedGrowth: '2.5',
    speedMax: '20',
    genGrowthBase: '1.25',
    genGrowthStep: '0.005',
    gen2Unlock: '100K',
    gen3Unlock: '25B',
    group: true,
    farmTarget: '',
    // Spiders
    spBank: '0',
    spRunMinutes: '15',
    spExp: '0.45',
    ccbLevel: '0',
    ccbPrice: '1',
    ccbGrowth: SPIDER_GROWTH_PLACEHOLDER,
    ccbMult: '1.35',
    ccbMax: '50',
    sbLevel: '0',
    sbPrice: '5',
    sbGrowth: SPIDER_GROWTH_PLACEHOLDER,
    sbMult: '1.2',
    sbMax: '30',
    gcLevel: '0',
    gcPrice: '20',
    gcGrowth: SPIDER_GROWTH_PLACEHOLDER,
    gcMult: '1.3',
    gcMax: '15',
    spGenLevel: '',
    gen4Plan: true,
    gen4Cost: '75K',
    gen4Effect: '1',
    gen5Plan: true,
    gen5Cost: '100M',
    gen5Effect: '1',
    spGroup: true
  };

  // Fields that may stay empty without being marked red.
  var OPTIONAL = {
    farmTarget: true, spGenLevel: true, curseSpent: true,
    gen2Price: true, gen2Cps: true, gen3Price: true, gen3Cps: true,
    gen4Price: true, gen4Cps: true, gen5Price: true, gen5Cps: true
  };

  var CANDY_VIEW = {
    name: function (id) {
      if (id === 'boost') return 'Candy Corn Gain';
      if (id === 'speed') return 'Generator Speed';
      return 'Generator ' + id.slice(3);
    },
    short: function (id) {
      if (id === 'boost') return 'CC Gain';
      if (id === 'speed') return 'Gen Speed';
      return 'Gen ' + id.slice(3);
    },
    color: function (id) { return id === 'boost' || id === 'speed' ? id : 'gen'; }
  };

  var SPIDER_NAMES = { ccBoost: 'CC Boost', spiderBoost: 'Spiders Boost', genCost: 'Gen Cost', gen4: 'Generator 4', gen5: 'Generator 5' };
  var SPIDER_SHORT = { ccBoost: 'CC Boost', spiderBoost: 'Sp. Boost', genCost: 'Gen Cost', gen4: 'Gen 4', gen5: 'Gen 5' };
  var SPIDER_COLORS = { ccBoost: 'boost', spiderBoost: 'spider', genCost: 'gen', gen4: 'unlock', gen5: 'unlock' };
  var SPIDER_VIEW = {
    name: function (id) { return SPIDER_NAMES[id]; },
    short: function (id) { return SPIDER_SHORT[id]; },
    color: function (id) { return SPIDER_COLORS[id]; }
  };
  var SPIDER_FIELD_PREFIX = { ccBoost: 'ccb', spiderBoost: 'sb', genCost: 'gc' };

  var fields = {};
  document.querySelectorAll('[data-field]').forEach(function (input) { fields[input.dataset.field] = input; });
  var FIELD_KEYS = Object.keys(DEFAULTS).filter(function (key) { return fields[key]; });

  function panelParts(name) {
    var panel = document.querySelector('[data-panel="' + name + '"]');
    function role(r) { return panel.querySelector('[data-role="' + r + '"]'); }
    return {
      problems: role('problems'),
      problemList: role('problem-list'),
      output: role('output'),
      next: role('next'),
      summary: role('summary'),
      pathTitle: role('path-title'),
      path: role('path'),
      reset: role('reset')
    };
  }

  var ui = {
    candy: panelParts('candy'),
    spiders: panelParts('spiders'),
    candyTotal: document.getElementById('candy-total-rate'),
    spiderRate: document.getElementById('spider-rate'),
    spPerReset: document.getElementById('sp-per-reset'),
    farm: document.getElementById('farm-result'),
    runTotal: document.getElementById('run-total'),
    spiderMult: document.getElementById('spider-mult'),
    formulaSpiders: document.getElementById('formula-spiders'),
    prestige: document.getElementById('prestige'),
    transfer: document.getElementById('transfer'),
    transferStatus: document.getElementById('transfer-status')
  };

  var state = {
    activeTab: DEFAULTS.activeTab, candyResult: null, candySteps: [], spiderResult: null,
    formulaSpiders: NaN, lastRaw: null, advice: null
  };

  // ---------- state ----------

  function readRaw() {
    var raw = { activeTab: state.activeTab };
    FIELD_KEYS.forEach(function (key) {
      raw[key] = fields[key].type === 'checkbox' ? fields[key].checked : fields[key].value;
    });
    return raw;
  }

  function writeRaw(raw) {
    FIELD_KEYS.forEach(function (key) {
      if (fields[key].type === 'checkbox') fields[key].checked = Boolean(raw[key]);
      else fields[key].value = raw[key];
    });
    showTab(raw.activeTab);
  }

  function setField(key, value) {
    fields[key].value = value;
  }

  // v1 had one generator (genLevel/genPrice) and a separate total CC/s field (rate);
  // the Spider exponent defaulted to a guess of 0.5 before v2.2 and to 0.449 before v2.6 (now fitted: 0.45).
  function migrate(obj) {
    var copy = Object.assign({}, obj);
    if (obj.gen1Level === undefined && obj.genLevel !== undefined) {
      copy.gen1Level = obj.genLevel;
      copy.gen1Price = obj.genPrice;
      copy.gen1Cps = obj.rate;
    }
    if (obj.spExp === '0.5' || obj.spExp === '0.449') copy.spExp = DEFAULTS.spExp;
    return copy;
  }

  // Keeps only known keys with values of the expected type; null when unusable.
  function sanitize(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var source = migrate(obj);
    var raw = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      var value = source[key];
      var fallback = DEFAULTS[key];
      if (typeof fallback === 'boolean') raw[key] = typeof value === 'boolean' ? value : fallback;
      else raw[key] = typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
    });
    if (raw.activeTab !== 'candy' && raw.activeTab !== 'spiders') raw.activeTab = DEFAULTS.activeTab;
    return raw;
  }

  function save(raw) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    } catch (e) {
      // Storage can be blocked (private mode); the page works without it.
    }
  }

  function load() {
    try {
      var text = localStorage.getItem(STORAGE_KEY);
      return text ? sanitize(JSON.parse(text)) : null;
    } catch (e) {
      return null;
    }
  }

  function markInvalid(raw) {
    FIELD_KEYS.forEach(function (key) {
      if (fields[key].type === 'checkbox') return;
      var text = String(raw[key]).trim();
      var bad = text === '' ? !OPTIONAL[key] : isNaN(calc.parseAmount(text));
      fields[key].classList.toggle('invalid', bad);
    });
  }

  function num(raw, key) {
    return calc.parseAmount(raw[key]);
  }

  function leveled(raw, prefix) {
    return {
      level: num(raw, prefix + 'Level'),
      price: num(raw, prefix + 'Price'),
      max: num(raw, prefix + 'Max'),
      mult: num(raw, prefix + 'Mult'),
      growth: num(raw, prefix + 'Growth')
    };
  }

  function candyParams(raw) {
    return {
      bank: num(raw, 'bank'),
      curseSpent: num(raw, 'curseSpent'),
      genGrowthBase: num(raw, 'genGrowthBase'),
      genGrowthStep: num(raw, 'genGrowthStep'),
      boost: leveled(raw, 'boost'),
      speed: leveled(raw, 'speed'),
      generators: GEN_NUMBERS.map(function (n) {
        var unlockKey = 'gen' + n + 'Unlock';
        var candyUnlock = raw[unlockKey] !== undefined;
        return {
          level: num(raw, 'gen' + n + 'Level'),
          price: num(raw, 'gen' + n + 'Price'),
          cps: num(raw, 'gen' + n + 'Cps'),
          unlockCost: candyUnlock ? num(raw, unlockKey) : NaN,
          candyUnlock: candyUnlock
        };
      })
    };
  }

  function candyProduction(p) {
    return p.generators.reduce(function (total, g) { return g.level >= 1 && g.cps > 0 ? total + g.cps : total; }, 0);
  }

  // Generator level at the end of a run, used to value Gen Cost: typed in, or taken from the CC plan.
  function referenceLevel(raw, candyResult) {
    var text = String(raw.spGenLevel).trim();
    if (text !== '') return { level: calc.parseAmount(text), fromPlan: false };
    var fromPlan = candyResult && candyResult.problems.length === 0 && candyResult.referenceLevel >= 1;
    return { level: fromPlan ? candyResult.referenceLevel : 50, fromPlan: fromPlan };
  }

  function spiderParams(raw, candyResult) {
    return {
      bank: num(raw, 'spBank'),
      perReset: currentSpiders(raw),
      runMinutes: num(raw, 'spRunMinutes'),
      exponent: num(raw, 'spExp'),
      genGrowthBase: num(raw, 'genGrowthBase'),
      genGrowthStep: num(raw, 'genGrowthStep'),
      genLevelRef: referenceLevel(raw, candyResult).level,
      ccBoost: leveled(raw, 'ccb'),
      spiderBoost: leveled(raw, 'sb'),
      genCost: leveled(raw, 'gc'),
      gen4: { planned: raw.gen4Plan, cost: num(raw, 'gen4Cost'), effect: num(raw, 'gen4Effect') },
      gen5: { planned: raw.gen5Plan, cost: num(raw, 'gen5Cost'), effect: num(raw, 'gen5Effect') }
    };
  }

  // ---------- formatting ----------

  function fmtMult(m) {
    return '×' + (m >= 1000 ? fmt(m) : String(parseFloat(m.toPrecision(4))));
  }

  function plural(n, forms) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
  }

  function fact(label, value) {
    return '<div class="fact"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
  }

  function tag(view, id, short) {
    return '<span class="tag ' + view.color(id) + '">' + (short ? view.short(id) : view.name(id)) + '</span>';
  }

  function waitText(seconds) {
    return seconds > 0 ? dur(seconds) : 'хватает уже';
  }

  function levelsText(row) {
    var text = (row.unlock ? '🔒' : row.from) + ' → ' + row.to;
    return row.count > 1 ? text + ' <span class="count">(' + row.count + ' шт.)</span>' : text;
  }

  function stepLabel(view, step) {
    return view.short(step.id) + (step.unlock ? ': открыть' : ' → ' + step.to);
  }

  // ---------- shared rendering ----------

  function showProblems(parts, problems) {
    var has = problems.length > 0;
    parts.problems.hidden = !has;
    parts.output.hidden = has;
    if (has) {
      parts.problemList.replaceChildren.apply(parts.problemList, problems.map(function (text) {
        var li = document.createElement('li');
        li.textContent = text;
        return li;
      }));
    }
    return has;
  }

  function nextHeader(view, step) {
    return '<div class="next-title">' + tag(view, step.id, false) +
      '<span class="levels">' + (step.unlock ? 'открыть' : step.from + ' → ' + step.to) + '</span></div>';
  }

  function nextActions(view, steps, action) {
    var upcoming = steps.slice(1, 4).map(function (s) { return stepLabel(view, s); }).join(' · ');
    return '<div class="next-actions">' +
      '<button type="button" class="primary" data-action="' + action + '">Купил ✓</button>' +
      (upcoming ? '<span class="then">Дальше: ' + upcoming + '</span>' : '') +
      '</div>';
  }

  function timeBar(totalTime, parts) {
    if (!(totalTime > 0)) return '';
    return '<div class="bar" aria-hidden="true">' + parts.map(function (part) {
      var share = part.wait / totalTime * 100;
      return share > 0 ? '<span class="' + part.color + '" style="width:' + share.toFixed(2) + '%"></span>' : '';
    }).join('') + '</div>';
  }

  function timeLegend(parts) {
    return '<ul class="legend">' + parts.filter(function (part) { return part.count > 0; }).map(function (part) {
      return '<li><i class="dot ' + part.color + '"></i>' + part.label + ': <strong>' + dur(part.wait) + '</strong>' +
        ' · ' + part.count + ' ' + plural(part.count, ['покупка', 'покупки', 'покупок']) + '</li>';
    }).join('') + '</ul>';
  }

  function messageList(className, messages) {
    if (!messages.length) return '';
    return '<ul class="' + className + '">' + messages.map(function (m) { return '<li>' + m + '</li>'; }).join('') + '</ul>';
  }

  // Merges consecutive purchases of the same upgrade (within one segment) into one row when `merge` is on.
  function tableRows(steps, merge, segmentOf) {
    var rows = [];
    steps.forEach(function (s, index) {
      var last = rows[rows.length - 1];
      var segment = segmentOf ? segmentOf(s) : 0;
      if (merge && last && last.id === s.id && last.segment === segment) {
        last.lastIndex = index + 1;
        last.count += 1;
        last.to = s.to;
        last.cost += s.cost;
        last.wait += s.wait;
        last.elapsed = s.elapsed;
        last.mult *= s.mult || 1;
        last.factor *= s.factor || 1;
        last.rateAfter = s.rateAfter;
        return;
      }
      rows.push({
        id: s.id, firstIndex: index + 1, lastIndex: index + 1, count: 1, from: s.from, to: s.to,
        unlock: Boolean(s.unlock), cost: s.cost, wait: s.wait, elapsed: s.elapsed, firstElapsed: s.elapsed,
        mult: s.mult || 1, factor: s.factor || 1, rateAfter: s.rateAfter, afterBoard: Boolean(s.afterBoard),
        segment: segment
      });
    });
    return rows;
  }

  function dividerRow(className, html) {
    return '<tr class="divider ' + className + '"><td colspan="8">' + html + '</td></tr>';
  }

  /*
   * `decor` (optional): { markers: [{ time, html }] — rows inserted before the first purchase made
   * after `time` (sorted by time); fadeAfter — purchases after this time are drawn faded;
   * boardEnd — time of the last board purchase, before the "board closed" divider }.
   */
  function renderPath(parts, steps, merge, cells, decor) {
    var n = steps.length;
    parts.pathTitle.textContent = 'Полный путь (' + n + ' ' + plural(n, ['шаг', 'шага', 'шагов']) + ')';
    var markers = decor ? decor.markers : [];
    if (!n) {
      parts.path.innerHTML = markers.map(function (m) { return dividerRow('reset', m.html); }).join('') ||
        '<tr><td colspan="8" class="muted">Покупать больше нечего.</td></tr>';
      return;
    }
    var placed = 0;
    function markersBefore(time) {
      var html = '';
      while (placed < markers.length && markers[placed].time < time) {
        html += dividerRow('reset', markers[placed].html);
        placed += 1;
      }
      return html;
    }
    function segmentOf(step) {
      var passed = markers.filter(function (m) { return step.elapsed > m.time; }).length;
      return passed * 2 + (step.afterBoard ? 1 : 0);
    }
    var rows = tableRows(steps, merge, decor ? segmentOf : null);
    parts.path.innerHTML = rows.map(function (r, i) {
      var before = '';
      if (r.afterBoard && !(rows[i - 1] && rows[i - 1].afterBoard)) {
        before += markersBefore(decor.boardEnd) + dividerRow('board', 'Борд закрыт · дальше генераторы');
      }
      before += markersBefore(r.firstElapsed);
      var classes = [];
      if (r.firstIndex === 1) classes.push('current');
      if (decor && r.firstElapsed > decor.fadeAfter) classes.push('after-reset');
      var index = r.count > 1 ? r.firstIndex + '–' + r.lastIndex : String(r.firstIndex);
      return before + '<tr' + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + '>' +
        '<td class="num muted">' + index + '</td>' +
        cells(r).map(function (cell) { return '<td' + (cell.num ? ' class="num"' : '') + '>' + cell.html + '</td>'; }).join('') +
        '</tr>';
    }).join('') + markersBefore(Infinity);
  }

  // ---------- Candy Corn tab ----------

  function spiderMultiplier(raw) {
    return Math.pow(num(raw, 'sbMult'), num(raw, 'sbLevel'));
  }

  function renderReset(advice) {
    var box = ui.candy.reset;
    if (!advice) {
      box.innerHTML = '<p class="muted">Нужны корректные поля на вкладке Candy Corn и степень k на вкладке Spiders.</p>';
      return;
    }
    var best = advice.bestRun;
    var verdict;
    if (advice.resetNow) {
      verdict = '<p class="reset-verdict ready">🕷 Пора ресет: +' + advice.spidersNow + ' Spiders</p>' +
        '<p class="muted">Дальше этот забег приносит Spiders медленнее, чем новый забег с нуля.</p>';
    } else if (advice.target) {
      verdict = '<p class="reset-verdict">Ресет при <strong>+' + advice.target.spiders + '</strong> Spiders — через <strong>' +
        dur(advice.target.time) + '</strong></p>' +
        '<p class="muted">Нужно собрать ' + fmt(advice.target.collected) + ' CC за забег (сейчас ' + fmt(advice.collectedNow) + ').</p>';
    } else {
      verdict = '<p class="reset-verdict">Пока рано: Spiders ещё нет.</p>';
    }
    box.innerHTML = verdict +
      '<dl class="facts">' +
        fact('Сейчас', '+' + advice.spidersNow + ' Spiders') +
        fact('Лучший забег с нуля', '+' + best.spiders + ' за ' + dur(best.time)) +
        fact('Темп', fmt(best.rate * 3600) + ' Spiders/ч') +
      '</dl>';
  }

  // Spiders by the formula if you reset now and after the last board purchase of the plan.
  function spidersText(p, result, raw) {
    var collected = calc.candyRunTotal(p);
    var atEnd = collected - p.bank + result.totalCost - result.unlockCost + result.bankLeft;
    var mult = spiderMultiplier(raw);
    var k = num(raw, 'spExp');
    var now = calc.spidersForRun(collected, mult, k);
    var end = calc.spidersForRun(atEnd, mult, k);
    if (!(now >= 0) || !(end >= 0)) return '—';
    return '+' + now + (end !== now ? ' <span class="muted">→ +' + end + ' в конце</span>' : '');
  }

  // Board plan followed by the generators to buy after it (from the reset advice), flagged afterBoard.
  function candySteps(p, result, advice) {
    if (result.problems.length) return [];
    if (!advice || !advice.afterBoard.length) return result.steps;
    var order = result.steps.map(function (s) { return s.id; }).concat(advice.afterBoard);
    return calc.simulateCandy(p, order).steps.map(function (s, i) {
      s.afterBoard = i >= result.steps.length;
      return s;
    });
  }

  // Reset rows for the path table and which purchases come after the recommended reset.
  function candyDecor(result, steps, advice) {
    if (!advice) return null;
    var boardEnd = result.steps.length ? result.steps[result.steps.length - 1].elapsed : -1;
    var markers = [];
    if (advice.resetNow) {
      markers.push({ time: -1, html: '🕷 Пора ресет: +' + advice.spidersNow + ' Spiders' });
    } else if (advice.target) {
      markers.push({ time: advice.target.time, html: '🕷 Лучший момент для ресета: +' + advice.target.spiders + ' Spiders' });
    }
    var finish = advice.finishTarget;
    if (finish && finish !== advice.target && result.steps.length) {
      markers.push({ time: finish.time, html: '🕷 Если сначала закрыть борд — ресет при +' + finish.spiders + ' Spiders' });
    }
    markers.sort(function (a, b) { return a.time - b.time; });
    return { markers: markers, fadeAfter: markers.length ? markers[0].time : Infinity, boardEnd: boardEnd };
  }

  function renderCandy(result, p, raw) {
    var production = candyProduction(p);
    ui.candyTotal.textContent = production > 0 ? fmt(production) + '/с' : '—';
    var parts = ui.candy;
    if (showProblems(parts, result.problems)) return;
    var steps = state.candySteps;

    if (!steps.length) {
      parts.next.innerHTML = '<p class="done">🎉 Борд закрыт: Candy Corn Gain и Generator Speed на максимуме. Дальше — ресет.</p>';
    } else {
      var s = steps[0];
      parts.next.innerHTML = (s.afterBoard ? '<p class="muted next-note">Борд закрыт — дальше генераторы.</p>' : '') +
        nextHeader(CANDY_VIEW, s) +
        '<dl class="facts">' +
          fact('Цена', fmt(s.cost)) +
          fact('Ждать', waitText(s.wait)) +
          fact('Множитель CC/s', fmtMult(s.mult)) +
          fact('CC/s после', fmt(s.rateAfter)) +
        '</dl>' +
        nextActions(CANDY_VIEW, steps, 'buy-candy');
    }

    var counts = { boost: 0, speed: 0, gen: 0 };
    result.steps.forEach(function (step) { counts[step.kind] += 1; });
    var generators = GEN_NUMBERS.filter(function (n) { return result.finalLevels[n - 1] > 0; }).map(function (n) {
      var from = result.startLevels[n - 1];
      var to = result.finalLevels[n - 1];
      return '<span><i class="dot gen"></i>Gen ' + n + ': ' + (from === 0 ? '🔒' : from) + (to !== from ? ' → ' + to : '') + '</span>';
    }).join('');
    var timeParts = [
      { color: 'boost', label: 'CC Gain', wait: result.waitByKind.boost, count: counts.boost },
      { color: 'speed', label: 'Gen Speed', wait: result.waitByKind.speed, count: counts.speed },
      { color: 'gen', label: 'Генераторы', wait: result.waitByKind.gen, count: counts.gen }
    ];
    var warnings = result.capped ? ['Генераторы упёрлись в предел поиска (3000 покупок) — проверь цены и рост цены генераторов.'] : [];

    parts.summary.innerHTML =
      '<dl class="facts">' +
        fact('Время до конца', dur(result.totalTime)) +
        fact('Покупок', String(result.steps.length)) +
        fact('CC/s в конце', fmt(result.finalRate) + ' <span class="muted">' + fmtMult(result.finalRate / result.startRate) + '</span>') +
        fact('Потрачено всего', fmt(result.totalCost)) +
        fact('Spiders за ресет', spidersText(p, result, raw)) +
        (steps.length > result.steps.length
          ? fact('После борда', '+' + (steps.length - result.steps.length) + ' покуп. генераторов в плане')
          : '') +
      '</dl>' +
      '<p class="gen-levels">' + generators + '</p>' +
      (result.steps.length ? timeBar(result.totalTime, timeParts) + timeLegend(timeParts) : '') +
      messageList('info-list', result.notes) +
      messageList('warning-list', warnings);

    renderPath(parts, steps, raw.group, function (r) {
      return [
        { html: tag(CANDY_VIEW, r.id, true) },
        { html: levelsText(r) },
        { html: fmt(r.cost), num: true },
        { html: fmtMult(r.mult), num: true },
        { html: r.wait > 0 ? dur(r.wait) : '—', num: true },
        { html: dur(r.elapsed), num: true },
        { html: fmt(r.rateAfter), num: true }
      ];
    }, candyDecor(result, steps, state.advice));
  }

  function renderFarm(raw, p) {
    var text = String(raw.farmTarget).trim();
    var target = calc.parseAmount(text);
    var rate = candyProduction(p);
    if (text === '') {
      ui.farm.textContent = 'Введи сумму — покажу, сколько фармить при текущем CC/s.';
      return;
    }
    if (isNaN(target) || !(rate > 0) || !(p.bank >= 0)) {
      ui.farm.textContent = 'Не могу посчитать: проверь сумму, Candy Corn и CC/s генераторов.';
      return;
    }
    var need = Math.max(0, target - p.bank);
    ui.farm.innerHTML = need === 0
      ? 'Уже хватает ✓'
      : 'Фармить <strong>' + dur(need / rate) + '</strong> · нужно ещё ' + fmt(need) + ' при ' + fmt(rate) + ' CC/s';
  }

  // Multiplies one field ('Cps' or 'Price') of every generator that has a value.
  function scaleGenerators(p, suffix, factor) {
    GEN_NUMBERS.forEach(function (n) {
      var value = suffix === 'Cps' ? p.generators[n - 1].cps : p.generators[n - 1].price;
      if (value > 0) setField('gen' + n + suffix, fmt(value * factor, 4));
    });
  }

  /*
   * Moves an upgrade (field prefix: boost, speed, gen1..gen5, ccb, sb, gc) from level `from` to `to`,
   * starting from the values in `base`, and keeps what depends on the level in step:
   * its next price; Gain/Speed/CC Boost — CC/s of every generator; Gen Cost — every generator price;
   * a generator's own CC/s (proportional to level). A locked generator (level 0) keeps the values
   * it has right after unlock (level 1).
   */
  function syncLevel(base, prefix, from, to) {
    var p = candyParams(base);
    var delta = to - from;
    if (prefix === 'boost' || prefix === 'speed') {
      var u = p[prefix];
      if (u.price > 0) setField(prefix + 'Price', fmt(u.price * Math.pow(u.growth, delta), 4));
      scaleGenerators(p, 'Cps', Math.pow(u.mult, delta));
    } else if (prefix.indexOf('gen') === 0) {
      var g = p.generators[Number(prefix.slice(3)) - 1];
      var startPrice = from >= 1 ? calc.generatorStartPrice(p, from, g.price) : g.price;
      var perLevel = from >= 1 ? g.cps / from : g.cps;
      if (startPrice > 0) setField(prefix + 'Price', fmt(calc.generatorPriceAt(p, startPrice, Math.max(to, 1)), 4));
      if (perLevel > 0) setField(prefix + 'Cps', fmt(perLevel * Math.max(to, 1), 4));
    } else {
      var s = leveled(base, prefix);
      if (s.price > 0) setField(prefix + 'Price', fmt(s.price * Math.pow(s.growth, delta), 4));
      if (prefix === 'ccb') scaleGenerators(p, 'Cps', Math.pow(s.mult, delta));
      if (prefix === 'gc') scaleGenerators(p, 'Price', Math.pow(s.mult, -delta));
    }
  }

  // "Купил": moves the inputs to the state right after the recommended Candy Corn purchase.
  function buyCandy() {
    var steps = state.candySteps;
    if (!steps || !steps.length) return;
    var step = steps[0];
    var raw = readRaw();
    var prefix = step.kind === 'gen' ? step.id : step.kind;
    syncLevel(raw, prefix, step.from, step.to);
    setField(prefix + 'Level', String(step.to));
    setField('bank', fmt(Math.max(0, num(raw, 'bank') - step.cost), 4));
    update();
  }

  // ---------- Spiders tab ----------

  function effectText(step) {
    if (step.id === 'ccBoost') return '×' + step.effect + ' к CC';
    if (step.id === 'spiderBoost') return '×' + step.effect + ' к Spiders';
    if (step.id === 'genCost') return '÷' + step.effect + ' цены ген.';
    return step.effect > 1 ? '×' + step.effect + ' к CC/s' : 'неизвестен';
  }

  function resetsText(seconds, runSeconds) {
    return seconds > 0 ? '≈' + fmt(seconds / runSeconds) : '—';
  }

  function renderFormula(collected, raw) {
    var mult = spiderMultiplier(raw);
    state.formulaSpiders = calc.spidersForRun(collected, mult, num(raw, 'spExp'));
    ui.runTotal.textContent = collected >= 0 ? fmt(collected) + ' CC' : '—';
    ui.spiderMult.textContent = mult > 0 ? fmtMult(mult) : '—';
    ui.formulaSpiders.textContent = state.formulaSpiders >= 0 ? '+' + state.formulaSpiders + ' Spiders' : '—';
  }

  function renderSpiders(result, p, raw) {
    ui.spPerReset.textContent = p.perReset >= 0 ? '+' + p.perReset : '—';
    ui.spiderRate.textContent = p.perReset > 0 && p.runMinutes > 0 ? fmt(p.perReset / p.runMinutes * 60) + ' Spiders/ч' : '—';
    var parts = ui.spiders;
    if (showProblems(parts, result.problems)) return;
    var runSeconds = result.runSeconds;

    if (!result.steps.length) {
      parts.next.innerHTML = '<p class="done">🎉 Spider-борд закрыт: всё куплено.</p>';
    } else {
      var s = result.steps[0];
      parts.next.innerHTML = nextHeader(SPIDER_VIEW, s) +
        '<dl class="facts">' +
          fact('Цена', fmt(s.cost) + ' Sp') +
          fact('Ждать', waitText(s.wait) + (s.wait > 0 ? ' <span class="muted">' + resetsText(s.wait, runSeconds) + ' рес.</span>' : '')) +
          fact('Эффект', effectText(s)) +
          fact('Доход Spiders', fmtMult(s.factor)) +
          fact('+Spiders/ресет после', fmt(s.perResetAfter)) +
        '</dl>' +
        nextActions(SPIDER_VIEW, result.steps, 'buy-spider');
    }

    var counts = { ccBoost: 0, spiderBoost: 0, genCost: 0, gen4: 0, gen5: 0 };
    result.steps.forEach(function (step) { counts[step.id] += 1; });
    var timeParts = ['ccBoost', 'spiderBoost', 'genCost', 'gen4', 'gen5'].map(function (id) {
      return { color: SPIDER_COLORS[id], label: SPIDER_SHORT[id], wait: result.waitById[id], count: counts[id] };
    });

    var ref = referenceLevel(raw, state.candyResult);
    var info = [
      'k = ' + p.exponent + ': CC Boost даёт ' + fmtMult(calc.spiderFactor(p, 'ccBoost')) + ' к доходу Spiders за уровень, ' +
        'Gen Cost — ' + fmtMult(calc.spiderFactor(p, 'genCost')) +
        ' (генераторы к концу забега ~' + ref.level + ' ур.' + (ref.fromPlan ? ', из CC-плана' : '') + ').'
    ];
    var warnings = [];
    if (raw.ccbGrowth === SPIDER_GROWTH_PLACEHOLDER && raw.sbGrowth === SPIDER_GROWTH_PLACEHOLDER && raw.gcGrowth === SPIDER_GROWTH_PLACEHOLDER) {
      warnings.push('Рост цен Spider-улучшений — временные ×1.5. Впиши реальные, иначе план приблизительный.');
    }
    ['gen4', 'gen5'].forEach(function (id) {
      if (p[id].planned && p[id].effect === 1) warnings.push(SPIDER_NAMES[id] + ': эффект неизвестен (×1), поэтому открытие стоит в конце.');
    });

    parts.summary.innerHTML =
      '<dl class="facts">' +
        fact('Время до конца', dur(result.totalTime) + (result.totalTime > 0 ? ' <span class="muted">' + resetsText(result.totalTime, runSeconds) + ' рес.</span>' : '')) +
        fact('Покупок', String(result.steps.length)) +
        fact('+Spiders/ресет в конце', fmt(result.finalPerReset) + ' <span class="muted">' + fmtMult(result.finalPerReset / result.startPerReset) + '</span>') +
        fact('Потрачено Spiders', fmt(result.totalCost)) +
      '</dl>' +
      (result.steps.length ? timeBar(result.totalTime, timeParts) + timeLegend(timeParts) : '') +
      messageList('info-list', info) +
      messageList('warning-list', warnings);

    renderPath(parts, result.steps, raw.spGroup, function (r) {
      return [
        { html: tag(SPIDER_VIEW, r.id, true) },
        { html: levelsText(r) },
        { html: fmt(r.cost), num: true },
        { html: fmtMult(r.factor), num: true },
        { html: r.wait > 0 ? dur(r.wait) : '—', num: true },
        { html: dur(r.elapsed), num: true },
        { html: resetsText(r.elapsed, runSeconds), num: true }
      ];
    });
  }

  // "Купил": moves the inputs to the state right after the recommended Spider purchase.
  function buySpider() {
    var result = state.spiderResult;
    if (!result || !result.steps || !result.steps.length) return;
    var step = result.steps[0];
    var raw = readRaw();
    var p = spiderParams(raw, state.candyResult);
    var prefix = SPIDER_FIELD_PREFIX[step.id];
    if (prefix) {
      syncLevel(raw, prefix, step.from, step.to);
      setField(prefix + 'Level', String(step.to));
    } else {
      fields[step.id + 'Plan'].checked = false;
    }
    setField('spBank', fmt(Math.max(0, p.bank - step.cost), 4));
    update();
  }

  // ---------- page ----------

  function showTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('[data-tab]').forEach(function (button) {
      button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    });
    document.querySelectorAll('[data-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== tab;
    });
  }

  function update() {
    var raw = readRaw();
    state.lastRaw = raw;
    markInvalid(raw);
    save(raw);
    var candy = candyParams(raw);
    state.candyResult = calc.optimizeCandy(candy);
    state.advice = calc.resetAdvice(candy, state.candyResult, spiderMultiplier(raw), num(raw, 'spExp'));
    state.candySteps = candySteps(candy, state.candyResult, state.advice);
    renderCandy(state.candyResult, candy, raw);
    renderFarm(raw, candy);
    var spiders = spiderParams(raw, state.candyResult);
    state.spiderResult = calc.optimizeSpiders(spiders);
    renderReset(state.advice);
    var gain = currentSpiders(raw);
    var ready = Boolean(state.advice && state.advice.resetNow);
    ui.prestige.classList.toggle('ready', ready);
    ui.prestige.textContent = (ready ? '🕷 Пора ресет' : '🕷 Ресет') + (gain > 0 ? ': +' + fmt(gain) + ' Spiders' : '');
    renderFormula(calc.candyRunTotal(candy), raw);
    renderSpiders(state.spiderResult, spiders, raw);
  }

  /*
   * "Ресет": back to the start of a run. Board levels to 0 and prices to the first ones (rounded to
   * 3 digits, since the game shows rounded prices and the first ones are round); generators to
   * level 1 with level-1 prices and production without Gain/Speed; Gen 2–3 (bought with Candy Corn)
   * lock again; Candy Corn on hand to 0; Spiders by the formula (or "+Spiders за ресет") are added.
   */
  function prestige() {
    var raw = readRaw();
    var p = candyParams(raw);
    var gain = currentSpiders(raw);
    if (!window.confirm('Ресет: сбросить Candy Corn борд и генераторы к началу забега' +
      (gain > 0 ? ' и получить +' + fmt(gain) + ' Spiders' : '') + '?')) return;

    var fresh = calc.resetCandyParams(p);
    ['boost', 'speed'].forEach(function (id) {
      if (fresh[id].price > 0) setField(id + 'Price', fmt(fresh[id].price, 3));
      setField(id + 'Level', '0');
    });
    GEN_NUMBERS.forEach(function (n) {
      var before = p.generators[n - 1];
      var after = fresh.generators[n - 1];
      setField('gen' + n + 'Level', String(after.level));
      if (before.level >= 1 && after.price > 0) setField('gen' + n + 'Price', fmt(after.price, 3));
      if (after.cps > 0) setField('gen' + n + 'Cps', fmt(after.cps, 4));
    });
    setField('bank', '0');
    setField('curseSpent', '0');
    if (gain > 0) setField('spBank', fmt(num(raw, 'spBank') + gain, 4));
    update();
    setTransferStatus('');
  }

  // Spiders a reset gives now, by the formula from the Candy Corn tab (NaN when it cannot be computed).
  function currentSpiders(raw) {
    return calc.spidersForRun(calc.candyRunTotal(candyParams(raw)), spiderMultiplier(raw), num(raw, 'spExp'));
  }

  function setTransferStatus(text) {
    ui.transferStatus.textContent = text;
  }

  function exportState() {
    var text = JSON.stringify(readRaw());
    ui.transfer.value = text;
    ui.transfer.select();
    if (!navigator.clipboard) {
      setTransferStatus('Строка в поле выше — скопируй её.');
      return;
    }
    navigator.clipboard.writeText(text).then(
      function () { setTransferStatus('Скопировано в буфер обмена ✓'); },
      function () { setTransferStatus('Строка в поле выше — скопируй её.'); }
    );
  }

  function importState() {
    var raw = null;
    try {
      raw = sanitize(JSON.parse(ui.transfer.value));
    } catch (e) {
      raw = null;
    }
    if (!raw) {
      setTransferStatus('Не получилось прочитать строку. Вставь строку из «Экспорт».');
      return;
    }
    writeRaw(raw);
    update();
    setTransferStatus('Загружено ✓');
  }

  function resetState() {
    writeRaw(DEFAULTS);
    update();
    setTransferStatus('Сброшено к значениям по умолчанию.');
  }

  /*
   * Manual level edits: dependents are recomputed from the values the page had before the first
   * keystroke in that field, so typing "42" digit by digit does not pile up rounding.
   * Any other edit or button press starts a fresh base.
   */
  var LEVEL_FIELD = /^(boost|speed|gen[1-5]|ccb|sb|gc)Level$/;
  var levelEdit = null;
  document.addEventListener('input', function (event) {
    var key = event.target.dataset && event.target.dataset.field;
    if (!key) return;
    if (LEVEL_FIELD.test(key)) {
      if (!levelEdit || levelEdit.key !== key) levelEdit = { key: key, base: state.lastRaw };
      var from = num(levelEdit.base, key);
      var to = calc.parseAmount(event.target.value);
      if (Number.isInteger(from) && from >= 0 && Number.isInteger(to) && to >= 0) {
        syncLevel(levelEdit.base, key.slice(0, -'Level'.length), from, to);
      }
    } else {
      levelEdit = null;
    }
    update();
  });
  document.addEventListener('click', function (event) {
    if (event.target.closest('button')) levelEdit = null;
    var target = event.target.closest('[data-action], [data-tab]');
    if (!target) return;
    if (target.dataset.tab) {
      showTab(target.dataset.tab);
      save(readRaw());
    } else if (target.dataset.action === 'buy-candy') {
      buyCandy();
    } else if (target.dataset.action === 'buy-spider') {
      buySpider();
    }
  });
  ui.prestige.addEventListener('click', prestige);
  document.getElementById('export').addEventListener('click', exportState);
  document.getElementById('import').addEventListener('click', importState);
  document.getElementById('reset').addEventListener('click', resetState);

  writeRaw(load() || DEFAULTS);
  update();
})();
