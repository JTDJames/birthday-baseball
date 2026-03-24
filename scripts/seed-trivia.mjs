/**
 * One-time seed: uploads data/trivia/*.json into Firestore collection "questions".
 * Requires: npm install
 * Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON with Firestore write access.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tiers = [
  "easy",
  "somewhat_easy",
  "medium",
  "hard",
  "very_hard",
];

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn(
      "Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path."
    );
  }

  admin.initializeApp({ projectId: "giants-trivia" });
  const db = admin.firestore();
  let batch = db.batch();
  let inBatch = 0;

  async function flush() {
    if (inBatch === 0) return;
    await batch.commit();
    batch = db.batch();
    inBatch = 0;
  }

  for (const tier of tiers) {
    const raw = await readFile(
      join(root, "data", "trivia", `${tier}.json`),
      "utf8"
    );
    const arr = JSON.parse(raw);
    for (let idx = 0; idx < arr.length; idx++) {
      const q = arr[idx];
      const id = `${tier}_${String(idx).padStart(2, "0")}`;
      batch.set(db.collection("questions").doc(id), {
        difficulty: tier,
        prompt: q.prompt,
        choices: q.choices,
        correctIndex: q.correctIndex,
        category: q.category ?? "",
        author: q.author ?? "AI generated",
      });
      inBatch += 1;
      if (inBatch >= 450) await flush();
    }
  }
  await flush();
  console.log("Done: seeded questions from data/trivia/*.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
