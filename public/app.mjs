import {
  filterGuests,
  planningSummary,
  missingMeals,
  assignSeats,
} from "./planning.mjs";
import { MENUS, SHARED_MENUS } from "./menus.mjs";
import {
  courses,
  optionsFor,
  submissionIssues,
  csvCell,
  deadline,
} from "./domain.mjs";
const app = document.querySelector("#app"),
  dialog = document.querySelector("#dialog");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const btn = (label, action, extra = "", primary = false) =>
  `<button type="button" data-action="${action}" ${extra} class="${primary ? "primary" : ""}">${label}</button>`;
const input = (name, label, value = "", type = "text", required = true) =>
  `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${type === "text" ? 'maxlength="100"' : ""}>`;
const select = (name, label, options, value = "") =>
  `<label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const check = (name, label, value = false) =>
  `<label class="check"><input type="checkbox" name="${name}" ${value ? "checked" : ""}>${label}</label>`;
const dateLabel = (d) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const demoMode = location.pathname === "/demo.html";
let demoStore;
let guestSearch = "",
  guestFilter = "all";
let user,
  staff = false,
  db,
  auth,
  A,
  F,
  unsubscribe,
  weddings = [],
  selected = null,
  view = "overview",
  busy = false,
  modalContext,
  filter = "",
  archived = false,
  noticeTimer;
const current = () => weddings.find((w) => w.id === selected);
function notice(text) {
  document.querySelector("#notice").textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => (document.querySelector("#notice").textContent = ""),
    6500,
  );
}
function openModal(title, html, context = {}) {
  modalContext = { id: selected, revision: current()?.revision, ...context };
  dialog.innerHTML = `<header><h2>${title}</h2>${btn("Close", "close", 'aria-label="Close dialog"')}</header><div class="form-error" role="alert"></div>${html}`;
  for (const field of dialog.querySelectorAll(
    "input[id],select[id],textarea[id]",
  )) {
    const oldId = field.id;
    for (const label of dialog.querySelectorAll("label[for]"))
      if (label.htmlFor === oldId) label.htmlFor = "modal-" + oldId;
    field.id = "modal-" + oldId;
  }
  app.inert = true;
  dialog.showModal();
}
function closeModal() {
  if (busy) return;
  dialog.close();
  app.inert = false;
  modalContext = null;
  render();
}
dialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeModal();
});
const actions = (label) =>
  `<div class="actions">${btn("Cancel", "close")}<button class="primary" type="submit">${label}</button></div>`;
function errorMessage(e) {
  const messages = {
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/email-already-in-use":
      "An account already exists for this email. Sign in or reset your password.",
    "auth/weak-password": "Use a password of at least 12 characters.",
    "auth/too-many-requests":
      "Too many attempts. Please wait before trying again.",
    "auth/network-request-failed":
      "Connection lost. Please reconnect and retry.",
  };
  return messages[e.code] || e.message || "Something went wrong. Please retry.";
}
async function api(command) {
  if (demoMode) return demoStore.command(command, staff);
  const token = await user.getIdToken();
  const r = await fetch("/api/wedding", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(command),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Unable to save. Please retry.");
  return result;
}
async function mutate(action, data = {}, extra = {}) {
  const context = modalContext || {
    id: selected,
    revision: current()?.revision,
  };
  const result = await api({
    action,
    id: context.id,
    revision: context.revision,
    data,
    ...extra,
  });
  if (result.wedding) {
    weddings = weddings
      .filter((w) => w.id !== result.wedding.id)
      .concat(result.wedding);
    selected = result.wedding.id;
  }
  return result;
}
function login() {
  app.innerHTML = `<section class="welcome"><div class="heart" aria-hidden="true">♡</div><p class="eyebrow">MCN COLLECTION</p><h1>Wedding Day Plan</h1><p class="muted">Your menus, your guests, your day.</p><div id="login-error" class="form-error" role="alert"></div><form data-form="login">${input("email", "Email address", "", "email")}${input("password", "Password", "", "password")}<div class="actions"><button class="primary full" type="submit">Sign in</button></div></form><div class="row actions">${btn("Create account", "register")}${btn("Forgot password", "reset")}</div><p class="secondary-text muted">Couples: use the email address given to your venue. Your email must be verified before opening a wedding.</p></section>`;
}
function render() {
  if (!user) {
    login();
    return;
  }
  if (!user.emailVerified) {
    app.innerHTML = `<section class="welcome"><p class="eyebrow">ONE MORE STEP</p><h1>Verify your email</h1><p>Open the verification email sent to ${esc(user.email)}.</p><div class="stack">${btn("I have verified my email", "verified", "", true)}${btn("Resend verification", "resend")}${btn(demoMode ? "Reset demo" : "Sign out", "logout")}</div></section>`;
    return;
  }
  const w = current();
  if (!w) {
    renderDashboard();
    return;
  }
  const locked = w.eventDetails.isSubmitted || w.archived;
  const tabs = [
    ["overview", "Planning checklist"],
    ["menu", "Menu options"],
    ["guests", "Guest list"],
    ["seating", "Seating plan"],
    ["totals", "Totals & submission"],
    ["report", "Kitchen & service sheets"],
    ["settings", "Wedding details"],
  ];
  app.innerHTML = `<div class="layout"><aside><p class="eyebrow">MCN COLLECTION</p><h2>Wedding<br>Day Plan</h2><p class="muted">${esc(MENUS[w.eventDetails.venue].name)}</p><nav class="nav" aria-label="Wedding sections">${tabs.map(([id, label]) => btn(label, "tab", `data-tab="${id}"`)).join("")}${btn(staff ? "All weddings" : "My weddings", "dashboard")}${btn(demoMode ? "Reset demo" : "Sign out", "logout")}</nav></aside><section class="content"><header class="page-header"><div class="row spread"><p class="eyebrow">${staff ? "STAFF PORTAL" : "YOUR WEDDING"}</p><span class="pill ${locked ? "good" : ""}">${w.archived ? "Archived" : locked ? "Submitted" : "Planning"}</span></div><h1>${esc(w.eventDetails.partner1)} &amp; ${esc(w.eventDetails.partner2)}</h1><p class="muted">${dateLabel(w.eventDetails.date)} · Final details by ${dateLabel(deadline(w.eventDetails.date))}</p>${locked ? '<div class="banner success">' + (w.archived ? "This wedding is archived." : "Your final details are submitted. Contact the venue if anything changes.") + "</div>" : ""}</header><div id="page">${view === "overview" ? overviewPage(w) : view === "menu" ? menuPage(w) : view === "guests" ? guestPage(w) : view === "seating" ? seatingPage(w) : view === "totals" ? totalsPage(w) : view === "settings" ? settingsPage(w) : reportPage(w)}</div><footer class="footer">Saved version ${w.revision} · ${esc(new Date(w.updatedAt).toLocaleString("en-GB"))}</footer></section></div>`;
  // Avoid duplicate class attributes on navigation buttons.
  for (const b of app.querySelectorAll("[data-tab]"))
    b.classList.toggle("active", b.dataset.tab === view);
}
function renderDashboard() {
  const visible = weddings
    .filter(
      (w) =>
        (staff ? w.archived === archived : !w.archived) &&
        (!filter || w.eventDetails.venue === filter),
    )
    .sort((a, b) => a.eventDetails.date.localeCompare(b.eventDetails.date));
  app.innerHTML = `<section class="content"><header class="page-header"><p class="eyebrow">MCN COLLECTION</p><div class="row spread"><h1>${staff ? "Wedding overview" : "Your weddings"}</h1><div class="row">${staff ? btn("Add wedding", "new", "", true) : ""}${btn(demoMode ? "Reset demo" : "Sign out", "logout")}</div></div><p class="muted">${staff ? "Keep track of dates, final details and guest numbers." : "Choose your wedding to continue planning."}</p></header>${staff ? `<div class="row no-print">${select("venueFilter", "Venue", [["", "All venues"], ...Object.entries(MENUS).map(([k, v]) => [k, v.name])], filter)}${btn(archived ? "Show active weddings" : "Show archived weddings", "archive-filter")}</div><br>` : ""}<div class="grid">${
    visible
      .map((w) => {
        const issues = submissionIssues(w);
        return `<article class="card"><span class="pill ${w.eventDetails.isSubmitted ? "good" : "warn"}">${w.eventDetails.isSubmitted ? "Submitted" : issues.length + " items to complete"}</span><h2>${esc(w.eventDetails.partner1)} &amp; ${esc(w.eventDetails.partner2)}</h2><p>${dateLabel(w.eventDetails.date)}<br><span class="muted">${esc(MENUS[w.eventDetails.venue].name)}</span></p><p class="muted">${w.guests.filter((g) => g.rsvp === "attending").length} attending · Deadline ${dateLabel(deadline(w.eventDetails.date))}</p>${btn("Open wedding", "open", `data-id="${w.id}"`, true)}</article>`;
      })
      .join("") ||
    `<div class="card empty"><h2>${staff ? "No weddings here yet" : "Your wedding is not linked yet"}</h2><p>${staff ? "Add a wedding and the couple’s email addresses." : "Ask your venue to link " + esc(user.email) + " to your wedding."}</p></div>`
  }</div></section>`;
}
function menuPage(w) {
  const m = w.menuSelections,
    d = w.eventDetails;
  return `<div class="row spread"><h2>Menu options</h2>${!d.isSubmitted && !w.archived ? btn("Choose menus", "menus", "", true) : ""}</div><div class="grid">${[
    ["Canapés", m.canapes],
    ["Starters", m.starters],
    ["Mains", m.mains],
    ["Desserts", m.desserts],
    ["Children’s starters", m.kidsStarters],
    ["Children’s mains", m.kidsMains],
    ["Children’s desserts", m.kidsDesserts],
    [
      "Evening food",
      [
        m.eveningCategory,
        ...m.eveningPizzas,
        ...m.eveningStreetFood,
        ...m.eveningSides,
      ].filter(Boolean),
    ],
  ]
    .map(
      ([title, items]) =>
        `<section class="card"><h3>${title}</h3>${items.length ? "<ul>" + items.map((v) => `<li>${esc(v)}</li>`).join("") + "</ul>" : '<p class="muted">Not selected</p>'}</section>`,
    )
    .join(
      "",
    )}</div><p class="muted">Vegan meal options remain available in each guest’s meal choices. Changing menus may leave existing guest choices needing an update.</p>`;
}
function overviewPage(w) {
  const p = planningSummary(w),
    locked = w.archived || w.eventDetails.isSubmitted;
  const due = w.eventDetails.isSubmitted
    ? "Final details submitted"
    : p.days < 0
      ? `${Math.abs(p.days)} days past the final-details deadline`
      : p.days === 0
        ? "Final details are due today"
        : `${p.days} days until final details are due`;
  const tasks = [
    ["RSVPs to confirm", p.pending, "guests", "pending"],
    ["Guests needing meal choices", p.missing, "guests", "missing-meals"],
    ["Guests needing a seat", p.unseated, "guests", "unseated"],
    ["Tables over capacity", p.overfull, "seating", "all"],
  ];
  return `<div class="overview-hero"><p class="eyebrow">YOUR NEXT STEPS</p><h2>Let’s get everything ready.</h2><p>${esc(due)}</p><div class="row spread"><span>${p.ready} of ${p.attending} attending guests have meals and seats</span><strong>${p.percent}%</strong></div><progress value="${p.percent}" max="100" aria-label="Guests with meals and seats">${p.percent}%</progress><small>This tracks guest details. Menus and final sign-off are checked before submission.</small></div><div class="task-grid">${tasks.map(([label, count, tab, filter]) => `<button class="task-card" data-action="task" data-tab="${tab}" data-filter="${filter}"><span class="task-count ${count ? "needs-attention" : "complete"}">${count || "✓"}</span><span>${label}</span><small>${count ? "Review details →" : "Complete"}</small></button>`).join("")}</div><div class="grid"><section class="card"><h3>Your wedding at a glance</h3><p>${p.attending} attending · ${w.guests.filter((g) => g.isChild && g.rsvp === "attending").length} children<br>${w.tables.length} tables · ${w.guests.filter((g) => g.rsvp === "attending" && (g.isVegan || g.dietary)).length} dietary notes</p>${btn("Review your menus", "tab", 'data-tab="menu"')}</section><section class="card"><h3>Final confirmation</h3><p>${locked ? "Your wedding details are locked. Staff will help with changes." : "Review outstanding details, then sign to confirm your final numbers."}</p>${btn("Review final details", "tab", 'data-tab="totals"', true)}</section></div>`;
}
function guestResults(w) {
  const locked = w.eventDetails.isSubmitted || w.archived,
    guests = filterGuests(w, { search: guestSearch, filter: guestFilter });
  return `<p class="muted" role="status">Showing ${guests.length} of ${w.guests.length} guests</p><div class="card table-wrap"><table class="guest-table"><thead><tr><th>Name</th><th>RSVP</th><th>Meals</th><th>Table</th><th>Dietary</th><th>Actions</th></tr></thead><tbody>${guests.map((g) => `<tr><td data-label="Name"><strong>${esc(g.name)}</strong>${g.isChild ? "<br><small>Child</small>" : ""}</td><td data-label="RSVP"><span class="pill ${g.rsvp === "attending" ? "good" : g.rsvp === "pending" ? "warn" : ""}">${esc(g.rsvp)}</span></td><td data-label="Meals">${courses.map((c) => `<div><small>${c[0].toUpperCase() + c.slice(1)}:</small> ${esc(g[c] || "Not chosen")}</div>`).join("")}${missingMeals(w, g) ? '<span class="pill warn">Needs a meal choice</span>' : ""}</td><td data-label="Table">${esc(w.tables.find((t) => t.id === g.tableId)?.name || "Unassigned")}</td><td data-label="Dietary">${g.isVegan ? "Vegan<br>" : ""}${esc(g.dietary || (!g.isVegan ? "None recorded" : ""))}</td><td data-label="Actions">${!locked ? btn("Edit", "guest", `data-id="${g.id}" aria-label="Edit ${esc(g.name)}"`) : "Locked"}</td></tr>`).join("") || '<tr><td colspan="6">' + (w.guests.length ? "No guests match these filters." : "Add your guests to start planning.") + "</td></tr>"}</tbody></table></div>`;
}
function guestPage(w) {
  const locked = w.eventDetails.isSubmitted || w.archived;
  return `<div class="row spread"><h2>Guest list</h2><div class="row">${btn("Export all guests", "csv")}${!locked ? btn("Bulk add", "bulk") + btn("Add guest", "guest", "", true) : ""}</div></div><div class="guest-tools"><div><label for="guest-search">Search guests, tables or dietary notes</label><input id="guest-search" type="search" value="${esc(guestSearch)}" placeholder="Start typing a name…"></div><div>${select(
    "guest-filter",
    "Show guests",
    [
      ["all", "All guests"],
      ["attending", "Attending"],
      ["pending", "Pending RSVP"],
      ["declined", "Declined"],
      ["missing-meals", "Missing meal choices"],
      ["unseated", "Needs a seat"],
      ["dietary", "Dietary requirements"],
      ["children", "Children"],
    ],
    guestFilter,
  )}</div>${btn("Clear filters", "clear-filters")}</div><div id="guest-results">${guestResults(w)}</div>`;
}
function seatingPage(w) {
  const locked = w.eventDetails.isSubmitted || w.archived,
    unseated = filterGuests(w, { filter: "unseated" });
  return `<div class="row spread"><h2>Seating plan</h2><div class="row">${!locked ? btn("Assign guests", "assign", "", true) + btn("Add table", "table") : ""}</div></div><section class="banner"><strong>${unseated.length} attending guests need seats.</strong>${unseated.length ? "<p>" + unseated.map((g) => esc(g.name)).join(", ") + "</p>" : ""}<p>Assign several guests together, or move them between tables.</p></section><div class="grid">${w.tables
    .map((t) => {
      const guests = w.guests.filter(
          (g) => g.rsvp === "attending" && g.tableId === t.id,
        ),
        remaining = t.seats - guests.length;
      return `<section class="card"><div class="row spread"><h3>${esc(t.name)}</h3><span class="pill ${remaining < 0 ? "warn" : remaining === 0 ? "good" : ""}">${guests.length} / ${t.seats} seats</span></div><p class="muted">${t.shape === "round" ? "Round" : "Rectangular"} · ${remaining < 0 ? Math.abs(remaining) + " over capacity" : remaining === 0 ? "Table full" : remaining + (remaining === 1 ? " seat free" : " seats free")}</p><ul>${guests.map((g) => `<li>${esc(g.name)}${g.isChild ? " <small>(child)</small>" : ""}</li>`).join("") || "<li>No guests assigned</li>"}</ul>${!locked ? '<div class="row">' + btn("Assign guests", "assign", `data-id="${t.id}"`) + btn("Edit table", "table", `data-id="${t.id}"`) + "</div>" : ""}</section>`;
    })
    .join("")}</div>`;
}
function seatingDialog(tableId) {
  const w = current(),
    guests = w.guests.filter((g) => g.rsvp === "attending");
  openModal(
    "Assign seats",
    `<form data-form="assign">${select("tableId", "Move selected guests to", [["", "Unassigned"], ...w.tables.map((t) => [t.id, `${t.name} (${t.seats - w.guests.filter((g) => g.rsvp === "attending" && g.tableId === t.id).length} seats free)`])], tableId || "")}<p class="muted">Choose guests below. Existing assignments move with them. Full tables cannot accept extra guests.</p><div class="seat-picker">${guests.map((g) => `<label class="check"><input type="checkbox" name="guestIds" value="${esc(g.id)}"><span><strong>${esc(g.name)}</strong><br><small>${esc(w.tables.find((t) => t.id === g.tableId)?.name || "Unassigned")}</small></span></label>`).join("") || "<p>Add attending guests first.</p>"}</div>${actions("Save seating")}</form>`,
  );
}
function totalsPage(w) {
  const issues = submissionIssues(w);
  const attending = w.guests.filter((g) => g.rsvp === "attending");
  return `<h2>Final details</h2><div class="count-grid"><div class="card"><span class="muted">Attending</span><div class="stat">${attending.length}</div></div><div class="card"><span class="muted">Children attending</span><div class="stat">${attending.filter((g) => g.isChild).length}</div></div><div class="card"><span class="muted">Pending RSVPs</span><div class="stat">${w.guests.filter((g) => g.rsvp === "pending").length}</div></div></div><br><section class="card"><h2>${w.eventDetails.isSubmitted ? "Final details submitted" : "Before you submit"}</h2>${w.eventDetails.isSubmitted ? `<p>Submitted ${esc(new Date(w.eventDetails.submissionDate).toLocaleString("en-GB"))}.</p><img class="signature" src="${esc(w.eventDetails.signature)}" alt="Submitted signature">` : issues.length ? `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "<p>All guests have valid meal choices and seats. Your details are ready to sign.</p>"}<div class="row">${!w.eventDetails.isSubmitted && !w.archived ? btn("Sign & submit", "submit", issues.length ? "disabled" : "", true) : ""}${staff && w.eventDetails.isSubmitted && !w.archived ? btn("Reopen wedding", "reopen") : ""}${btn("View kitchen sheets", "tab", 'data-tab="report"')}</div></section>`;
}
function settingsPage(w) {
  return `<section class="card"><h2>Wedding details</h2><p>${esc(w.eventDetails.partner1)} &amp; ${esc(w.eventDetails.partner2)}<br>${dateLabel(w.eventDetails.date)}<br>${esc(MENUS[w.eventDetails.venue].name)}</p>${!w.eventDetails.isSubmitted && !w.archived ? btn("Edit details", "settings") : ""}${staff ? `<hr><h3>Couple access</h3><p>${w.coupleEmails.map(esc).join("<br>")}</p><div class="row">${btn("Version history", "history")}${btn("Download backup", "backup")}${btn(w.archived ? "Restore from archive" : "Archive wedding", "archive")}</div>` : ""}</section>`;
}
function reportPage(w) {
  const gs = w.guests.filter((g) => g.rsvp === "attending");
  return `<article class="report">${demoMode ? "<p>DEMO · FICTIONAL RECORDS</p>" : ""}<div class="row spread no-print"><h2>Kitchen & service sheets</h2>${btn("Print / save PDF", "print", "", true)}</div><h1>${esc(w.eventDetails.partner1)} &amp; ${esc(w.eventDetails.partner2)}</h1><p>${dateLabel(w.eventDetails.date)} · ${esc(MENUS[w.eventDetails.venue].name)} · ${gs.length} attending (${gs.filter((g) => g.isChild).length} children)<br>${w.eventDetails.isSubmitted ? "FINAL SUBMITTED DETAILS" : "DRAFT: details may change"} · Version ${w.revision}</p><h2>Kitchen quantities</h2><div class="grid">${courses
    .map((c) => {
      const counts = new Map();
      for (const g of gs)
        counts.set(
          g[c] || "Not chosen",
          (counts.get(g[c] || "Not chosen") || 0) + 1,
        );
      return `<section class="card no-break"><h3>${c[0].toUpperCase() + c.slice(1)}</h3><table><tbody>${[...counts].map(([name, n]) => `<tr><td>${esc(name)}</td><td>${n}</td></tr>`).join("")}</tbody></table></section>`;
    })
    .join(
      "",
    )}</div><h2>Canapés & evening food</h2><p>${esc(w.menuSelections.canapes.join(" · ") || "No canapés selected")}<br>${esc([w.menuSelections.eveningCategory, ...w.menuSelections.eveningPizzas, ...w.menuSelections.eveningStreetFood, ...w.menuSelections.eveningSides].filter(Boolean).join(" · "))}</p><h2>Dietary requirements</h2><table><thead><tr><th>Guest</th><th>Table</th><th>Requirements</th></tr></thead><tbody>${
    gs
      .filter((g) => g.dietary || g.isVegan)
      .map(
        (g) =>
          `<tr><td>${esc(g.name)}</td><td>${esc(w.tables.find((t) => t.id === g.tableId)?.name || "Unassigned")}</td><td>${g.isVegan ? "Vegan. " : ""}${esc(g.dietary)}</td></tr>`,
      )
      .join("") || '<tr><td colspan="3">None recorded</td></tr>'
  }</tbody></table>${[...w.tables, { id: null, name: "Unassigned" }]
    .map((t) => {
      const guests = gs.filter((g) => g.tableId === t.id);
      return guests.length
        ? `<section><h2>${esc(t.name)}</h2><table><thead><tr><th>Guest</th><th>Starter</th><th>Main</th><th>Dessert</th><th>Dietary</th></tr></thead><tbody>${guests.map((g) => `<tr><td>${esc(g.name)}${g.isChild ? " (child)" : ""}</td>${courses.map((c) => `<td>${esc(g[c])}</td>`).join("")}<td>${g.isVegan ? "Vegan. " : ""}${esc(g.dietary)}</td></tr>`).join("")}</tbody></table></section>`
        : "";
    })
    .join("")}</article>`;
}
function menuDialog() {
  const w = current(),
    m = w.menuSelections;
  const sections = [
    ["canapes", "Canapés: choose 3", MENUS[w.eventDetails.venue].canapes],
    ...["starters", "mains", "desserts"].map((k) => [
      k,
      k[0].toUpperCase() + k.slice(1) + ": choose up to 3",
      MENUS[w.eventDetails.venue][k],
    ]),
    ...["Starters", "Mains", "Desserts"].map((k) => [
      "kids" + k,
      "Children’s " + k.toLowerCase() + ": choose 1",
      SHARED_MENUS.kids[k.toLowerCase()],
    ]),
    [
      "eveningPizzas",
      "Pizzas: choose 3 for the pizza package",
      SHARED_MENUS.evening.find((p) => p.isPizza).items,
    ],
    [
      "eveningStreetFood",
      "Street food: choose up to 3",
      SHARED_MENUS.evening.find((p) => p.name === "Street Food").items,
    ],
    [
      "eveningSides",
      "Hog roast extra sides",
      SHARED_MENUS.evening.find((p) => p.extraItems).extraItems,
    ],
  ];
  openModal(
    "Choose your menus",
    `<form data-form="menus">${check("hasCanapes", "Include canapés", w.eventDetails.hasCanapes)}${select("eveningCategory", "Evening package", [["", "Choose package"], ...SHARED_MENUS.evening.map((p) => [p.name, p.name])], m.eveningCategory)}${sections.map(([k, title, items]) => `<fieldset><legend>${title}</legend><div class="choices">${items.map((item) => `<label class="check"><input type="checkbox" name="${k}" value="${esc(item)}" ${m[k].includes(item) ? "checked" : ""}>${esc(item)}</label>`).join("")}</div></fieldset>`).join("")}${actions("Save menu choices")}</form>`,
  );
}
function guestDialog(id) {
  const w = current(),
    g = w.guests.find((g) => g.id === id) || {
      id: crypto.randomUUID(),
      name: "",
      rsvp: "pending",
      isChild: false,
      isVegan: false,
      dietary: "",
      starter: "",
      main: "",
      dessert: "",
      tableId: null,
    };
  openModal(
    id ? "Edit guest" : "Add guest",
    `<form data-form="guest">${input("name", "Guest name", g.name)}${select(
      "rsvp",
      "RSVP",
      [
        ["pending", "Pending"],
        ["attending", "Attending"],
        ["declined", "Declined"],
      ],
      g.rsvp,
    )}${check("isChild", "Child", g.isChild)}${check("isVegan", "Vegan", g.isVegan)}<div id="meal-fields">${guestMealFields(w, g)}</div><label for="dietary">Dietary requirements</label><textarea id="dietary" name="dietary" maxlength="1000">${esc(g.dietary)}</textarea>${select("tableId", "Table", [["", "Unassigned"], ...w.tables.map((t) => [t.id, `${t.name} (${t.seats} seats)`])], g.tableId || "")}${id ? btn("Remove guest", "remove-guest", `data-id="${id}"`) : ""}${actions("Save guest")}</form>`,
    { guest: g },
  );
}
function guestMealFields(w, g) {
  return courses
    .map((c) =>
      select(
        c,
        c[0].toUpperCase() + c.slice(1),
        [["", "Choose meal"], ...optionsFor(w, g, c).map((v) => [v, v])],
        g[c],
      ),
    )
    .join("");
}
function signatureDialog() {
  openModal(
    "Confirm your final details",
    `<p>Sign to confirm your guest numbers, menus and seating. Staff must reopen the wedding before further edits.</p><form data-form="submit"><canvas id="signature" class="signature" width="1000" height="320" aria-label="Draw your signature" tabindex="0"></canvas><p class="secondary-text">Draw using your mouse, finger or stylus.</p>${btn("Clear signature", "clear-signature")}${actions("Confirm & submit")}</form>`,
    { signed: false },
  );
  let drawing = false;
  const c = document.querySelector("#signature"),
    ctx = c.getContext("2d");
  const point = (e) => {
    const r = c.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * c.width) / r.width,
      ((e.clientY - r.top) * c.height) / r.height,
    ];
  };
  c.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    drawing = true;
    c.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...point(e));
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#302626";
  });
  c.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    ctx.lineTo(...point(e));
    ctx.stroke();
    modalContext.signed = true;
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    c.addEventListener(event, () => (drawing = false));
}
async function handleAction(el) {
  const action = el.dataset.action,
    id = el.dataset.id;
  if (busy) return;
  if (action === "close") {
    closeModal();
    return;
  }
  if (action === "demo-role" && demoMode) {
    staff = !staff;
    weddings = demoStore.list(staff);
    selected = weddings[0]?.id || null;
    user = {
      uid: staff ? "demo-staff" : "demo-couple",
      email: staff ? "staff@example.com" : "couple@example.com",
      emailVerified: true,
    };
    document.querySelector("#demo-role").textContent = staff
      ? "View as couple"
      : "View as staff";
    render();
    return;
  }
  if (action === "logout") {
    if (demoMode) {
      location.reload();
      return;
    }
    if (dialog.open) closeModal();
    await A.signOut(auth);
    return;
  }
  if (action === "register") {
    openModal(
      "Create your account",
      `<form data-form="register">${input("email", "Email address", document.querySelector("#email")?.value || "", "email")}${input("password", "Password (at least 12 characters)", "", "password")}<p class="muted">Use the email your venue has linked to your wedding.</p>${actions("Create account")}</form>`,
    );
    return;
  }
  if (action === "reset") {
    openModal(
      "Reset password",
      `<form data-form="reset">${input("email", "Email address", document.querySelector("#email")?.value || "", "email")}${actions("Send reset email")}</form>`,
    );
    return;
  }
  if (action === "resend") {
    await A.sendEmailVerification(user);
    notice("Verification email sent.");
    return;
  }
  if (action === "verified") {
    await user.reload();
    await user.getIdToken(true);
    await sessionChanged(auth.currentUser);
    return;
  }
  if (action === "dashboard") {
    selected = null;
    render();
    return;
  }
  if (action === "open") {
    guestSearch = "";
    guestFilter = "all";
    selected = id;
    view = "overview";
    render();
    return;
  }
  if (action === "task") {
    guestSearch = "";
    guestFilter = el.dataset.filter || "all";
    view = el.dataset.tab;
    render();
    return;
  }
  if (action === "clear-filters") {
    guestSearch = "";
    guestFilter = "all";
    render();
    return;
  }
  if (action === "assign") {
    seatingDialog(id);
    return;
  }
  if (action === "tab") {
    view = el.dataset.tab;
    render();
    return;
  }
  if (action === "archive-filter") {
    archived = !archived;
    render();
    return;
  }
  if (action === "new") {
    openModal(
      "Add a wedding",
      `<form data-form="new">${input("partner1", "Partner 1")}${input("partner2", "Partner 2")}${input("date", "Wedding date", "", "date")}${select(
        "venue",
        "Venue",
        Object.entries(MENUS).map(([k, v]) => [k, v.name]),
        "shotton",
      )}${input("email1", "Couple email 1", "", "email")}${input("email2", "Couple email 2 (optional)", "", "email", false)}<p class="muted">Each partner creates and verifies an account with one of these emails. They will then see this wedding.</p>${actions("Create wedding")}</form>`,
      { id: null, revision: null },
    );
    return;
  }
  if (action === "menus") {
    menuDialog();
    return;
  }
  if (action === "guest") {
    guestDialog(id);
    return;
  }
  if (action === "bulk") {
    openModal(
      "Add several guests",
      `<form data-form="bulk"><label for="names">One name per line</label><textarea id="names" name="names" required maxlength="50000" rows="10"></textarea>${actions("Add guests")}</form>`,
    );
    return;
  }
  if (action === "table") {
    const t = current().tables.find((t) => t.id === id) || {
      id: crypto.randomUUID(),
      name: "",
      seats: 8,
      shape: "round",
    };
    openModal(
      id ? "Edit table" : "Add table",
      `<form data-form="table">${input("name", "Table name", t.name)}${input("seats", "Number of seats", t.seats, "number")}${select(
        "shape",
        "Shape",
        [
          ["round", "Round"],
          ["rect", "Rectangular"],
        ],
        t.shape,
      )}${id ? btn("Remove table", "remove-table", `data-id="${id}"`) : ""}${actions("Save table")}</form>`,
      { table: t },
    );
    return;
  }
  if (action === "settings") {
    const w = current(),
      d = w.eventDetails;
    openModal(
      "Wedding details",
      `<form data-form="settings">${input("partner1", "Partner 1", d.partner1)}${input("partner2", "Partner 2", d.partner2)}${staff ? input("date", "Wedding date", d.date, "date") + input("email1", "Couple email 1", w.coupleEmails[0], "email") + input("email2", "Couple email 2 (optional)", w.coupleEmails[1] || "", "email", false) : ""}${actions("Save details")}</form>`,
    );
    return;
  }
  if (action === "submit") {
    const issues = submissionIssues(current());
    if (issues.length) throw new Error(issues.join("\n"));
    signatureDialog();
    return;
  }
  if (action === "clear-signature") {
    const c = document.querySelector("#signature");
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    modalContext.signed = false;
    return;
  }
  if (["reopen", "archive"].includes(action)) {
    openModal(
      action === "reopen"
        ? "Reopen wedding"
        : current().archived
          ? "Restore archived wedding"
          : "Archive wedding",
      `<form data-form="${action}"><label for="reason">Reason (saved in the history)</label><textarea id="reason" name="reason" maxlength="500" required></textarea>${actions("Confirm")}</form>`,
    );
    return;
  }
  if (action === "history") {
    const result = await api({ action: "history", id: selected });
    openModal(
      "Saved version history",
      `<p>Restoring a version keeps the current couple access and returns the wedding to draft. Reopen submitted weddings first.</p><div class="stack">${result.versions.map((v) => `<section class="card"><h3>Version ${v.revision}</h3><p>Saved before ${esc(v.action)}<br>${esc(new Date(v.savedAt).toLocaleString("en-GB"))}<br>${esc(v.actor)}<br>${esc(v.reason)}</p>${btn("Restore this version", "restore", `data-id="${v.id}" ${current().eventDetails.isSubmitted || current().archived ? "disabled" : ""}`)}</section>`).join("") || "<p>No earlier versions yet.</p>"}</div>`,
    );
    return;
  }
  if (action === "restore") {
    closeModal();
    openModal(
      "Restore previous version",
      `<form data-form="restore"><p>The current version will remain in history.</p><label for="reason">Reason</label><textarea id="reason" name="reason" required maxlength="500"></textarea>${actions("Restore version")}</form>`,
      { versionId: id },
    );
    return;
  }
  if (action === "remove-guest" || action === "remove-table") {
    if (
      !confirm(
        action === "remove-guest"
          ? "Remove this guest?"
          : "Remove this table and unassign its guests?",
      )
    )
      return;
    await perform(async () => {
      const w = current();
      await mutate(
        "edit",
        action === "remove-guest"
          ? { guests: w.guests.filter((g) => g.id !== id) }
          : {
              tables: w.tables.filter((t) => t.id !== id),
              guests: w.guests.map((g) =>
                g.tableId === id ? { ...g, tableId: null } : g,
              ),
            },
      );
    });
    return;
  }
  if (action === "csv") {
    const w = current();
    download(
      "wedding-guests.csv",
      "\uFEFF" +
        [
          [
            "Name",
            "RSVP",
            "Starter",
            "Main",
            "Dessert",
            "Dietary",
            "Table",
            "Child",
            "Vegan",
          ],
          ...w.guests.map((g) => [
            g.name,
            g.rsvp,
            g.starter,
            g.main,
            g.dessert,
            g.dietary,
            w.tables.find((t) => t.id === g.tableId)?.name || "",
            g.isChild ? "Yes" : "No",
            g.isVegan ? "Yes" : "No",
          ]),
        ]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n"),
      "text/csv",
    );
    return;
  }
  if (action === "backup") {
    download(
      "wedding-backup-" + selected + ".json",
      JSON.stringify(
        { exportedAt: new Date().toISOString(), wedding: current() },
        null,
        2,
      ),
      "application/json",
    );
    return;
  }
  if (action === "print") {
    window.print();
    return;
  }
}
function download(name, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function perform(fn) {
  busy = true;
  const buttons = [...dialog.querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await fn();
    busy = false;
    closeModal();
    render();
    notice(
      demoMode
        ? "Demo updated. Changes reset when you refresh."
        : "Changes saved.",
    );
  } catch (e) {
    const target = dialog.open
      ? dialog.querySelector(".form-error")
      : document.querySelector("#login-error");
    if (target) target.textContent = errorMessage(e);
    else notice(errorMessage(e));
  } finally {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (el) handleAction(el).catch((err) => notice(errorMessage(err)));
});
document.addEventListener("input", (e) => {
  if (e.target.id === "guest-search") {
    guestSearch = e.target.value;
    document.querySelector("#guest-results").innerHTML =
      guestResults(current());
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "guest-filter") {
    guestFilter = e.target.value;
    document.querySelector("#guest-results").innerHTML =
      guestResults(current());
  }
  if (e.target.id === "venueFilter") {
    filter = e.target.value;
    render();
  }
  if (dialog.open && e.target.matches("[name=isChild],[name=isVegan]")) {
    const f = e.target.form;
    const g = {
      ...modalContext.guest,
      isChild: f.elements.isChild.checked,
      isVegan: f.elements.isVegan.checked,
    };
    for (const c of courses) g[c] = f.elements[c].value;
    document.querySelector("#meal-fields").innerHTML = guestMealFields(
      current(),
      g,
    );
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!form.dataset.form) return;
  e.preventDefault();
  if (busy) return;
  const f = new FormData(form),
    kind = form.dataset.form;
  const val = (k) => (f.get(k) || "").trim();
  if (kind === "login") {
    const b = form.querySelector("button");
    b.disabled = true;
    try {
      await A.signInWithEmailAndPassword(
        auth,
        val("email").toLowerCase(),
        f.get("password"),
      );
    } catch (err) {
      document.querySelector("#login-error").textContent = errorMessage(err);
    } finally {
      b.disabled = false;
    }
    return;
  }
  await perform(async () => {
    if (kind === "register") {
      if (f.get("password").length < 12)
        throw new Error("Use at least 12 characters for your password.");
      const result = await A.createUserWithEmailAndPassword(
        auth,
        val("email").toLowerCase(),
        f.get("password"),
      );
      await A.sendEmailVerification(result.user);
      return;
    }
    if (kind === "reset") {
      await A.sendPasswordResetEmail(auth, val("email").toLowerCase());
      return;
    }
    const w = current();
    if (kind === "assign") {
      await mutate("edit", {
        guests: assignSeats(w, f.getAll("guestIds"), val("tableId") || null),
      });
      return;
    }
    if (kind === "new") {
      await mutate("create", {
        eventDetails: {
          partner1: val("partner1"),
          partner2: val("partner2"),
          date: val("date"),
          venue: val("venue"),
        },
        coupleEmails: [val("email1"), val("email2")]
          .filter(Boolean)
          .map((e) => e.toLowerCase()),
      });
      view = "overview";
      return;
    }
    if (kind === "guest") {
      const g = {
        id: modalContext.guest.id,
        name: val("name"),
        rsvp: val("rsvp"),
        isChild: f.has("isChild"),
        isVegan: f.has("isVegan"),
        dietary: val("dietary"),
        starter: val("starter"),
        main: val("main"),
        dessert: val("dessert"),
        tableId: val("tableId") || null,
      };
      await mutate("edit", {
        guests: w.guests.some((x) => x.id === g.id)
          ? w.guests.map((x) => (x.id === g.id ? g : x))
          : [...w.guests, g],
      });
      return;
    }
    if (kind === "bulk") {
      const names = val("names")
        .split(/[\r\n]+/)
        .map((n) => n.trim())
        .filter(Boolean);
      if (!names.length) throw new Error("Enter at least one guest.");
      await mutate("edit", {
        guests: [
          ...w.guests,
          ...names.map((name) => ({
            id: crypto.randomUUID(),
            name,
            rsvp: "pending",
            isChild: false,
            isVegan: false,
            dietary: "",
            starter: "",
            main: "",
            dessert: "",
            tableId: null,
          })),
        ],
      });
      return;
    }
    if (kind === "table") {
      const t = {
        id: modalContext.table.id,
        name: val("name"),
        seats: Number(val("seats")),
        shape: val("shape"),
      };
      await mutate("edit", {
        tables: w.tables.some((x) => x.id === t.id)
          ? w.tables.map((x) => (x.id === t.id ? t : x))
          : [...w.tables, t],
      });
      return;
    }
    if (kind === "menus") {
      const m = {};
      for (const k of Object.keys(w.menuSelections))
        m[k] = k === "eveningCategory" ? val(k) : f.getAll(k);
      if (m.eveningCategory !== "Woodfired Pizzas") m.eveningPizzas = [];
      if (m.eveningCategory !== "Street Food") m.eveningStreetFood = [];
      if (m.eveningCategory !== "Hog Roast") m.eveningSides = [];
      if (!f.has("hasCanapes")) m.canapes = [];
      await mutate("edit", {
        menuSelections: m,
        eventDetails: { hasCanapes: f.has("hasCanapes") },
      });
      return;
    }
    if (kind === "settings") {
      const data = {
        eventDetails: { partner1: val("partner1"), partner2: val("partner2") },
      };
      if (staff) {
        data.eventDetails.date = val("date");
        data.coupleEmails = [val("email1"), val("email2")]
          .filter(Boolean)
          .map((e) => e.toLowerCase());
      }
      await mutate("edit", data);
      return;
    }
    if (kind === "submit") {
      if (!modalContext.signed)
        throw new Error("Please draw your signature first.");
      await mutate("submit", {
        signature: document.querySelector("#signature").toDataURL("image/png"),
      });
      return;
    }
    if (["archive", "reopen", "restore"].includes(kind)) {
      await mutate(
        kind,
        { reason: val("reason") },
        kind === "restore" ? { versionId: modalContext.versionId } : {},
      );
      return;
    }
  });
  if (kind === "reset" && !dialog.open)
    notice("If an account exists, a reset email will arrive shortly.");
});
let sessionGeneration = 0;
async function sessionChanged(next) {
  const generation = ++sessionGeneration;
  unsubscribe?.();
  unsubscribe = null;
  user = next;
  staff = false;
  weddings = [];
  selected = null;
  if (dialog.open) {
    dialog.close();
    app.inert = false;
    modalContext = null;
  }
  if (!next || !next.emailVerified) {
    render();
    return;
  }
  try {
    const token = await next.getIdTokenResult();
    if (generation !== sessionGeneration) return;
    staff = token.claims.staff === true;
    const base = F.collection(db, "weddings");
    const q = staff
      ? base
      : F.query(
          base,
          F.where("coupleEmails", "array-contains", next.email.toLowerCase()),
          F.where("archived", "==", false),
        );
    app.innerHTML =
      '<section class="welcome"><h1>Loading your weddings…</h1></section>';
    unsubscribe = F.onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (generation !== sessionGeneration) return;
        weddings = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!staff && !selected && weddings.length === 1)
          selected = weddings[0].id;
        if (selected && !weddings.some((w) => w.id === selected)) {
          selected = null;
          if (dialog.open) {
            dialog.close();
            app.inert = false;
            modalContext = null;
          }
        }
        if (!dialog.open) render();
        else if (current()?.revision !== modalContext.revision)
          dialog.querySelector(".form-error").textContent =
            "This wedding changed on another device. Cancel and reopen this form to use the latest version.";
      },
      (err) => {
        weddings = [];
        selected = null;
        if (dialog.open) {
          dialog.close();
          app.inert = false;
          modalContext = null;
        }
        app.innerHTML = `<section class="welcome"><h1>Unable to load weddings</h1><p>${esc(errorMessage(err))}</p>${btn(demoMode ? "Reset demo" : "Sign out", "logout")}</section>`;
      },
    );
  } catch (e) {
    notice(errorMessage(e));
    render();
  }
}
async function start() {
  if (demoMode) {
    const { createDemo } = await import("./demo.mjs");
    demoStore = createDemo();
    user = {
      uid: "demo-staff",
      email: "staff@example.com",
      emailVerified: true,
    };
    staff = true;
    weddings = demoStore.list(staff);
    selected = "sample-wedding";
    view = "overview";
    render();
    return;
  }
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    const config = await r.json();
    if (!r.ok) throw new Error(config.error);
    const base = "https://www.gstatic.com/firebasejs/12.0.0/";
    const [core, a, f] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-firestore.js"),
    ]);
    A = a;
    F = f;
    const firebase = core.initializeApp(config);
    auth = A.getAuth(firebase);
    db = F.getFirestore(firebase);
    await A.setPersistence(auth, A.browserSessionPersistence);
    A.onAuthStateChanged(auth, sessionChanged);
  } catch (e) {
    app.innerHTML = `<section class="welcome"><p class="eyebrow">MCN COLLECTION</p><h1>Wedding Day Plan</h1><p>Shared saving is not connected yet.</p><p class="muted">The venue team needs to finish the Firebase setup before accounts and wedding records are available.</p><button type="button" id="retry">Try again</button><p><a href="/demo.html">Explore the demo wedding</a></p></section>`;
    document.querySelector("#retry").onclick = () => location.reload();
  }
}
window.addEventListener("beforeunload", (e) => {
  if (dialog.open && dialog.querySelector("form")) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("offline", () =>
  notice("You are offline. Changes will not save until you reconnect."),
);
start();
