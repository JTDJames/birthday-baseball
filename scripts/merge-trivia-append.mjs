/**
 * Merges data/trivia/_append_{tier}.json into data/trivia/{tier}.json (run once after adding questions).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tiers = [
  "easy",
  "somewhat_easy",
  "medium",
  "hard",
  "very_hard",
];

for (const t of tiers) {
  const existing = JSON.parse(
    readFileSync(join(root, "data", "trivia", `${t}.json`), "utf8")
  );
  const append = JSON.parse(
    readFileSync(join(root, "data", "trivia", `_append_${t}.json`), "utf8")
  );
  writeFileSync(
    join(root, "data", "trivia", `${t}.json`),
    JSON.stringify([...existing, ...append], null, 2) + "\n"
  );
  console.log(`${t}.json: ${existing.length} + ${append.length} = ${existing.length + append.length}`);
}
console.log("Done merge.");
