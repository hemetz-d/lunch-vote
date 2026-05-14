// Lunch Vote — Weekly Overview page (vanilla JS port).
// Mounts into #root. Fetches /api/week and renders the chalk-slate grid.

(() => {
  const { h, clear, apiWeek, isBeloved, makeTabs, makeHeaderControls, openNameModal, mountAdminRefreshButton } = window.LV;

  // Restaurants we don't show on the weekly overview because they don't
  // publish a weekly menu (Noodle King is build-your-own, Spar is the
  // supermarket self-service — same every day in both cases). Tally + voting
  // on the Today view still include them.
  const HIDDEN_IN_WEEK = new Set(["noodle-king", "spar"]);
  const isHidden = (r) => HIDDEN_IN_WEEK.has(r.id);

  const root = document.getElementById("root");
  const header = h("header", { class: "header" });
  const topBar = h("div", { class: "wo-top" });
  const boardWrap = h("div", { class: "wo-board-wrap" });
  root.append(header, topBar, boardWrap);

  // anchorDate: null = let the server pick today (or upcoming Monday on
  // weekends). Otherwise an ISO date inside the desired week — the worker
  // snaps it to that Monday's Mon–Fri range.
  let state = { data: null, error: null, loading: true, anchorDate: null };
  let syncHeaderControls = () => {};

  function buildHeader() {
    clear(header);
    const controls = makeHeaderControls({
      onOpenName: () => openNameModal({ onSave: () => render() }),
    });
    syncHeaderControls = controls.syncLabels;
    const inner = h("div", { class: "header-inner" },
      h("div", { class: "brand" },
        h("h1", null, "Lunch Vote"),
        h("p", { class: "date" }, "Week overview"),
      ),
      h("div", { style: { display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" } },
        makeTabs("week"),
        controls.container,
      ),
    );
    header.append(inner);
  }

  function render() {
    syncHeaderControls();
    renderTop();
    renderBoard();
  }

  function renderTop() {
    clear(topBar);
    const d = state.data;
    const range = d ? `${prettyDate(d.weekStart)} – ${prettyDate(d.weekEnd, d.weekStart)}` : "—";
    topBar.append(
      h("div", { class: "wo-title" },
        h("span", { class: "eyebrow" }, "overview · all menus"),
        h("h2", null, d ? `Week of ${range}` : "Loading…"),
      ),
      h("div", { class: "wo-nav" },
        h("button", {
          class: "nav-btn", title: "Previous week", "aria-label": "Previous week",
          onClick: () => shiftWeek(-7),
        }, "←"),
        h("span", { class: "range" }, range),
        h("button", {
          class: "nav-btn",
          // Forward navigation stops at the current week — no menu data
          // exists for future weeks, so the affordance would always lie.
          // weekEnd >= today covers both "on current week" and "already
          // previewing a future week".
          disabled: !d || d.weekEnd >= d.today,
          title: !d || d.weekEnd >= d.today ? "Already on the latest week" : "Next week",
          "aria-label": "Next week",
          onClick: () => shiftWeek(7),
        }, "→"),
      ),
    );
  }

  function renderBoard() {
    clear(boardWrap);
    if (state.loading) {
      boardWrap.append(h("p", { style: { color: "var(--muted)" } }, "Loading week…"));
      return;
    }
    if (state.error) {
      boardWrap.append(
        h("div", { class: "rail-card" },
          h("h3", null, "Couldn't load"),
          h("p", { style: { color: "var(--muted)", fontSize: "14px" } }, state.error),
          h("button", { class: "btn primary", onClick: load }, "Retry"),
        ),
      );
      return;
    }
    const d = state.data;
    if (!d || !d.days || d.days.length === 0) {
      boardWrap.append(h("p", { style: { color: "var(--muted)" } }, "No data for this week."));
      return;
    }

    // Build the ordered restaurant list from day 0 — minus the ones that
    // don't publish a weekly menu (see HIDDEN_IN_WEEK).
    const restaurantOrder = ["ferdinando", "radatz", "odysseus"];
    const byId = new Map();
    for (const day of d.days) {
      for (const r of day.restaurants) {
        if (isHidden(r)) continue;
        if (!byId.has(r.id)) byId.set(r.id, { id: r.id, name: r.name, menuUrl: r.menuUrl });
      }
    }
    const restaurants = restaurantOrder.map(id => byId.get(id)).filter(Boolean);
    // Add any others not in our ordered list (defensive)
    for (const r of byId.values()) {
      if (!restaurants.find(x => x.id === r.id)) restaurants.push(r);
    }

    const board = h("div", { class: "wo-board" });

    // Desktop grid
    const grid = h("div", { class: "wo-grid" });
    // Corner
    grid.append(
      h("div", { class: "wo-cell head corner" },
        h("span", { class: "corner-eyebrow" }, "menus posted"),
        h("span", { class: "corner-title" }, "This week"),
      ),
    );
    // Day header row
    for (const day of d.days) {
      const isToday = day.date === d.today;
      const isPast = day.date < d.today;
      const isFuture = day.date > d.today;
      const colCls = isToday ? "wo-col-today" : isPast ? "wo-col-past" : "wo-col-future";
      grid.append(
        h("div", { class: `wo-cell head ${colCls}` },
          h("div", { class: "wo-day-head" },
            h("span", { class: "name" }, weekdayLong(day.date)),
            h("span", { class: "num" }, dayNum(day.date)),
            isToday ? h("span", { class: "today-pill" }, "today") : null,
            isFuture && !isToday ? h("span", { class: "winner", style: { opacity: 0.7 } }, "upcoming") : null,
          ),
        ),
      );
    }
    // Restaurant rows
    for (const r of restaurants) {
      const meta = window.LV.BRAND_META[r.id] || { emoji: "•", nick: r.name };
      grid.append(
        h("div", { class: "wo-cell row-start" },
          h("span", { class: "emoji" }, meta.emoji),
          h("div", { class: "meta" },
            h("span", { class: "name" }, r.name),
            h("span", { class: "sub" }, meta.nick),
          ),
        ),
      );
      for (const day of d.days) {
        const rDay = day.restaurants.find(x => x.id === r.id);
        const isToday = day.date === d.today;
        const isPast = day.date < d.today;
        const isFuture = day.date > d.today;
        const colCls = isToday ? "wo-col-today" : isPast ? "wo-col-past" : "wo-col-future";
        const options = rDay?.options || [];
        const cell = h("div", { class: `wo-cell ${colCls}` });
        if (options.length === 0) {
          cell.append(h("span", { class: "wo-empty" }, "not posted yet"));
        } else {
          const menu = h("div", { class: "wo-menu" });
          for (const o of options) {
            const beloved = isBeloved(r, o);
            menu.append(
              h("div", { class: "dish" + (beloved ? " beloved" : "") },
                h("span", { class: "name" }, o.name),
                o.price != null ? h("span", { class: "price" }, `€${Number(o.price).toFixed(2)}`) : null,
              ),
            );
          }
          cell.append(menu);
        }
        grid.append(cell);
      }
    }
    board.append(grid);

    // Stacked mobile layout (rendered always; CSS controls visibility)
    const stacked = h("div", { class: "wo-stacked" });
    for (const day of d.days) {
      const isToday = day.date === d.today;
      const isFuture = day.date > d.today;
      const isPast = day.date < d.today;
      const section = h("div", { class: "wo-day-section " + (isToday ? "today-section" : "") },
        h("div", { class: "day-header" },
          h("div", { class: "left" },
            h("span", { class: "num" }, dayNum(day.date)),
            h("span", { class: "name" }, weekdayLong(day.date)),
          ),
          isToday ? h("span", { class: "today-pill" }, "today") : null,
          isFuture && !isToday ? h("span", { style: { fontSize: "12px", color: "var(--chalk-dim)" } }, "upcoming") : null,
        ),
        renderStackedRows(day, restaurants),
      );
      stacked.append(section);
    }
    board.append(stacked);

    boardWrap.append(board);
  }

  function renderStackedRows(day, restaurants) {
    const wrap = h("div", { class: "restaurants" });
    for (const r of restaurants) {
      const meta = window.LV.BRAND_META[r.id] || { emoji: "•", nick: r.name };
      const rDay = day.restaurants.find(x => x.id === r.id);
      const options = rDay?.options || [];
      wrap.append(
        h("div", { class: "r-row" },
          h("div", { class: "r-name" },
            h("span", { class: "r-emoji" }, meta.emoji),
            meta.nick,
          ),
          options.length === 0
            ? h("span", { class: "wo-empty" }, "not posted yet")
            : h("div", { class: "wo-menu" },
                ...options.map(o =>
                  h("div", { class: "dish" + (isBeloved(r, o) ? " beloved" : "") },
                    h("span", { class: "name" }, o.name),
                    o.price != null ? h("span", { class: "price" }, `€${Number(o.price).toFixed(2)}`) : null,
                  ),
                ),
              ),
        ),
      );
    }
    return wrap;
  }

  // ---------- Helpers ----------

  function weekdayLong(iso) {
    try { return new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }); }
    catch { return ""; }
  }
  function dayNum(iso) {
    try { return new Date(iso + "T12:00:00Z").getUTCDate(); }
    catch { return ""; }
  }
  function prettyDate(iso, refIso) {
    try {
      const d = new Date(iso + "T12:00:00Z");
      const ref = refIso ? new Date(refIso + "T12:00:00Z") : null;
      const sameMonth = ref && d.getUTCMonth() === ref.getUTCMonth();
      return d.toLocaleDateString(undefined, sameMonth ? { day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
    } catch { return iso; }
  }

  async function load() {
    try {
      state.loading = true;
      render();
      const data = await apiWeek(state.anchorDate);
      state.data = data;
      state.error = null;
      state.loading = false;
      render();
    } catch (e) {
      state.loading = false;
      state.error = e.message;
      render();
    }
  }

  // Shift the displayed week by `deltaDays` (typically ±7) using the currently
  // displayed weekStart as the pivot. No boundary check — past weeks just show
  // "not posted yet" cells when there's no data, so the user can always step
  // forward again to recover.
  function shiftWeek(deltaDays) {
    const pivot = state.data?.weekStart;
    if (!pivot) return;
    const d = new Date(pivot + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + deltaDays);
    state.anchorDate = d.toISOString().slice(0, 10);
    load();
  }

  // Boot
  buildHeader();
  mountAdminRefreshButton();
  load();
})();
