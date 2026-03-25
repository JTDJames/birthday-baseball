import { auth, db, storage } from "./firebase-init.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  addDoc,
  collection,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const MAX_BYTES = 5 * 1024 * 1024;

function sanitizeFileName(name) {
  const base = String(name || "photo").split(/[/\\]/).pop() || "photo";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return cleaned || "photo.jpg";
}

function showOk(text) {
  const el = document.getElementById("msgOk");
  const err = document.getElementById("msgErr");
  err.classList.remove("show");
  err.textContent = "";
  el.textContent = text;
  el.classList.add("show");
}

function showErr(text) {
  const el = document.getElementById("msgErr");
  const ok = document.getElementById("msgOk");
  ok.classList.remove("show");
  ok.textContent = "";
  el.textContent = text;
  el.classList.add("show");
}

async function ensureAnonymousAuth() {
  if (auth.currentUser && auth.currentUser.isAnonymous) return;
  await signInAnonymously(auth);
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById("submitBtn");
  const fileInput = document.getElementById("file");
  const displayNameInput = document.getElementById("displayName");
  const captionInput = document.getElementById("caption");

  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    showErr("Please choose an image file.");
    return;
  }
  if (!file.type || !file.type.startsWith("image/")) {
    showErr("Only image files are allowed.");
    return;
  }
  if (file.size > MAX_BYTES) {
    showErr("File is too large (max 5 MB).");
    return;
  }

  submitBtn.disabled = true;
  showErr("");
  showOk("");

  try {
    await ensureAnonymousAuth();
    const uid = auth.currentUser.uid;

    const payload = {
      submitterUid: uid,
      status: "pending",
      submittedAt: serverTimestamp(),
    };
    const dn = String(displayNameInput.value || "").trim();
    const cap = String(captionInput.value || "").trim();
    if (dn) payload.displayName = dn;
    if (cap) payload.caption = cap;

    const docRef = await addDoc(collection(db, "photo_submissions"), payload);

    const safeName = sanitizeFileName(file.name);
    const pendingStoragePath = `photo-submissions/pending/${docRef.id}/${safeName}`;
    const storageRef = ref(storage, pendingStoragePath);

    await uploadBytes(storageRef, file, { contentType: file.type });

    await updateDoc(docRef, {
      pendingStoragePath,
      fileName: safeName,
      contentType: file.type,
    });

    showOk("Thanks! Your photo was submitted for review.");
    fileInput.value = "";
    displayNameInput.value = "";
    captionInput.value = "";
  } catch (err) {
    console.error(err);
    const code = err && err.code;
    const msg =
      code === "storage/unauthorized" || code === "permission-denied"
        ? "Upload was blocked (check Firestore/Storage rules and anonymous sign-in)."
        : err && err.message
          ? String(err.message)
          : "Something went wrong. Try again.";
    showErr(msg);
  } finally {
    submitBtn.disabled = false;
  }
});
