import test from "node:test";
import assert from "node:assert/strict";
import { transition, authorize } from "../lib/service.mjs";
import {
  emptyWedding,
  validateWedding,
  submissionIssues,
  optionsFor,
  csvCell,
  deadline,
} from "../public/domain.mjs";
import { MENUS, SHARED_MENUS } from "../public/menus.mjs";
export const staff = {
  uid: "staff-1",
  email: "staff@example.com",
  email_verified: true,
  staff: true,
};
export const couple = {
  uid: "couple-1",
  email: "couple@example.com",
  email_verified: true,
};
export function fixture() {
  const w = emptyWedding(
    {
      partner1: "Alex",
      partner2: "Sam",
      date: "2027-06-12",
      venue: "shotton",
      hasCanapes: false,
    },
    ["couple@example.com"],
  );
  for (const k of ["starters", "mains", "desserts"])
    w.menuSelections[k] = [MENUS.shotton[k][0]];
  w.menuSelections.eveningCategory = "Hot Stotties";
  w.guests = [
    {
      id: "g1",
      name: "Jo",
      rsvp: "attending",
      isChild: false,
      isVegan: false,
      dietary: "",
      starter: MENUS.shotton.starters[0],
      main: MENUS.shotton.mains[0],
      dessert: MENUS.shotton.desserts[0],
      tableId: "top",
    },
  ];
  w.revision = 1;
  return w;
}
const signature = "data:image/png;base64," + "A".repeat(100);
const edit = (w, data, actor = couple) =>
  transition(actor, w, { action: "edit", revision: w.revision, data });
const submit = (w) =>
  transition(
    couple,
    w,
    { action: "submit", revision: w.revision, data: { signature } },
    "2027-05-01T12:00:00.000Z",
  );
const rejects = (fn, status) => assert.throws(fn, (e) => e.status === status);
test("valid wedding and completed guest list pass", () => {
  assert.equal(validateWedding(fixture()).guests.length, 1);
  assert.deepEqual(submissionIssues(fixture()), []);
});
test("unverified accounts are denied", () =>
  rejects(
    () => authorize({ ...couple, email_verified: false }, fixture()),
    401,
  ));
test("another couple cannot read or mutate wedding", () =>
  rejects(
    () =>
      edit(
        fixture(),
        { guests: [] },
        { ...couple, email: "other@example.com" },
      ),
    403,
  ));
test("staff can create but couple cannot", () => {
  const w = fixture();
  assert.equal(
    transition(staff, null, { action: "create", data: w }).revision,
    1,
  );
  rejects(() => transition(couple, null, { action: "create", data: w }), 403);
});
test("create ignores caller supplied submission metadata", () => {
  const w = fixture();
  w.eventDetails.isSubmitted = true;
  w.eventDetails.signature = signature;
  w.eventDetails.submissionDate = "2020-01-01";
  const n = transition(staff, null, { action: "create", data: w });
  assert.equal(n.eventDetails.isSubmitted, false);
  assert.equal(n.eventDetails.signature, null);
});
test("stale device is rejected instead of overwriting", () =>
  rejects(
    () =>
      transition(couple, fixture(), {
        action: "edit",
        revision: 0,
        data: { guests: [] },
      }),
    409,
  ));
test("signed submission is durable and locks staff and couples", () => {
  const w = submit(fixture());
  assert.equal(w.eventDetails.signature, signature);
  assert.equal(w.eventDetails.submissionDate, "2027-05-01T12:00:00.000Z");
  rejects(() => edit(w, { guests: [] }), 423);
  rejects(() => edit(w, { guests: [] }, staff), 423);
});
test("delayed save from pre-submit revision is rejected", () => {
  const w = submit(fixture());
  rejects(
    () =>
      transition(couple, w, {
        action: "edit",
        revision: 1,
        data: { guests: [] },
      }),
    409,
  );
});
test("couple cannot bypass submission through eventDetails", () =>
  rejects(
    () => edit(fixture(), { eventDetails: { isSubmitted: true, signature } }),
    403,
  ));
test("couple cannot change venue, date, access or metadata", () => {
  for (const data of [
    { eventDetails: { venue: "parlour" } },
    { eventDetails: { date: "2028-01-01" } },
    { coupleEmails: ["other@example.com"] },
    { revision: 100 },
    { staff: true },
  ])
    assert.throws(() => edit(fixture(), data));
});
test("staff must supply a reason to reopen", () => {
  const w = submit(fixture());
  rejects(
    () =>
      transition(staff, w, {
        action: "reopen",
        revision: w.revision,
        data: {},
      }),
    400,
  );
  rejects(
    () =>
      transition(couple, w, {
        action: "reopen",
        revision: w.revision,
        data: { reason: "Change" },
      }),
    403,
  );
  const n = transition(staff, w, {
    action: "reopen",
    revision: w.revision,
    data: { reason: "Couple requested a change" },
  });
  assert.equal(n.eventDetails.isSubmitted, false);
  assert.equal(n.eventDetails.signature, null);
});
test("all pending RSVPs block submission", () => {
  const w = fixture();
  w.guests[0].rsvp = "pending";
  assert(submissionIssues(w).some((x) => x.includes("RSVP")));
  rejects(() => submit(w), 400);
});
test("missing or removed meal choices block submission", () => {
  const w = fixture();
  w.menuSelections.starters = [];
  assert(submissionIssues(w).some((x) => x.includes("starter")));
  rejects(() => submit(w), 400);
});
test("missing seats and full tables block submission", () => {
  const w = fixture();
  w.guests[0].tableId = null;
  assert(submissionIssues(w).some((x) => x.includes("assign a table")));
  w.guests[0].tableId = "top";
  w.tables[0].seats = 1;
  w.guests.push({ ...w.guests[0], id: "g2" });
  assert(submissionIssues(w).some((x) => x.includes("too many")));
});
test("children and vegan guests use correct meal lists", () => {
  const w = fixture();
  for (const c of ["starters", "mains", "desserts"])
    w.menuSelections["kids" + c[0].toUpperCase() + c.slice(1)] = [
      SHARED_MENUS.kids[c][0],
    ];
  assert.deepEqual(optionsFor(w, { isChild: true }, "main"), [
    SHARED_MENUS.kids.mains[0],
  ]);
  assert.deepEqual(
    optionsFor(w, { isVegan: true, isChild: true }, "main"),
    SHARED_MENUS.vegan.mains,
  );
});
test("empty or invalid signatures do not submit", () => {
  for (const signature of [
    "",
    null,
    "javascript:evil",
    "data:image/svg+xml;base64,evil",
  ])
    rejects(
      () =>
        transition(couple, fixture(), {
          action: "submit",
          revision: 1,
          data: { signature },
        }),
      400,
    );
});
test("archive is recoverable and denies couple access", () => {
  const w = transition(staff, fixture(), {
    action: "archive",
    revision: 1,
    data: { reason: "Cancelled" },
  });
  assert.equal(w.archived, true);
  rejects(() => authorize(couple, w), 403);
  const restored = transition(staff, w, {
    action: "archive",
    revision: 2,
    data: { reason: "Reinstated" },
  });
  assert.equal(restored.archived, false);
});
test("restore keeps current access and clears old submission", () => {
  const old = submit(fixture());
  old.coupleEmails = ["old@example.com"];
  const restored = transition(staff, fixture(), {
    action: "restore",
    revision: 1,
    data: { reason: "Recover guests" },
    restoreSnapshot: old,
  });
  assert.deepEqual(restored.coupleEmails, ["couple@example.com"]);
  assert.equal(restored.eventDetails.signature, null);
  assert.equal(restored.eventDetails.isSubmitted, false);
});
test("submitted wedding must be reopened before restore", () => {
  const w = submit(fixture());
  rejects(
    () =>
      transition(staff, w, {
        action: "restore",
        revision: 2,
        data: { reason: "Recover" },
        restoreSnapshot: fixture(),
      }),
    423,
  );
});
test("invalid schema, menu values, duplicate guests and oversized records fail", () => {
  for (const change of [
    (w) => w.guests.push({ ...w.guests[0] }),
    (w) => (w.guests[0].tableId = "missing"),
    (w) => (w.tables[0].seats = -1),
    (w) => (w.eventDetails.date = "2027-02-30"),
    (w) => (w.menuSelections.starters = ["injected"]),
    (w) => (w.guests[0].name = "x".repeat(101)),
    (w) => (w.eventDetails.venue = "__proto__"),
  ]) {
    const w = fixture();
    change(w);
    assert.throws(() => validateWedding(w));
  }
});
test("CSV escapes quotes, newlines and spreadsheet formulas", () => {
  assert.equal(csvCell('A "B"'), '"A ""B"""');
  assert.equal(csvCell("=CMD()"), '"\'=CMD()"');
  assert.equal(csvCell(" \t+CMD()"), '"\' \t+CMD()"');
  assert.equal(csvCell("A\nB"), '"A\nB"');
});
test("deadline handles month boundaries and leap years", () => {
  assert.equal(deadline("2028-03-10"), "2028-02-25");
  assert.equal(deadline("2027-01-10"), "2026-12-27");
});
