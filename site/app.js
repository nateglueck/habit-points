"use strict";

const cfg = window.HABIT_CONFIG;
const db = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

// Seeded on a person's first sign-in; everything is editable under "Manage habits".
const STARTER_HABITS = [
  { name: "Exercise", points: 5, max_count: 2, period: "day" },
  { name: "Slept 7+ hours", points: 3, max_count: 1, period: "day" },
  { name: "Practice German", points: 4, max_count: 1, period: "day" },
  { name: "Read 20 minutes", points: 2, max_count: 1, period: "day" },
  { name: "10k steps", points: 3, max_count: 1, period: "day" },
  { name: "No alcohol", points: 2, max_count: 1, period: "day" },
];

const PERIODS = { day: "today", week: "this week", month: "this month" };

const state = { user: null, habits: [], completions: [], spends: [] };
const $ = (id) => document.getElementById(id);

const localDay = (d = new Date()) => d.toLocaleDateString("sv-SE"); // YYYY-MM-DD

// First local day of the current day/week/month; weeks start on Monday.
function periodStart(period, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (period === "month") d.setDate(1);
  return localDay(d);
}
const fmtWhen = (iso) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

function setStatus(msg, isError = false) {
  $("status").textContent = msg;
  $("status").classList.toggle("error", isError);
}

// Wraps a database call: surfaces errors in the status line and returns the data.
async function run(promise) {
  const { data, error } = await promise;
  if (error) {
    setStatus(error.message, true);
    throw error;
  }
  setStatus("");
  return data;
}

// PostgREST caps a response at 1000 rows, and the ledger needs the full history.
async function fetchAll(table, orderColumn) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await run(db.from(table).select("*").order(orderColumn).range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function load() {
  const [habits, completions, spends] = await Promise.all([
    fetchAll("habits", "created_at"),
    fetchAll("completions", "earned_at"),
    fetchAll("spends", "spent_at"),
  ]);
  state.habits = habits;
  state.completions = completions;
  state.spends = spends;

  if (!habits.length && !completions.length) {
    state.habits = await run(db.from("habits").insert(STARTER_HABITS).select());
  }
  render();
}

// ---- rendering -------------------------------------------------------------

function render() {
  const ledger = computeLedger(state.completions, state.spends, cfg);
  renderSummary(ledger);
  renderToday();
  renderSpend(ledger);
  renderHistory();
  renderManage();
}

function renderSummary(ledger) {
  $("points").textContent = ledger.points;
  $("euros").textContent = `€${Math.floor(Math.max(ledger.points, 0) / cfg.pointsPerEuro)}`;

  const fill = ledger.unlocked ? 100 : Math.min(100, (Math.max(ledger.points, 0) / cfg.gatePoints) * 100);
  $("gateFill").style.width = `${fill}%`;
  $("gateFill").classList.toggle("open", ledger.unlocked);
  $("gateText").textContent = ledger.unlocked
    ? "Unlocked: spend down to 0. Relocks when you can't cover €1."
    : `Locked: ${Math.max(cfg.gatePoints - ledger.points, 0)} more points to unlock spending.`;

  $("expiry").textContent = ledger.expiringSoon
    ? `${ledger.expiringSoon} points expire in the next 7 days (next on ${fmtDate(ledger.nextExpiry)}).`
    : ledger.nextExpiry
      ? `Next points expire on ${fmtDate(ledger.nextExpiry)}.`
      : `Points stay valid for ${cfg.validityDays} days.`;
}

function renderToday() {
  const items = state.habits.filter((h) => !h.archived).map((h) => {
    // ISO dates compare correctly as strings.
    const start = periodStart(h.period);
    const done = state.completions.filter((c) => c.habit_id === h.id && c.day >= start);
    const full = done.length >= h.max_count;
    const count = h.max_count > 1 || h.period !== "day" ? ` · ${done.length}/${h.max_count} ${PERIODS[h.period]}` : "";

    const logBtn = el("button", {
      type: "button",
      className: `habit${done.length ? " done" : ""}`,
      disabled: full,
      onclick: (e) => logHabit(h, e.currentTarget),
    },
      el("span", { className: "check", textContent: full ? "✓" : done.length ? "+" : "" }),
      el("span", { className: "name", textContent: h.name }),
      el("span", { className: "pts", textContent: `+${h.points}${count}` }),
    );
    const undoBtn = done.length
      ? el("button", { type: "button", className: "undo", title: "Undo", textContent: "↺", onclick: () => undoHabit(done.at(-1)) })
      : null;
    return el("li", {}, logBtn, undoBtn);
  });
  $("habits").replaceChildren(...items);
  if (!items.length) $("habits").append(el("li", { className: "muted", textContent: "No habits yet. Add some under Manage habits." }));
}

function renderSpend(ledger) {
  const max = ledger.spendableEuros;
  $("spendEuros").max = Math.max(max, 1);
  $("spendBtn").disabled = max < 1;
  $("spendHint").textContent = !ledger.unlocked
    ? `Reach ${cfg.gatePoints} points to unlock spending.`
    : max < 1
      ? "Not enough points for €1."
      : `Up to €${max} available. ${cfg.pointsPerEuro} points = €1, oldest points are used first.`;
}

function renderHistory() {
  const names = new Map(state.habits.map((h) => [h.id, h.name]));
  const today = localDay();
  const entries = [
    ...state.completions.map((c) => ({
      at: c.earned_at, label: names.get(c.habit_id) ?? "Habit", delta: `+${c.points}`, cls: "earn",
      remove: c.day === today ? () => undoHabit(c) : null,
    })),
    ...state.spends.map((s) => ({
      at: s.spent_at, label: `Spent €${s.euros}${s.note ? `: ${s.note}` : ""}`, delta: `−${s.points}`, cls: "spend",
      remove: localDay(new Date(s.spent_at)) === today ? () => removeSpend(s) : null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);

  $("history").replaceChildren(...entries.map((e) =>
    el("li", { className: e.cls },
      el("span", { className: "when muted", textContent: fmtWhen(e.at) }),
      el("span", { className: "label", textContent: e.label }),
      el("span", { className: "delta", textContent: e.delta }),
      e.remove ? el("button", { type: "button", className: "undo", title: "Remove", textContent: "×", onclick: e.remove }) : null,
    )));
  if (!entries.length) $("history").append(el("li", { className: "muted", textContent: "Nothing logged yet." }));
}

function renderManage() {
  $("manage").replaceChildren(...state.habits.map((h) => {
    const field = (key, attrs) => el("input", {
      ...attrs,
      value: h[key],
      onchange: (e) => updateHabit(h, { [key]: attrs.type === "number" ? Number(e.target.value) : e.target.value.trim() }),
    });
    const period = periodSelect(h.period);
    period.onchange = (e) => updateHabit(h, { period: e.target.value });
    return el("li", { className: `habit-form${h.archived ? " archived" : ""}` },
      field("name", { type: "text", maxLength: 60, required: true }),
      el("label", {}, "pts ", field("points", { type: "number", min: 1, max: 100 })),
      el("label", {}, field("max_count", { type: "number", min: 1, max: 50 }), "×", period),
      el("button", {
        type: "button",
        textContent: h.archived ? "Restore" : "Archive",
        onclick: () => updateHabit(h, { archived: !h.archived }),
      }),
    );
  }));
}

function periodSelect(selected) {
  const select = el("select", {}, ...Object.keys(PERIODS).map((p) => el("option", { value: p, textContent: `per ${p}` })));
  select.value = selected;
  return select;
}

// ---- actions ---------------------------------------------------------------

async function logHabit(habit, button) {
  button.disabled = true; // guards against a double tap logging twice
  try {
    const row = await run(db.from("completions")
      .insert({ habit_id: habit.id, points: habit.points, day: localDay() })
      .select().single());
    state.completions.push(row);
  } finally {
    render();
  }
}

async function undoHabit(completion) {
  await run(db.from("completions").delete().eq("id", completion.id));
  state.completions = state.completions.filter((c) => c.id !== completion.id);
  render();
}

async function removeSpend(spend) {
  if (!confirm(`Remove the €${spend.euros} spend? Its points go back to your balance.`)) return;
  await run(db.from("spends").delete().eq("id", spend.id));
  state.spends = state.spends.filter((s) => s.id !== spend.id);
  render();
}

async function spend(euros, note) {
  // Re-check against fresh numbers: points may have expired since the last render.
  const ledger = computeLedger(state.completions, state.spends, cfg);
  if (!Number.isInteger(euros) || euros < 1 || euros > ledger.spendableEuros) {
    setStatus(`You can spend up to €${ledger.spendableEuros} right now.`, true);
    return;
  }
  const row = await run(db.from("spends")
    .insert({ euros, points: euros * cfg.pointsPerEuro, note: note || null })
    .select().single());
  state.spends.push(row);
  $("spendNote").value = "";
  $("spendEuros").value = 1;
  render();
  setStatus(`Enjoy your €${euros}!`);
}

async function updateHabit(habit, patch) {
  try {
    const row = await run(db.from("habits").update(patch).eq("id", habit.id).select().single());
    Object.assign(habit, row);
  } finally {
    render();
  }
}

async function addHabit(form) {
  const data = new FormData(form);
  const row = await run(db.from("habits").insert({
    name: data.get("name").trim(),
    points: Number(data.get("points")),
    max_count: Number(data.get("max_count")),
    period: data.get("period"),
  }).select().single());
  state.habits.push(row);
  form.reset();
  render();
}

// ---- auth ------------------------------------------------------------------

function showSignedIn(user) {
  const changed = state.user?.id !== user?.id;
  state.user = user;
  $("auth").hidden = !!user;
  $("app").hidden = !user;
  $("signOut").hidden = !user;
  $("changePassword").hidden = !user;
  if (!user) $("passwordCard").hidden = true;
  // Deferred: awaiting Supabase calls inside onAuthStateChange can deadlock its auth lock.
  if (user && changed) setTimeout(() => load().catch(() => {}));
}

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await run(db.auth.signInWithPassword({ email: $("email").value, password: $("password").value })).catch(() => {});
});

$("signUp").addEventListener("click", async () => {
  if (!$("authForm").reportValidity()) return;
  const data = await run(db.auth.signUp({ email: $("email").value, password: $("password").value })).catch(() => null);
  if (data && !data.session) setStatus("Account created. Confirm the link in your email, then sign in.");
});

$("signOut").addEventListener("click", () => db.auth.signOut());

$("forgotPassword").addEventListener("click", async () => {
  if (!$("email").reportValidity()) return;
  // The emailed link signs the person in and lands back here as a PASSWORD_RECOVERY event.
  const redirectTo = location.origin + location.pathname;
  const sent = await run(db.auth.resetPasswordForEmail($("email").value, { redirectTo })).catch(() => null);
  if (sent) setStatus("Check your email for a link to set a new password.");
});

const showPasswordForm = (show) => {
  $("passwordCard").hidden = !show;
  if (show) $("newPassword").focus();
};

$("changePassword").addEventListener("click", () => showPasswordForm(true));
$("cancelPassword").addEventListener("click", () => showPasswordForm(false));

$("passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const saved = await run(db.auth.updateUser({ password: $("newPassword").value })).catch(() => null);
  if (!saved) return;
  e.target.reset();
  showPasswordForm(false);
  setStatus("Password changed.");
});

$("spendForm").addEventListener("submit", (e) => {
  e.preventDefault();
  spend(Number($("spendEuros").value), $("spendNote").value.trim()).catch(() => {});
});

$("addHabit").addEventListener("submit", (e) => {
  e.preventDefault();
  addHabit(e.target).catch(() => {});
});

// Expiry and "today" both move with the clock, so refresh when the app comes back.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.user) render();
});

db.auth.onAuthStateChange((event, session) => {
  showSignedIn(session?.user ?? null);
  if (event === "PASSWORD_RECOVERY") showPasswordForm(true);
});
