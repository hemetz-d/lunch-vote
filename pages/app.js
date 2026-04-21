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
  const bannerEl = document.getElementById("banner");
  const hangryEl = document.getElementById("hangry");
  const confettiRoot = document.getElementById("confetti-root");
  const decideBtn = document.getElementById("decide-btn");
  const decideNoteEl = document.getElementById("decide-note");
  const tiebreakerBtn = document.getElementById("tiebreaker-btn");
  const rouletteOverlay = document.getElementById("roulette-overlay");
  const rouletteTitleEl = document.getElementById("roulette-title");
  const rouletteDisplayEl = document.getElementById("roulette-display");
  const shameModal = document.getElementById("shame-modal");
  const shameBodyEl = document.getElementById("shame-body");
  let lastLeaderId;                 // sentinel undefined = haven't rendered yet
  let currentTiedIds = [];           // updated on each render, used by tie-break button
  let lastData = null;

  document.getElementById("change-name").addEventListener("click", () => openNameModal());
  document.getElementById("name-save").addEventListener("click", saveName);
  document.getElementById("name-input").addEventListener("keydown", e => {
    if (e.key === "Enter") saveName();
  });
  refreshBtn.addEventListener("click", manualRefresh);
  noteForm.addEventListener("submit", submitNote);
  decideBtn.addEventListener("click", decideForMe);
  tiebreakerBtn.addEventListener("click", breakTie);
  document.getElementById("shame-cancel").addEventListener("click", dismissShame);
  document.getElementById("shame-confirm").addEventListener("click", confirmShame);

  // Theme persistence. The inline <head> script already applied whatever was
  // in localStorage before first paint; here we just sync the <select> to it
  // and handle changes.
  const themeSelect = document.getElementById("theme-select");
  themeSelect.value = localStorage.getItem("lunch-vote-theme") || "default";
  themeSelect.addEventListener("change", e => {
    const t = e.target.value;
    if (t === "default") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    localStorage.setItem("lunch-vote-theme", t);
  });

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

    // "Decide for me" lockout — 5 minutes of no takebacks after the roulette.
    const lockoutUntil = Number(localStorage.getItem("lunch-vote-lockout-until") || 0);
    if (Date.now() < lockoutUntil) {
      const mins = Math.ceil((lockoutUntil - Date.now()) / 60_000);
      alert(`The dice decided — no changes for another ~${mins} min.`);
      return;
    }

    // Commit shaming — show a modal before the 4th change of the day.
    const hadPrevious = lastData?.myVote && lastData.myVote !== restaurantId;
    const changes = getVoteChanges();
    if (hadPrevious && changes >= 3) {
      const nth = changes + 1;
      const line = nth === 4 ? "This is your 4th change today. Just pick one. 🙄"
                 : nth === 5 ? "Fifth change. The kitchen will be closed before you're done."
                 : "At this point, just close the tab.";
      shameBodyEl.textContent = line;
      shameModal.hidden = false;
      pendingShameAction = () => doVote(restaurantId, /*isChange=*/true);
      return;
    }

    await doVote(restaurantId, hadPrevious);
  }

  let pendingShameAction = null;
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
      headers: {
        "content-type": "application/json",
        "x-user-id": user.id,
        "x-user-name": user.name,
      },
      body: JSON.stringify({ restaurant_id: restaurantId }),
    });
    refresh();
  }

  function voteChangesKey() {
    return `lunch-vote-changes-${lastData?.date ?? "unknown"}`;
  }
  function getVoteChanges() { return Number(localStorage.getItem(voteChangesKey()) || 0); }
  function incrementVoteChanges() {
    localStorage.setItem(voteChangesKey(), String(getVoteChanges() + 1));
  }

  // Decide for me — roulette overlay picks a random restaurant, then casts
  // the vote and locks further changes for 5 minutes.
  async function decideForMe() {
    const user = getUser();
    if (!user) { openNameModal(); return; }
    if (!lastData || lastData.restaurants.length === 0) return;
    decideBtn.disabled = true;

    const choices = lastData.restaurants;
    const pick = choices[Math.floor(Math.random() * choices.length)];
    await playRoulette("Rolling the dice…", choices, pick, "🎯");

    localStorage.setItem("lunch-vote-lockout-until", String(Date.now() + 5 * 60_000));
    await doVote(pick.id, /*isChange=*/false);
    // Keep the button disabled until lockout expires (render() re-evaluates).
  }

  // Tie-breaker spin — advisory only, doesn't change any vote.
  async function breakTie() {
    if (currentTiedIds.length < 2 || !lastData) return;
    const tied = lastData.restaurants.filter(r => currentTiedIds.includes(r.id));
    const pick = tied[Math.floor(Math.random() * tied.length)];
    tiebreakerBtn.disabled = true;
    await playRoulette(`Breaking the ${tied.length}-way tie…`, tied, pick, "🏆");
    tiebreakerBtn.disabled = false;
  }

  // Shared roulette animation: cycle names with decelerating delays, then
  // land on `pick` with a prefix emoji.
  async function playRoulette(title, choices, pick, prefix) {
    rouletteTitleEl.textContent = title;
    rouletteDisplayEl.textContent = "?";
    rouletteDisplayEl.classList.remove("landed");
    rouletteOverlay.hidden = false;

    const delays = [60, 60, 60, 80, 110, 150, 210, 300, 420, 560, 740];
    let cursor = Math.floor(Math.random() * choices.length);
    for (const d of delays) {
      rouletteDisplayEl.textContent = choices[cursor % choices.length].name;
      cursor++;
      await sleep(d);
    }
    rouletteDisplayEl.textContent = `${prefix} ${pick.name}`;
    rouletteDisplayEl.classList.add("landed");
    await sleep(1500);
    rouletteOverlay.hidden = true;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

  function renderBanner(data) {
    const haventVoted = !data.myVote;
    const waiting = data.waitingOn || [];
    bannerEl.innerHTML = "";
    if (!haventVoted && waiting.length === 0) { bannerEl.hidden = true; return; }
    bannerEl.hidden = false;
    bannerEl.className = "banner" + (haventVoted ? " nudge" : "");
    if (haventVoted) {
      const m = document.createElement("span");
      m.textContent = data.previewing ? "You haven't pre-voted for Monday yet." : "You haven't voted yet today.";
      bannerEl.appendChild(m);
    } else {
      bannerEl.appendChild(document.createElement("span"));
    }
    if (waiting.length > 0) {
      const w = document.createElement("span");
      w.className = "waiting";
      const shown = waiting.slice(0, 5);
      const extra = waiting.length - shown.length;
      w.textContent = `Still waiting on: ${shown.join(", ")}${extra > 0 ? ` + ${extra} more` : ""}`;
      bannerEl.appendChild(w);
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
    renderBanner(data);
    mainEl.innerHTML = "";

    const maxVotes = Math.max(0, ...data.restaurants.map(r => r.votes));
    const hasWinner = maxVotes > 0;
    const leaders = data.restaurants.filter(r => r.votes === maxVotes && maxVotes > 0);
    const singleLeaderId = leaders.length === 1 ? leaders[0].id : null;

    // Tie-breaker button visibility: only when 2+ tied at > 0.
    currentTiedIds = leaders.length >= 2 ? leaders.map(r => r.id) : [];
    if (currentTiedIds.length >= 2) {
      tiebreakerBtn.hidden = false;
      tiebreakerBtn.textContent = `🎰 Break the ${currentTiedIds.length}-way tie`;
    } else {
      tiebreakerBtn.hidden = true;
    }

    // Lockout state on the decide button.
    const lockoutUntil = Number(localStorage.getItem("lunch-vote-lockout-until") || 0);
    const lockedOut = Date.now() < lockoutUntil;
    decideBtn.disabled = lockedOut;
    if (lockedOut) {
      const mins = Math.ceil((lockoutUntil - Date.now()) / 60_000);
      decideNoteEl.hidden = false;
      decideNoteEl.textContent = `Locked in for ~${mins} min`;
    } else {
      decideNoteEl.hidden = true;
    }

    // Confetti on leader change — but not on initial render, and not on ties.
    if (lastLeaderId !== undefined && singleLeaderId && singleLeaderId !== lastLeaderId) {
      fireConfetti();
    }
    lastLeaderId = singleLeaderId;

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
      const chef = chefEmoji(r.votes, maxVotes, leaders.length);
      title.innerHTML = titleRow
        + `<span class="chef" title="${chefTitle(r.votes, maxVotes, leaders.length)}">${chef}</span>`
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

  // Chef reacts to how the card is doing relative to the pack.
  function chefEmoji(votes, maxVotes, numLeaders) {
    if (maxVotes === 0) return "🧑‍🍳";              // no votes anywhere — neutral
    if (votes === 0) return "😭";                   // 0 votes but others have some
    if (votes === maxVotes) return numLeaders === 1 ? "😎" : "🤨";  // leading (tied = suspicious)
    return "🤔";                                    // middle of the pack
  }
  function chefTitle(votes, maxVotes, numLeaders) {
    if (maxVotes === 0) return "Chef is ready when you are";
    if (votes === 0) return "Chef is heartbroken";
    if (votes === maxVotes) return numLeaders === 1 ? "Chef is smug" : "Chef is suspicious of the tie";
    return "Chef is in the running";
  }

  // Hangry clock — a face in the header that ages through the morning.
  // Accepts ?clock=HH (integer or decimal) to force a specific hour for testing.
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
    if (hangryEl) {
      hangryEl.textContent = emoji;
      hangryEl.setAttribute("title", title);
    }
  }

  // Confetti burst — inject N colored pieces with randomized drift, let the CSS
  // animation run them down the viewport, then remove.
  function fireConfetti() {
    const COLORS = ["#5B5FC7", "#ff5e9c", "#ffd93d", "#4ac29a", "#f97e5d", "#7ecff1"];
    const N = 80;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < N; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      const startX = Math.random() * 100;                   // vw percent
      const drift  = (Math.random() - 0.5) * 300;           // px lateral drift
      const delay  = Math.random() * 0.4;                   // stagger
      const rotate = Math.random() * 360;
      piece.style.left = `${startX}vw`;
      piece.style.setProperty("--dx", `${drift}px`);
      piece.style.animationDelay = `${delay}s`;
      piece.style.background = COLORS[i % COLORS.length];
      piece.style.transform = `rotate(${rotate}deg)`;
      piece.addEventListener("animationend", () => piece.remove());
      frag.appendChild(piece);
    }
    confettiRoot.appendChild(frag);
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
  updateHangryClock();
  setInterval(updateHangryClock, 60_000);
  refresh();
  setInterval(refresh, REFRESH_MS);
})();
