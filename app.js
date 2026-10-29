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
    spPerReset: '10',
    spRunMinutes: '15',
    spExp: '0.5',
    spCc1: '1M',
    spSp1: '1',
    spCc2: '',
    spSp2: '',
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
    farmTarget: true, spGenLevel: true, spCc1: true, spSp1: true, spCc2: true, spSp2: true,
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
      path: role('path')
    };
  }

  var ui = {
    candy: panelParts('candy'),
    spiders: panelParts('spiders'),
    candyTotal: document.getElementById('candy-total-rate'),
    spiderRate: document.getElementById('spider-rate'),
    farm: document.getElementById('farm-result'),
    fitResult: document.getElementById('fit-result'),
    applyFit: document.getElementById('apply-fit'),
    runTotal: document.getElementById('run-total'),
    prestige: document.getElementById('prestige'),
    transfer: document.getElementById('transfer'),
    transferStatus: document.getElementById('transfer-status')
  };

  var state = { activeTab: DEFAULTS.activeTab, candyResult: null, spiderResult: null, fit: NaN, runTotal: NaN };

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

  // v1 had one generator (genLevel/genPrice) and a separate total CC/s field (rate).
  function migrate(obj) {
    if (obj.gen1Level !== undefined || obj.genLevel === undefined) return obj;
    var copy = Object.assign({}, obj);
    copy.gen1Level = obj.genLevel;
    copy.gen1Price = obj.genPrice;
    copy.gen1Cps = obj.rate;
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
      perReset: num(raw, 'spPerReset'),
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

  // Merges consecutive purchases of the same upgrade into one row when `merge` is on.
  function tableRows(steps, merge) {
    var rows = [];
    steps.forEach(function (s, index) {
      var last = rows[rows.length - 1];
      if (merge && last && last.id === s.id) {
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
        unlock: Boolean(s.unlock), cost: s.cost, wait: s.wait, elapsed: s.elapsed,
        mult: s.mult || 1, factor: s.factor || 1, rateAfter: s.rateAfter
      });
    });
    return rows;
  }

  function renderPath(parts, steps, merge, cells) {
    var n = steps.length;
    parts.pathTitle.textContent = 'Полный путь (' + n + ' ' + plural(n, ['шаг', 'шага', 'шагов']) + ')';
    if (!n) {
      parts.path.innerHTML = '<tr><td colspan="8" class="muted">Покупать больше нечего.</td></tr>';
      return;
    }
    parts.path.innerHTML = tableRows(steps, merge).map(function (r) {
      var index = r.count > 1 ? r.firstIndex + '–' + r.lastIndex : String(r.firstIndex);
      return '<tr' + (r.firstIndex === 1 ? ' class="current"' : '') + '>' +
        '<td class="num muted">' + index + '</td>' +
        cells(r).map(function (cell) { return '<td' + (cell.num ? ' class="num"' : '') + '>' + cell.html + '</td>'; }).join('') +
        '</tr>';
    }).join('');
  }

  // ---------- Candy Corn tab ----------

  function renderCandy(result, p, raw) {
    var production = candyProduction(p);
    ui.candyTotal.textContent = production > 0 ? fmt(production) + '/с' : '—';
    var parts = ui.candy;
    if (showProblems(parts, result.problems)) return;

    if (!result.steps.length) {
      parts.next.innerHTML = '<p class="done">🎉 Борд закрыт: Candy Corn Gain и Generator Speed на максимуме.</p>';
    } else {
      var s = result.steps[0];
      parts.next.innerHTML = nextHeader(CANDY_VIEW, s) +
        '<dl class="facts">' +
          fact('Цена', fmt(s.cost)) +
          fact('Ждать', waitText(s.wait)) +
          fact('Множитель CC/s', fmtMult(s.mult)) +
          fact('CC/s после', fmt(s.rateAfter)) +
        '</dl>' +
        nextActions(CANDY_VIEW, result.steps, 'buy-candy');
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
      '</dl>' +
      '<p class="gen-levels">' + generators + '</p>' +
      (result.steps.length ? timeBar(result.totalTime, timeParts) + timeLegend(timeParts) : '') +
      messageList('info-list', result.notes) +
      messageList('warning-list', warnings);

    renderPath(parts, result.steps, raw.group, function (r) {
      return [
        { html: tag(CANDY_VIEW, r.id, true) },
        { html: levelsText(r) },
        { html: fmt(r.cost), num: true },
        { html: fmtMult(r.mult), num: true },
        { html: r.wait > 0 ? dur(r.wait) : '—', num: true },
        { html: dur(r.elapsed), num: true },
        { html: fmt(r.rateAfter), num: true }
      ];
    });
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

  // "Купил": moves the inputs to the state right after the recommended Candy Corn purchase.
  function buyCandy() {
    var result = state.candyResult;
    if (!result || !result.steps || !result.steps.length) return;
    var step = result.steps[0];
    var p = candyParams(readRaw());
    if (step.kind === 'boost' || step.kind === 'speed') {
      var u = p[step.kind];
      setField(step.kind + 'Level', String(step.to));
      setField(step.kind + 'Price', fmt(u.price * u.growth, 4));
      GEN_NUMBERS.forEach(function (n) {
        var cps = p.generators[n - 1].cps;
        if (cps > 0) setField('gen' + n + 'Cps', fmt(cps * step.mult, 4));
      });
    } else {
      var n = Number(step.id.slice(3));
      var g = p.generators[n - 1];
      setField('gen' + n + 'Level', String(step.to));
      if (!step.unlock) {
        setField('gen' + n + 'Price', fmt(g.price * calc.generatorGrowth(p, g.level), 4));
        setField('gen' + n + 'Cps', fmt(g.cps * (g.level + 1) / g.level, 4));
      }
    }
    setField('bank', fmt(Math.max(0, p.bank - step.cost), 4));
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

  function renderFit(raw) {
    state.fit = calc.fitExponent(num(raw, 'spCc1'), num(raw, 'spSp1'), num(raw, 'spCc2'), num(raw, 'spSp2'));
    var usable = state.fit >= 0;
    ui.fitResult.textContent = usable ? 'По замерам k ≈ ' + state.fit.toFixed(3) : 'Заполни оба замера (CC разные).';
    ui.applyFit.disabled = !usable;
  }

  function renderSpiders(result, p, raw) {
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
    var p = spiderParams(readRaw(), state.candyResult);
    var prefix = SPIDER_FIELD_PREFIX[step.id];
    if (prefix) {
      setField(prefix + 'Level', String(step.to));
      setField(prefix + 'Price', fmt(p[step.id].price * p[step.id].growth, 4));
    } else {
      fields[step.id + 'Plan'].checked = false;
    }
    // CC Boost speeds up every generator; Gen Cost makes every generator level cheaper.
    var candy = candyParams(readRaw());
    GEN_NUMBERS.forEach(function (n) {
      var g = candy.generators[n - 1];
      if (step.id === 'ccBoost' && g.cps > 0) setField('gen' + n + 'Cps', fmt(g.cps * step.effect, 4));
      if (step.id === 'genCost' && g.price > 0) setField('gen' + n + 'Price', fmt(g.price / step.effect, 4));
    });
    setField('spBank', fmt(Math.max(0, p.bank - step.cost), 4));
    setField('spPerReset', fmt(p.perReset * step.factor, 4));
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
    markInvalid(raw);
    save(raw);
    var candy = candyParams(raw);
    state.candyResult = calc.optimizeCandy(candy);
    renderCandy(state.candyResult, candy, raw);
    renderFarm(raw, candy);
    var spiders = spiderParams(raw, state.candyResult);
    state.spiderResult = calc.optimizeSpiders(spiders);
    state.runTotal = calc.candyRunTotal(candy);
    ui.runTotal.textContent = state.runTotal >= 0 ? fmt(state.runTotal) + ' CC' : '—';
    var perReset = num(raw, 'spPerReset');
    ui.prestige.textContent = perReset > 0 ? '🕷 Ресет: +' + fmt(perReset) + ' Spiders' : '🕷 Ресет';
    renderFit(raw);
    renderSpiders(state.spiderResult, spiders, raw);
  }

  /*
   * "Ресет": back to the start of a run. Board levels to 0 and prices to the first ones (rounded to
   * 3 digits, since the game shows rounded prices and the first ones are round); generators to
   * level 1 with level-1 prices and production without Gain/Speed; Gen 2–3 (bought with Candy Corn)
   * lock again; Candy Corn on hand to 0; "+Spiders за ресет" is added to Spiders.
   */
  function prestige() {
    var raw = readRaw();
    var p = candyParams(raw);
    var perReset = num(raw, 'spPerReset');
    if (!window.confirm('Ресет: сбросить Candy Corn борд и генераторы к началу забега' +
      (perReset > 0 ? ' и получить +' + fmt(perReset) + ' Spiders' : '') + '?')) return;

    var boardFactor = Math.pow(p.boost.mult, p.boost.level) * Math.pow(p.speed.mult, p.speed.level);
    ['boost', 'speed'].forEach(function (id) {
      var u = p[id];
      if (u.level > 0 && u.price > 0) setField(id + 'Price', fmt(u.price / Math.pow(u.growth, u.level), 3));
      setField(id + 'Level', '0');
    });
    GEN_NUMBERS.forEach(function (n) {
      var g = p.generators[n - 1];
      if (g.level >= 1) {
        setField('gen' + n + 'Level', g.candyUnlock ? '0' : '1');
        if (g.price > 0) setField('gen' + n + 'Price', fmt(calc.generatorStartPrice(p, g.level, g.price), 3));
        if (g.cps > 0) setField('gen' + n + 'Cps', fmt(g.cps / g.level / boardFactor, 4));
      } else if (g.cps > 0) {
        setField('gen' + n + 'Cps', fmt(g.cps / boardFactor, 4));
      }
    });
    setField('bank', '0');
    if (perReset > 0) setField('spBank', fmt(num(raw, 'spBank') + perReset, 4));
    update();
    setTransferStatus('');
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

  document.addEventListener('input', function (event) {
    if (event.target.dataset && event.target.dataset.field) update();
  });
  document.addEventListener('click', function (event) {
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
  document.getElementById('take-run').addEventListener('click', function () {
    if (!(state.runTotal > 0)) return;
    setField('spCc2', fmt(state.runTotal, 4));
    setField('spSp2', String(readRaw().spPerReset));
    update();
  });
  ui.applyFit.addEventListener('click', function () {
    if (!(state.fit >= 0)) return;
    setField('spExp', String(parseFloat(state.fit.toFixed(3))));
    update();
  });
  document.getElementById('export').addEventListener('click', exportState);
  document.getElementById('import').addEventListener('click', importState);
  document.getElementById('reset').addEventListener('click', resetState);

  writeRaw(load() || DEFAULTS);
  update();
})();
