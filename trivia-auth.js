import { auth } from "./firebase-init.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/** Prevents a second signInWithPopup; Firebase cancels the first popup (flash then close). */
let googleSignInInFlight = false;

export async function signInWithGoogle() {
  if (googleSignInInFlight) return;
  googleSignInInFlight = true;
  try {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = e && e.code;
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        await signInWithRedirect(auth, provider);
      } else if (code === "auth/cancelled-popup-request") {
        console.warn(
          "Sign-in popup was replaced or cancelled (often a double tap on Sign in)."
        );
      } else {
        throw e;
      }
    }
  } finally {
    googleSignInInFlight = false;
  }
}

export function signOutTrivia() {
  return signOut(auth);
}

export { auth };

export function displayNameFromUser(user) {
  if (!user) return "";
  return (
    user.displayName ||
    (user.email ? String(user.email).split("@")[0] : "") ||
    "Player"
  );
}
