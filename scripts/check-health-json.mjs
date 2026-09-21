// Checks the health document a production build emitted, so CI tests what
// `npm run build` produced and not only that it exited 0.
//
//     node scripts/check-health-json.mjs [path]    (default: dist/health.json)
//
// health.json is written by the `monitor-health-endpoint` plugin in
// vite.config.ts and served as /api/health. A build can succeed without it:
// a mistyped emitFile option, or a bundler upgrade that changes when plugin
// hooks run, still builds cleanly and quietly takes the monitor's own health
// endpoint away. This check exits non-zero, naming every mismatch, when the
// file is missing, unparseable, or no longer says what the plugin promises.
//
// The expectations are the plugin's, not new ones — keep them in step:
// - `status`, `service`, `timestamp`: the three fields every Mossland service
//   publishes under the ecosystem health contract.
// - `timestamp === buildTime`: deliberate. For a static artifact the build IS
//   the content, so the timestamp is frozen at build time. Do not "fix" it to
//   a request time.
// - `pipeline: "none"` and no `lastProcessedAt`: monitor processes nothing, so
//   it must not offer a freshness time a consumer could mistake for one.
// - `commit`: CI always builds from a git checkout, so a null or empty commit
//   here means the git lookup broke. (Outside a checkout the plugin reports
//   null on purpose; this script is for CI, not for tarball builds.)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = process.argv[2] ?? fileURLToPath(new URL("../dist/health.json", import.meta.url));

function fail(problems, doc) {
    console.error(`check-health-json: ${path} is not the health document the build should emit.`);
    for (const problem of problems) console.error(`  - ${problem}`);
    if (doc !== undefined) console.error(JSON.stringify(doc, null, 2));
    process.exit(1);
}

let raw;
try {
    raw = readFileSync(path, "utf8");
} catch (error) {
    fail([`cannot read it (${error.code ?? error.message}). Did the build emit health.json?`]);
}

let doc;
try {
    doc = JSON.parse(raw);
} catch (error) {
    fail([`it is not JSON (${error.message})`]);
}
if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    fail(["it is not a JSON object"], doc);
}

const problems = [];
const expect = (ok, message) => { if (!ok) problems.push(message); };

expect(doc.status === "ok", `status should be "ok", got ${JSON.stringify(doc.status)}`);
expect(doc.service === "monitor", `service should be "monitor", got ${JSON.stringify(doc.service)}`);
expect(doc.role === "viewer", `role should be "viewer", got ${JSON.stringify(doc.role)}`);
expect(doc.pipeline === "none", `pipeline should be "none", got ${JSON.stringify(doc.pipeline)}`);
expect(!("lastProcessedAt" in doc), "lastProcessedAt should be absent: monitor runs no pipeline");

// Checked as a real ISO instant first, so that two missing fields cannot
// satisfy `timestamp === buildTime` by both being undefined.
const isIsoInstant = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v))
    && new Date(v).toISOString() === v;
expect(isIsoInstant(doc.buildTime), `buildTime should be an ISO timestamp, got ${JSON.stringify(doc.buildTime)}`);
expect(doc.timestamp === doc.buildTime,
    `timestamp should equal buildTime (frozen at build), got ${JSON.stringify(doc.timestamp)} vs ${JSON.stringify(doc.buildTime)}`);

// `git rev-parse --short HEAD`: at least 7 hex digits.
expect(typeof doc.commit === "string" && /^[0-9a-f]{7,40}$/.test(doc.commit),
    `commit should be a short git hash, got ${JSON.stringify(doc.commit)}`);

if (problems.length > 0) fail(problems, doc);
console.log(`check-health-json: ${path} ok (commit ${doc.commit}, built ${doc.buildTime})`);
