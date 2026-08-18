/* ============================================================
   Orbit — idea space
   A floating brainstorm board with anticipated dates.
   Talks to server.js; falls back to localStorage when it's absent.
   ============================================================ */

(() => {
  'use strict';

  const API = '/api/ideas';
  const CACHE_KEY = 'orbit.cache.v2';

  const STATUSES = {
    spark:    'Spark',
    brewing:  'Brewing',
    building: 'Building',
    shipped:  'Shipped',
    parked:   'Parked',
  };

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  /* ---------------------------------------------------------
     Tiny helpers
     --------------------------------------------------------- */

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------------------------------------------------------
     Dates — everything is stored as a plain 'YYYY-MM-DD' string
     so a date never drifts across timezones.
     --------------------------------------------------------- */

  const toKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const fromKey = (key) => {
    if (!key) return null;
    const [y, m, d] = key.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  const today = () => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  };

  const addDays = (d, n) => {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  };

  const daysUntil = (key) => {
    const d = fromKey(key);
    if (!d) return null;
    return Math.round((d - today()) / 86400000);
  };

  const formatDate = (key) => {
    const d = fromKey(key);
    if (!d) return '';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return `${MON_ABBR[d.getMonth()]} ${d.getDate()}${sameYear ? '' : ', ' + d.getFullYear()}`;
  };

  /** Human countdown: "in 5 days", "Today", "3 days late". */
  const relative = (key) => {
    const n = daysUntil(key);
    if (n === null) return '';
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return '1 day late';
    if (n < 0) {
      const late = -n;
      if (late < 14) return `${late} days late`;
      if (late < 60) return `${Math.round(late / 7)} weeks late`;
      return `${Math.round(late / 30)} months late`;
    }
    if (n < 14) return `in ${n} days`;
    if (n < 60) return `in ${Math.round(n / 7)} weeks`;
    if (n < 365) return `in ${Math.round(n / 30)} months`;
    return `in ${(n / 365).toFixed(1)} years`;
  };

  /** the one thing worth flagging in colour */
  const isLate = (idea) =>
    Boolean(idea.date) && idea.status !== 'shipped' && daysUntil(idea.date) < 0;

  /* ---------------------------------------------------------
     Natural-language date parsing for the composer (@…)
     --------------------------------------------------------- */

  const MONTH_RE = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  const DAY_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  const monthIndex = (s) => MON_ABBR.findIndex((m) => m.toLowerCase() === s.slice(0, 3).toLowerCase());

  const unitDays = (u) => {
    u = u.toLowerCase();
    if (u.startsWith('d')) return 1;
    if (u.startsWith('w')) return 7;
    if (u === 'mo' || u.startsWith('mon') || u === 'm') return 30;
    if (u.startsWith('y')) return 365;
    return 1;
  };

  const nextWeekday = (target) => {
    const base = today();
    let delta = (target - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // "friday" on a Friday means next Friday
    return addDays(base, delta);
  };

  /**
   * Parse a date expression at the start of `text`.
   * Returns { date: 'YYYY-MM-DD', length } or null.
   */
  function parseDateExpr(text) {
    const t = text.trimStart();
    const lead = text.length - t.length;
    const done = (date, m) => ({ date: toKey(date), length: lead + m.length });

    let m;

    // 2026-09-01
    if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))
      return done(new Date(+m[1], +m[2] - 1, +m[3]), m[0]);

    // 9/1 or 9/1/26
    if ((m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) {
      let year = m[3] ? +m[3] : today().getFullYear();
      if (year < 100) year += 2000;
      const d = new Date(year, +m[1] - 1, +m[2]);
      if (!m[3] && d < today()) d.setFullYear(year + 1);
      return done(d, m[0]);
    }

    // in 3 weeks
    if ((m = t.match(/^in\s+(\d+)\s*(days?|d|weeks?|w|months?|mo|m|years?|y)\b/i)))
      return done(addDays(today(), +m[1] * unitDays(m[2])), m[0]);

    // 3w / 10d / 2mo
    if ((m = t.match(/^(\d+)\s*(days?|d|weeks?|w|months?|mo|m|years?|y)\b/i)))
      return done(addDays(today(), +m[1] * unitDays(m[2])), m[0]);

    // end of month / end of year
    if ((m = t.match(/^(?:end of|eo)\s+(month|year|week)/i))) {
      const base = today();
      const kind = m[1].toLowerCase();
      const d =
        kind === 'month' ? new Date(base.getFullYear(), base.getMonth() + 1, 0)
        : kind === 'year' ? new Date(base.getFullYear(), 11, 31)
        : addDays(base, (7 - base.getDay()) % 7 || 7);
      return done(d, m[0]);
    }

    // next week / next month / next friday
    if ((m = t.match(/^next\s+(week|month|year|sun|mon|tue|wed|thu|fri|sat)[a-z]*/i))) {
      const w = m[1].toLowerCase();
      if (w === 'week')  return done(addDays(today(), 7), m[0]);
      if (w === 'month') return done(addDays(today(), 30), m[0]);
      if (w === 'year')  return done(addDays(today(), 365), m[0]);
      return done(nextWeekday(DAY_NAMES[w]), m[0]);
    }

    // today / tomorrow
    if ((m = t.match(/^(today|tonight)\b/i)))  return done(today(), m[0]);
    if ((m = t.match(/^(tomorrow|tmrw?|tmr)\b/i))) return done(addDays(today(), 1), m[0]);

    // friday
    if ((m = t.match(/^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*/i))) {
      const key = m[1].slice(0, 3).toLowerCase();
      return done(nextWeekday(DAY_NAMES[key]), m[0]);
    }

    // sep 12 / september 12, 2027
    if ((m = t.match(new RegExp(`^(${MONTH_RE})[a-z]*\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`, 'i')))) {
      const mi = monthIndex(m[1]);
      const year = m[3] ? +m[3] : today().getFullYear();
      const d = new Date(year, mi, +m[2]);
      if (!m[3] && d < today()) d.setFullYear(year + 1);
      return done(d, m[0]);
    }

    // 12 sep
    if ((m = t.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})[a-z]*`, 'i')))) {
      const mi = monthIndex(m[2]);
      const d = new Date(today().getFullYear(), mi, +m[1]);
      if (d < today()) d.setFullYear(d.getFullYear() + 1);
      return done(d, m[0]);
    }

    return null;
  }

  /**
   * Turn a raw composer line into an idea draft.
   * "Study app @in 3 weeks #school !building" → {title, date, tags, status}
   */
  function parseInput(raw) {
    let text = raw;
    let date = null;
    let status = 'spark';
    const tags = [];

    // @date
    const at = text.indexOf('@');
    if (at !== -1) {
      const parsed = parseDateExpr(text.slice(at + 1));
      if (parsed) {
        date = parsed.date;
        text = text.slice(0, at) + text.slice(at + 1 + parsed.length);
      }
    }

    // !status
    text = text.replace(/!(\w+)/g, (full, word) => {
      const key = Object.keys(STATUSES).find((s) => s.startsWith(word.toLowerCase()));
      if (key) { status = key; return ''; }
      return full;
    });

    // #tags
    text = text.replace(/#([\w-]+)/g, (_, tag) => { tags.push(tag); return ''; });

    return { title: text.replace(/\s+/g, ' ').trim(), date, tags, status };
  }

  /* ---------------------------------------------------------
     State
     --------------------------------------------------------- */

  let ideas = [];
  let view = 'float';
  let filter = 'all';
  let query = '';
  let editingId = null;
  let lastSnapshot = null;
  let online = false;

  function normalize(raw) {
    return {
      id: raw.id || uid(),
      title: String(raw.title || 'Untitled idea'),
      note: String(raw.note || ''),
      date: raw.date || null,
      status: STATUSES[raw.status] ? raw.status : 'spark',
      tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean).map(String) : [],
      createdAt: raw.createdAt || new Date().toISOString(),
    };
  }

  /* ---------------------------------------------------------
     Persistence

     server.js is the source of truth. If it isn't reachable —
     someone opened index.html straight off disk — Orbit falls
     back to localStorage so the board still works.
     --------------------------------------------------------- */

  async function request(method, path = '', body) {
    const res = await fetch(API + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || `${method} ${API}${path} → ${res.status}`);
    }
    return res.json();
  }

  /**
   * Send a change that has already been applied to `ideas`.
   * `before` is the array as it was, so a failed write can be undone.
   */
  async function persist(work, before) {
    cacheLocally();
    if (!online) return true;
    try {
      await work();
      cacheLocally();
      return true;
    } catch (err) {
      console.error('[orbit]', err);
      if (before) { ideas = before; cacheLocally(); render(); }
      toast('Server unreachable — that change was not saved.');
      return false;
    }
  }

  function cacheLocally() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(ideas));
    } catch (err) {
      console.warn('[orbit] local cache failed:', err);
    }
  }

  function loadCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.map(normalize) : [];
    } catch {
      return [];
    }
  }

  async function boot() {
    // leftovers from the localStorage-only version
    localStorage.removeItem('orbit.ideas.v1');
    localStorage.removeItem('orbit.seeded.v1');

    try {
      ideas = (await request('GET')).ideas.map(normalize);
      online = true;
      cacheLocally();
    } catch {
      ideas = loadCache();
      $('#localOnly').hidden = false;
      $('#localOnly').title = 'The backend is not running — changes stay in this browser.';
    }

    render();
    requestAnimationFrame(tick);
  }

  /** Another tab or device may have moved on while we were away. */
  async function refresh() {
    if (!online || !modalRoot.hidden || quickAdd.value.trim() || drag) return;
    try {
      const next = (await request('GET')).ideas.map(normalize);
      if (JSON.stringify(next) !== JSON.stringify(ideas)) {
        ideas = next;
        cacheLocally();
        render();
      }
    } catch { /* keep showing what we have */ }
  }

  const byId = (id) => ideas.find((i) => i.id === id);

  function visibleIdeas() {
    const q = query.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (filter === 'dated' && !idea.date) return false;
      if (filter === 'undated' && idea.date) return false;
      if (STATUSES[filter] && idea.status !== filter) return false;
      if (!q) return true;
      return (
        idea.title.toLowerCase().includes(q) ||
        idea.note.toLowerCase().includes(q) ||
        idea.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }

  /* ---------------------------------------------------------
     Elements
     --------------------------------------------------------- */

  const stage      = $('#stage');
  const timelineEl = $('#timeline');
  const emptyEl    = $('#empty');
  const composer   = $('#composer');
  const quickAdd   = $('#quickAdd');
  const hintsEl    = $('#composerHints');
  const searchEl   = $('#search');
  const modalRoot  = $('#modalRoot');
  const toastEl    = $('#toast');
  const fileInput  = $('#fileInput');

  /* ---------------------------------------------------------
     Float view — a gentle physics field of drifting bubbles
     --------------------------------------------------------- */

  const nodes = new Map();   // id -> { el, x, y, vx, vy, w, h, scale, targetScale, hover, dragging }
  const PAD = 14;
  const BOTTOM_KEEPOUT = 92; // leave the composer some breathing room

  function bounds() {
    return {
      w: stage.clientWidth,
      h: stage.clientHeight,
    };
  }

  function bubbleMarkup(idea) {
    const date = idea.date
      ? `<span class="b-date${isLate(idea) ? ' late' : ''}" title="${formatDate(idea.date)}">${relative(idea.date)}</span>`
      : `<span class="b-date">Someday</span>`;
    const tags = idea.tags.slice(0, 2).map((t) => '#' + esc(t)).join(' ');

    return `
      <div class="b-status">${STATUSES[idea.status]}</div>
      <h3 class="b-title">${esc(idea.title)}</h3>
      ${idea.note ? `<p class="b-note">${esc(idea.note)}</p>` : ''}
      <div class="b-foot">
        ${date}
        ${tags ? `<span class="b-tags">${tags}</span>` : ''}
      </div>`;
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  /**
   * Spots for `n` bubbles spread over a jittered grid, so a fresh load
   * starts evenly distributed instead of clumped.
   */
  function spreadPositions(n) {
    const b = bounds();
    const usableH = Math.max(1, b.h - BOTTOM_KEEPOUT);
    if (n <= 0) return [];
    const cols = clamp(Math.round(Math.sqrt(n * (b.w / usableH))), 1, n);
    const rows = Math.ceil(n / cols);
    const spots = [];
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      spots.push({
        fx: (col + 0.5 + (Math.random() - 0.5) * 0.5) / cols,
        fy: (row + 0.5 + (Math.random() - 0.5) * 0.5) / rows,
      });
    }
    return spots;
  }

  function createNode(idea, spawnAtComposer, spot) {
    const el = document.createElement('article');
    el.className = 'bubble';
    el.dataset.id = idea.id;
    el.innerHTML = bubbleMarkup(idea);
    stage.appendChild(el);

    const b = bounds();
    const w = el.offsetWidth || 220;
    const h = el.offsetHeight || 120;

    let x, y, vx, vy;
    if (spawnAtComposer) {
      x = b.w / 2 - w / 2 + (Math.random() - 0.5) * 90;
      y = b.h - BOTTOM_KEEPOUT - h;
      vx = (Math.random() - 0.5) * 0.5;
      vy = -0.55 - Math.random() * 0.3;
    } else {
      const usableH = b.h - BOTTOM_KEEPOUT;
      const s = spot || { fx: Math.random(), fy: Math.random() };
      x = clamp(s.fx * b.w - w / 2, PAD, Math.max(PAD, b.w - w - PAD));
      y = clamp(s.fy * usableH - h / 2, PAD, Math.max(PAD, usableH - h - PAD));
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.12 + Math.random() * 0.16;
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed;
    }

    const node = { el, x, y, vx, vy, w, h, scale: 1, targetScale: 1, hover: false, dragging: false };
    nodes.set(idea.id, node);

    el.addEventListener('pointerenter', () => { node.hover = true; node.targetScale = 1.045; });
    el.addEventListener('pointerleave', () => { node.hover = false; node.targetScale = 1; });
    el.addEventListener('pointerdown', (e) => startDrag(e, idea.id));

    place(node);
    return node;
  }

  function place(node) {
    node.el.style.transform =
      `translate3d(${node.x.toFixed(2)}px, ${node.y.toFixed(2)}px, 0) scale(${node.scale.toFixed(3)})`;
  }

  /** Reconcile the DOM bubbles with the current filtered list. */
  function syncFloat(list, spawnedId) {
    const wanted = new Set(list.map((i) => i.id));

    for (const [id, node] of nodes) {
      if (!wanted.has(id)) {
        node.el.remove();
        nodes.delete(id);
      }
    }

    const spots = spreadPositions(list.filter((i) => !nodes.has(i.id)).length);
    let spotIndex = 0;

    for (const idea of list) {
      const existing = nodes.get(idea.id);
      if (!existing) {
        createNode(idea, idea.id === spawnedId, spots[spotIndex++]);
      } else {
        existing.el.innerHTML = bubbleMarkup(idea);
        existing.w = existing.el.offsetWidth;
        existing.h = existing.el.offsetHeight;
      }
    }
  }

  /* ------------------ drag ------------------ */

  let drag = null;

  function startDrag(e, id) {
    if (e.button !== undefined && e.button !== 0) return;
    const node = nodes.get(id);
    if (!node) return;

    drag = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - node.x,
      offY: e.clientY - node.y,
      lastX: e.clientX,
      lastY: e.clientY,
      vx: 0,
      vy: 0,
      moved: false,
    };
    node.dragging = true;
    node.targetScale = 1.07;
    node.el.classList.add('dragging');
    node.el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const node = nodes.get(drag.id);
    if (!node) return;
    node.x = e.clientX - drag.offX;
    node.y = e.clientY - drag.offY;
    drag.vx = e.clientX - drag.lastX;
    drag.vy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (Math.abs(e.clientX - drag.startX) > 3 || Math.abs(e.clientY - drag.startY) > 3) drag.moved = true;
    place(node);
  });

  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const node = nodes.get(drag.id);
    if (node) {
      node.dragging = false;
      node.targetScale = node.hover ? 1.045 : 1;
      node.el.classList.remove('dragging');
      // fling: carry a little of the drag momentum into the drift
      node.vx = clamp(drag.vx * 0.25, -6, 6);
      node.vy = clamp(drag.vy * 0.25, -6, 6);
    }
    if (!drag.moved) openModal(drag.id);
    drag = null;
    e.preventDefault?.();
  });

  /* ------------------ animation loop ------------------ */

  let lastTime = performance.now();

  function tick(now) {
    const dt = clamp((now - lastTime) / 16.667, 0, 3);
    lastTime = now;

    if (view === 'float' && nodes.size) {
      const b = bounds();
      const list = Array.from(nodes.values());
      const maxY = b.h - BOTTOM_KEEPOUT;

      for (const node of list) {
        node.scale += (node.targetScale - node.scale) * 0.18;

        if (node.dragging) { place(node); continue; }

        // hovered bubbles slow to a near stop so they're easy to read
        const damp = node.hover ? 0.86 : 0.998;
        node.vx *= Math.pow(damp, dt);
        node.vy *= Math.pow(damp, dt);

        // keep a whisper of motion so the field never freezes
        if (!node.hover) {
          const speed = Math.hypot(node.vx, node.vy);
          if (speed < 0.08) {
            const a = Math.random() * Math.PI * 2;
            node.vx += Math.cos(a) * 0.02;
            node.vy += Math.sin(a) * 0.02;
          }
        }

        node.x += node.vx * dt;
        node.y += node.vy * dt;

        // soft walls
        if (node.x < PAD)                { node.x = PAD; node.vx = Math.abs(node.vx) * 0.85; }
        if (node.x + node.w > b.w - PAD) { node.x = b.w - PAD - node.w; node.vx = -Math.abs(node.vx) * 0.85; }
        if (node.y < PAD)                { node.y = PAD; node.vy = Math.abs(node.vy) * 0.85; }
        if (node.y + node.h > maxY)      { node.y = maxY - node.h; node.vy = -Math.abs(node.vy) * 0.85; }
      }

      // gentle mutual repulsion so cards stay readable
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], c = list[j];
          const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
          const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
          const dx = cx - ax, dy = cy - ay;
          const minX = (a.w + c.w) / 2 + 10;
          const minY = (a.h + c.h) / 2 + 10;
          if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
            const pushX = (minX - Math.abs(dx)) / minX;
            const pushY = (minY - Math.abs(dy)) / minY;
            const force = 0.16 * dt;
            if (pushX < pushY) {
              const dir = dx >= 0 ? 1 : -1;
              if (!a.dragging) a.vx -= dir * force;
              if (!c.dragging) c.vx += dir * force;
            } else {
              const dir = dy >= 0 ? 1 : -1;
              if (!a.dragging) a.vy -= dir * force;
              if (!c.dragging) c.vy += dir * force;
            }
          }
        }
      }

      for (const node of list) if (!node.dragging) place(node);
    }

    requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------
     Timeline view
     --------------------------------------------------------- */

  function renderTimeline(list) {
    const dated = list.filter((i) => i.date).sort((a, b) => a.date.localeCompare(b.date));
    const undated = list.filter((i) => !i.date);

    const groups = new Map();
    for (const idea of dated) {
      const key = idea.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(idea);
    }

    let html = '<div class="tl-inner">';
    let index = 0;

    for (const [key, items] of groups) {
      const [y, m] = key.split('-').map(Number);
      html += `
        <div class="tl-group">
          <div class="tl-group-head">
            <h3 class="tl-month">${MONTHS[m - 1]} ${y}</h3>
            <span class="tl-count">${items.length}</span>
          </div>
          ${items.map((i) => timelineCard(i, index++)).join('')}
        </div>`;
    }

    if (undated.length) {
      html += `
        <div class="tl-group">
          <div class="tl-group-head">
            <h3 class="tl-month">Someday</h3>
            <span class="tl-count">${undated.length}</span>
          </div>
          ${undated.map((i) => timelineCard(i, index++)).join('')}
        </div>`;
    }

    html += '</div>';
    timelineEl.innerHTML = html;
  }

  function timelineCard(idea, index) {
    const late = isLate(idea);
    const d = fromKey(idea.date);
    const delay = Math.min(index * 18, 300);
    const sub = idea.note || idea.tags.map((t) => '#' + t).join(' ');

    return `
      <div class="tl-card" data-id="${idea.id}" style="animation-delay:${delay}ms">
        <span class="tl-day${late ? ' late' : ''}">${d ? `${d.getDate()} ${DAY_ABBR[d.getDay()]}` : '—'}</span>
        <div class="tl-body">
          <h4>${esc(idea.title)}</h4>
          ${sub ? `<p>${esc(sub)}</p>` : ''}
        </div>
        <span class="tl-meta">
          ${idea.date ? `<span class="${late ? 'late' : ''}">${relative(idea.date)}</span> · ` : ''}${STATUSES[idea.status]}
        </span>
      </div>`;
  }

  /* ---------------------------------------------------------
     Render
     --------------------------------------------------------- */

  function render(spawnedId) {
    const list = visibleIdeas();

    stage.hidden = view !== 'float';
    timelineEl.hidden = view !== 'timeline';
    emptyEl.hidden = list.length > 0;

    if (view === 'float') {
      syncFloat(list, spawnedId);
      timelineEl.innerHTML = '';
    } else {
      for (const [, node] of nodes) node.el.remove();
      nodes.clear();
      renderTimeline(list);
    }

    renderStats();
  }

  function renderStats() {
    const live = ideas.filter((i) => i.status !== 'shipped');
    const soon = live.filter((i) => i.date && daysUntil(i.date) >= 0 && daysUntil(i.date) <= 7);
    const late = live.filter((i) => isLate(i));

    $('#statTotal').textContent = ideas.length;
    $('#statSoon').textContent = soon.length;
    $('#statLate').textContent = late.length;
    $('#statLate').classList.toggle('on', late.length > 0);
  }

  /* ---------------------------------------------------------
     Composer
     --------------------------------------------------------- */

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = quickAdd.value.trim();
    if (!raw) return;

    const draft = parseInput(raw);
    if (!draft.title) {
      toast('Give the idea a name too.');
      return;
    }

    const idea = normalize(draft);
    const before = ideas;
    ideas = [idea, ...ideas];
    quickAdd.value = '';
    updateHints();
    render(idea.id);
    toast(`Added “${idea.title}”${idea.date ? ' · ' + relative(idea.date) : ''}`);
    persist(() => request('POST', '', idea), before);
  });

  quickAdd.addEventListener('input', updateHints);

  // the whole bar is a big target for the input
  composer.addEventListener('click', (e) => {
    if (!e.target.closest('button')) quickAdd.focus();
  });

  function updateHints() {
    const raw = quickAdd.value;
    if (!raw.trim()) { hintsEl.textContent = ''; return; }

    const draft = parseInput(raw);
    const bits = [];
    if (draft.date) bits.push(`${formatDate(draft.date)} · ${relative(draft.date)}`);
    if (draft.status !== 'spark') bits.push(STATUSES[draft.status]);
    if (draft.tags.length) bits.push('#' + draft.tags.join(' #'));
    hintsEl.textContent = bits.join('  ·  ');
  }

  /* ---------------------------------------------------------
     Modal editor
     --------------------------------------------------------- */

  const mTitle = $('#mTitle');
  const mNote = $('#mNote');
  const mDate = $('#mDate');
  const mStatus = $('#mStatus');
  const mTags = $('#mTags');
  const mCountdown = $('#mCountdown');

  function openModal(id) {
    const idea = byId(id);
    if (!idea) return;
    editingId = id;

    mTitle.value = idea.title;
    mNote.value = idea.note;
    mDate.value = idea.date || '';
    mStatus.value = idea.status;
    mTags.value = idea.tags.join(', ');

    updateCountdown();
    modalRoot.hidden = false;
    setTimeout(() => mTitle.focus(), 60);
  }

  function closeModal() {
    modalRoot.hidden = true;
    editingId = null;
  }

  function updateCountdown() {
    const key = mDate.value;
    if (!key) { mCountdown.className = 'countdown'; mCountdown.textContent = ''; return; }
    const d = fromKey(key);
    mCountdown.className = `countdown${daysUntil(key) < 0 ? ' late' : ''}`;
    mCountdown.textContent =
      `${relative(key)} — ${DAY_ABBR[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  mDate.addEventListener('input', updateCountdown);

  $('#quickDates').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.days === 'clear') mDate.value = '';
    else mDate.value = toKey(addDays(today(), +btn.dataset.days));
    updateCountdown();
  });

  $('#mSave').addEventListener('click', () => {
    const current = byId(editingId);
    if (!current) return closeModal();

    const patch = {
      title: mTitle.value.trim() || 'Untitled idea',
      note: mNote.value.trim(),
      date: mDate.value || null,
      status: mStatus.value,
      tags: mTags.value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
    };
    const updated = { ...current, ...patch };

    const before = ideas;
    ideas = ideas.map((i) => (i.id === updated.id ? updated : i));
    closeModal();
    render();
    toast('Saved');
    persist(() => request('PATCH', '/' + encodeURIComponent(updated.id), patch), before);
  });

  $('#mDelete').addEventListener('click', () => {
    const idea = byId(editingId);
    if (!idea) return closeModal();
    snapshot();
    const before = ideas;
    ideas = ideas.filter((i) => i.id !== idea.id);
    closeModal();
    render();
    toast(`Deleted “${idea.title}”`, 'Undo');
    persist(() => request('DELETE', '/' + encodeURIComponent(idea.id)), before);
  });

  modalRoot.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });

  /* ---------------------------------------------------------
     Views, filters, search
     --------------------------------------------------------- */

  $$('.view').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.view').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      view = btn.dataset.view;
      render();
    });
  });

  $('#filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $$('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    filter = chip.dataset.filter;
    render();
  });

  searchEl.addEventListener('input', () => {
    query = searchEl.value;
    render();
  });

  timelineEl.addEventListener('click', (e) => {
    const card = e.target.closest('.tl-card');
    if (card) openModal(card.dataset.id);
  });

  /* ---------------------------------------------------------
     Menu: export / import / shuffle / wipe
     --------------------------------------------------------- */

  const menu = $('#menu');
  const menuBtn = $('#menuBtn');

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });

  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.menu-wrap')) {
      menu.hidden = true;
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  menu.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');

    if (act === 'export') exportJSON();
    if (act === 'import') fileInput.click();
    if (act === 'shuffle') shuffle();
    if (act === 'wipe') {
      if (!ideas.length) return toast('Nothing to delete.');
      snapshot();
      const before = ideas;
      const n = ideas.length;
      ideas = [];
      render();
      toast(`Deleted ${n} idea${n > 1 ? 's' : ''}`, 'Undo');
      persist(() => request('DELETE'), before);
    }
  });

  function exportJSON() {
    const blob = new Blob([JSON.stringify(ideas, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orbit-ideas-${toKey(today())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${ideas.length} ideas`);
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error('not a list of ideas');
      snapshot();
      const before = ideas;
      const next = ideas.slice();
      let added = 0, updated = 0;
      for (const raw of parsed) {
        const idea = normalize(raw);
        const at = next.findIndex((i) => i.id === idea.id);
        if (at >= 0) { next[at] = idea; updated++; }
        else { next.unshift(idea); added++; }
      }
      ideas = next;
      render();
      toast(`Imported ${added} new, ${updated} updated`, 'Undo');
      persist(() => request('PUT', '', { ideas }), before);
    } catch (err) {
      console.error('[orbit] import failed:', err);
      toast("That file didn't look like an Orbit export.");
    }
    fileInput.value = '';
  });

  function shuffle() {
    if (view !== 'float') { toast('Switch to Float view to shuffle.'); return; }
    const b = bounds();
    const usableH = b.h - BOTTOM_KEEPOUT;
    const spots = spreadPositions(nodes.size);
    let i = 0;
    for (const node of nodes.values()) {
      const s = spots[i++];
      node.x = clamp(s.fx * b.w - node.w / 2, PAD, Math.max(PAD, b.w - node.w - PAD));
      node.y = clamp(s.fy * usableH - node.h / 2, PAD, Math.max(PAD, usableH - node.h - PAD));
      const a = Math.random() * Math.PI * 2;
      node.vx = Math.cos(a) * 0.9;
      node.vy = Math.sin(a) * 0.9;
    }
  }

  /* ---------------------------------------------------------
     Undo + toast
     --------------------------------------------------------- */

  function snapshot() {
    lastSnapshot = JSON.parse(JSON.stringify(ideas));
  }

  let toastTimer;
  function toast(message, actionLabel) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = esc(message) + (actionLabel ? `<button class="u">${esc(actionLabel)}</button>` : '');
    toastEl.hidden = false;
    if (actionLabel) {
      $('.u', toastEl).addEventListener('click', () => {
        if (!lastSnapshot) return;
        const before = ideas;
        ideas = lastSnapshot.map(normalize);
        lastSnapshot = null;
        render();
        toastEl.hidden = true;
        toast('Restored');
        persist(() => request('PUT', '', { ideas }), before);
      });
    }
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, actionLabel ? 6500 : 2600);
  }

  /* ---------------------------------------------------------
     Keyboard
     --------------------------------------------------------- */

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');

    if (e.key === 'Escape') {
      if (!modalRoot.hidden) { closeModal(); return; }
      if (document.activeElement === quickAdd || document.activeElement === searchEl) {
        document.activeElement.blur();
      }
      return;
    }

    // Cmd/Ctrl+Enter saves from inside the modal
    if (!modalRoot.hidden && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      $('#mSave').click();
      return;
    }

    if (typing) return;

    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); quickAdd.focus(); }
    if (e.key === '/') { e.preventDefault(); searchEl.focus(); }
  });

  /* ---------------------------------------------------------
     Resize — keep everything inside the stage
     --------------------------------------------------------- */

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const b = bounds();
      for (const node of nodes.values()) {
        node.w = node.el.offsetWidth;
        node.h = node.el.offsetHeight;
        node.x = clamp(node.x, PAD, Math.max(PAD, b.w - node.w - PAD));
        node.y = clamp(node.y, PAD, Math.max(PAD, b.h - node.h - BOTTOM_KEEPOUT));
        place(node);
      }
    }, 120);
  });

  /* ---------------------------------------------------------
     Go
     --------------------------------------------------------- */

  boot();
  window.addEventListener('focus', refresh);

  // Countdowns are relative — refresh them if the tab is left open past midnight.
  let lastDayStamp = toKey(today());
  setInterval(() => {
    const stamp = toKey(today());
    if (stamp !== lastDayStamp) { lastDayStamp = stamp; render(); }
  }, 60000);
})();
