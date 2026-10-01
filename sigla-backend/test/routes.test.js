const test = require("node:test");
const assert = require("node:assert/strict");

// Route modules pull in the Sequelize models. A placeholder URI lets them load
// with no database: Sequelize only connects on the first query, and none runs.
process.env.PG_URI ??= "postgres://user:pass@127.0.0.1:1/routes_test";
process.env.JWT_SECRET ??= "routes-test";

const routesOf = (file) =>
  require(`../src/routes/${file}`)
    .stack.filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`)
    .sort();

// Every route here has a caller: the admin UI, the mobile app (word-bank), or
// the ML import scripts (admin-add, upload-videos, samples, upload-jobs). An
// exact list catches both an accidental removal and a dead route coming back.
test("word routes are exactly the ones something calls", () => {
  assert.deepEqual(routesOf("wordRoutes.js"), [
    "DELETE /:id",
    "DELETE /:id/samples",
    "GET /",
    "GET /:id",
    "GET /:id/samples",
    "GET /:id/upload-jobs/active",
    "GET /signers",
    "GET /stats",
    "GET /upload-jobs/:jobId",
    "GET /upload-jobs/active",
    "GET /word-bank",
    "PATCH /:id/set-video",
    "POST /:id/upload-videos",
    "POST /admin-add",
    "PUT /:id",
  ]);
});

test("ml routes serve only the training dataset", () => {
  assert.deepEqual(routesOf("mlRoutes.js"), ["GET /dataset"]);
});

test("model routes keep the manual test and lookup endpoints", () => {
  assert.deepEqual(routesOf("modelRoutes.js"), [
    "DELETE /:id",
    "GET /",
    "GET /:id",
    "GET /:id/status",
    "GET /latest",
    "GET /stats",
    "POST /deploy",
    "POST /revert",
    "POST /test",
    "POST /train",
  ]);
});

test("category routes have no duplicate list endpoint", () => {
  assert.deepEqual(routesOf("categoryRoutes.js"), [
    "DELETE /:id",
    "GET /",
    "POST /",
    "PUT /:id",
  ]);
});
