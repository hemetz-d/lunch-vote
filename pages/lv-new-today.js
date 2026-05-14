// Lunch Vote — Today / Slate Reels page (vanilla JS port).
// Mounts into #root. Fetches /api/today, lets you swipe through the day's
// restaurants, votes via /api/vote.

(() => {
  const { h, clear, escape, pile, avatar,
          getTheme, getAccent,
          apiToday, apiVote, apiClearVotes, apiRefresh, isBeloved,
          getUser, openNameModal, makeTabs, makeHeaderControls,
          shuffleWithSeed, mountAdminRefreshButton } = window.LV;

  // Fresh shuffle seed per page load so each visit gives a new deck order,
  // but stable for the lifetime of this page so the 10s poll / refresh button
  // / other in-session reloads don't reshuffle cards under the user mid-vote.
  const SHUFFLE_SEED = (Math.random() * 0x7fffffff) >>> 0;

  // ---------- State ----------
  const state = {
    data: null,           // /api/today response
    error: null,
    loading: true,
    index: 0,
    actions: {},          // {restaurantId: 'vote' | 'skip'}
    protestActive: false,
    exitState: null,      // 'vote' | 'skip' | 'protest' | null
    drag: { dx: 0, dy: 0, active: false },
    showSummary: false,   // forces summary even if not all cards seen (e.g. after vote)
    // True between "Change my vote" and the next commit — suppresses the
    // apiVoted bounce-back so the user actually gets to re-swipe.
    revoting: false,
  };

  // Drag pointer tracking
  const pointerRef = { id: null, startX: 0, startY: 0 };

  // Tracks the restaurant id that was on top in the last render. When the
  // next render swaps in a new top card (post-commit or post-revote), we add
  // the `entering` class so the new card animates from behind-1 geometry up
  // into the top spot instead of snapping bigger.
  let lastTopId = null;

  // ---------- Root layout (static; built once) ----------
  const root = document.getElementById("root");
  const header = h("header", { class: "header" });
  const layout = h("div", { class: "layout" });
  const leftRail = h("aside", { class: "rail rail-left" });
  const stage = h("main", { class: "stage" });
  const rightRail = h("aside", { class: "rail rail-right" });
  layout.append(leftRail, stage, rightRail);
  root.append(header, layout);

  // Drag move/up listeners live on the persistent stage element (not on the
  // ephemeral card-frame), so they survive the card re-render that happens
  // inside onPointerDown. Combined with `stage.setPointerCapture(...)` in
  // onPointerDown, this also guarantees we receive pointerup even when the
  // user releases outside the browser window — otherwise the drag state
  // stays active and the card sticks to the cursor on next entry.
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerUp);

  // Header bar — rebuilt only once; sync labels via controls helper.
  let syncHeaderControls = () => {};
  function buildHeader() {
    clear(header);
    const controls = makeHeaderControls({
      onOpenName: () => openNameModal({ onSave: () => { rebuildAll(); reload(); } }),
    });
    syncHeaderControls = controls.syncLabels;
    const inner = h("div", { class: "header-inner" },
      h("div", { class: "brand" },
        h("h1", null, "Lunch Vote"),
        h("p", { class: "date" }, "Today"),
      ),
      h("div", { style: { display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" } },
        makeTabs("today"),
        controls.container,
      ),
    );
    header.append(inner);
  }

  // ---------- Render ----------

  function renderAll() {
    syncHeaderControls();
    renderLeftRail();
    renderStage();
    renderRightRail();
  }

  function rebuildAll() {
    buildHeader();
    renderAll();
  }

  function renderLeftRail() {
    clear(leftRail);
    const d = state.data;
    if (!d) return;

    // Alert card — beloved dish on the menu today
    const alerts = window.LV.findAlerts(d.restaurants);
    if (alerts.length > 0) {
      const a = alerts[0];
      leftRail.append(
        h("div", { class: "alert-card" },
          h("span", { class: "emoji" }, a.alert.emoji),
          h("p", null,
            h("strong", null, a.alert.dishName),
            ` is on the menu today at ${a.restaurant.name} — your beloved dish.`,
          ),
        ),
      );
    }

    // Live tally — always sorted: leader on top, then descending by votes.
    // Ties break alphabetically by restaurant name so the row order doesn't
    // wobble when two restaurants share a count.
    const tally = h("div", { class: "rail-card" }, h("h3", null, "Live tally"));
    const restaurants = d.restaurants;
    const counts = restaurants.map(r => ({ r, votes: r.votes || 0, voters: r.voters || [] }));
    counts.sort((a, b) => b.votes - a.votes || a.r.name.localeCompare(b.r.name));
    // Everyone tied at the top vote count is a leader — ties highlight all.
    const topVotes = counts.length > 0 ? counts[0].votes : 0;
    const leaderIds = topVotes > 0
      ? new Set(counts.filter(c => c.votes === topVotes).map(c => c.r.id))
      : new Set();
    for (const c of counts) {
      const row = h("div", {
        class: "tally-row " + (leaderIds.has(c.r.id) ? "leading" : ""),
      },
        h("span", { class: "name" },
          h("span", { class: "emoji" }, window.LV.BRAND_META[c.r.id]?.emoji || "•"),
          c.r.name,
        ),
        pile(c.voters, 3),
        h("span", { class: "count" }, c.votes),
      );
      tally.append(row);
    }
    // Protest row
    const p = d.protest || { votes: 0, voters: [] };
    tally.append(
      h("div", { class: "tally-row protest" },
        h("span", { class: "name" }, "🪧 None of these"),
        pile(p.voters, 3),
        h("span", { class: "count" }, p.votes || 0),
      ),
    );
    leftRail.append(tally);

    // Week mini (linked to /week-new.html)
    leftRail.append(
      h("div", { class: "rail-card" },
        h("h3", null, "This week"),
        h("a", { href: "/week-new.html", style: {
          display: "inline-flex", gap: "8px", alignItems: "center",
          color: "var(--ink)", textDecoration: "none", fontSize: "14px",
        } }, "▤ ", "Open weekly overview →"),
      ),
    );

    // Beloved dishes — read-only list of the configured alerts. The dynamic
    // alert card at the top of the rail surfaces a match when one is on the
    // menu today; this card is the always-on "what we're watching for" view.
    const restaurantNameById = new Map(d.restaurants.map(r => [r.id, r.name]));
    const alertList = h("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } });
    for (const a of window.LV.ALERTS) {
      const restName = restaurantNameById.get(a.restaurantId) || a.restaurantId;
      alertList.append(
        h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px", fontSize: "14px" } },
          h("span", { style: { fontSize: "20px", lineHeight: 1 } }, a.emoji),
          h("span", null,
            h("strong", null, a.dishName),
            h("span", { style: { color: "var(--muted)", fontSize: "12px", marginLeft: "6px" } }, "@ " + restName),
          ),
        ),
      );
    }
    leftRail.append(
      h("div", { class: "rail-card" },
        h("h3", null, "Beloved dishes"),
        alertList,
      ),
    );
  }

  function renderRightRail() {
    clear(rightRail);
    const d = state.data;
    if (!d) return;
    const restaurants = d.restaurants;
    const lineup = h("div", { class: "rail-card" }, h("h3", null, "The lineup"));
    const list = h("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
    for (let i = 0; i < restaurants.length; i++) {
      const r = restaurants[i];
      const action = state.actions[r.id];
      const acted = !!action;
      const isCurrent = i === state.index && !state.protestActive && !state.showSummary;
      const cls = ["up-next-card", acted ? "acted" : "", action === "vote" ? "voted" : "", isCurrent ? "current" : ""]
        .filter(Boolean).join(" ");
      let pos = acted ? (action === "vote" ? "✓ voted" : "skipped") : (isCurrent ? "now" : `#${i + 1}`);
      const styleObj = {
        outline: isCurrent ? "2px solid var(--accent)" : "none",
        outlineOffset: "2px",
        cursor: "pointer",
      };
      const meta = window.LV.BRAND_META[r.id] || { emoji: "•", nick: r.name };
      const cheapest = (r.options || []).reduce((m, o) => (o.price != null && (m == null || o.price < m) ? o.price : m), null);
      list.append(
        h("div", {
          class: cls, style: styleObj,
          onClick: () => { if (!acted && !isCurrent) jumpTo(i); },
        },
          h("span", { class: "emoji" }, meta.emoji),
          h("div", { class: "body" },
            h("div", { class: "name" }, r.name),
            h("div", { class: "sub" }, `${meta.nick}${cheapest != null ? ` · from €${cheapest.toFixed(2)}` : ""}`),
          ),
          h("span", { class: "pos" }, pos),
        ),
      );
    }
    lineup.append(list);
    rightRail.append(lineup);
  }

  function renderStage() {
    clear(stage);
    if (state.loading) {
      stage.append(h("p", { style: { color: "var(--muted)" } }, "Loading menus…"));
      return;
    }
    if (state.error) {
      stage.append(
        h("div", { class: "rail-card" },
          h("h3", null, "Couldn't load"),
          h("p", { style: { color: "var(--muted)", fontSize: "14px" } }, state.error),
          h("button", { class: "btn primary", onClick: reload }, "Retry"),
        ),
      );
      return;
    }
    const d = state.data;
    if (!d) return;

    // No user → prompt
    if (!getUser()) {
      stage.append(h("p", { style: { color: "var(--muted)" } }, "Set your name to start voting…"));
      openNameModal({ onSave: () => { rebuildAll(); reload(); } });
      return;
    }

    // Empty menus?
    const anyOptions = (d.restaurants || []).some(r => r.options && r.options.length > 0);
    if (!anyOptions) {
      stage.append(
        h("div", { class: "rail-card", style: { maxWidth: "460px" } },
          h("h3", null, "No menus yet"),
          h("p", { style: { color: "var(--muted)", fontSize: "14px" } },
            "The cron job hasn't fetched today's menus. Try refreshing."),
          h("button", { class: "btn primary", onClick: refreshMenus }, "↻ Fetch menus now"),
        ),
      );
      return;
    }

    const restaurants = d.restaurants;
    const total = restaurants.length;

    // If the API knows about any votes for this user and we haven't started a
    // fresh swipe session locally, jump straight to the summary. The
    // `revoting` flag is set by "Change my vote" so the user gets to re-swipe
    // even before the async server-clear completes.
    const serverHasVotes = (d.myVotes && d.myVotes.length > 0) || !!d.myVote;
    const apiVoted = serverHasVotes
      && !state.protestActive
      && Object.keys(state.actions).length === 0
      && !state.showSummary
      && !state.revoting;
    if (apiVoted) {
      stage.append(renderSummary());
      return;
    }

    const allActed = restaurants.every(r => state.actions[r.id]);
    const isDone = state.protestActive || allActed || state.showSummary;
    if (isDone) {
      stage.append(renderSummary());
      return;
    }

    // After out-of-order voting (e.g. user jumps to card #3 via the lineup,
    // then swipes through #3 and #4), state.index can land past the end with
    // un-acted cards #1/#2 still waiting. Pull it back to the nearest
    // un-acted card so the stage never goes blank.
    if (!restaurants[state.index] || state.actions[restaurants[state.index].id]) {
      state.index = nextUnactedIndex(restaurants, state.index - 1, state.actions);
    }

    // Progress bars — "done" is action-based, not position-based, so it stays
    // correct when the user navigates out of order.
    const bars = h("div", { class: "progress-bars" });
    for (let i = 0; i < total; i++) {
      const r = restaurants[i];
      const act = state.actions[r.id];
      const cls = ["bar",
        act ? "done" : "",
        i === state.index && !act ? "current" : "",
        act === "vote" ? "voted" : "",
      ].filter(Boolean).join(" ");
      bars.append(h("div", { class: cls }, h("div", { class: "fill" })));
    }
    stage.append(bars);

    // Card frame
    const frame = h("div", { class: "card-frame" });
    const stack = h("div", { class: "card-stack" });
    frame.append(stack);

    // Render top + behind cards
    const slice = restaurants.slice(state.index, state.index + 4);
    const newTopId = slice[0]?.id ?? null;
    const topChanged = newTopId !== null && newTopId !== lastTopId;
    slice.forEach((r, i) => {
      const card = renderCard(r, i);
      // When the top card identity changes, run the card-settle keyframe
      // (defined in sr.css) so the new top grows smoothly from behind-1
      // geometry into position instead of snapping bigger.
      if (i === 0 && topChanged) card.classList.add("entering");
      stack.append(card);
    });
    lastTopId = newTopId;

    // Drag listeners live on `stage` (attached once at module init) so they
    // survive renderStage rebuilds and so pointerup fires even when the
    // pointer is released outside the window via stage.setPointerCapture().
    stage.append(frame);

    // Swipe hints
    stage.append(
      h("div", { class: "swipe-hints" },
        h("span", { class: "pill" }, "← drag or click skip"),
        h("span", { class: "pill" }, "enter to vote · esc to skip"),
        h("span", { class: "pill" }, "drag right or click ✓"),
      ),
    );
  }

  function renderCard(r, i) {
    const total = state.data.restaurants.length;
    const index = state.index;
    const positionClass = i === 0 ? "top" : `behind-${i}`;
    const meta = window.LV.BRAND_META[r.id] || { emoji: "•", nick: r.name };

    const isLeading = (() => {
      let max = 0, id = null;
      for (const x of state.data.restaurants) if ((x.votes || 0) > max) { max = x.votes || 0; id = x.id; }
      return id === r.id && max > 0;
    })();

    // Drag/exit styles on top card only
    let styleOverlay = {};
    let dragging = false;
    if (i === 0) {
      if (state.drag.active && (state.drag.dx || state.drag.dy)) {
        dragging = true;
        const rot = Math.max(-22, Math.min(22, state.drag.dx * 0.05));
        styleOverlay.transform = `translate(${state.drag.dx}px, ${state.drag.dy}px) rotate(${rot}deg)`;
      }
    }

    const showVote = i === 0 && state.drag.active && state.drag.dx > 50;
    const showSkip = i === 0 && state.drag.active && state.drag.dx < -50;
    const exitCls = i === 0 && state.exitState ? `exit-${state.exitState}` : "";

    const cls = ["card", positionClass, dragging ? "dragging" : "", exitCls,
                 showVote ? "show-vote" : "", showSkip ? "show-skip" : ""].filter(Boolean).join(" ");

    // Find the beloved option (if any)
    const belovedItem = (r.options || []).find(o => isBeloved(r, o));

    // Content
    const content = h("div", { class: "card-content" },
      // Eyebrow
      h("div", { class: "card-eyebrow" },
        h("span", null, `✦ TODAY · ${weekdayShort(state.data.date)} ✦`),
      ),
      // Title
      h("div", { class: "card-title" },
        h("span", { class: "emoji" }, meta.emoji),
        h("span", { class: "name" }, r.name),
      ),
      // Subtitle
      h("div", { class: "card-sub" },
        meta.nick + (r.menuUrl ? "" : ""),
      ),
      // Divider
      h("div", { class: "card-divider" }),
      // Menu
      menuList(r, belovedItem),
      h("div", { class: "card-spacer" }),
      // Foot
      h("div", { class: "card-foot" },
        h("div", { class: "voters" },
          pile(r.voters || [], 5),
          h("span", null, `${r.votes || 0} ${r.votes === 1 ? "vote" : "votes"}`),
        ),
        isLeading && h("span", { class: "leading" }, "★ leading"),
      ),
    );

    // Progress segments inside card
    const segs = h("div", { class: "card-progress" });
    for (let s = 0; s < total; s++) {
      const segCls = ["seg", s < index ? "done" : "", s === index ? "current" : ""].filter(Boolean).join(" ");
      segs.append(h("div", { class: segCls }));
    }

    // Counter
    const counter = h("div", { class: "card-counter" }, `${index + 1} / ${total}`);

    // Action rail. No explicit "None of these" button — that's now the
    // implicit outcome of skipping every card (see auto-protest in commit()).
    const rail = h("div", { class: "action-rail" },
      actionBtn("✓", "vote", () => commit("vote"), "vote-btn"),
      actionBtn("↓", "skip", () => commit("skip"), "skip-btn"),
    );

    // Beloved pin
    const pin = belovedItem ? h("div", { class: "beloved-pin" }, "🔥 chef's special") : null;

    // Stamps
    const stampVote = h("div", { class: "stamp vote" }, "VOTE");
    const stampSkip = h("div", { class: "stamp skip" }, "SKIP");

    const card = h("div", {
      class: cls, style: styleOverlay,
      onPointerDown: i === 0 ? onPointerDown : undefined,
    },
      segs, counter, pin, content, stampVote, stampSkip, rail,
    );

    return card;
  }

  function actionBtn(symbol, label, onClick, kind) {
    const cls = kind === "vote-btn" ? "action-btn vote" : "action-btn skip";
    return h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" } },
      h("button", {
        class: cls,
        onClick: (e) => { e.stopPropagation(); onClick(); },
        title: label,
      }, symbol),
      h("span", { class: "action-label" }, label),
    );
  }

  function menuList(r, belovedItem) {
    const wrap = h("div", { class: "card-menu" });
    const options = (r.options || []).slice(0, 4);
    if (options.length === 0) {
      wrap.append(h("div", { style: { fontSize: "14px", color: "var(--chalk-soft)", fontStyle: "italic" } }, "menu not posted yet"));
      return wrap;
    }
    for (const o of options) {
      const beloved = o === belovedItem || (belovedItem && o.name === belovedItem.name);
      const dish = h("div", { class: "dish" + (beloved ? " beloved" : "") },
        h("div", { class: "row" },
          h("span", { class: "name" }, o.name),
          o.price != null ? h("span", { class: "price" }, `€${Number(o.price).toFixed(2)}`) : null,
        ),
        beloved ? h("div", { class: "note" }, "↳ your fav — alerted you this morning") : null,
      );
      wrap.append(dish);
    }
    return wrap;
  }

  function renderSummary() {
    const d = state.data;
    const restaurants = d.restaurants;

    // Multi-vote: merge local swipe-right actions with the server's persisted
    // votes. Local state is authoritative for the current session; server
    // votes catch the cross-page-load case.
    const localPicks = Object.entries(state.actions).filter(([, a]) => a === "vote").map(([id]) => id);
    const serverPicks = Array.isArray(d.myVotes) ? d.myVotes : (d.myVote ? [d.myVote] : []);
    const allPicks = Array.from(new Set([...localPicks, ...serverPicks]));
    const nonProtestPicks = allPicks.filter(id => id !== "protest");
    const protestActive = state.protestActive || allPicks.includes("protest");

    let leaderId = null, max = 0;
    for (const r of restaurants) if ((r.votes || 0) > max) { max = r.votes || 0; leaderId = r.id; }
    const leader = leaderId && restaurants.find(r => r.id === leaderId);

    if (protestActive) {
      return h("div", { class: "summary protest" },
        h("span", { style: { fontSize: "56px", lineHeight: 1 } }, "🪧"),
        h("h2", null, "You walked out."),
        h("p", { style: { margin: 0, color: "var(--muted)" } },
          "None of today's options worked for you. We'll let the others know."),
        h("div", { class: "pick" },
          h("div", { class: "name" }, "on strike"),
          h("div", { class: "meta" }, `${d.protest?.votes || 0} colleague${(d.protest?.votes || 0) === 1 ? "" : "s"} also walking out`),
        ),
        h("div", { class: "actions" },
          h("button", { class: "btn", onClick: () => resetVoting() }, "Undo — go back"),
          h("button", { class: "btn primary", onClick: () => resetVoting() }, "Start over"),
        ),
      );
    }

    if (nonProtestPicks.length > 0) {
      const picks = nonProtestPicks
        .map(id => restaurants.find(r => r.id === id))
        .filter(Boolean);
      const headline = picks.length === 1
        ? "Your vote is in."
        : `${picks.length} votes locked in.`;
      const youVotedForLeader = leader && picks.some(p => p.id === leader.id);

      return h("div", { class: "summary" },
        h("span", { style: { fontSize: "56px", lineHeight: 1 } },
          picks.length === 1
            ? (window.LV.BRAND_META[picks[0].id]?.emoji || "•")
            : "🗳️",
        ),
        h("h2", null, headline),
        // One .pick card per chosen restaurant. Same chrome as the single
        // pick — accent border + paper-2 background via .summary .pick.
        ...picks.map(p => {
          const meta = window.LV.BRAND_META[p.id] || { emoji: "•", nick: p.name };
          return h("div", { class: "pick" },
            h("div", { class: "name" },
              picks.length > 1
                ? `${meta.emoji} ${p.name}`
                : p.name,
            ),
            h("div", { class: "meta" }, meta.nick),
            h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" } },
              pile(p.voters || [], 6),
              h("span", { style: { fontSize: "14px", color: "var(--muted)" } },
                `${p.votes || 0} ${p.votes === 1 ? "vote" : "votes"}`,
              ),
            ),
          );
        }),
        h("p", { style: { margin: 0, color: "var(--muted)", fontSize: "14px" } },
          youVotedForLeader
            ? `${(window.LV.BRAND_META[leader.id]?.nick || leader.name)} is leading. 🎉`
            : leader
              ? `Currently leading: ${(window.LV.BRAND_META[leader.id]?.emoji || "•")} ${leader.name} with ${leader.votes}. You can still change your mind.`
              : "",
        ),
        h("div", { class: "actions" },
          h("button", { class: "btn", onClick: () => resetVoting() },
            picks.length === 1 ? "Change my vote" : "Change my votes"),
          h("a", { class: "btn", href: "/week-new.html" }, "View week"),
        ),
      );
    }

    // Skipped all
    return h("div", { class: "summary" },
      h("span", { style: { fontSize: "48px", lineHeight: 1 } }, "🤔"),
      h("h2", null, "You skipped everything."),
      h("p", { style: { margin: 0, color: "var(--muted)" } },
        leader ? `No vote cast. Today's leader is ${window.LV.BRAND_META[leader.id]?.emoji || "•"} ${leader.name}.` : "No vote cast yet.",
      ),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", onClick: () => resetVoting() }, "Try again"),
      ),
    );
  }

  // ---------- Actions ----------

  // CSS .card transition is 0.45s — wait slightly longer so the animation
  // completes before we re-render with the next card on top.
  const EXIT_MS = 460;

  // Drag thresholds (pixels). PREVIEW is when the "VOTE" / "SKIP" stamp first
  // fades in (dim, "tentative"). COMMIT is the threshold at which releasing
  // actually fires the action and the stamp goes full-bright with a card glow.
  // The two-tier model fixes the prior UX bug where the stamp said "VOTE" at
  // 50px but the trigger didn't fire until 120px, so users released mid-drag
  // and were surprised by either an accidental vote or no vote at all.
  const SWIPE_PREVIEW_DX = 90;
  const SWIPE_COMMIT_DX = 270;
  const SWIPE_PREVIEW_DY = 120;
  const SWIPE_COMMIT_DY = 330;

  // Find the next un-acted card index after `fromIndex`, wrapping around to
  // the start. Returns fromIndex if every card has been acted on (caller
  // detects this via the allActed check and renders the summary).
  function nextUnactedIndex(restaurants, fromIndex, actions) {
    const n = restaurants.length;
    if (n === 0) return 0;
    for (let i = 1; i <= n; i++) {
      const idx = ((fromIndex + i) % n + n) % n;
      if (!actions[restaurants[idx].id]) return idx;
    }
    return fromIndex;
  }

  // Animate the current top card off-screen using the .exit-* CSS class.
  // We deliberately do NOT re-render or force a reflow: the inline drag
  // transform is cleared and the exit class is added in the same tick so the
  // browser sees one style change (drag pos → exit pos) and the .card CSS
  // transition smoothly interpolates between them — no snap-to-identity
  // intermediate frame.
  function animateExit(action) {
    const topCard = stage.querySelector(".card.top");
    if (!topCard) return;
    // Drop the drag-only class + inline drag transform so the exit-* CSS
    // transform takes effect cleanly.
    topCard.classList.remove("dragging", "show-vote", "show-skip", "ready-vote", "ready-skip");
    topCard.style.transform = "";
    // Show the full-bright stamp during the fly-off (no stamp for protest).
    if (action === "vote" || action === "skip") {
      topCard.classList.add(`show-${action}`, `ready-${action}`);
    }
    // Atomic with the style.transform = "" above — no reflow between, so the
    // transition fires from the drag position straight to the exit position.
    topCard.classList.add(`exit-${action}`);
  }

  function commit(action) {
    if (state.exitState) return;
    if (action === "protest") {
      state.exitState = "protest";
      animateExit("protest");
      setTimeout(async () => {
        state.protestActive = true;
        state.revoting = false;
        state.exitState = null;
        state.drag = { dx: 0, dy: 0, active: false };
        renderAll();
        // Legacy replace-all: protest is mutually exclusive with everything
        // else (see worker mutual-exclusion logic), so a single replace works.
        try { await apiVote("protest"); await reload(); }
        catch (e) { console.warn("protest vote failed", e); }
      }, EXIT_MS);
      return;
    }
    const r = state.data.restaurants[state.index];
    if (!r) return;
    state.exitState = action;
    animateExit(action);
    setTimeout(async () => {
      state.actions[r.id] = action;
      // Advance to the next un-acted card (wrapping back to the start if we
      // had jumped ahead and left earlier cards un-acted).
      state.index = nextUnactedIndex(state.data.restaurants, state.index, state.actions);
      state.revoting = false;
      state.exitState = null;
      state.drag = { dx: 0, dy: 0, active: false };

      // If this skip closed out a "skipped everything" pass, treat it as an
      // implicit protest — same semantics as the old explicit 🪧 button.
      const restaurantsList = state.data.restaurants;
      const allActed = restaurantsList.every(rr => state.actions[rr.id]);
      const allSkipped = allActed && Object.values(state.actions).every(a => a === "skip");
      if (allSkipped) state.protestActive = true;

      renderAll();
      if (action === "vote") {
        // action: "add" — accumulates votes instead of replacing the previous one.
        try { await apiVote(r.id, "add"); await reload({ keepActions: true }); }
        catch (e) { state.error = e.message; renderAll(); }
      } else if (allSkipped) {
        // Legacy replace-all on the protest restaurant — worker mutual-exclusion
        // takes care of clearing any stray non-protest rows.
        try { await apiVote("protest"); await reload(); }
        catch (e) { console.warn("auto-protest failed", e); }
      }
    }, EXIT_MS);
  }

  function jumpTo(targetIndex) {
    if (state.exitState) return;
    if (targetIndex < 0 || targetIndex >= state.data.restaurants.length) return;
    state.index = targetIndex;
    state.drag = { dx: 0, dy: 0, active: false };
    renderAll();
  }

  function resetVoting() {
    state.actions = {};
    state.protestActive = false;
    state.index = 0;
    state.drag = { dx: 0, dy: 0, active: false };
    state.exitState = null;
    state.showSummary = false;
    state.revoting = true;
    // Clear locally-cached server votes so the apiVoted check can't bounce us
    // back to the summary while the async clear is in flight.
    if (state.data) { state.data.myVote = null; state.data.myVotes = []; }
    renderAll();
    apiClearVotes()
      .then(() => reload({ keepActions: true }))
      .catch(e => { console.warn("clear votes failed", e); });
  }

  async function refreshMenus() {
    try {
      await apiRefresh();
      await reload();
    } catch (e) { alert(e.message); }
  }

  // ---------- Pointer / Keyboard ----------

  function onPointerDown(e) {
    if (state.exitState) return;
    // Don't start drag if clicking an action button
    if (e.target.closest && e.target.closest(".action-btn, button")) return;
    // Capture on the persistent stage element. Capturing on the card would
    // be lost as soon as renderStage() below replaces it.
    try { stage.setPointerCapture(e.pointerId); } catch {}
    pointerRef.id = e.pointerId;
    pointerRef.startX = e.clientX;
    pointerRef.startY = e.clientY;
    state.drag = { dx: 0, dy: 0, active: true };
    renderStage(); // mark dragging
  }
  function onPointerMove(e) {
    if (!state.drag.active || e.pointerId !== pointerRef.id) return;
    state.drag.dx = e.clientX - pointerRef.startX;
    state.drag.dy = e.clientY - pointerRef.startY;
    // Apply transform directly on the top card (avoids full re-render every move)
    const card = stage.querySelector(".card.top");
    if (card) {
      const dx = state.drag.dx;
      const dy = state.drag.dy;
      const rot = Math.max(-22, Math.min(22, dx * 0.05));
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
      // Preview (dim stamp): user is moving in this direction.
      card.classList.toggle("show-vote", dx > SWIPE_PREVIEW_DX);
      card.classList.toggle("show-skip", dx < -SWIPE_PREVIEW_DX || dy > SWIPE_PREVIEW_DY);
      // Ready (full stamp + colored ring on card): release now to commit.
      card.classList.toggle("ready-vote", dx > SWIPE_COMMIT_DX);
      card.classList.toggle("ready-skip", dx < -SWIPE_COMMIT_DX || dy > SWIPE_COMMIT_DY);
      card.classList.add("dragging");
    }
  }
  function onPointerUp(e) {
    if (!state.drag.active) return;
    state.drag.active = false;
    const { dx, dy } = state.drag;
    if (dx > SWIPE_COMMIT_DX)        commit("vote");
    else if (dx < -SWIPE_COMMIT_DX)  commit("skip");
    else if (dy > SWIPE_COMMIT_DY)   commit("skip");
    else {
      // snap back
      state.drag = { dx: 0, dy: 0, active: false };
      const card = stage.querySelector(".card.top");
      if (card) {
        card.style.transform = "";
        card.classList.remove("show-vote", "show-skip", "ready-vote", "ready-skip", "dragging");
      }
    }
  }

  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (state.exitState) return;
    if (state.protestActive || state.showSummary) return;
    if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); commit("vote"); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "Escape") {
      e.preventDefault(); commit("skip");
    }
  });

  // ---------- Networking ----------

  async function reload({ keepActions = false } = {}) {
    try {
      if (!keepActions) state.loading = !state.data;
      const data = await apiToday();
      // Shuffle with the per-page-load seed: fresh order on each open,
      // stable across in-session reloads so cards don't shift mid-vote.
      data.restaurants = shuffleWithSeed(data.restaurants, SHUFFLE_SEED);
      state.data = data;
      state.error = null;
      state.loading = false;
      renderAll();
    } catch (e) {
      state.loading = false;
      state.error = e.message;
      renderAll();
    }
  }

  // ---------- Helpers ----------

  function weekdayShort(isoDate) {
    try {
      return new Date(isoDate + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }).toUpperCase();
    } catch { return ""; }
  }

  // ---------- Boot ----------
  buildHeader();
  mountAdminRefreshButton();
  if (!getUser()) {
    openNameModal({ onSave: () => { rebuildAll(); reload(); } });
  }
  // Fetch data either way — the tally + lineup are visible behind the name
  // modal and shouldn't sit on "Loading menus…" until the 10s poll fires.
  reload();

  // Poll every 10s to keep tally fresh (matches existing app behaviour)
  setInterval(() => {
    if (!document.hidden && !state.drag.active && !state.exitState) reload({ keepActions: true });
  }, 10000);
})();
