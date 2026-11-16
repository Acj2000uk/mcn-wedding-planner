import { emptyWedding } from "./domain.mjs";
import { MENUS, SHARED_MENUS } from "./menus.mjs";
import { transition, authorize } from "./changes.mjs";
export function createDemo() {
  let records = new Map(),
    history = new Map();
  const w = emptyWedding(
    {
      partner1: "Emma",
      partner2: "James",
      date: "2027-06-12",
      venue: "shotton",
      hasCanapes: false,
    },
    ["couple@example.com"],
  );
  w.tables = [
    { id: "top", name: "Top Table", seats: 4, shape: "rect" },
    { id: "rose", name: "Rose Table", seats: 6, shape: "round" },
    { id: "willow", name: "Willow Table", seats: 6, shape: "round" },
  ];
  for (const c of ["starters", "mains", "desserts"]) {
    w.menuSelections[c] = MENUS.shotton[c].slice(0, 3);
    w.menuSelections["kids" + c[0].toUpperCase() + c.slice(1)] = [
      SHARED_MENUS.kids[c][0],
    ];
  }
  w.menuSelections.eveningCategory = "Woodfired Pizzas";
  w.menuSelections.eveningPizzas = SHARED_MENUS.evening
    .find((p) => p.isPizza)
    .items.slice(0, 3);
  w.guests = [
    "Emma Wilson",
    "James Clarke",
    "Olivia Wilson",
    "Noah Clarke",
    "Amelia Green",
    "George Green",
    "Isla Brown",
    "Freddie Brown",
  ].map((name, i) => ({
    id: "guest-" + i,
    name,
    rsvp: i === 7 ? "pending" : "attending",
    isChild: i === 5,
    isVegan: i === 4,
    dietary:
      i === 6 ? "Nut allergy. Confirm meal preparation with the venue." : "",
    starter:
      i === 4
        ? SHARED_MENUS.vegan.starters[0]
        : i === 5
          ? w.menuSelections.kidsStarters[0]
          : i === 3
            ? ""
            : w.menuSelections.starters[i % 3],
    main:
      i === 4
        ? SHARED_MENUS.vegan.mains[0]
        : i === 5
          ? w.menuSelections.kidsMains[0]
          : w.menuSelections.mains[i % 3],
    dessert:
      i === 4
        ? SHARED_MENUS.vegan.desserts[0]
        : i === 5
          ? w.menuSelections.kidsDesserts[0]
          : w.menuSelections.desserts[i % 3],
    tableId: i < 3 ? "top" : i < 5 ? "rose" : null,
  }));
  Object.assign(w, {
    revision: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: "demo-staff",
    lastAction: "create",
  });
  records.set("sample-wedding", w);
  return {
    list(staff) {
      return [...records]
        .filter(
          ([, w]) =>
            staff ||
            (!w.archived && w.coupleEmails.includes("couple@example.com")),
        )
        .map(([id, w]) => ({ id, ...structuredClone(w) }));
    },
    async command(command, staff) {
      const actor = {
        uid: staff ? "demo-staff" : "demo-couple",
        email: staff ? "staff@example.com" : "couple@example.com",
        email_verified: true,
        staff,
      };
      const id = command.action === "create" ? crypto.randomUUID() : command.id;
      const old = records.get(id),
        versions = history.get(id) || [];
      authorize(actor, old);
      if (command.action === "history") {
        if (!staff) throw new Error("Staff access required.");
        return { versions: versions.map(({ snapshot, ...v }) => v).reverse() };
      }
      const restoreSnapshot =
        command.action === "restore"
          ? versions.find((v) => v.id === command.versionId)?.snapshot
          : undefined;
      const next = transition(actor, old, { ...command, restoreSnapshot });
      if (old) {
        versions.push({
          id: "v" + old.revision,
          revision: old.revision,
          snapshot: structuredClone(old),
          savedAt: next.updatedAt,
          actor: actor.email,
          action: command.action,
          reason: command.data?.reason || "",
        });
        history.set(id, versions);
      }
      records.set(id, next);
      return { wedding: { id, ...structuredClone(next) } };
    },
  };
}
