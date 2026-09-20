// Run server-side only. Never ship a service-account key to the browser.
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json node setAdminClaim.js FIREBASE_AUTH_UID

const admin = require("firebase-admin");

async function main() {
  const uid = process.argv[2];
  if (!uid) throw new Error("Usage: node setAdminClaim.js FIREBASE_AUTH_UID");
  admin.initializeApp();
  await admin.auth().setCustomUserClaims(uid, { admin: true });
  const user = await admin.auth().getUser(uid);
  console.log(`Admin claim set for ${user.uid} (${user.email || "no email"}).`);
  console.log("The user must sign out/sign in again (or refresh their ID token) before the claim is reflected in the client.");
  await admin.app().delete();
}

main().catch((error) => { console.error(error); process.exit(1); });
