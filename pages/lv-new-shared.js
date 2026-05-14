// Lunch Vote — new UI shared module.
// Pulled in by both index-new.html (Today / Slate Reels) and week-new.html.
//
// Vanilla JS, no build step, matches the style of the existing app.js.
// Identity / api client / restaurant metadata / preference toggles / shared
// DOM helpers live here, attached to window.LV.

(() => {
  const API = location.origin;

  // ---------- Identity (shared with existing app.js) ----------
  // We reuse `lunch-vote-user` so a vote on /new and a vote on / are the same
  // user from the backend's perspective.
  function getUser() {
    try { return JSON.parse(localStorage.getItem("lunch-vote-user") || "null"); }
    catch { return null; }
  }
  function setUser(user) {
    localStorage.setItem("lunch-vote-user", JSON.stringify(user));
  }
  function ensureUser(name) {
    const existing = getUser();
    const id = existing?.id || crypto.randomUUID();
    const user = { id, name };
    setUser(user);
    return user;
  }

  // ---------- Preferences (new UI namespaced; doesn't touch old app's keys) ----------
  const ACCENTS = [
    { id: "red",    color: "#c6442b" },
    { id: "orange", color: "#c45a1f" },
    { id: "green",  color: "#3a8e5a" },
    { id: "blue",   color: "#3a6fb8" },
    { id: "purple", color: "#5b5fc7" },
    { id: "pink",   color: "#c43a7a" },
  ];
  function getTheme() {
    const v = localStorage.getItem("lvn-theme");
    return v === "dark" ? "dark" : "light";
  }
  function setTheme(t) {
    localStorage.setItem("lvn-theme", t);
    document.documentElement.dataset.theme = t;
    updateThemeColorMeta();
  }
  function getAccent() {
    const v = localStorage.getItem("lvn-accent");
    return ACCENTS.find(a => a.id === v) ? v : "red";
  }
  function setAccent(name) {
    localStorage.setItem("lvn-accent", name);
    const a = ACCENTS.find(x => x.id === name) || ACCENTS[0];
    document.documentElement.style.setProperty("--accent", a.color);
    updateThemeColorMeta();
  }
  function updateThemeColorMeta() {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && bg) meta.setAttribute("content", bg);
  }

  // ---------- Restaurant metadata (hardcoded per restaurant id) ----------
  // Just emoji + nick — colors come from the user's accent.
  const BRAND_META = {
    ferdinando:    { emoji: "🍕", nick: "Italian"     },
    radatz:        { emoji: "🥩", nick: "Butcher"     },
    "noodle-king": { emoji: "🍜", nick: "Asian"       },
    odysseus:      { emoji: "🫒", nick: "Greek"       },
    spar:          { emoji: "🛒", nick: "Supermarket" },
  };

  // ---------- Beloved dish alerts (ported from existing app.js) ----------
  // Same patterns as the current app — match name+description, case-insensitive.
  const ALERTS = [
    { restaurantId: "ferdinando", pattern: /\bpizza\b[^./]{0,30}\bdiavol[oa]\b/i, emoji: "🔥", dishName: "Pizza Diavola" },
    { restaurantId: "radatz",     pattern: /\blasagne\b/i,                       emoji: "🍝", dishName: "Lasagne" },
  ];
  function findAlerts(restaurants) {
    // Returns array of { alert, restaurant, option }.
    const out = [];
    for (const r of restaurants) {
      for (const a of ALERTS) {
        if (a.restaurantId !== r.id) continue;
        for (const o of (r.options || [])) {
          const hay = `${o.name || ""} ${o.description || ""}`;
          if (a.pattern.test(hay)) {
            out.push({ alert: a, restaurant: r, option: o });
            break;
          }
        }
      }
    }
    return out;
  }
  function isBeloved(restaurant, option) {
    const a = ALERTS.find(x => x.restaurantId === restaurant.id);
    if (!a) return false;
    return a.pattern.test(`${option.name || ""} ${option.description || ""}`);
  }

  // ---------- API client ----------
  async function apiToday() {
    const user = getUser();
    const headers = {};
    if (user) {
      headers["x-user-id"] = user.id;
      headers["x-user-name"] = user.name;
    }
    const res = await fetch(`${API}/api/today`, { headers });
    if (!res.ok) throw new Error(`/api/today ${res.status}`);
    return res.json();
  }
  // Pass an ISO date (YYYY-MM-DD) to anchor the response on a specific week —
  // the worker resolves it to that Monday's Mon–Fri range. Omit for the
  // server-default (today, or the upcoming Monday on weekends).
  async function apiWeek(date) {
    const url = date
      ? `${API}/api/week?date=${encodeURIComponent(date)}`
      : `${API}/api/week`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`/api/week ${res.status}`);
    return res.json();
  }
  // action defaults to legacy replace-all (single-vote semantics, used by old UI).
  // Pass "add" to accumulate multi-vote picks, "remove" to drop one specific vote.
  async function apiVote(restaurantId, action) {
    const user = getUser();
    if (!user) throw new Error("no user");
    const body = action
      ? { restaurant_id: restaurantId, action }
      : { restaurant_id: restaurantId };
    const res = await fetch(`${API}/api/vote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": user.id,
        "x-user-name": user.name,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`vote failed (${res.status}) ${msg}`);
    }
    return res.json().catch(() => ({}));
  }
  // Wipe all of the user's votes for today — backs the "Change my vote" flow.
  async function apiClearVotes() {
    const user = getUser();
    if (!user) throw new Error("no user");
    const res = await fetch(`${API}/api/vote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": user.id,
        "x-user-name": user.name,
      },
      body: JSON.stringify({ action: "clear" }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`clear failed (${res.status}) ${msg}`);
    }
    return res.json().catch(() => ({}));
  }
  async function apiRefresh() {
    const res = await fetch(`${API}/api/refresh`, { method: "POST" });
    if (!res.ok) {
      if (res.status === 429) {
        const j = await res.json().catch(() => ({}));
        throw new Error(`refreshed recently, try again in ${j.retryAfter || "60"}s`);
      }
      throw new Error(`refresh ${res.status}`);
    }
    return res.json();
  }

  // ---------- DOM helpers ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k.startsWith("on") && typeof v === "function") {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k.startsWith("data-") || k.startsWith("aria-")) {
          el.setAttribute(k, v);
        } else if (k === "html") {
          el.innerHTML = v;
        } else {
          try { el[k] = v; }
          catch { el.setAttribute(k, v); }
        }
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------- Shared widgets: Tabs / Header controls ----------
  function makeTabs(active) {
    return h("div", { class: "wo-tabs", role: "tablist", "aria-label": "View" },
      h("a", { href: "/index-new.html", class: active === "today" ? "active" : "" }, "↺ Today"),
      h("a", { href: "/week-new.html", class: active === "week" ? "active" : "" }, "▤ Week"),
    );
  }

  // Header controls: theme, accent, name button + name modal trigger.
  function makeHeaderControls({ onOpenName } = {}) {
    const themeBtn = h("button", { class: "icon-btn", title: "Toggle theme" });
    const accentBtn = h("button", { class: "icon-btn", title: "Cycle accent color" });
    const swatch = h("span", { class: "accent-swatch" });
    accentBtn.append(swatch);
    const nameBtn = h("button", { class: "icon-btn", title: "Change name" });

    function syncLabels() {
      themeBtn.textContent = getTheme() === "dark" ? "☀️" : "🌙";
      swatch.style.background = (ACCENTS.find(a => a.id === getAccent()) || ACCENTS[0]).color;
      accentBtn.innerHTML = "";
      accentBtn.append(swatch);
      const user = getUser();
      nameBtn.textContent = "";
      nameBtn.append(user?.name || "Set name", " ▾");
    }
    themeBtn.addEventListener("click", () => { setTheme(getTheme() === "dark" ? "light" : "dark"); syncLabels(); });
    accentBtn.addEventListener("click", () => {
      const i = ACCENTS.findIndex(a => a.id === getAccent());
      setAccent(ACCENTS[(i + 1) % ACCENTS.length].id);
      syncLabels();
      // Pulse the swatch — adjacent accents (e.g. red→orange) are subtle
      // enough that a static color swap can read as "nothing happened".
      swatch.classList.remove("pulse");
      void swatch.offsetWidth;
      swatch.classList.add("pulse");
    });
    nameBtn.addEventListener("click", () => { if (onOpenName) onOpenName(); });

    syncLabels();
    return { container: h("div", { class: "controls" }, themeBtn, accentBtn, nameBtn), syncLabels };
  }

  // Avatar pile. ids = array of names. We hash name → tone slot so colors are
  // stable per person across renders.
  function toneFor(name) {
    const s = String(name || "?");
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const tones = ["a", "b", "c", "d", "e", "f"];
    return tones[hash % tones.length];
  }
  function avatar(voter) {
    const name = typeof voter === "string" ? voter : (voter?.name || voter?.id || "?");
    const initial = name.trim()[0]?.toUpperCase() || "?";
    return h("span", { class: `av t-${toneFor(name)}`, title: name }, initial);
  }
  function pile(voters, max = 4) {
    const list = (voters || []).slice();
    const shown = list.slice(0, max);
    const extra = list.length - shown.length;
    const el = h("span", { class: "pile" });
    for (const v of shown) el.append(avatar(v));
    if (extra > 0) el.append(h("span", { class: "av plus" }, `+${extra}`));
    return el;
  }

  // Name modal — same look as the prototype.
  function openNameModal({ onSave, onCancel } = {}) {
    // Dedup: if a name modal is already mounted, don't stack another. Renderers
    // call this on every paint when there's no user, and the 10s poll keeps
    // re-rendering — without this guard, overlays accumulate forever.
    if (document.querySelector("body > .overlay")) return;

    const user = getUser();
    let typed = user?.name || "";
    let chosenAccent = getAccent();

    const input = h("input", {
      type: "text", value: typed, placeholder: "Jane from Marketing", autocomplete: "off",
      onInput: (e) => { typed = e.target.value; saveBtn.disabled = !typed.trim(); },
      onKeyDown: (e) => { if (e.key === "Enter" && typed.trim()) commit(); },
    });
    const swatchRow = h("div", { class: "swatch-row", role: "radiogroup", "aria-label": "Accent" });
    for (const a of ACCENTS) {
      const b = h("button", {
        type: "button", class: "swatch", "aria-label": a.id,
        style: { background: a.color },
        "aria-pressed": String(a.id === chosenAccent),
        onClick: () => {
          chosenAccent = a.id;
          for (const c of swatchRow.children) c.setAttribute("aria-pressed", String(c.getAttribute("aria-label") === a.id));
        },
      });
      swatchRow.append(b);
    }
    const saveBtn = h("button", { class: "btn primary", onClick: () => commit() }, "Continue");
    saveBtn.disabled = !typed.trim();

    const modal = h("div", { class: "modal", onClick: (e) => e.stopPropagation() },
      h("h2", null, "What's your name?"),
      h("p", null, "Used to label your vote. Pick a color so the avatar pile reflects you."),
      input, swatchRow,
      h("div", { class: "actions" }, saveBtn),
    );
    const overlay = h("div", { class: "overlay", onClick: () => { if (user && onCancel) close(false); } }, modal);
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 50);

    function commit() {
      if (!typed.trim()) return;
      setAccent(chosenAccent);
      const u = ensureUser(typed.trim());
      close(true);
      if (onSave) onSave(u);
    }
    function close(saved) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (!saved && onCancel) onCancel();
    }
  }

  // Seedable PRNG used by the voting-deck shuffle in today.js. Caller passes
  // a numeric seed so the shuffle stays stable across in-session reloads
  // (the 10s poll, refresh button, etc.) — important so cards don't shift
  // around mid-vote. A fresh page load gets a new seed and thus a new order.
  function mulberry32(seed) {
    return function() {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffleWithSeed(arr, seed) {
    if (!Array.isArray(arr) || arr.length <= 1) return Array.isArray(arr) ? arr.slice() : [];
    const rng = mulberry32(seed >>> 0);
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // Tiny floating refresh button — mounted once at bottom-right. Idempotent
  // so both today.js and week.js can call it on boot without dup checks.
  function mountAdminRefreshButton() {
    if (document.querySelector(".refresh-admin")) return;
    const btn = h("button", {
      class: "refresh-admin",
      title: "Refresh menus (admin)",
      "aria-label": "Refresh menus",
      onClick: async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add("spinning");
        try {
          await apiRefresh();
          window.location.reload();
        } catch (e) {
          btn.disabled = false;
          btn.classList.remove("spinning");
          alert(e.message);
        }
      },
    }, "↻");
    document.body.appendChild(btn);
  }

  // Boot: apply persisted prefs as soon as this script loads.
  setTheme(getTheme());
  setAccent(getAccent());
  // Drop any leftover key from the old brand-toggle days so it doesn't sit
  // in users' localStorage forever.
  try { localStorage.removeItem("lvn-brand"); } catch {}

  // Expose only what page scripts actually consume. Internal helpers
  // (setUser, escape, avatar, toneFor, API, ACCENTS) stay closed-over inside
  // this IIFE — adding them to window.LV would imply they're part of the
  // module's interface, which they aren't.
  window.LV = {
    BRAND_META, ALERTS,
    getUser, ensureUser,
    getTheme, setTheme, getAccent, setAccent,
    findAlerts, isBeloved,
    apiToday, apiWeek, apiVote, apiClearVotes, apiRefresh,
    h, clear,
    makeTabs, makeHeaderControls, pile,
    openNameModal,
    shuffleWithSeed, mountAdminRefreshButton,
  };
})();
