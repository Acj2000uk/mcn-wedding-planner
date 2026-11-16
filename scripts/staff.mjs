import { admin } from "../lib/admin.mjs";
const [email, action] = process.argv.slice(2);
if (!email || !["grant", "revoke"].includes(action))
  throw new Error("Usage: npm run staff -- email@example.com grant|revoke");
const { auth } = admin();
const user = await auth.getUserByEmail(email);
if (!user.emailVerified && action === "grant")
  throw new Error("Staff must verify their email first.");
await auth.setCustomUserClaims(user.uid, {
  ...user.customClaims,
  staff: action === "grant",
});
await auth.revokeRefreshTokens(user.uid);
console.log("Staff permission updated. Sign in again to refresh access.");
