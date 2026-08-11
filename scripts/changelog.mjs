// Regenerates src/changelog.json from git history. Runs automatically
// before every build/deploy via [build] in wrangler.toml, so the live
// /changelog page always reflects what's actually deployed.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

let entries = [];
try {
  const raw = execSync(
    "git log -n 200 --date=format:%Y-%m-%d --pretty=format:%h%x1f%ad%x1f%s",
    { encoding: "utf8" }
  );
  entries = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, date, subject] = line.split("\x1f");
      return { hash, date, subject };
    });
} catch (err) {
  console.warn("changelog: git log failed, keeping existing changelog.json");
  process.exit(0);
}

// Skip the write when nothing changed — wrangler dev watches src/, and an
// unconditional write here would retrigger the build in a loop.
const target = new URL("../src/changelog.json", import.meta.url);
const next = JSON.stringify(entries, null, 2) + "\n";
let current = "";
try {
  current = readFileSync(target, "utf8");
} catch {}
if (current !== next) {
  writeFileSync(target, next);
  console.log(`changelog: wrote ${entries.length} entries`);
} else {
  console.log("changelog: up to date");
}
