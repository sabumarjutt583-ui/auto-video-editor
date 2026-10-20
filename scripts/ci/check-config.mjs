// Fails early, with a clear message, when the release settings are missing or wrong.
// Reads: RELEASES_REPO, SOURCE_REPO (this repository), HAS_RELEASES_TOKEN, HAS_SIGNING_KEY ("true"/"false").
import { validRepo } from "../lib/release.mjs";

const repo = (process.env.RELEASES_REPO ?? "").trim();
const problems = [];

if (repo === "") {
  problems.push(
    "The variable RELEASES_REPO is not set.\n  Set it in: source repository > Settings > Secrets and variables > Actions > Variables > New repository variable.\n  Name: RELEASES_REPO   Value: owner/name of your PUBLIC releases repository, for example myname/autoeditor-releases",
  );
} else if (!validRepo(repo)) {
  problems.push(`RELEASES_REPO is "${repo}". It must look like owner/name, for example myname/autoeditor-releases.`);
} else if (repo.toLowerCase() === (process.env.SOURCE_REPO ?? "").toLowerCase()) {
  problems.push("RELEASES_REPO is the same as the source repository. Releases are never published to the source repository. Use a separate public repository.");
}
if (process.env.HAS_RELEASES_TOKEN !== "true") {
  problems.push("The secret RELEASES_TOKEN is not set.\n  Add it in: Settings > Secrets and variables > Actions > Secrets. It is a fine-grained token with Contents: read and write on RELEASES_REPO only.");
}
if (process.env.HAS_SIGNING_KEY !== "true") {
  problems.push("The secret TAURI_SIGNING_PRIVATE_KEY is not set (and TAURI_SIGNING_PRIVATE_KEY_PASSWORD if the key has a password). See RELEASE.md, step 4.");
}

if (problems.length > 0) {
  for (const p of problems) {
    const [first, ...rest] = p.split("\n");
    console.error(`::error::${first}`);
    if (rest.length > 0) console.error(rest.join("\n"));
  }
  console.error("Nothing was built or published.");
  process.exit(1);
}
console.log(`Release settings are present. Releases go to ${repo}.`);
