import { auth } from "./firebase-init.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export function signInWithGoogle() {
  return signInWithPopup(auth, provider);
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
