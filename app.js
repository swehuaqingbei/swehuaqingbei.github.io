(() => {
  const C = window.CONFIG;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEMO = new URLSearchParams(location.search).has('demo');
  const CACHE_KEY = 'hqcup-cache-v1';

  const state = {
    page: 'matches', filter: 'all',
    matches: [], ranks: [],
    source: 'default', updatedAt: null,
    demoStep: Math.max(0, Math.min(window.DEMO_STEPS.length, parseInt(new URLSearchParams(location.search).get('demo'), 10) || 1) - 1),
    demoTimer: null,
  };
  const prevScores = {};
  let champShownFor = null;
  try { champShownFor = sessionStorage.getItem('hqcup-champ'); } catch (e) {}

  // ---------------- data ----------------
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function toObjects(rows) {
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1)
      .map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
      .filter(o => Object.values(o).some(v => v !== ''));
  }

  async function fetchTab(tab) {
    const url = `https://docs.google.com/spreadsheets/d/${C.SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}&t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (text.trim().startsWith('<')) throw new Error('表格未公开');
    return toObjects(parseCSV(text));
  }

  const num = v => { const s = String(v ?? '').trim(); if (s === '') return null; const n = parseInt(s, 10); return isNaN(n) ? null : n; };
  const hhmm = v => { const m = String(v ?? '').match(/(\d{1,2})[:.](\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : String(v ?? ''); };

  function normalize(o) {
    const type = (o['类型'] || '').trim();
    const m = {
      id: o['编号'], type, round: o['轮次'] || '', time: hhmm(o['时间']), pitch: o['场地'] || '',
      home: o['主队'] || '', away: o['客队'] || '',
      hg: num(o['主队进球']), ag: num(o['客队进球']),
      hp: num(o['主队积分']), ap: num(o['客队积分']),
      hpk: num(o['主队点球']), apk: num(o['客队点球']),
      winner: (o['胜方'] || '').trim(),
    };
    m.group = type.startsWith('A') ? 'A' : type.startsWith('B') ? 'B' : null;
    m.isFinal = type.includes('决赛');
    m.isYouth = type.includes('青少年');
    const scored = m.hg !== null || m.ag !== null;
    if (m.group) m.status = (m.hp !== null && m.ap !== null) ? 'done' : scored ? 'live' : 'upcoming';
    else m.status = m.winner ? 'done' : scored ? 'live' : 'upcoming';
    return m;
  }

  async function load() {
    if (DEMO) {
      apply(window.DEMO_STEPS[state.demoStep].data, [], 'demo');
      return;
    }
    if (!C.SHEET_ID) { apply(window.DEFAULT_MATCHES, [], 'default'); return; }
    try {
      const [matches, ranks] = await Promise.all([
        fetchTab(C.MATCH_TAB),
        fetchTab(C.RANK_TAB).catch(() => []),
      ]);
      if (!matches.length) throw new Error('empty');
      const now = Date.now();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ matches, ranks, at: now })); } catch (e) {}
      apply(matches, ranks, 'sheet', now);
    } catch (err) {
      console.warn('读取表格失败', err);
      let cache = null;
      try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) {}
      if (cache) apply(cache.matches, cache.ranks, 'offline', cache.at);
      else apply(window.DEFAULT_MATCHES, [], 'offline');
    }
  }

  function apply(rows, ranks, source, at) {
    state.matches = rows.map(normalize).filter(m => m.type);
    state.ranks = ranks || [];
    state.source = source;
    state.updatedAt = at || Date.now();
    render();
  }

  // ---------------- logic ----------------
  function standings(group) {
    const ms = state.matches.filter(m => m.group === group);
    const teams = new Map();
    const t = name => {
      if (!teams.has(name)) teams.set(name, { name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
      return teams.get(name);
    };
    ms.forEach(m => { if (m.home) t(m.home); if (m.away) t(m.away); });
    ms.filter(m => m.status === 'done').forEach(m => {
      const h = t(m.home), a = t(m.away);
      h.p++; a.p++;
      h.pts += m.hp; a.pts += m.ap;
      h.gf += m.hg || 0; h.ga += m.ag || 0; a.gf += m.ag || 0; a.ga += m.hg || 0;
      if (m.hp > m.ap) { h.w++; a.l++; } else if (m.hp < m.ap) { a.w++; h.l++; } else { h.d++; a.d++; }
    });
    const list = [...teams.values()];
    list.forEach(x => x.gd = x.gf - x.ga);
    list.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf);
    // 组委会手动排名覆盖
    const manual = {};
    state.ranks.forEach(r => {
      const g = String(r['组别'] || '').trim().toUpperCase();
      const rk = num(r['手动排名']);
      if (g.startsWith(group) && rk !== null && r['队伍']) manual[r['队伍'].trim()] = rk;
    });
    if (Object.keys(manual).length) {
      const auto = list.slice();
      list.sort((x, y) => {
        const mx = manual[x.name], my = manual[y.name];
        if (mx != null && my != null) return mx - my;
        if (mx != null) return -1;
        if (my != null) return 1;
        return auto.indexOf(x) - auto.indexOf(y);
      });
    }
    const complete = ms.length > 0 && ms.every(m => m.status === 'done');
    return { list, complete, manual: Object.keys(manual).length > 0 };
  }

  const finalMatch = () => state.matches.find(m => m.isFinal);
  function champion() {
    const f = finalMatch();
    if (!f || f.status !== 'done' || !f.winner) return null;
    const runner = f.winner === f.home ? f.away : f.winner === f.away ? f.home : '';
    return { name: f.winner, runner };
  }

  // ---------------- rendering ----------------
  const initial = name => { const s = String(name).trim(); return s ? s[0].toUpperCase() : '?'; };
  const badge = name => `<span class="b">${esc(initial(name))}</span>`;

  function teamHTML(m, side) {
    const name = side === 'h' ? m.home : m.away;
    if (!name) {
      const ph = m.isFinal ? (side === 'h' ? 'A组第一' : 'B组第一') : '待定';
      return `<div class="team tbd"><span class="b q">?</span><span>${ph}</span></div>`;
    }
    let win = false;
    if (m.status === 'done') {
      if (m.group) win = side === 'h' ? m.hg > m.ag : m.ag > m.hg;
      else win = m.winner === name;
    }
    return `<div class="team${win ? ' win' : ''}">${badge(name)}<span>${esc(name)}</span></div>`;
  }

  function scoreHTML(m) {
    if (m.status === 'upcoming' && m.hg === null && m.ag === null) {
      return `<div class="score t">${m.isFinal && !m.home ? 'VS' : esc(m.time)}</div>`;
    }
    const h = m.hg ?? 0, a = m.ag ?? 0;
    const key = h + '-' + a;
    const prev = prevScores[m.id];
    const bh = prev && prev.split('-')[0] !== String(h) ? ' bump' : '';
    const ba = prev && prev.split('-')[1] !== String(a) ? ' bump' : '';
    prevScores[m.id] = key;
    const pk = (m.hpk !== null || m.apk !== null) ? `<span class="pk">点球 ${m.hpk ?? 0} – ${m.apk ?? 0}</span>` : '';
    return `<div class="score"><span class="d${bh}">${h}</span><span class="l">–</span><span class="d${ba}">${a}</span>${pk}</div>`;
  }

  function label(m) {
    if (m.group) return `${m.group}组 · ${m.round}`;
    return m.round || m.type;
  }

  function cardHTML(m) {
    let left;
    if (m.status === 'live') left = `<span class="lv"><i></i>比赛中 · ${esc(label(m))}</span>`;
    else if (m.status === 'done') left = `<span class="done">已结束 · ${esc(label(m))}</span>`;
    else left = `<span>${m.isFinal ? '🏆 ' : ''}${esc(label(m))}</span>`;
    const right = `<span>${esc(m.pitch)}${m.status === 'upcoming' ? '' : ' · ' + esc(m.time)}</span>`;
    const cls = ['card', 'st-' + m.status, m.isFinal ? 'final' : ''].join(' ');
    return `<div class="${cls}" id="m-${esc(m.id)}"><div class="meta">${left}${right}</div>
      <div class="row">${teamHTML(m, 'h')}${scoreHTML(m)}${teamHTML(m, 'a')}</div></div>`;
  }

  function champHTML(c) {
    return `<div class="champ"><div class="cup">🏆</div><div class="k">冠 军</div><div class="n">${esc(c.name)}</div>
      ${c.runner ? `<div class="r">亚军 · ${esc(c.runner)}</div>` : ''}</div>`;
  }

  function sectionOf(m) {
    if (m.group) return m.round;
    if (m.isYouth) return '青少年组';
    if (m.isFinal) return '冠亚军决赛';
    return m.type;
  }

  function matchesPage() {
    const f = state.filter;
    const pick = m => f === 'all' || (f === 'A' && m.group === 'A') || (f === 'B' && m.group === 'B')
      || (f === 'youth' && m.isYouth) || (f === 'final' && m.isFinal);
    const ms = state.matches.filter(pick);
    let html = '';
    const c = champion();
    if (c && (f === 'all' || f === 'final')) html += champHTML(c);

    let rest = ms;
    if (f === 'all') {
      const live = ms.filter(m => m.status === 'live');
      if (live.length) {
        html += `<div class="sec">正在进行 <small>${live.length} 场</small></div>` + live.map(cardHTML).join('');
        rest = ms.filter(m => m.status !== 'live');
      }
    }
    const items = rest.map(m => ({ time: m.time, m }));
    if (f === 'all') window.EVENTS.forEach(e => items.push({ time: e.time, e }));
    items.sort((x, y) => x.time.localeCompare(y.time) || (x.e ? -1 : 0) - (y.e ? -1 : 0));

    let lastSec = null;
    items.forEach(it => {
      if (it.e) {
        html += `<div class="ev"><div class="tm">${esc(it.e.time)}</div><div><div class="t">${esc(it.e.title)}</div><div class="n">${esc(it.e.note)}</div></div></div>`;
        lastSec = null;
        return;
      }
      const sec = sectionOf(it.m);
      if (sec !== lastSec) {
        html += `<div class="sec">${esc(sec)} <small>${esc(it.m.time)}</small></div>`;
        lastSec = sec;
      }
      html += cardHTML(it.m);
    });
    if (!ms.length) html += '<div class="empty">暂无比赛</div>';
    return html;
  }

  function tablePage() {
    let html = '';
    const c = champion();
    if (c) html += champHTML(c);
    ['A', 'B'].forEach(g => {
      const { list, complete, manual } = standings(g);
      html += `<div class="sec">${g}组积分榜 <small>${complete ? '小组赛已结束' : '实时'}</small></div>`;
      html += `<div class="tbl"><table><thead><tr><th>#</th><th>球队</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>进/失</th><th>净</th><th>分</th></tr></thead><tbody>`;
      list.forEach((t, i) => {
        html += `<tr class="${i === 0 && list[0].p > 0 ? 'lead' : ''}"><td class="rk">${i + 1}</td>
          <td><div class="tn">${badge(t.name)}<span>${esc(t.name)}${i === 0 && complete ? '<span class="tag">决赛</span>' : ''}</span></div></td>
          <td>${t.p}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td><td>${t.gf}:${t.ga}</td><td>${t.gd > 0 ? '+' : ''}${t.gd}</td><td class="pts">${t.pts}</td></tr>`;
      });
      html += `</tbody></table></div>`;
      if (manual) html += `<div class="note">* 排名已由组委会调整</div>`;
    });
    html += `<div class="note">胜 3 分，平 1 分，负 0 分。积分相同时依次比较净胜球、进球数。每组第一名进入 16:05 室内12号场冠亚军决赛，决赛打平直接点球决胜。</div>`;
    return html;
  }

  function venuePage() {
    const g = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    const a = q => 'https://maps.apple.com/?q=' + encodeURIComponent(q);
    return `
      <div class="code"><div><div class="k">室内球场 / 洗手间 门禁密码</div><div style="font-size:12px;margin-top:2px">进门后直走即是球场</div></div><div class="v">5026</div></div>

      <div class="info"><h3>📍 怎么去</h3>
        <p>Sollentuna Fotbollshall（Norrvikens IP），室外场与室内馆在同一处。场馆外有<b>付费停车场</b>。</p>
        <div class="btns">
          <a class="btn" href="${g('Sollentuna Fotbollshall')}" target="_blank" rel="noopener">🗺 Google 地图</a>
          <a class="btn" href="${a('Sollentuna Fotbollshall')}" target="_blank" rel="noopener">🍎 Apple 地图</a>
        </div></div>

      <div class="info"><h3>☀️ 室外场 · 成人小组赛</h3>
        <p>Norrvikens IP 室外场：<b>A组 → 11号场（1号场）</b>，<b>B组 → 12号场（2号场）</b>，均为半场。开幕式 12:45 在图中<b>集合点</b>举行。</p>
        <img src="assets/outdoor-map.jpg" alt="室外场地示意图" loading="lazy"></div>

      <div class="info"><h3>🏟 室内馆 · 青少年组 & 决赛</h3>
        <p>Sollentuna Fotbollshall 室内 <b>12号场</b>：青少年比赛（3号场）及 16:05 成人组冠亚军决赛。门禁密码 <b>5026</b>，进门后直走。</p>
        <img src="assets/indoor-map.jpg" alt="室内场地示意图" loading="lazy"></div>

      <div class="info"><h3>🕐 当天流程</h3><ul class="tl">
        <li><b>12:30</b><span>球队签到，裁判及球队负责人碰头</span></li>
        <li><b>12:45</b><span>合照 + 室外开幕式</span></li>
        <li><b>13:00</b><span>成人小组赛开赛（室外）</span></li>
        <li><b>13:15</b><span>青少年 8-11岁 7v7（室内）</span></li>
        <li><b>14:15</b><span>青少年 12-15岁 5v5（室内）</span></li>
        <li><b>15:35</b><span>小组赛结束，统计积分，全体移步室内</span></li>
        <li><b>16:05</b><span>成人组冠亚军决赛（室内）</span></li>
        <li><b>17:10</b><span>颁奖 + 全体合影</span></li>
      </ul></div>

      <div class="info"><h3>⚽ 赛制</h3>
        <p>成人组：A、B 两组各 3 队单循环，半场比赛，20 分钟 + 5 分钟中场 + 20 分钟。手掷界外球、无越位、禁止倒地铲球、无限滚动换人、红黄牌制度。决赛打平直接点球，不加时。</p>
        <p style="margin-top:6px">青少年：8-11岁 7v7，12-15岁 5v5，1/4 场，20 + 5 + 20 分钟。降低身体对抗，禁止危险铲球，打平直接点球。</p></div>`;
  }

  function renderHeader() {
    const el = $('#filters');
    if (state.page === 'matches') {
      const fs = [['all', '全部'], ['A', 'A组'], ['B', 'B组'], ['youth', '青少年'], ['final', '决赛']];
      el.innerHTML = fs.map(([k, v]) => `<button data-f="${k}" class="${state.filter === k ? 'on' : ''}">${v}</button>`).join('');
    } else {
      el.innerHTML = `<span class="lbl">${state.page === 'table' ? '积分榜' : '场地信息'}</span>`;
    }
    document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('on', b.dataset.page === state.page));
  }

  function renderStatus() {
    const el = $('#status');
    const t = new Date(state.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const map = {
      sheet: `<i></i>实时比分 · 每 ${Math.round(C.REFRESH_MS / 1000)} 秒自动刷新 · ${t}`,
      offline: `<i></i>网络不稳定 · 显示的是 ${t} 的数据`,
      default: `<i></i>赛程预览（尚未连接比分表）`,
      demo: `<i></i>演示模式 · 数据为模拟`,
    };
    el.className = 'status' + (state.source === 'offline' ? ' off' : '');
    el.innerHTML = map[state.source];
  }

  function render() {
    renderHeader();
    renderStatus();
    const v = $('#view');
    v.innerHTML = state.page === 'table' ? tablePage() : state.page === 'venue' ? venuePage() : matchesPage();
    if (state.page !== 'matches') state.matches.forEach(m => { if (m.hg !== null || m.ag !== null) prevScores[m.id] = (m.hg ?? 0) + '-' + (m.ag ?? 0); });
    const c = champion();
    if (c && champShownFor !== c.name) {
      champShownFor = c.name;
      try { sessionStorage.setItem('hqcup-champ', c.name); } catch (e) {}
      confetti();
    }
    if (DEMO) renderDemo();
  }

  // ---------------- confetti ----------------
  function confetti() {
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    const W = cv.width = innerWidth * devicePixelRatio, H = cv.height = innerHeight * devicePixelRatio;
    const colors = ['#fecc02', '#005b99', '#d6a54a', '#ffffff', '#e0262b'];
    const ps = Array.from({ length: 160 }, () => ({
      x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35,
      vx: (Math.random() - .5) * 26, vy: -Math.random() * 30 - 10,
      s: (Math.random() * 8 + 6) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
      c: colors[Math.random() * colors.length | 0],
    }));
    let f = 0;
    (function tick() {
      ctx.clearRect(0, 0, W, H);
      ps.forEach(p => {
        p.vy += .9; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      });
      if (++f < 160) requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H);
    })();
  }

  // ---------------- demo ----------------
  function renderDemo() {
    const el = $('#demo'), n = window.DEMO_STEPS.length;
    el.hidden = false;
    document.body.classList.add('has-demo');
    const playing = !!state.demoTimer;
    el.innerHTML = `<button data-d="prev">◀</button>
      <div class="d"><small>演示 ${state.demoStep + 1}/${n}</small>${esc(window.DEMO_STEPS[state.demoStep].desc)}</div>
      <button data-d="play" class="p">${playing ? '❚❚' : '▶'}</button>
      <button data-d="next">▶▶</button><button data-d="reset">↺</button>`;
  }
  function demoGo(i) {
    state.demoStep = Math.max(0, Math.min(window.DEMO_STEPS.length - 1, i));
    if (state.demoStep === 0) { champShownFor = null; try { sessionStorage.removeItem('hqcup-champ'); } catch (e) {} }
    load();
  }
  $('#demo').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.d;
    if (a === 'prev') demoGo(state.demoStep - 1);
    if (a === 'next') demoGo(state.demoStep + 1);
    if (a === 'reset') { clearInterval(state.demoTimer); state.demoTimer = null; demoGo(0); }
    if (a === 'play') {
      if (state.demoTimer) { clearInterval(state.demoTimer); state.demoTimer = null; renderDemo(); }
      else {
        state.demoTimer = setInterval(() => {
          if (state.demoStep >= window.DEMO_STEPS.length - 1) { clearInterval(state.demoTimer); state.demoTimer = null; renderDemo(); return; }
          demoGo(state.demoStep + 1);
        }, 2500);
        renderDemo();
      }
    }
  });

  // ---------------- navigation ----------------
  function setPage(p) {
    state.page = ['matches', 'table', 'venue'].includes(p) ? p : 'matches';
    render();
    scrollTo(0, 0);
  }
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    history.replaceState(null, '', '#' + b.dataset.page);
    setPage(b.dataset.page);
  });
  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]'); if (!b) return;
    state.filter = b.dataset.f;
    render();
  });

  state.page = ['matches', 'table', 'venue'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'matches';
  load();
  if (!DEMO && C.SHEET_ID) {
    setInterval(load, C.REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }
})();
