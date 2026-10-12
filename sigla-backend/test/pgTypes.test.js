const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

// The database stores timestamps as UTC in "timestamp without time zone" columns.
// pg reads such a value as LOCAL time of the machine unless told otherwise, so a
// backend running on a UTC+8 laptop reported every created_at 8 hours early (the
// admin's training tracker then thought a new run was 8 h old). Each case runs in a
// child process because a process's time zone is fixed when it starts.
const readAs = (tz) =>
  execFileSync(process.execPath, ["-e", `
    require(${JSON.stringify(path.join(__dirname, "../src/config/pgTypes.js"))});
    const { types } = require("pg");
    process.stdout.write(types.getTypeParser(1114)("2026-10-12 06:26:17.879").toISOString());
  `], { env: { ...process.env, TZ: tz }, encoding: "utf8" });

for (const tz of ["UTC", "Asia/Singapore", "America/New_York"]) {
  test(`a stored timestamp is read as UTC when the machine is on ${tz}`, () => {
    assert.strictEqual(readAs(tz), "2026-10-12T06:26:17.879Z");
  });
}
