import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

/** Optional: use from non-module scripts after load, e.g. `window.firebaseDb`. */
if (typeof window !== "undefined") {
  window.firebaseDb = db;
}
