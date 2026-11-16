import test from "node:test";
import assert from "node:assert/strict";
import { createDemo } from "../public/demo.mjs";
import {
  filterGuests,
  planningSummary,
  assignSeats,
} from "../public/planning.mjs";
const sample = () => createDemo().list(true)[0];
test("checklist counts missing meals, seats and RSVPs independently", () => {
  const s = planningSummary(sample(), "2027-05-29");
  assert.deepEqual(
    [s.attending, s.pending, s.missing, s.unseated, s.ready, s.days],
    [7, 1, 1, 2, 4, 0],
  );
});
test("search combines with filters and searches table names", () => {
  const w = sample();
  assert.equal(
    filterGuests(w, { filter: "missing-meals" })[0].name,
    "Noah Clarke",
  );
  assert.equal(filterGuests(w, { search: "rose table" }).length, 2);
  assert.equal(
    filterGuests(w, { filter: "unseated", search: "ISLA" }).length,
    1,
  );
  assert.equal(filterGuests(w, { filter: "declined" }).length, 0);
});
test("group seating preserves original records and rejects capacity overflow", () => {
  const w = sample();
  const ids = ["guest-5", "guest-6"];
  assert.throws(() => assignSeats(w, ids, "top"), /enough seats/);
  const guests = assignSeats(w, ids, "willow");
  assert.equal(guests.filter((g) => g.tableId === "willow").length, 2);
  assert.equal(w.guests[5].tableId, null);
  assert.equal(assignSeats({ ...w, guests }, ids, null)[5].tableId, null);
});
test("group seating rejects pending guests, missing tables and locked records", () => {
  const w = sample();
  assert.throws(() => assignSeats(w, ["guest-7"], "willow"), /attending/);
  assert.throws(() => assignSeats(w, ["guest-0"], "missing"), /valid table/);
  w.eventDetails.isSubmitted = true;
  assert.throws(() => assignSeats(w, ["guest-0"], "willow"), /locked/);
});
test("demo uses revision checks, enforces roles and resets in a new session", async () => {
  const demo = createDemo();
  const w = demo.list(true)[0];
  const guests = assignSeats(w, ["guest-5"], "willow");
  const result = await demo.command(
    { action: "edit", id: w.id, revision: 1, data: { guests } },
    false,
  );
  assert.equal(result.wedding.revision, 2);
  await assert.rejects(
    demo.command(
      { action: "edit", id: w.id, revision: 1, data: { guests } },
      false,
    ),
  );
  await assert.rejects(demo.command({ action: "history", id: w.id }, false));
  assert.equal(sample().guests[5].tableId, null);
  assert.equal(
    (await demo.command({ action: "history", id: w.id }, true)).versions.length,
    1,
  );
});
