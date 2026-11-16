import { courses, optionsFor, deadline, Problem } from "./domain.mjs";
export function missingMeals(w, g) {
  return (
    g.rsvp === "attending" &&
    courses.some((c) => !optionsFor(w, g, c).includes(g[c]))
  );
}
export function filterGuests(w, { search = "", filter = "all" } = {}) {
  const term = search.trim().toLocaleLowerCase("en-GB");
  return w.guests.filter((g) => {
    const table = w.tables.find((t) => t.id === g.tableId)?.name || "";
    const matches =
      !term ||
      [g.name, g.dietary, table, ...courses.map((c) => g[c])]
        .join(" ")
        .toLocaleLowerCase("en-GB")
        .includes(term);
    const group =
      filter === "all" ||
      filter === g.rsvp ||
      (filter === "missing-meals" && missingMeals(w, g)) ||
      (filter === "unseated" &&
        g.rsvp === "attending" &&
        !w.tables.some((t) => t.id === g.tableId)) ||
      (filter === "dietary" &&
        g.rsvp === "attending" &&
        (g.isVegan || g.dietary.trim())) ||
      (filter === "children" && g.isChild);
    return matches && group;
  });
}
export function planningSummary(
  w,
  today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }),
) {
  const attending = w.guests.filter((g) => g.rsvp === "attending");
  const pending = w.guests.filter((g) => g.rsvp === "pending").length;
  const missing = attending.filter((g) => missingMeals(w, g)).length;
  const unseated = attending.filter(
    (g) => !w.tables.some((t) => t.id === g.tableId),
  ).length;
  const overfull = w.tables.filter(
    (t) => attending.filter((g) => g.tableId === t.id).length > t.seats,
  ).length;
  const due = deadline(w.eventDetails.date);
  const days = Math.round(
    (Date.parse(due + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) /
      86400000,
  );
  const ready = attending.filter(
    (g) => !missingMeals(w, g) && w.tables.some((t) => t.id === g.tableId),
  ).length;
  return {
    attending: attending.length,
    pending,
    missing,
    unseated,
    overfull,
    ready,
    percent: attending.length
      ? Math.round((ready / attending.length) * 100)
      : 0,
    days,
    due,
  };
}
export function assignSeats(w, guestIds, tableId) {
  if (w.archived || w.eventDetails.isSubmitted)
    throw new Problem("This wedding is locked.", 423);
  const ids = new Set(guestIds);
  if (!ids.size) throw new Problem("Select at least one guest.");
  if (
    [...ids].some(
      (id) => !w.guests.some((g) => g.id === id && g.rsvp === "attending"),
    )
  )
    throw new Problem("Only attending guests can be seated.");
  const table = w.tables.find((t) => t.id === tableId);
  if (tableId !== null && !table) throw new Problem("Choose a valid table.");
  const guests = w.guests.map((g) => (ids.has(g.id) ? { ...g, tableId } : g));
  if (
    table &&
    guests.filter((g) => g.rsvp === "attending" && g.tableId === tableId)
      .length > table.seats
  )
    throw new Problem(
      `${table.name} does not have enough seats. Choose fewer guests or increase its capacity.`,
    );
  return guests;
}
