// Lunch Vote frontend. Plain JS, no build step.
//
// API base: same origin by default. Override with ?api=https://workers-host for local dev
// when Pages and Worker run on different ports.

(() => {
  const params = new URLSearchParams(location.search);
  const API = params.get("api") || location.origin;
  const REFRESH_MS = 10_000;

  const nameModal = document.getElementById("name-modal");
  const whoEl = document.getElementById("who");
  const dateEl = document.getElementById("date");
  const mainEl = document.getElementById("main");
  const footerEl = document.getElementById("footer");
  let lastData = null;

  document.getElementById("change-name").addEventListener("click", () => openNameModal());
  document.getElementById("name-save").addEventListener("click", saveName);
  document.getElementById("name-input").addEventListener("keydown", e => {
    if (e.key === "Enter") saveName();
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
      const res = await fetch(`${API}/api/today`, { headers: { "x-user-id": user.id } });
      if (!res.ok) throw new Error(`API ${res.status}`);
      lastData = await res.json();
      render(lastData);
      footerEl.textContent = `Last updated ${new Date().toLocaleTimeString()}. Refreshes every 10s.`;
    } catch (err) {
      footerEl.textContent = `Error: ${err.message}`;
    }
  }

  async function vote(restaurantId) {
    const user = getUser();
    if (!user) { openNameModal(); return; }
    await fetch(`${API}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": user.id },
      body: JSON.stringify({ restaurant_id: restaurantId }),
    });
    refresh();
  }

  function render(data) {
    dateEl.textContent = formatDate(data.date);
    mainEl.innerHTML = "";
    for (const r of data.restaurants) {
      const card = document.createElement("div");
      card.className = "card" + (data.myVote === r.id ? " voted" : "");
      const title = document.createElement("h2");
      const titleRow = `<span class="title-row">`
        + `<span>${escape(r.name)}</span>`
        + (r.menuUrl ? `<a class="menu-link" href="${escape(r.menuUrl)}" target="_blank" rel="noopener">View original ↗</a>` : "")
        + `</span>`;
      title.innerHTML = titleRow
        + `<span class="tally">${r.votes} vote${r.votes === 1 ? "" : "s"}</span>`;
      card.appendChild(title);

      if (r.options.length === 0) {
        const e = document.createElement("div");
        e.className = "empty";
        e.textContent = "No menu today.";
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
