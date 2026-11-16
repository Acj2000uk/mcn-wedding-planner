import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
export function admin() {
  if (!getApps().length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT)
      throw new Error("Firebase server configuration is missing.");
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    });
  }
  return { auth: getAuth(), db: getFirestore() };
}
