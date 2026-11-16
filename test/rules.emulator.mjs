import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
const env = await initializeTestEnvironment({
  projectId: "demo-mcn-wedding",
  firestore: { rules: await readFile("firestore.rules", "utf8") },
});
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log("PASS " + name);
};
try {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "weddings/a"), {
      coupleEmails: ["alex@example.com"],
      archived: false,
    });
    await setDoc(doc(db, "weddings/b"), {
      coupleEmails: ["other@example.com"],
      archived: false,
    });
    await setDoc(doc(db, "weddings/archived"), {
      coupleEmails: ["alex@example.com"],
      archived: true,
    });
    await setDoc(doc(db, "weddings/a/versions/v1"), { private: true });
  });
  const own = env
    .authenticatedContext("alex", {
      email: "alex@example.com",
      email_verified: true,
    })
    .firestore();
  const staff = env
    .authenticatedContext("staff", {
      email: "staff@example.com",
      email_verified: true,
      staff: true,
    })
    .firestore();
  const unverified = env
    .authenticatedContext("unverified", {
      email: "alex@example.com",
      email_verified: false,
    })
    .firestore();
  await check("own wedding readable", () =>
    assertSucceeds(getDoc(doc(own, "weddings/a"))),
  );
  await check("other wedding hidden", () =>
    assertFails(getDoc(doc(own, "weddings/b"))),
  );
  await check("archived wedding hidden from couple", () =>
    assertFails(getDoc(doc(own, "weddings/archived"))),
  );
  await check("anonymous denied", () =>
    assertFails(
      getDoc(doc(env.unauthenticatedContext().firestore(), "weddings/a")),
    ),
  );
  await check("unverified denied", () =>
    assertFails(getDoc(doc(unverified, "weddings/a"))),
  );
  await check("staff reads all weddings", () =>
    assertSucceeds(getDocs(collection(staff, "weddings"))),
  );
  await check("couple cannot list all weddings", () =>
    assertFails(getDocs(collection(own, "weddings"))),
  );
  await check("couple scoped query works", () =>
    assertSucceeds(
      getDocs(
        query(
          collection(own, "weddings"),
          where("coupleEmails", "array-contains", "alex@example.com"),
          where("archived", "==", false),
        ),
      ),
    ),
  );
  await check("couple direct write denied", () =>
    assertFails(
      setDoc(doc(own, "weddings/a"), {
        archived: false,
        coupleEmails: ["alex@example.com"],
      }),
    ),
  );
  await check("staff direct write denied", () =>
    assertFails(
      setDoc(doc(staff, "weddings/a"), {
        archived: false,
        coupleEmails: ["alex@example.com"],
      }),
    ),
  );
  await check("version history hidden from direct reads", () =>
    assertFails(getDoc(doc(staff, "weddings/a/versions/v1"))),
  );
  console.log(`${passed} Firestore rule checks passed.`);
} finally {
  await env.cleanup();
}
