import { auth, db, storage } from "./firebase-init.js";
import {
  signInWithGoogle,
  signOutTrivia,
} from "./trivia-auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  deleteObject,
  getBytes,
  getDownloadURL,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

/** Must match admin UIDs in firestore.rules and storage.rules. */
const ADMIN_UIDS = new Set(["sFLbwsGEPXWMc3iXLtpPaHE6pHr1"]);

const PLACEHOLDER = "sFLbwsGEPXWMc3iXLtpPaHE6pHr1";

const gridEl = document.getElementById("grid");
const emptyEl = document.getElementById("empty");
const statusLine = document.getElementById("statusLine");
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const adminWarn = document.getElementById("adminWarn");

function isAdminUser(user) {
  return user && ADMIN_UIDS.has(user.uid);
}

function setStatus(text) {
  statusLine.textContent = text || "";
}

function showPlaceholderWarning() {
  if (ADMIN_UIDS.has(PLACEHOLDER)) {
    adminWarn.classList.remove("hidden");
  } else {
    adminWarn.classList.add("hidden");
  }
}

async function loadPendingIntoGrid() {
  gridEl.innerHTML = "";
  const user = auth.currentUser;
  if (!user || !isAdminUser(user)) {
    emptyEl.classList.add("hidden");
    return;
  }

  setStatus("Loading pending submissions…");
  const q = query(
    collection(db, "photo_submissions"),
    where("status", "==", "pending")
  );
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter(({ data }) => data && data.pendingStoragePath)
    .sort((a, b) => {
      const ta = a.data.submittedAt && a.data.submittedAt.toMillis
        ? a.data.submittedAt.toMillis()
        : 0;
      const tb = b.data.submittedAt && b.data.submittedAt.toMillis
        ? b.data.submittedAt.toMillis()
        : 0;
      return tb - ta;
    });

  if (!rows.length) {
    emptyEl.classList.remove("hidden");
    setStatus("");
    return;
  }

  emptyEl.classList.add("hidden");
  setStatus(`${rows.length} pending`);

  for (const { id, data } of rows) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = id;

    const img = document.createElement("img");
    img.alt = "Pending submission";
    try {
      const pendingRef = ref(storage, data.pendingStoragePath);
      img.src = await getDownloadURL(pendingRef);
    } catch (e) {
      console.error(e);
      img.alt = "Could not load image";
    }

    const body = document.createElement("div");
    body.className = "card-body";

    const meta = document.createElement("div");
    meta.className = "meta";
    const parts = [];
    if (data.displayName) parts.push(`Name: ${data.displayName}`);
    if (data.caption) parts.push(`Caption: ${data.caption}`);
    parts.push(`File: ${data.fileName || "?"}`);
    meta.textContent = parts.join(" · ");

    const rejectNoteWrap = document.createElement("div");
    const rejectLabel = document.createElement("label");
    rejectLabel.htmlFor = `reject-note-${id}`;
    rejectLabel.textContent = "Rejection note (optional)";
    const rejectNote = document.createElement("textarea");
    rejectNote.id = `reject-note-${id}`;
    rejectNote.rows = 2;
    rejectNote.placeholder = "Internal note";
    rejectNoteWrap.appendChild(rejectLabel);
    rejectNoteWrap.appendChild(rejectNote);

    const actions = document.createElement("div");
    actions.className = "actions";

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "btn btn-success";
    approveBtn.textContent = "Approve";

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "btn btn-danger";
    rejectBtn.textContent = "Reject";

    approveBtn.addEventListener("click", () =>
      approveSubmission(id, data, approveBtn, rejectBtn)
    );
    rejectBtn.addEventListener("click", () =>
      rejectSubmission(id, data, rejectNote.value, approveBtn, rejectBtn)
    );

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);

    body.appendChild(meta);
    body.appendChild(rejectNoteWrap);
    body.appendChild(actions);

    card.appendChild(img);
    card.appendChild(body);
    gridEl.appendChild(card);
  }
}

async function approveSubmission(docId, data, approveBtn, rejectBtn) {
  if (!data.pendingStoragePath || !data.fileName) {
    alert("Missing storage fields on this document.");
    return;
  }
  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  try {
    const pendingRef = ref(storage, data.pendingStoragePath);
    const bytes = await getBytes(pendingRef);
    const contentType =
      data.contentType && String(data.contentType).startsWith("image/")
        ? data.contentType
        : "image/jpeg";

    const approvedPath = `photo-submissions/approved/${docId}/${data.fileName}`;
    const approvedRef = ref(storage, approvedPath);
    await uploadBytes(approvedRef, bytes, { contentType });
    const publicUrl = await getDownloadURL(approvedRef);
    await deleteObject(pendingRef);

    await updateDoc(doc(db, "photo_submissions", docId), {
      status: "approved",
      publicUrl,
      approvedStoragePath: approvedPath,
      approvedAt: serverTimestamp(),
      approvedBy: auth.currentUser.uid,
    });

    await loadPendingIntoGrid();
  } catch (e) {
    console.error(e);
    alert(e && e.message ? e.message : "Approve failed");
  } finally {
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
  }
}

async function rejectSubmission(
  docId,
  data,
  note,
  approveBtn,
  rejectBtn
) {
  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  try {
    if (data.pendingStoragePath) {
      try {
        await deleteObject(ref(storage, data.pendingStoragePath));
      } catch (e) {
        console.warn("Pending delete:", e);
      }
    }

    const payload = {
      status: "rejected",
      rejectedAt: serverTimestamp(),
      rejectedBy: auth.currentUser.uid,
    };
    const trimmed = String(note || "").trim();
    if (trimmed) payload.rejectionNote = trimmed.slice(0, 500);

    await updateDoc(doc(db, "photo_submissions", docId), payload);
    await loadPendingIntoGrid();
  } catch (e) {
    console.error(e);
    alert(e && e.message ? e.message : "Reject failed");
  } finally {
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
  }
}

signInBtn.addEventListener("click", () => {
  signInWithGoogle().catch((e) => console.error(e));
});

signOutBtn.addEventListener("click", () => {
  signOutTrivia().catch((e) => console.error(e));
});

onAuthStateChanged(auth, (user) => {
  showPlaceholderWarning();
  if (user) {
    signInBtn.classList.add("hidden");
    signOutBtn.classList.remove("hidden");
    if (isAdminUser(user)) {
      setStatus("");
      loadPendingIntoGrid().catch((e) => {
        console.error(e);
        setStatus("Could not load submissions.");
      });
    } else {
      gridEl.innerHTML = "";
      emptyEl.classList.add("hidden");
      setStatus("Signed in, but this account is not an admin.");
    }
  } else {
    signInBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
    gridEl.innerHTML = "";
    emptyEl.classList.add("hidden");
    setStatus("Sign in with Google to moderate.");
  }
});
