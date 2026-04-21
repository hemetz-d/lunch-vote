// Lunch Vote frontend. Plain JS, no build step.
//
// API base: same origin by default. Override with ?api=https://workers-host for local dev
// when Pages and Worker run on different ports.

(() => {
  const params = new URLSearchParams(location.search);
  const API = params.get("api") || location.origin;
  const REFRESH_MS = 10_000;
  const STALE_MS = 2.5 * 24 * 60 * 60 * 1000;  // > 2.5 days since last fetch → stale badge
  let autoRefreshed = false;                    // fire the empty-state self-heal once per page load

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
  let lastData = null;

  document.getElementById("change-name").addEventListener("click", () => openNameModal());
  document.getElementById("name-save").addEventListener("click", saveName);
  document.getElementById("name-input").addEventListener("keydown", e => {
    if (e.key === "Enter") saveName();
  });
  refreshBtn.addEventListener("click", manualRefresh);
  noteForm.addEventListener("submit", submitNote);

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
      footerEl.textContent = `Last updated ${new Date().toLocaleTimeString()}. Refreshes every 10s.`;

      // Self-heal: if every restaurant is menu-less AND we're showing today
      // (not a weekend preview), fire a one-time refresh. On weekends the
      // restaurants haven't published next week's menus yet, so refreshing
      // would be wasted traffic that can't succeed.
      const allEmpty = lastData.restaurants.every(r => r.options.length === 0);
      if (allEmpty && !autoRefreshed && !lastData.previewing) {
        autoRefreshed = true;
        footerEl.textContent = "No menus yet — fetching now…";
        try {
          await fetch(`${API}/api/refresh`, { method: "POST" });
          const res2 = await fetch(`${API}/api/today`, { headers: { "x-user-id": user.id, "x-user-name": user.name } });
          if (res2.ok) {
            lastData = await res2.json();
            render(lastData);
            footerEl.textContent = `Last updated ${new Date().toLocaleTimeString()}.`;
          }
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
    footerEl.textContent = "Fetching latest menus…";
    try {
      const res = await fetch(`${API}/api/refresh`, { method: "POST" });
      if (!res.ok) throw new Error(`refresh ${res.status}`);
      await refresh();
    } catch (err) {
      footerEl.textContent = `Refresh failed: ${err.message}`;
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = orig;
    }
  }

  async function vote(restaurantId) {
    const user = getUser();
    if (!user) { openNameModal(); return; }
    await fetch(`${API}/api/vote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": user.id,
        "x-user-name": user.name,
      },
      body: JSON.stringify({ restaurant_id: restaurantId }),
    });
    refresh();
  }

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
        headers: {
          "content-type": "application/json",
          "x-user-id": user.id,
          "x-user-name": user.name,
        },
        body: JSON.stringify({ body }),
      });
      noteInput.value = "";
      await refresh();
    } finally {
      noteSubmit.disabled = false;
      noteInput.focus();
    }
  }

  function renderNotes(notes) {
    notesListEl.innerHTML = "";
    if (!notes || notes.length === 0) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No notes yet — first one sets the tone.";
      notesListEl.appendChild(e);
      return;
    }
    for (const n of notes) {
      const d = document.createElement("div");
      d.className = "note";
      const t = new Date(n.createdAt);
      const hhmm = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
      d.innerHTML = `<span class="meta">${hhmm}</span>`
        + `<span class="author">${escape(n.userName)}:</span> `
        + `<span>${escape(n.body)}</span>`;
      notesListEl.appendChild(d);
    }
  }

  function render(data) {
    dateEl.textContent = formatDate(data.date)
      + (data.previewing ? " · next Monday preview" : "");
    renderNotes(data.notes);
    mainEl.innerHTML = "";

    const maxVotes = Math.max(0, ...data.restaurants.map(r => r.votes));
    const hasWinner = maxVotes > 0;

    for (const r of data.restaurants) {
      const isWinner = hasWinner && r.votes === maxVotes;
      const classes = ["card"];
      if (data.myVote === r.id) classes.push("voted");
      if (isWinner) classes.push("winning");
      const card = document.createElement("div");
      card.className = classes.join(" ");
      if (isWinner) {
        const trophy = document.createElement("span");
        trophy.className = "trophy";
        trophy.textContent = "🏆 leading";
        card.appendChild(trophy);
      }
      const title = document.createElement("h2");
      const titleRow = `<span class="title-row">`
        + `<span>${escape(r.name)}</span>`
        + (r.menuUrl ? `<a class="menu-link" href="${escape(r.menuUrl)}" target="_blank" rel="noopener">View original ↗</a>` : "")
        + `</span>`;
      title.innerHTML = titleRow
        + `<span class="tally">${r.votes} vote${r.votes === 1 ? "" : "s"}</span>`;
      card.appendChild(title);

      if (r.lastError) {
        const s = document.createElement("div");
        s.className = "status error";
        s.textContent = `⚠ Couldn't fetch: ${r.lastError}`;
        card.appendChild(s);
      } else if (r.lastFetchedAt && Date.now() - r.lastFetchedAt > STALE_MS) {
        const s = document.createElement("div");
        s.className = "status stale";
        s.textContent = `Menu last updated ${Math.floor((Date.now() - r.lastFetchedAt) / 86400000)} days ago — might be stale`;
        card.appendChild(s);
      }

      if (r.voters && r.voters.length > 0) {
        const votersEl = document.createElement("div");
        votersEl.className = "voters";
        const shown = r.voters.slice(0, 6);
        const extra = r.voters.length - shown.length;
        votersEl.textContent = shown.join(", ") + (extra > 0 ? ` + ${extra} more` : "");
        card.appendChild(votersEl);
      }

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

      const btn = document.createElement("button");
      btn.className = "vote" + (data.myVote === r.id ? " voted" : "");
      btn.textContent = data.myVote === r.id ? "✓ Your vote" : "Vote for this";
      btn.addEventListener("click", () => vote(r.id));
      card.appendChild(btn);

      mainEl.appendChild(card);
    }
  }

  function formatDate(iso) {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  const user = getUser();
  if (user) whoEl.textContent = user.name;
  refresh();
  setInterval(refresh, REFRESH_MS);
})();
