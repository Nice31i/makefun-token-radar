// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, sorting and a detail view
// for every protocol. No network: every byte shown is already in data.js.
// The page recomputes each row's implied value from the snapshot figures
// (impliedOf), so the number on screen and the number in board.json are the
// same arithmetic, visibly. Deep links: ?tab=live, ?category=Dexs,
// ?chain=Solana, ?tvl=100000000, ?detail=<slug>, ?q=<text>, ?sort=implied.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    tvl: params.get('tvl') || 'all',
    watchOnly: params.get('watch') === '1',
    tab: params.get('tab') === 'live' ? 'live' : 'pre-token',
    sort: params.get('sort') || 'implied',
    dir: params.get('dir') === 'asc' ? 1 : -1,
    selected: params.get('detail') || null,
  };
  var watchSet = {};
  (DATA.watchlist_slugs || []).forEach(function (s) { watchSet[s] = true; });

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.round(d) + 'd';
  }
  function pctClass(n) { return n === null || n === undefined ? 'flat' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat'; }

  // radar-2, the same formula lib/model.ts uses: base x growth x maturity x breadth.
  function impliedOf(row, model) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = Math.min(model.growth_cap, Math.max(model.growth_floor, g));
    var w = g >= 0 ? model.growth_up_weight : model.growth_down_weight;
    var growthMult = 1 + (g / 100) * w;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.max(0, Math.min((row.chains || []).length - 1, model.breadth_max_chains));
    var breadth = 1 + extra * model.breadth_per_chain;
    return { value: Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth)), growth: g, growthMult: growthMult, maturity: maturity, breadth: breadth, age: age };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function syncUrl() {
    var q = new URLSearchParams();
    if (state.q) q.set('q', state.q);
    if (state.category !== 'all') q.set('category', state.category);
    if (state.chain !== 'all') q.set('chain', state.chain);
    if (state.tvl !== 'all') q.set('tvl', state.tvl);
    if (state.watchOnly) q.set('watch', '1');
    if (state.tab === 'live') q.set('tab', 'live');
    if (state.sort !== 'implied') q.set('sort', state.sort);
    if (state.dir === 1) q.set('dir', 'asc');
    if (state.selected) q.set('detail', state.selected);
    var s = q.toString();
    try {
      history.replaceState(null, '', s ? window.location.pathname + '?' + s : window.location.pathname);
    } catch (e) { /* file:// or sandboxed views may refuse history writes; the page still works */ }
  }

  function filteredRows() {
    var rows = DATA.rows.filter(function (r) {
      if (state.watchOnly && !watchSet[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.tvl !== 'all' && r.tvl_usd < Number(state.tvl)) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    var d = state.dir;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'change') { av = a.change_7d === null ? -9999 : a.change_7d; bv = b.change_7d === null ? -9999 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'name') { return d * (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      return d * (av - bv);
    });
    return rows;
  }

  function sortHeader(label, key) {
    var th = el('th', { class: state.sort === key ? (state.dir === 1 ? 'sorted asc' : 'sorted') : '' });
    th.appendChild(el('button', {
      type: 'button', text: label,
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' || key === 'rank' ? 1 : -1; }
        render();
      },
    }));
    return th;
  }

  function renderDetail(row) {
    var box = el('section', { class: 'detail', 'aria-label': 'Protocol detail' });
    var calc = impliedOf(row, DATA.model);
    box.appendChild(el('h2', { text: '#' + row.rank + ' ' + row.name }));
    box.appendChild(el('p', {
      class: 'meta', html:
        esc(row.category || 'Uncategorised') + ' · ' + esc((row.chains || []).join(', ') || 'chain not recorded') +
        ' · listed ' + esc(row.listed_at || 'date not recorded') +
        ' · <b>records no token</b> in the snapshot' + (watchSet[row.slug] ? ' · <b>on the watchlist</b>' : ''),
    }));
    var kv = el('div', { class: 'kv' });
    kv.appendChild(el('div', {}, el('div', { class: 'k', text: 'Implied value' }), el('div', { class: 'v', text: fmtUsd(row.implied_value_usd) })));
    kv.appendChild(el('div', {}, el('div', { class: 'k', text: 'TVL' }), el('div', { class: 'v', text: fmtUsd(row.tvl_usd) })));
    kv.appendChild(el('div', {}, el('div', { class: 'k', text: '7-day change' }), el('div', { class: 'v ' + pctClass(row.change_7d), text: fmtPct(row.change_7d) })));
    kv.appendChild(el('div', {}, el('div', { class: 'k', text: 'Running with no token recorded' }), el('div', { class: 'v', text: fmtAge(row.age_days) })));
    kv.appendChild(el('div', {}, el('div', { class: 'k', text: 'Chains' }), el('div', { class: 'v', text: String((row.chains || []).length) })));
    box.appendChild(kv);
    box.appendChild(el('h3', { text: 'Why this value — recomputed live from the snapshot figures' }));
    box.appendChild(el('div', {
      class: 'formula', text:
        'TVL ' + fmtUsd(row.tvl_usd) + ' x base ' + DATA.model.base_multiple +
        ' x growth ' + calc.growthMult.toFixed(3) + ' (' + fmtPct(calc.growth) + ')' +
        ' x maturity ' + calc.maturity.toFixed(3) + ' (' + fmtAge(row.age_days) + ')' +
        ' x breadth ' + calc.breadth.toFixed(3) + ' (' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ')' +
        ' = ' + fmtUsd(calc.value) + (calc.value === row.implied_value_usd ? ' — matches board.json' : ' — differs from board.json by ' + fmtUsd(Math.abs(calc.value - row.implied_value_usd))),
    }));
    box.appendChild(el('h3', { text: 'Farm plan — ' + (row.farm_steps || []).length + ' steps' }));
    var ol = el('ol', { class: 'farm' });
    (row.farm_steps || []).forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    box.appendChild(ol);
    box.appendChild(el('p', { class: 'note', text: '“Records no token” means the snapshot records no market cap, CoinGecko id or symbol for this protocol. It is not a claim that the protocol has no token. Farm plans are a reader\u2019s guide, not financial advice.' }));
    return box;
  }

  function render() {
    syncUrl();
    app.innerHTML = '';
    var wrap = el('div', { class: 'wrap' });
    app.appendChild(wrap);

    var head = el('header', { class: 'top' });
    var left = el('div');
    left.appendChild(el('p', { class: 'eyebrow', text: 'Token Radar · ' + DATA.model_version + ' · snapshot ' + DATA.as_of }));
    left.appendChild(el('h1', { html: 'The next token, <span>ranked before it exists.</span>' }));
    left.appendChild(el('p', {
      class: 'lede', html: '<b>' + DATA.board_size + ' pre-token protocols</b>, ranked by what a token would be worth if each protocol\u2019s record stayed as it is — TVL, seven-day growth, time running with no token recorded, and chain reach. Every row carries a farm plan with costs and times.',
    }));
    head.appendChild(left);
    var stats = el('div', { class: 'stats' });
    stats.appendChild(el('div', { class: 'stat' }, el('div', { class: 'n', text: String(DATA.board_size) }), el('div', { class: 'l', text: 'Ranked rows' })));
    stats.appendChild(el('div', { class: 'stat' }, el('div', { class: 'n', text: String(DATA.watchlist_size) }), el('div', { class: 'l', text: 'Watchlist covered' })));
    stats.appendChild(el('div', { class: 'stat' }, el('div', { class: 'n', text: String(DATA.early_size) }), el('div', { class: 'l', text: 'Below-floor finds' })));
    stats.appendChild(el('div', { class: 'stat' }, el('div', { class: 'n', text: fmtUsd(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0) }), el('div', { class: 'l', text: 'Top implied value' })));
    head.appendChild(stats);
    wrap.appendChild(head);

    var m = DATA.model;
    wrap.appendChild(el('p', {
      class: 'modelbar', html: '<b>Value model ' + esc(DATA.model_version) + ':</b> implied = TVL × <code>' + m.base_multiple + '</code> × growth (7d change clamped ' + m.growth_floor + '% to +' + m.growth_cap + '%, falls weighted ' + m.growth_down_weight + ' vs rises ' + m.growth_up_weight + ') × maturity (0.55–1.00 over ' + m.maturity_days + ' days; unknown age counts as ' + m.unknown_age_days + ' days) × breadth (+2% per extra chain, max +10%). No protocol name is special-cased.',
    }));

    var tabs = el('div', { class: 'tabs', role: 'tablist' });
    tabs.appendChild(el('button', { class: 'tab', role: 'tab', 'aria-selected': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board (' + DATA.board_size + ')', onclick: function () { state.tab = 'pre-token'; state.selected = null; render(); } }));
    tabs.appendChild(el('button', { class: 'tab', role: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', text: 'Already trading (' + DATA.live_size + ')', onclick: function () { state.tab = 'live'; state.selected = null; render(); } }));
    wrap.appendChild(tabs);

    if (state.tab === 'live') {
      wrap.appendChild(el('p', { class: 'note', text: 'These protocols already record a token, so they are not ranked by implied value. The board shows the market\u2019s own capitalisation instead — the separation the radar exists to make.' }));
      var lt = el('table', { class: 'board' });
      var lh = el('thead'); var lhr = el('tr');
      ['Protocol', 'Category', 'TVL', 'Market cap', '7d'].forEach(function (h, i) { lhr.appendChild(el('th', { class: i >= 2 ? 'num' : '', text: h })); });
      lh.appendChild(lhr); lt.appendChild(lh);
      var lb = el('tbody');
      DATA.live.forEach(function (r) {
        var tr = el('tr');
        tr.appendChild(el('td', {}, el('span', { class: 'pname', text: r.name }), el('div', { class: 'psub', text: (r.chains || []).join(', ') })));
        tr.appendChild(el('td', { text: r.category || '—' }));
        tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
        tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
        tr.appendChild(el('td', { class: 'num ' + pctClass(r.change_7d), text: fmtPct(r.change_7d) }));
        lb.appendChild(tr);
      });
      lt.appendChild(lb);
      wrap.appendChild(lt);
      wrap.appendChild(el('footer', { html: '<b>Source:</b> ' + esc(DATA.source) + ' · Floor $' + DATA.floor_usd.toLocaleString('en-US') + ' · ' + DATA.board_size + ' ranked rows, ' + DATA.live_size + ' live rows set aside.' }));
      app.setAttribute('aria-busy', 'false');
      return;
    }

    var cats = [];
    DATA.rows.forEach(function (r) { var c = r.category || 'Uncategorised'; if (cats.indexOf(c) < 0) cats.push(c); });
    cats.sort();
    var chains = [];
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
    chains.sort();

    var controls = el('div', { class: 'controls' });
    var search = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; renderTable(); });
    controls.appendChild(search);
    var catSel = el('select', { 'aria-label': 'Filter by category' });
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    cats.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c, selected: state.category === c ? 'selected' : null })); });
    catSel.addEventListener('change', function () { state.category = catSel.value; renderTable(); });
    controls.appendChild(catSel);
    var chainSel = el('select', { 'aria-label': 'Filter by chain' });
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c, selected: state.chain === c ? 'selected' : null })); });
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; renderTable(); });
    controls.appendChild(chainSel);
    var tvlSel = el('select', { 'aria-label': 'Filter by TVL' });
    [['all', 'Any TVL'], ['50000000', 'TVL ≥ $50M (watchlist floor)'], ['100000000', 'TVL ≥ $100M'], ['1000000000', 'TVL ≥ $1B']].forEach(function (o) {
      tvlSel.appendChild(el('option', { value: o[0], text: o[1], selected: state.tvl === o[0] ? 'selected' : null }));
    });
    tvlSel.addEventListener('change', function () { state.tvl = tvlSel.value; renderTable(); });
    controls.appendChild(tvlSel);
    var watchLabel = el('label');
    var watchBox = el('input', { type: 'checkbox', checked: state.watchOnly ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; renderTable(); });
    watchLabel.appendChild(watchBox);
    watchLabel.appendChild(document.createTextNode(' Watchlist only'));
    controls.appendChild(watchLabel);
    var count = el('span', { class: 'count' });
    controls.appendChild(count);
    wrap.appendChild(controls);

    var tableWrap = el('div');
    wrap.appendChild(tableWrap);
    var detailWrap = el('div');
    wrap.appendChild(detailWrap);
    wrap.appendChild(el('footer', { html: '<b>Source:</b> ' + esc(DATA.source) + ' · Floor $' + DATA.floor_usd.toLocaleString('en-US') + ' · Implied values are this entry\u2019s own claim, never the snapshot\u2019s. “Records no token” describes the record, not the protocol.' }));

    function renderTable() {
      syncUrl();
      var rows = filteredRows();
      count.innerHTML = '<b>' + rows.length + '</b> of ' + DATA.board_size + ' shown';
      tableWrap.innerHTML = '';
      detailWrap.innerHTML = '';
      var table = el('table', { class: 'board' });
      var thead = el('thead'); var hr = el('tr');
      hr.appendChild(sortHeader('Rank', 'rank'));
      hr.appendChild(sortHeader('Protocol', 'name'));
      hr.appendChild(el('th', { text: 'Category' }));
      hr.appendChild(sortHeader('Implied value', 'implied'));
      hr.appendChild(sortHeader('TVL', 'tvl'));
      hr.appendChild(sortHeader('7d', 'change'));
      hr.appendChild(sortHeader('Age', 'age'));
      hr.appendChild(el('th', { text: 'Farm plan' }));
      thead.appendChild(hr); table.appendChild(thead);
      var tbody = el('tbody');
      if (rows.length === 0) {
        var er = el('tr'); er.appendChild(el('td', { class: 'empty', colspan: '8', text: 'No protocol matches these filters. Clear the search or widen the TVL range.' }));
        tbody.appendChild(er);
      }
      rows.forEach(function (r) {
        var tr = el('tr', { tabindex: '0', class: (r.rank <= 3 ? 'top3 ' : '') + (state.selected === r.slug ? 'selected' : '') });
        tr.addEventListener('click', function () { state.selected = state.selected === r.slug ? null : r.slug; renderTable(); });
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.selected = state.selected === r.slug ? null : r.slug; renderTable(); } });
        tr.appendChild(el('td', {}, el('span', { class: 'rank', text: String(r.rank) })));
        var nameTd = el('td');
        nameTd.appendChild(el('span', { class: 'pname', text: r.name }));
        nameTd.appendChild(el('div', { class: 'psub', text: (r.chains || []).slice(0, 3).join(' · ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '') }));
        tr.appendChild(nameTd);
        tr.appendChild(el('td', {}, el('span', { class: 'badge' + (watchSet[r.slug] ? ' watch' : ''), text: watchSet[r.slug] ? 'Watchlist · ' + (r.category || '—') : (r.category || '—') })));
        tr.appendChild(el('td', { class: 'num', html: '<b>' + fmtUsd(r.implied_value_usd) + '</b>' }));
        tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
        tr.appendChild(el('td', { class: 'num ' + pctClass(r.change_7d), text: fmtPct(r.change_7d) }));
        tr.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
        tr.appendChild(el('td', { text: (r.farm_steps || []).length + ' steps' }));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      if (state.selected) {
        var found = null;
        DATA.rows.forEach(function (r) { if (r.slug === state.selected) found = r; });
        if (found) detailWrap.appendChild(renderDetail(found));
      }
    }

    renderTable();
    app.setAttribute('aria-busy', 'false');
    var sel = state.selected;
    if (sel) {
      var target = detailWrap.querySelector('.detail');
      if (target) target.scrollIntoView({ block: 'nearest' });
    }
  }

  render();
})();
