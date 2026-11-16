import { MENUS, SHARED_MENUS } from "./menus.mjs";
export class Problem extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const requireValue = (condition, message) => {
  if (!condition) throw new Problem(message);
};
const string = (x, max = 200) => typeof x === "string" && x.length <= max;
const keys = (obj, allowed) =>
  obj &&
  typeof obj === "object" &&
  !Array.isArray(obj) &&
  Object.keys(obj).every((k) => allowed.includes(k));
export const courses = ["starter", "main", "dessert"];
export function optionsFor(w, guest, course) {
  if (guest.isVegan) return SHARED_MENUS.vegan[course + "s"];
  if (guest.isChild)
    return (
      w.menuSelections[
        "kids" + course[0].toUpperCase() + course.slice(1) + "s"
      ] || []
    );
  return w.menuSelections[course + "s"] || [];
}
export function emptyWedding(details, emails) {
  return {
    eventDetails: {
      ...details,
      isSubmitted: false,
      signature: null,
      submissionDate: null,
    },
    coupleEmails: emails,
    guests: [],
    tables: [{ id: "top", name: "Top Table", seats: 8, shape: "rect" }],
    menuSelections: {
      canapes: [],
      starters: [],
      mains: [],
      desserts: [],
      kidsStarters: [],
      kidsMains: [],
      kidsDesserts: [],
      eveningCategory: "",
      eveningPizzas: [],
      eveningSides: [],
      eveningStreetFood: [],
    },
    archived: false,
    revision: 0,
  };
}
export function validateWedding(w) {
  const d = w.eventDetails;
  requireValue(
    keys(d, [
      "partner1",
      "partner2",
      "date",
      "venue",
      "isSubmitted",
      "signature",
      "submissionDate",
      "hasVegGuests",
      "hasChildren",
      "hasCanapes",
    ]),
    "Invalid wedding details.",
  );
  for (const k of ["partner1", "partner2"])
    requireValue(string(d[k], 100) && d[k].trim(), "Enter both partner names.");
  requireValue(
    string(d.date, 10) &&
      /^\d{4}-\d{2}-\d{2}$/.test(d.date) &&
      !Number.isNaN(Date.parse(d.date)) &&
      new Date(d.date).toISOString().slice(0, 10) === d.date,
    "Enter a valid wedding date.",
  );
  requireValue(Object.hasOwn(MENUS, d.venue), "Choose a supported venue.");
  requireValue(typeof d.isSubmitted === "boolean", "Invalid submission state.");
  for (const k of ["hasVegGuests", "hasChildren", "hasCanapes"])
    requireValue(
      d[k] === undefined || d[k] === null || typeof d[k] === "boolean",
      "Invalid menu option.",
    );
  requireValue(
    d.signature === null ||
      (string(d.signature, 100000) &&
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d.signature)),
    "Invalid signature.",
  );
  requireValue(
    d.submissionDate === null ||
      (string(d.submissionDate, 30) &&
        !Number.isNaN(Date.parse(d.submissionDate))),
    "Invalid submission date.",
  );
  requireValue(
    Array.isArray(w.coupleEmails) &&
      w.coupleEmails.length > 0 &&
      w.coupleEmails.length <= 2 &&
      w.coupleEmails.every(
        (e) =>
          string(e, 254) &&
          e === e.toLowerCase().trim() &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
      ),
    "Enter one or two valid couple email addresses.",
  );
  const m = w.menuSelections;
  const limits = {
    canapes: 3,
    starters: 3,
    mains: 3,
    desserts: 3,
    kidsStarters: 1,
    kidsMains: 1,
    kidsDesserts: 1,
    eveningPizzas: 3,
    eveningSides: 4,
    eveningStreetFood: 3,
  };
  requireValue(
    keys(m, [...Object.keys(limits), "eveningCategory"]),
    "Invalid menu selections.",
  );
  requireValue(
    m.eveningCategory === "" ||
      SHARED_MENUS.evening.some((p) => p.name === m.eveningCategory),
    "Invalid evening package.",
  );
  for (const [k, limit] of Object.entries(limits)) {
    const choices = k.startsWith("kids")
      ? SHARED_MENUS.kids[k.slice(4).toLowerCase()]
      : k === "eveningPizzas"
        ? SHARED_MENUS.evening.find((p) => p.isPizza).items
        : k === "eveningSides"
          ? SHARED_MENUS.evening.find((p) => p.extraItems).extraItems
          : k === "eveningStreetFood"
            ? SHARED_MENUS.evening.find((p) => p.name === "Street Food").items
            : MENUS[d.venue][k];
    requireValue(
      Array.isArray(m[k]) &&
        m[k].length <= limit &&
        new Set(m[k]).size === m[k].length &&
        m[k].every((v) => choices.includes(v)),
      "Invalid selection: " + k,
    );
  }
  requireValue(
    Array.isArray(w.tables) && w.tables.length <= 100,
    "Maximum 100 tables.",
  );
  const ids = new Set();
  for (const t of w.tables) {
    requireValue(
      keys(t, ["id", "name", "seats", "shape"]) &&
        string(t.id, 80) &&
        t.id &&
        !ids.has(t.id) &&
        string(t.name, 100) &&
        t.name.trim() &&
        Number.isInteger(t.seats) &&
        t.seats > 0 &&
        t.seats <= 100 &&
        ["round", "rect"].includes(t.shape),
      "Check table names, IDs and capacities.",
    );
    ids.add(t.id);
  }
  requireValue(
    Array.isArray(w.guests) && w.guests.length <= 500,
    "Maximum 500 guests.",
  );
  const guestIds = new Set();
  for (const g of w.guests) {
    requireValue(
      keys(g, [
        "id",
        "name",
        "rsvp",
        "isChild",
        "isVegan",
        "dietary",
        "starter",
        "main",
        "dessert",
        "tableId",
      ]) &&
        string(g.id, 80) &&
        g.id &&
        !guestIds.has(g.id) &&
        string(g.name, 100) &&
        g.name.trim() &&
        ["pending", "attending", "declined"].includes(g.rsvp) &&
        typeof g.isChild === "boolean" &&
        typeof g.isVegan === "boolean" &&
        string(g.dietary, 1000) &&
        courses.every((c) => string(g[c], 300)) &&
        (g.tableId === null || ids.has(g.tableId)),
      "Check guest details and table assignments.",
    );
    guestIds.add(g.id);
  }
  return w;
}
export function submissionIssues(w) {
  const issues = [];
  const attending = w.guests.filter((g) => g.rsvp === "attending");
  if (!attending.length) issues.push("Add at least one attending guest.");
  if (w.guests.some((g) => g.rsvp === "pending"))
    issues.push("Resolve all pending RSVPs.");
  for (const g of attending) {
    for (const c of courses)
      if (!optionsFor(w, g, c).includes(g[c]))
        issues.push(`${g.name}: choose a valid ${c}.`);
    if (!w.tables.some((t) => t.id === g.tableId))
      issues.push(`${g.name}: assign a table.`);
  }
  for (const t of w.tables)
    if (attending.filter((g) => g.tableId === t.id).length > t.seats)
      issues.push(`${t.name}: too many guests for the seats available.`);
  if (w.eventDetails.hasCanapes && w.menuSelections.canapes.length !== 3)
    issues.push("Choose three canapés.");
  const m = w.menuSelections;
  if (!m.eveningCategory) issues.push("Choose an evening food package.");
  if (m.eveningCategory === "Woodfired Pizzas" && m.eveningPizzas.length !== 3)
    issues.push("Choose three pizzas.");
  if (m.eveningCategory === "Street Food" && !m.eveningStreetFood.length)
    issues.push("Choose the street food options.");
  return issues;
}
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function deadline(date) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 14);
  return d.toISOString().slice(0, 10);
}
