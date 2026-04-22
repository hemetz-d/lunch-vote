// Lunch Vote frontend. Plain JS, no build step.
// API base: same origin by default. Override with ?api=https://... for local dev.

(() => {
  const params = new URLSearchParams(location.search);
  const API = params.get("api") || location.origin;
  const REFRESH_MS = 10_000;
  const STALE_MS = 2.5 * 24 * 60 * 60 * 1000;  // > 2.5 days since last fetch → stale badge

  // Fire an attention-grabbing banner when a restaurant's menu today contains
  // a beloved dish. Matched against name + description, case-insensitive.
  const ALERTS = [
    {
      // Require "pizza" to appear near "diavola/o" so pasta dishes like
      // "Penne alla Diavola" don't trigger. The [^./] bound stops matching
      // at the "/" separating the Italian name from the German translation,
      // so a Pizza Margherita paired with a Penne Diavola description
      // won't match either.
      restaurantId: "ferdinando",
      pattern: /\bpizza\b[^./]{0,30}\bdiavol[oa]\b/i,
      emoji: "🔥",
      dishName: "Pizza Diavola",
    },
    {
      restaurantId: "radatz",
      pattern: /\blasagne\b/i,
      emoji: "🍝",
      dishName: "Lasagne",
    },
  ];

  // ---------- DOM references ----------
  const nameModal = document.getElementById("name-modal");
  const whoEl = document.getElementById("who");
  const dateEl = document.getElementById("date");
  const mainEl = document.getElementById("main");
  const footerEl = document.getElementById("footer-status");
  const refreshBtn = document.getElementById("refresh-btn");
  const notesListEl = document.getElementById("notes-list");
  const noteForm = document.getElementById("note-form");
  const noteInput = document.getElementById("note-input");
  const noteSubmit = document.getElementById("note-submit");
  const bannerEl = document.getElementById("banner");
  const alertsEl = document.getElementById("alerts");
  const hangryEl = document.getElementById("hangry");
  const confettiRoot = document.getElementById("confetti-root");
  const protestBtn = document.getElementById("protest-btn");
  const protestVotersEl = document.getElementById("protest-voters");
  const leaderboardBody = document.getElementById("leaderboard-body");
  const leaderboardSummary = document.getElementById("leaderboard-summary");
  const shameModal = document.getElementById("shame-modal");
  const shameBodyEl = document.getElementById("shame-body");
  const weekGridEl = document.getElementById("week-grid");
  const weekTitleEl = document.getElementById("week-title");
  const tabButtons = document.querySelectorAll(".tab");

  let lastLeaderId;         // sentinel undefined = haven't rendered yet
  let lastData = null;
  let weekData = null;
  let autoRefreshed = false;
  let pendingShameAction = null;
  let activeView = localStorage.getItem("lunch-vote-view") === "week" ? "week" : "today";

  // ---------- Event wiring ----------
  document.getElementById("change-name").addEventListener("click", () => openNameModal());
  document.getElementById("name-save").addEventListener("click", saveName);
  document.getElementById("name-input").addEventListener("keydown", e => {
    if (e.key === "Enter") saveName();
  });
  refreshBtn.addEventListener("click", manualRefresh);
  noteForm.addEventListener("submit", submitNote);
  protestBtn.addEventListener("click", toggleProtest);
  document.getElementById("shame-cancel").addEventListener("click", dismissShame);
  document.getElementById("shame-confirm").addEventListener("click", confirmShame);
  for (const btn of tabButtons) btn.addEventListener("click", () => switchView(btn.dataset.view));

  // ---------- Theme toggle ----------
  const themeBtn = document.getElementById("theme-toggle");
  const mqDark = window.matchMedia("(prefers-color-scheme: dark)");
  themeBtn.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("lunch-vote-theme-pref", next);
    updateThemeIcon();
  });
  mqDark.addEventListener("change", () => {
    if (!localStorage.getItem("lunch-vote-theme-pref")) updateThemeIcon();
  });
  function effectiveTheme() {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === "light" || explicit === "dark") return explicit;
    return mqDark.matches ? "dark" : "light";
  }
  function updateThemeIcon() {
    const t = effectiveTheme();
    themeBtn.textContent = t === "dark" ? "☀" : "🌙";
    themeBtn.title = t === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
  updateThemeIcon();

  // ---------- Identity ----------
  function getUser() {
    try { return JSON.parse(localStorage.getItem("lunch-vote-user") || "null"); } catch { return null; }
  }
  function setUser(user) { localStorage.setItem("lunch-vote-user", JSON.stringify(user)); }

  function openNameModal() {
    const user = getUser();
    document.getElementById("name-input").value = user?.name || "";
    nameModal.hidden = false;
    document.getElementById("name-input").focus();
  }

  function saveName() {
    const name = document.getElementById("name-input").value.trim();
    if (!name) return;
    const existing = getUser();
    const user = existing ?? { id: crypto.randomUUID(), name };
    user.name = name;
    setUser(user);
    whoEl.textContent = name;
    nameModal.hidden = true;
    refresh();
  }

  // ---------- Polling ----------
  async function refresh() {
    const user = getUser();
    if (!user) { openNameModal(); return; }
    try {
      const res = await fetch(`${API}/api/today`, {
        headers: { "x-user-id": user.id, "x-user-name": user.name },
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      lastData = await res.json();
      render(lastData);
      footerEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;

      // Self-heal: one-shot refresh when today is empty (fresh deploy /
      // Monday-morning before cron). Skipped on weekends since restaurants
      // typically haven't published next week's menus yet.
      const allEmpty = lastData.restaurants.every(r => r.options.length === 0);
      if (allEmpty && !autoRefreshed && !lastData.previewing) {
        autoRefreshed = true;
        footerEl.textContent = "Fetching menus…";
        try {
          await fetch(`${API}/api/refresh`, { method: "POST" });
          const res2 = await fetch(`${API}/api/today`, { headers: { "x-user-id": user.id, "x-user-name": user.name } });
          if (res2.ok) { lastData = await res2.json(); render(lastData); footerEl.textContent = `Updated ${new Date().toLocaleTimeString()}`; }
        } catch {}
      }
    } catch (err) {
      footerEl.textContent = `Error: ${err.message}`;
    }
  }

  async function manualRefresh() {
    refreshBtn.disabled = true;
    const orig = refreshBtn.textContent;
    refreshBtn.textContent = "Refreshing…";
    footerEl.textContent = "Fetching menus…";
    try {
      const res = await fetch(`${API}/api/refresh`, { method: "POST" });
      if (!res.ok) throw new Error(`refresh ${res.status}`);
      await refresh();
      if (activeView === "week") await loadWeek();
    } catch (err) {
      footerEl.textContent = `Refresh failed: ${err.message}`;
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = orig;
    }
  }

  // ---------- Tabs + view switching ----------
  function switchView(view) {
    if (view !== "today" && view !== "week") return;
    activeView = view;
    localStorage.setItem("lunch-vote-view", view);
    document.body.dataset.view = view;
    for (const btn of tabButtons) {
      const active = btn.dataset.view === view;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    }
    if (view === "week") loadWeek();
  }

  async function loadWeek() {
    try {
      const res = await fetch(`${API}/api/week`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      weekData = await res.json();
      renderWeek(weekData);
    } catch (err) {
      weekGridEl.innerHTML = `<p style="color: var(--muted); font-size: 13px;">Failed to load week: ${escape(err.message)}</p>`;
    }
  }

  function renderWeek(data) {
    weekTitleEl.textContent = formatWeekRange(data.weekStart, data.weekEnd)
      + (data.previewing ? " · next week preview" : "");
    weekGridEl.innerHTML = "";
    for (const day of data.days) {
      const col = document.createElement("div");
      col.className = "day-col" + (day.date === data.today ? " today" : "");
      const weekday = new Date(day.date + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" });
      const monthDay = new Date(day.date + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
      col.innerHTML = `<h3><span>${escape(weekday)}</span><span class="day-date">${escape(monthDay)}</span></h3>`;
      for (const r of day.restaurants) {
        const rEl = document.createElement("div");
        rEl.className = "day-rest";
        const link = r.menuUrl ? `<a href="${escape(r.menuUrl)}" target="_blank" rel="noopener">↗</a>` : "";
        let body = "";
        if (r.options && r.options.length > 0) {
          body = `<ul>${r.options.map(o =>
            `<li><span>${escape(o.name)}</span>${o.price != null ? `<span class="opt-price">€${o.price.toFixed(2)}</span>` : ""}</li>`
          ).join("")}</ul>`;
        } else {
          body = `<div class="empty">No menu</div>`;
        }
        rEl.innerHTML = `<h4><span>${escape(r.name)}</span>${link}</h4>${body}`;
        col.appendChild(rEl);
      }
      weekGridEl.appendChild(col);
    }
  }

  function formatWeekRange(startIso, endIso) {
    const s = new Date(startIso + "T12:00:00Z");
    const e = new Date(endIso + "T12:00:00Z");
    const sameMonth = s.getUTCMonth() === e.getUTCMonth();
    const startFmt = s.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" });
    const endFmt = e.toLocaleDateString(undefined, { month: sameMonth ? undefined : "long", day: "numeric", timeZone: "UTC" });
    return `Week of ${startFmt} – ${endFmt}`;
  }

  // ---------- Voting ----------
  async function vote(restaurantId) {
    const user = getUser();
    if (!user) { openNameModal(); return; }

    // Commit shaming — show a modal before the 4th vote change of the day.
    const hadPrevious = lastData?.myVote && lastData.myVote !== restaurantId;
    const changes = getVoteChanges();
    if (hadPrevious && changes >= 3) {
      const nth = changes + 1;
      shameBodyEl.textContent =
        nth === 4 ? "This is your 4th change today. Just pick one 🙄" :
        nth === 5 ? "Fifth change. The kitchen will be closed before you're done." :
                    "At this point, just close the tab.";
      shameModal.hidden = false;
      pendingShameAction = () => doVote(restaurantId, /*isChange=*/true);
      return;
    }
    await doVote(restaurantId, hadPrevious);
  }

  function dismissShame() { shameModal.hidden = true; pendingShameAction = null; }
  async function confirmShame() {
    shameModal.hidden = true;
    const action = pendingShameAction; pendingShameAction = null;
    if (action) await action();
  }

  async function doVote(restaurantId, isChange) {
    const user = getUser();
    if (!user) return;
    if (isChange) incrementVoteChanges();
    await fetch(`${API}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": user.id, "x-user-name": user.name },
      body: JSON.stringify({ restaurant_id: restaurantId }),
    });
    refresh();
  }

  function voteChangesKey() { return `lunch-vote-changes-${lastData?.date ?? "unknown"}`; }
  function getVoteChanges() { return Number(localStorage.getItem(voteChangesKey()) || 0); }
  function incrementVoteChanges() {
    localStorage.setItem(voteChangesKey(), String(getVoteChanges() + 1));
  }

  async function toggleProtest() {
    const user = getUser();
    if (!user) { openNameModal(); return; }
    if (lastData?.myVote === "protest") {
      // Already on the picket line — pick a restaurant to switch.
      alert("You're already on the picket line. Pick a restaurant to switch.");
      return;
    }
    await vote("protest");
  }

  // ---------- Notes ----------
  async function submitNote(e) {
    e.preventDefault();
    const user = getUser();
    if (!user) { openNameModal(); return; }
    const body = noteInput.value.trim();
    if (!body) return;
    noteSubmit.disabled = true;
    try {
      await fetch(`${API}/api/note`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": user.id, "x-user-name": user.name },
        body: JSON.stringify({ body }),
      });
      noteInput.value = "";
      await refresh();
    } finally {
      noteSubmit.disabled = false;
      noteInput.focus();
    }
  }

  // ---------- Rendering ----------
  function renderBanner(data) {
    const haventVoted = !data.myVote;
    const waiting = data.waitingOn || [];
    bannerEl.innerHTML = "";
    if (!haventVoted && waiting.length === 0) { bannerEl.hidden = true; return; }
    bannerEl.hidden = false;
    bannerEl.className = "banner";
    if (haventVoted) {
      const m = document.createElement("span");
      m.className = "nudge-pill";
      m.textContent = data.previewing ? "You haven't pre-voted for Monday yet." : "You haven't voted yet today.";
      bannerEl.appendChild(m);
    }
    if (waiting.length > 0) {
      const w = document.createElement("span");
      w.className = "waiting";
      const shown = waiting.slice(0, 5);
      const extra = waiting.length - shown.length;
      w.textContent = `Waiting on: ${shown.join(", ")}${extra > 0 ? ` + ${extra}` : ""}`;
      bannerEl.appendChild(w);
    }
  }

  function renderAlerts(restaurants) {
    alertsEl.innerHTML = "";
    const triggered = [];
    for (const alert of ALERTS) {
      const r = restaurants.find(x => x.id === alert.restaurantId);
      if (!r || !r.options.length) continue;
      const matched = r.options.find(o =>
        alert.pattern.test(`${o.name} ${o.description || ""}`)
      );
      if (matched) {
        triggered.push({ ...alert, restaurant: r.name, matchedName: matched.name });
      }
    }
    if (triggered.length === 0) { alertsEl.hidden = true; return; }
    alertsEl.hidden = false;
    for (const t of triggered) {
      const div = document.createElement("div");
      div.className = "alert-banner";
      div.innerHTML =
        `<span class="alert-emoji">${t.emoji}</span>`
        + `<span><strong>${escape(t.dishName)}</strong> at <strong>${escape(t.restaurant)}</strong> today — ${escape(t.matchedName)}</span>`;
      alertsEl.appendChild(div);
    }
  }

  function renderNotes(notes) {
    notesListEl.innerHTML = "";
    if (!notes || notes.length === 0) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No notes yet.";
      notesListEl.appendChild(e);
      return;
    }
    for (const n of notes) {
      const d = document.createElement("div");
      d.className = "note";
      const t = new Date(n.createdAt);
      const hhmm = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
      d.innerHTML = `<span class="meta">${hhmm}</span>`
        + `<span class="author">${escape(n.userName)}</span>: `
        + `<span>${escape(n.body)}</span>`;
      notesListEl.appendChild(d);
    }
  }

  function render(data) {
    dateEl.textContent = formatDate(data.date) + (data.previewing ? " · next Monday preview" : "");
    renderBanner(data);
    renderAlerts(data.restaurants);
    renderNotes(data.notes);

    const maxVotes = Math.max(0, ...data.restaurants.map(r => r.votes));
    const hasWinner = maxVotes > 0;
    const leaders = data.restaurants.filter(r => r.votes === maxVotes && maxVotes > 0);
    const singleLeaderId = leaders.length === 1 ? leaders[0].id : null;

    // Confetti on leader transitions (not on first render, not on ties).
    if (lastLeaderId !== undefined && singleLeaderId && singleLeaderId !== lastLeaderId) {
      fireConfetti();
    }
    lastLeaderId = singleLeaderId;

    mainEl.innerHTML = "";
    for (const r of data.restaurants) mainEl.appendChild(renderCard(r, data, maxVotes, leaders.length));

    // Protest button + voter list.
    const protest = data.protest || { votes: 0, voters: [] };
    const iAmProtesting = data.myVote === "protest";
    protestBtn.classList.toggle("active", iAmProtesting);
    protestBtn.textContent = iAmProtesting
      ? `🪧 Protesting${protest.votes > 0 ? ` · ${protest.votes}` : ""}`
      : `🪧 None of these${protest.votes > 0 ? ` · ${protest.votes}` : ""}`;
    if (protest.voters.length > 0) {
      const shown = protest.voters.slice(0, 8);
      const extra = protest.voters.length - shown.length;
      protestVotersEl.innerHTML = shown.map(v => renderVoter(v, data.badges)).join(", ")
        + (extra > 0 ? ` + ${extra}` : "");
      protestVotersEl.hidden = false;
    } else {
      protestVotersEl.hidden = true;
    }

    renderLeaderboard(data.leaderboard || []);
  }

  function renderCard(r, data, maxVotes, numLeaders) {
    const isWinner = maxVotes > 0 && r.votes === maxVotes;
    const classes = ["card"];
    if (data.myVote === r.id) classes.push("voted");
    if (isWinner) classes.push("winning");

    const card = document.createElement("div");
    card.className = classes.join(" ");

    // Header row: name + (optional source link) | chef emoji + tally
    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML = `
      <div>
        <h2>${escape(r.name)}</h2>
        ${r.menuUrl ? `<a class="menu-link" href="${escape(r.menuUrl)}" target="_blank" rel="noopener">View original ↗</a>` : ""}
      </div>
      <div class="meta">
        <span class="chef" title="${escape(chefTitle(r.votes, maxVotes, numLeaders))}">${chefEmoji(r.votes, maxVotes, numLeaders)}</span>
        <span>${r.votes} vote${r.votes === 1 ? "" : "s"}</span>
      </div>`;
    card.appendChild(head);

    // Source health banner.
    if (r.lastError) {
      const s = document.createElement("div");
      s.className = "status error";
      s.textContent = `⚠ Couldn't fetch: ${r.lastError}`;
      card.appendChild(s);
    } else if (r.lastFetchedAt && Date.now() - r.lastFetchedAt > STALE_MS) {
      const s = document.createElement("div");
      s.className = "status stale";
      s.textContent = `Last updated ${Math.floor((Date.now() - r.lastFetchedAt) / 86_400_000)} days ago`;
      card.appendChild(s);
    }

    // Menu.
    if (r.options.length === 0) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = data.previewing
        ? "Not published yet — usually appears Monday morning."
        : "No menu today.";
      card.appendChild(e);
    } else {
      const ul = document.createElement("ul");
      ul.className = "options";
      for (const o of r.options) {
        const li = document.createElement("li");
        li.innerHTML = `<span class="opt-name">${escape(o.name)}</span>`
          + (o.price != null ? `<span class="opt-price">€${o.price.toFixed(2)}</span>` : "")
          + (o.description ? `<div class="opt-desc">${escape(o.description)}</div>` : "");
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }

    // Voters.
    if (r.voters && r.voters.length > 0) {
      const votersEl = document.createElement("div");
      votersEl.className = "voters";
      const shown = r.voters.slice(0, 6);
      const extra = r.voters.length - shown.length;
      votersEl.innerHTML = shown.map(v => renderVoter(v, data.badges)).join(", ")
        + (extra > 0 ? ` + ${extra}` : "");
      card.appendChild(votersEl);
    }

    // Vote button.
    const btn = document.createElement("button");
    btn.className = "vote" + (data.myVote === r.id ? " voted" : "");
    btn.textContent = data.myVote === r.id ? "✓ Your vote" : "Vote for this";
    btn.addEventListener("click", () => vote(r.id));
    card.appendChild(btn);

    return card;
  }

  function renderVoter(name, badgesByName) {
    const badges = (badgesByName && badgesByName[name]) || [];
    const badgeStr = badges.length > 0
      ? ` <span class="voter-badge" title="${escape(badgeTitle(badges))}">${badges.join("")}</span>`
      : "";
    return `${escape(name)}${badgeStr}`;
  }

  function badgeTitle(badges) {
    const map = {
      "🥇": "First vote of the day",
      "🍝": "Loyalist — same pick 3 times running",
      "📝": "Scribe — 10+ notes all-time",
      "👑": "Champion — most votes this week",
    };
    return badges.map(b => map[b] || b).join(" · ");
  }

  function renderLeaderboard(entries) {
    if (!entries || entries.length === 0) {
      leaderboardBody.innerHTML = `<p style="color: var(--muted); font-size: 13px; margin: 10px 0 0;">No activity in the last 7 days yet.</p>`;
      leaderboardSummary.textContent = "Leaderboard";
      return;
    }
    leaderboardSummary.textContent = `Leaderboard · ${entries.length} active`;
    const rows = entries.map((e, i) => `
      <tr>
        <td class="rank">${i + 1}.</td>
        <td>${escape(e.name)}${e.badges.length ? ` <span class="voter-badge">${e.badges.join("")}</span>` : ""}</td>
        <td class="right">${e.votes}</td>
        <td class="right">${e.notes}</td>
      </tr>
    `).join("");
    leaderboardBody.innerHTML = `
      <table>
        <thead>
          <tr><th></th><th>Name</th><th class="right">Votes</th><th class="right">Notes</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ---------- Chef reactions ----------
  function chefEmoji(votes, maxVotes, numLeaders) {
    if (maxVotes === 0) return "🧑‍🍳";
    if (votes === 0) return "😭";
    if (votes === maxVotes) return numLeaders === 1 ? "😎" : "🤨";
    return "🤔";
  }
  function chefTitle(votes, maxVotes, numLeaders) {
    if (maxVotes === 0) return "Chef is ready when you are";
    if (votes === 0) return "Chef is heartbroken";
    if (votes === maxVotes) return numLeaders === 1 ? "Chef is smug" : "Chef is suspicious of the tie";
    return "Chef is in the running";
  }

  // ---------- Hangry clock ----------
  function updateHangryClock() {
    const override = params.get("clock");
    const now = new Date();
    const hm = override !== null ? Number(override) : now.getHours() + now.getMinutes() / 60;
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    let emoji, title;
    if (isWeekend && override === null) { emoji = "🛋️"; title = "It's the weekend — relax"; }
    else if (hm < 9)    { emoji = "😴"; title = "Chef is still asleep"; }
    else if (hm < 10)   { emoji = "🙂"; title = "Lunch is a while off"; }
    else if (hm < 11)   { emoji = "😐"; title = "Stomach stirring"; }
    else if (hm < 11.5) { emoji = "😤"; title = "Getting hangry"; }
    else if (hm < 12)   { emoji = "😠"; title = "Very hangry — decide!"; }
    else if (hm < 13)   { emoji = "👹"; title = "Feral. DECIDE."; }
    else if (hm < 15)   { emoji = "😌"; title = "Post-lunch calm"; }
    else                { emoji = "😑"; title = "Just an afternoon now"; }
    hangryEl.textContent = emoji;
    hangryEl.setAttribute("title", title);
  }

  // ---------- Confetti ----------
  function fireConfetti() {
    const COLORS = ["#5B5FC7", "#ff5e9c", "#ffd93d", "#4ac29a", "#f97e5d", "#7ecff1"];
    const N = 80;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < N; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.setProperty("--dx", `${(Math.random() - 0.5) * 300}px`);
      piece.style.animationDelay = `${Math.random() * 0.4}s`;
      piece.style.background = COLORS[i % COLORS.length];
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      piece.addEventListener("animationend", () => piece.remove());
      frag.appendChild(piece);
    }
    confettiRoot.appendChild(frag);
  }

  // ---------- Utilities ----------
  function formatDate(iso) {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------- Boot ----------
  const user = getUser();
  if (user) whoEl.textContent = user.name;
  updateHangryClock();
  setInterval(updateHangryClock, 60_000);
  switchView(activeView);   // applies body[data-view], tab highlight, and triggers week load if needed
  refresh();
  setInterval(refresh, REFRESH_MS);
})();
