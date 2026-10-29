/* UI for the Candy Corn board optimizer: reads inputs, renders the plan, keeps state in the browser. */
(function () {
  'use strict';

  var calc = window.CandyCalc;
  var fmt = calc.formatAmount;
  var dur = calc.formatDuration;
  var STORAGE_KEY = 'candy-corn-board-v1';

  var NAMES = { boost: 'Candy Corn Gain', speed: 'Generator Speed', generator: 'Generator' };
  var SHORT_NAMES = { boost: 'CC Gain', speed: 'Gen Speed', generator: 'Generator' };
  var FIELD_PREFIX = { boost: 'boost', speed: 'speed', generator: 'gen' };

  var DEFAULTS = {
    bank: '0',
    rate: '100',
    boostLevel: '0',
    boostPrice: '1K',
    speedLevel: '0',
    speedPrice: '2.5K',
    genLevel: '1',
    genPrice: '100',
    boostMult: '1.25',
    boostGrowth: '2',
    boostMax: '25',
    speedMult: '1.1',
    speedGrowth: '2.5',
    speedMax: '20',
    genGrowth: '1.3',
    farmTarget: '',
    group: true
  };

  // Fields that may stay empty without being marked red.
  var OPTIONAL = { farmTarget: true };

  var fields = {};
  document.querySelectorAll('[data-field]').forEach(function (el) { fields[el.dataset.field] = el; });

  var el = {
    problems: document.getElementById('problems'),
    problemList: document.getElementById('problem-list'),
    output: document.getElementById('output'),
    next: document.getElementById('next-body'),
    summary: document.getElementById('summary-body'),
    pathTitle: document.getElementById('path-title'),
    path: document.getElementById('path-body'),
    farm: document.getElementById('farm-result'),
    transfer: document.getElementById('transfer'),
    transferStatus: document.getElementById('transfer-status')
  };

  var lastResult = null;

  // ---------- state ----------

  function readRaw() {
    var raw = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      raw[key] = fields[key].type === 'checkbox' ? fields[key].checked : fields[key].value;
    });
    return raw;
  }

  function writeRaw(raw) {
    Object.keys(DEFAULTS).forEach(function (key) {
      if (fields[key].type === 'checkbox') fields[key].checked = Boolean(raw[key]);
      else fields[key].value = raw[key];
    });
  }

  // Keeps only known keys with values of the expected type; null when unusable.
  function sanitize(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var raw = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      var value = obj[key];
      if (typeof DEFAULTS[key] === 'boolean') raw[key] = typeof value === 'boolean' ? value : DEFAULTS[key];
      else raw[key] = typeof value === 'string' || typeof value === 'number' ? String(value) : DEFAULTS[key];
    });
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

  function toParams(raw) {
    var n = calc.parseAmount;
    return {
      bank: n(raw.bank),
      rate: n(raw.rate),
      boost: { level: n(raw.boostLevel), price: n(raw.boostPrice), max: n(raw.boostMax), mult: n(raw.boostMult), growth: n(raw.boostGrowth) },
      speed: { level: n(raw.speedLevel), price: n(raw.speedPrice), max: n(raw.speedMax), mult: n(raw.speedMult), growth: n(raw.speedGrowth) },
      generator: { level: n(raw.genLevel), price: n(raw.genPrice), growth: n(raw.genGrowth) }
    };
  }

  function markInvalid(raw) {
    Object.keys(DEFAULTS).forEach(function (key) {
      if (fields[key].type === 'checkbox') return;
      var text = String(raw[key]).trim();
      var bad = text === '' ? !OPTIONAL[key] : isNaN(calc.parseAmount(text));
      fields[key].classList.toggle('invalid', bad);
    });
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

  function tag(id, short) {
    return '<span class="tag ' + id + '">' + (short ? SHORT_NAMES[id] : NAMES[id]) + '</span>';
  }

  function fact(label, value) {
    return '<div class="fact"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
  }

  // ---------- rendering ----------

  function renderNext(result) {
    if (!result.steps.length) {
      el.next.innerHTML = '<p class="done">🎉 Борд закрыт: Candy Corn Gain и Generator Speed на максимуме.</p>';
      return;
    }
    var s = result.steps[0];
    var upcoming = result.steps.slice(1, 4).map(function (x) { return SHORT_NAMES[x.id] + ' ' + x.to; }).join(' → ');
    el.next.innerHTML =
      '<div class="next-title">' + tag(s.id) + '<span class="levels">' + s.from + ' → ' + s.to + '</span></div>' +
      '<dl class="facts">' +
        fact('Цена', fmt(s.cost)) +
        fact('Ждать', s.wait > 0 ? dur(s.wait) : 'хватает уже') +
        fact('Множитель', fmtMult(s.mult)) +
        fact('CC/s после', fmt(s.rateAfter)) +
      '</dl>' +
      '<div class="next-actions">' +
        '<button type="button" class="primary" data-action="bought">Купил ✓</button>' +
        (upcoming ? '<span class="then">Дальше: ' + upcoming + '</span>' : '') +
      '</div>';
  }

  function renderSummary(result, params) {
    var counts = { boost: 0, speed: 0, generator: 0 };
    result.steps.forEach(function (s) { counts[s.id] += 1; });
    var generatorsBought = result.generatorTo - result.generatorFrom;
    var ids = ['boost', 'speed', 'generator'];

    var bar = result.totalTime > 0
      ? '<div class="bar" aria-hidden="true">' + ids.map(function (id) {
          var share = result.waitById[id] / result.totalTime * 100;
          return share > 0 ? '<span class="' + id + '" style="width:' + share.toFixed(2) + '%"></span>' : '';
        }).join('') + '</div>'
      : '';

    var legend = '<ul class="legend">' + ids.filter(function (id) { return counts[id] > 0; }).map(function (id) {
      return '<li><i class="dot ' + id + '"></i>' + SHORT_NAMES[id] + ': <strong>' + dur(result.waitById[id]) + '</strong>' +
        ' · ' + counts[id] + ' ' + plural(counts[id], ['покупка', 'покупки', 'покупок']) + '</li>';
    }).join('') + '</ul>';

    el.summary.innerHTML =
      '<dl class="facts">' +
        fact('Время до конца', dur(result.totalTime)) +
        fact('Покупок', String(result.steps.length)) +
        fact('Generator', result.generatorFrom + ' → ' + result.generatorTo +
          (generatorsBought ? ' <span class="muted">(+' + generatorsBought + ')</span>' : '')) +
        fact('CC/s в конце', fmt(result.finalRate) + ' <span class="muted">' + fmtMult(result.finalRate / params.rate) + '</span>') +
        fact('Потрачено всего', fmt(result.totalCost)) +
      '</dl>' +
      (result.steps.length ? bar + legend : '') +
      (result.capped ? '<p class="warning">Генератор упёрся в предел поиска (3000 уровней) — проверь цену и рост цены генератора.</p>' : '');
  }

  // Merges consecutive purchases of the same upgrade into one row when `merge` is on.
  function tableRows(steps, merge) {
    var rows = [];
    steps.forEach(function (s, index) {
      var last = rows[rows.length - 1];
      if (merge && last && last.id === s.id) {
        last.lastIndex = index + 1;
        last.to = s.to;
        last.cost += s.cost;
        last.mult *= s.mult;
        last.wait += s.wait;
        last.elapsed = s.elapsed;
        last.rateAfter = s.rateAfter;
        last.count += 1;
        return;
      }
      rows.push({
        firstIndex: index + 1, lastIndex: index + 1, id: s.id, from: s.from, to: s.to, cost: s.cost,
        mult: s.mult, wait: s.wait, elapsed: s.elapsed, rateAfter: s.rateAfter, count: 1
      });
    });
    return rows;
  }

  function renderPath(result, merge) {
    var n = result.steps.length;
    el.pathTitle.textContent = 'Полный путь (' + n + ' ' + plural(n, ['шаг', 'шага', 'шагов']) + ')';
    if (!n) {
      el.path.innerHTML = '<tr><td colspan="8" class="muted">Покупать больше нечего.</td></tr>';
      return;
    }
    el.path.innerHTML = tableRows(result.steps, merge).map(function (r) {
      var index = r.count > 1 ? r.firstIndex + '–' + r.lastIndex : String(r.firstIndex);
      return '<tr' + (r.firstIndex === 1 ? ' class="current"' : '') + '>' +
        '<td class="num muted">' + index + '</td>' +
        '<td>' + tag(r.id, true) + '</td>' +
        '<td>' + r.from + ' → ' + r.to + (r.count > 1 ? ' <span class="count">(' + r.count + ' шт.)</span>' : '') + '</td>' +
        '<td class="num">' + fmt(r.cost) + '</td>' +
        '<td class="num">' + fmtMult(r.mult) + '</td>' +
        '<td class="num">' + (r.wait > 0 ? dur(r.wait) : '—') + '</td>' +
        '<td class="num">' + dur(r.elapsed) + '</td>' +
        '<td class="num">' + fmt(r.rateAfter) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderFarm(raw, params) {
    var text = String(raw.farmTarget).trim();
    var target = calc.parseAmount(text);
    if (text === '') {
      el.farm.textContent = 'Введи сумму — покажу, сколько фармить при текущем CC/s.';
      return;
    }
    if (isNaN(target) || !(params.rate > 0) || !(params.bank >= 0)) {
      el.farm.textContent = 'Не могу посчитать: проверь сумму, Candy Corn и CC/s.';
      return;
    }
    var need = Math.max(0, target - params.bank);
    el.farm.innerHTML = need === 0
      ? 'Уже хватает ✓'
      : 'Фармить <strong>' + dur(need / params.rate) + '</strong> · нужно ещё ' + fmt(need) + ' при ' + fmt(params.rate) + ' CC/s';
  }

  function renderProblems(problems) {
    el.problemList.replaceChildren.apply(el.problemList, problems.map(function (text) {
      var li = document.createElement('li');
      li.textContent = text;
      return li;
    }));
  }

  function update() {
    var raw = readRaw();
    var params = toParams(raw);
    markInvalid(raw);
    save(raw);
    renderFarm(raw, params);

    var result = calc.optimize(params);
    lastResult = result;
    el.problems.hidden = result.problems.length === 0;
    el.output.hidden = result.problems.length > 0;
    if (result.problems.length) {
      renderProblems(result.problems);
      return;
    }
    renderNext(result);
    renderSummary(result, params);
    renderPath(result, raw.group);
  }

  // ---------- actions ----------

  // "Купил": moves the inputs to the state right after the recommended purchase.
  function applyFirstStep() {
    if (!lastResult || !lastResult.steps || !lastResult.steps.length) return;
    var step = lastResult.steps[0];
    var params = toParams(readRaw());
    var upgrade = params[step.id];
    var prefix = FIELD_PREFIX[step.id];
    fields[prefix + 'Level'].value = String(step.to);
    fields[prefix + 'Price'].value = fmt(upgrade.price * upgrade.growth, 4);
    fields.bank.value = fmt(Math.max(0, params.bank - step.cost), 4);
    fields.rate.value = fmt(params.rate * step.mult, 4);
    update();
  }

  function setTransferStatus(text) {
    el.transferStatus.textContent = text;
  }

  function exportState() {
    var text = JSON.stringify(readRaw());
    el.transfer.value = text;
    el.transfer.select();
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
      raw = sanitize(JSON.parse(el.transfer.value));
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

  document.querySelector('.layout').addEventListener('input', function (event) {
    if (event.target.dataset && event.target.dataset.field) update();
  });
  el.next.addEventListener('click', function (event) {
    if (event.target.closest('[data-action="bought"]')) applyFirstStep();
  });
  document.getElementById('export').addEventListener('click', exportState);
  document.getElementById('import').addEventListener('click', importState);
  document.getElementById('reset').addEventListener('click', resetState);

  writeRaw(load() || DEFAULTS);
  update();
})();
