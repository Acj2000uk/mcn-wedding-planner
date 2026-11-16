import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../lib/http.mjs";
import { emptyWedding } from "../public/domain.mjs";
const staff = {
  uid: "s1",
  email: "staff@example.com",
  email_verified: true,
  staff: true,
};
const couple = { uid: "c1", email: "couple@example.com", email_verified: true };
function harness(actor = staff) {
  const wedding = emptyWedding(
    {
      partner1: "A",
      partner2: "B",
      venue: "shotton",
      date: "2027-01-01",
      hasCanapes: false,
    },
    ["couple@example.com"],
  );
  wedding.revision = 1;
  const records = new Map([["weddings/w1", wedding]]);
  let authArgs;
  const ref = (path) => ({
    path,
    collection: (name) => ({ doc: (id) => ref(path + "/" + name + "/" + id) }),
    get: async () => snap(path),
  });
  const snap = (path) => ({
    exists: records.has(path),
    data: () => structuredClone(records.get(path)),
  });
  const db = {
    collection: (name) => ({ doc: (id) => ref(name + "/" + id) }),
    runTransaction: async (fn) => {
      const writes = [];
      const result = await fn({
        get: async (r) => snap(r.path),
        create: (r, v) => {
          assert(!records.has(r.path));
          writes.push([r.path, v]);
        },
        set: (r, v) => writes.push([r.path, v]),
      });
      for (const [k, v] of writes) records.set(k, v);
      return result;
    },
  };
  const handler = createHandler(() => ({
    auth: {
      verifyIdToken: async (...args) => {
        authArgs = args;
        if (actor instanceof Error) throw actor;
        return actor;
      },
    },
    db,
  }));
  const request = (command, headers = {}) =>
    handler(
      new Request("https://example.test/api/wedding", {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          Origin: "https://example.test",
          ...headers,
        },
        body: JSON.stringify(command),
      }),
    );
  return {
    request,
    records,
    handler,
    get authArgs() {
      return authArgs;
    },
  };
}
test("API rejects missing and revoked tokens", async () => {
  let h = harness();
  assert.equal((await h.request({}, { Authorization: "" })).status, 401);
  h = harness(new Error("revoked"));
  assert.equal((await h.request({})).status, 401);
  assert.deepEqual(h.authArgs, ["token", true]);
});
test("API denies cross-origin requests", async () =>
  assert.equal(
    (await harness().request({}, { Origin: "https://other.test" })).status,
    403,
  ));
test("API denies unverified and unrelated accounts", async () => {
  assert.equal(
    (
      await harness({ ...couple, email_verified: false }).request({
        action: "edit",
        id: "w1",
        revision: 1,
        data: { guests: [] },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await harness({ ...couple, email: "other@example.com" }).request({
        action: "edit",
        id: "w1",
        revision: 1,
        data: { guests: [] },
      })
    ).status,
    403,
  );
});
test("save stores old version and audit before new version commits", async () => {
  const h = harness(couple);
  const r = await h.request({
    action: "edit",
    id: "w1",
    revision: 1,
    data: { eventDetails: { partner1: "Changed" } },
  });
  assert.equal(r.status, 200);
  assert.equal(h.records.get("weddings/w1").revision, 2);
  const version = h.records.get("weddings/w1/versions/v1");
  assert.equal(version.snapshot.eventDetails.partner1, "A");
  assert.equal(version.actor, couple.email);
  assert.equal(version.action, "edit");
});
test("stale save leaves both current state and history unchanged", async () => {
  const h = harness();
  const r = await h.request({
    action: "edit",
    id: "w1",
    revision: 0,
    data: { guests: [] },
  });
  assert.equal(r.status, 409);
  assert.equal(h.records.size, 1);
});
test("client supplied restore snapshot is never trusted", async () => {
  const h = harness();
  const r = await h.request({
    action: "restore",
    id: "w1",
    revision: 1,
    versionId: "v1",
    data: { reason: "Recover" },
    restoreSnapshot: h.records.get("weddings/w1"),
  });
  assert.equal(r.status, 404);
  assert.equal(h.records.size, 1);
});
test("couple cannot request version history or restore", async () => {
  const h = harness(couple);
  assert.equal((await h.request({ action: "history", id: "w1" })).status, 403);
  assert.equal(
    (
      await h.request({
        action: "restore",
        id: "w1",
        revision: 1,
        versionId: "v1",
        data: { reason: "Recover" },
      })
    ).status,
    403,
  );
});
test("restore loads trusted server version, keeps audit, returns draft", async () => {
  const h = harness();
  await h.request({
    action: "edit",
    id: "w1",
    revision: 1,
    data: { eventDetails: { partner1: "Changed" } },
  });
  const r = await h.request({
    action: "restore",
    id: "w1",
    revision: 2,
    versionId: "v1",
    data: { reason: "Undo name" },
  });
  assert.equal(r.status, 200);
  assert.equal(h.records.get("weddings/w1").eventDetails.partner1, "A");
  assert.equal(h.records.get("weddings/w1").revision, 3);
  assert.equal(h.records.get("weddings/w1/versions/v2").reason, "Undo name");
});
test("non-JSON input and invalid IDs return controlled errors", async () => {
  const h = harness();
  const r = await h.handler(
    new Request("https://example.test/api/wedding", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: "invalid",
    }),
  );
  assert.equal(r.status, 400);
  assert.equal(
    (await h.request({ action: "edit", id: "../other" })).status,
    400,
  );
});
