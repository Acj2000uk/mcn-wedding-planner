import { randomUUID } from "node:crypto";
import { transition, authorize } from "./service.mjs";
import { Problem } from "../public/domain.mjs";
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export function createHandler(getAdmin) {
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path.endsWith("/config")) {
      try {
        const c = JSON.parse(process.env.FIREBASE_WEB_CONFIG || "{}");
        if (
          !c.apiKey ||
          !c.authDomain ||
          !c.projectId ||
          !c.appId ||
          !process.env.FIREBASE_SERVICE_ACCOUNT
        )
          return json(
            { error: "Shared saving is awaiting Firebase setup." },
            503,
          );
        return json({
          apiKey: c.apiKey,
          authDomain: c.authDomain,
          projectId: c.projectId,
          appId: c.appId,
        });
      } catch {
        return json(
          { error: "Shared saving is awaiting Firebase setup." },
          503,
        );
      }
    }
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return json({ error: "Origin not allowed." }, 403);
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return json({ error: "Please sign in." }, 401);
    try {
      const { auth, db } = getAdmin();
      let actor;
      try {
        actor = await auth.verifyIdToken(token, true);
      } catch {
        return json({ error: "Your session expired. Sign in again." }, 401);
      }
      if (!actor.email_verified)
        return json({ error: "Verify your email before continuing." }, 403);
      const raw = await request.text();
      if (raw.length > 600000)
        return json({ error: "Wedding data is too large." }, 413);
      let command;
      try {
        command = JSON.parse(raw);
      } catch {
        return json({ error: "Invalid request." }, 400);
      }
      if (!command || typeof command !== "object")
        return json({ error: "Invalid request." }, 400);
      // Whitelist fields, never accept restoreSnapshot or server metadata from a client.
      const { action, revision, data, id, versionId } = command;
      if (
        action !== "create" &&
        (typeof id !== "string" || !/^[\w-]{1,80}$/.test(id))
      )
        return json({ error: "Invalid wedding ID." }, 400);
      const weddingId = action === "create" ? randomUUID() : id;
      const ref = db.collection("weddings").doc(weddingId);
      if (action === "history") {
        authorize(actor, (await ref.get()).data());
        if (actor.staff !== true)
          return json({ error: "Staff access required." }, 403);
        const history = await ref
          .collection("versions")
          .orderBy("savedAt", "desc")
          .limit(50)
          .get();
        return json({
          versions: history.docs.map((d) => {
            const v = d.data();
            return {
              id: d.id,
              revision: v.snapshot.revision,
              savedAt: v.savedAt,
              actor: v.actor,
              action: v.action,
              reason: v.reason,
            };
          }),
        });
      }
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? snap.data() : null;
        let restoreSnapshot;
        if (action === "restore") {
          authorize(actor, current);
          if (actor.staff !== true)
            throw new Problem("Staff access required.", 403);
          if (typeof versionId !== "string" || !/^v\d+$/.test(versionId))
            throw new Problem("Invalid version.", 400);
          restoreSnapshot = (
            await tx.get(ref.collection("versions").doc(versionId))
          ).data()?.snapshot;
        }
        const now = new Date().toISOString();
        const next = transition(
          actor,
          current,
          { action, revision, data, restoreSnapshot },
          now,
        );
        // Same transaction: the old state and audit event exist before a mutation succeeds.
        if (current)
          tx.create(ref.collection("versions").doc("v" + current.revision), {
            snapshot: current,
            savedAt: now,
            actor: actor.email,
            action,
            reason: data?.reason || "",
          });
        tx.set(ref, next);
        return next;
      });
      return json({ wedding: { id: weddingId, ...result } });
    } catch (err) {
      if (err instanceof Problem)
        return json({ error: err.message }, err.status);
      console.error("Wedding API failure", err.code || err.name);
      return json(
        {
          error:
            "The server could not save your changes. Your form is still open. Please retry.",
        },
        503,
      );
    }
  };
}
