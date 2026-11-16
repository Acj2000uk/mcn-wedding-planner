import {
  Problem,
  emptyWedding,
  validateWedding,
  submissionIssues,
} from "../public/domain.mjs";
const fail = (msg, status) => {
  throw new Problem(msg, status);
};
export function authorize(actor, w) {
  if (!actor?.uid || !actor.email_verified)
    fail("Sign in with a verified email address.", 401);
  if (actor.staff === true) return;
  if (
    !w ||
    w.archived ||
    !w.coupleEmails.includes((actor.email || "").toLowerCase())
  )
    fail("You do not have access to this wedding.", 403);
}
export function transition(
  actor,
  current,
  command,
  now = new Date().toISOString(),
) {
  authorize(actor, current);
  const staff = actor.staff === true;
  const { action, revision, data = {} } = command;
  if (action === "create") {
    if (!staff || current) fail("Only staff can create weddings.", 403);
    const w = emptyWedding(data.eventDetails, data.coupleEmails);
    // Do not trust caller-supplied submission fields, metadata or revisions.
    const d = data.eventDetails || {};
    w.eventDetails = {
      partner1: d.partner1,
      partner2: d.partner2,
      date: d.date,
      venue: d.venue,
      hasCanapes: false,
      isSubmitted: false,
      signature: null,
      submissionDate: null,
    };
    return {
      ...validateWedding(w),
      revision: 1,
      updatedAt: now,
      updatedBy: actor.uid,
      lastAction: "create",
    };
  }
  if (!current) fail("Wedding not found.", 404);
  if (!Number.isInteger(revision) || revision !== current.revision)
    fail(
      "This wedding changed on another device. Reload the latest version before saving.",
      409,
    );
  const w = structuredClone(current);
  if (["reopen", "archive", "restore"].includes(action)) {
    if (!staff) fail("Only staff can perform this action.", 403);
    if (
      typeof data.reason !== "string" ||
      !data.reason.trim() ||
      data.reason.length > 500
    )
      fail("Enter a reason for this change.", 400);
  }
  if (action === "edit") {
    if (current.archived || current.eventDetails.isSubmitted)
      fail("This wedding is locked. Ask staff to reopen it.", 423);
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !Object.keys(data).every((k) =>
        [
          "guests",
          "tables",
          "menuSelections",
          "eventDetails",
          "coupleEmails",
        ].includes(k),
      )
    )
      fail("Invalid update.", 400);
    if ("coupleEmails" in data && !staff)
      fail("Only staff can change couple access.", 403);
    for (const k of ["guests", "tables", "menuSelections", "coupleEmails"])
      if (k in data) w[k] = data[k];
    if ("eventDetails" in data) {
      const allowed = staff
        ? ["partner1", "partner2", "date", "hasCanapes"]
        : ["partner1", "partner2", "hasCanapes"];
      if (
        !data.eventDetails ||
        !Object.keys(data.eventDetails).every((k) => allowed.includes(k))
      )
        fail("These event details cannot be changed here.", 403);
      w.eventDetails = { ...w.eventDetails, ...data.eventDetails };
    }
  } else if (action === "submit") {
    if (current.archived || current.eventDetails.isSubmitted)
      fail("This wedding is already locked.", 423);
    const issues = submissionIssues(current);
    if (issues.length) fail(issues.slice(0, 8).join("\n"), 400);
    if (
      typeof data.signature !== "string" ||
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.signature) ||
      data.signature.length < 100 ||
      data.signature.length > 100000
    )
      fail("Please sign before submitting.", 400);
    w.eventDetails = {
      ...w.eventDetails,
      isSubmitted: true,
      signature: data.signature,
      submissionDate: now,
    };
  } else if (action === "reopen") {
    if (current.archived || !current.eventDetails.isSubmitted)
      fail("Only a submitted, active wedding can be reopened.", 400);
    w.eventDetails = {
      ...w.eventDetails,
      isSubmitted: false,
      signature: null,
      submissionDate: null,
    };
  } else if (action === "archive") {
    w.archived = !current.archived;
  } else if (action === "restore") {
    if (current.archived || current.eventDetails.isSubmitted)
      fail("Reopen the active wedding before restoring a version.", 423);
    // A trusted server-loaded snapshot, never a client-provided snapshot.
    if (!command.restoreSnapshot) fail("Version not found.", 404);
    for (const k of ["guests", "tables", "menuSelections", "eventDetails"])
      w[k] = structuredClone(command.restoreSnapshot[k]);
    w.eventDetails = {
      ...w.eventDetails,
      isSubmitted: false,
      signature: null,
      submissionDate: null,
    };
    // Current access list is deliberately retained.
  } else fail("Unknown action.", 400);
  validateWedding(w);
  return {
    ...w,
    revision: current.revision + 1,
    updatedAt: now,
    updatedBy: actor.uid,
    lastAction: action,
  };
}
