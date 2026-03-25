import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  getRedirectResult,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Completes Google sign-in after signInWithRedirect (full-page return to this site).
getRedirectResult(auth).catch(() => {});

/** Optional: use from non-module scripts after load, e.g. `window.firebaseDb`. */
if (typeof window !== "undefined") {
  window.firebaseDb = db;
  window.firebaseAuth = auth;
  window.firebaseStorage = storage;
}
