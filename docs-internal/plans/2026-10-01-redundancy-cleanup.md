# Redundancy Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove verified-dead code across all four projects (Phase 1), then consolidate duplicated live logic behind tests (Phase 2), without changing anything a user, the mobile app, or the ML import scripts rely on.

**Architecture:** Phase 1 is pure deletion. Each deletion is guarded by a test or check that pins what must survive: a route-table test for the backend, an AST route test for the ML service, Android lint plus a release build for mobile resources, and lint/build for admin. Phase 2 extracts shared helpers one concern at a time, each with unit tests where the runtime allows.

**Tech Stack:** Node 22 / Express / Sequelize (`node --test`), React + Vite (ESLint), FastAPI / Python (pytest, `venv/Scripts/python.exe`), Kotlin / Android (Gradle, JUnit 4, coroutines 1.7.3, Kotlin 1.9.22).

**Spec:** No separate spec doc. The source is the redundancy audit from 2026-10-01 plus these user decisions:
1. Delete the entire retired word-bank-page chain (ManageWordBank.jsx, its client API calls, the backend handlers only it used, both video-generation implementations, ffmpeg deps).
2. Remove the ML `/deploy` and `/checksum` endpoints (and `services/deploy.py`). **Keep** `POST /models/test`, `GET /models/:id`, `GET /administrators/:id` and `GET /words/:id` as manual/debug endpoints; delete only their unused admin-client wrappers.
3. Do both phases: dead code first, then consolidation.
4. Delete the verified-unused mobile resources.

## Global Constraints

- Work on a branch: `git checkout -b chore/redundancy-cleanup` (never commit to `main` directly).
- Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Must survive (called from outside the admin UI):** `GET /words` (list), `POST /words/admin-add`, `POST /words/:id/upload-videos`, `GET /words/:id/samples`, `GET /words/:id/upload-jobs/active`, `GET /words/upload-jobs/:jobId` are used by `sigla-ml/scripts/import_words.py`, `import_alphabets.py` and `tools/import_fsl105.py`. `GET /ml/dataset` is used by ML training and every tool calling `fetch_approved_samples`. `GET /words/word-bank`, `GET /categories`, `GET /models/latest` are used by the mobile app.
- **Must survive (read as text by a test):** `sigla-ml/tests/test_mobile_parity_flags.py` regex-reads `MainActivity.kt`, `PredictionService.kt`, `HandLandmarkHelper.kt` and `ClipPreparer.kt`. Keep `TAP_FEATURE_SIZE` in `ClipPreparer.kt` even though Kotlin never reads it.
- Keep the `/word_bank` → `/dataset` redirect in `App.jsx` (old bookmarks).
- Keep the two Poppins fonts (`poppins_bold`, `poppins_medium`): no reference exists, but Android lint does not flag them, so they are out of scope.
- Do not touch the Kotlin ↔ Python feature-extraction mirrors (intentional, parity-tested), the response DTO fields in `ApiService.kt`, or `ManageModel`'s compact pagination (different design: 5/page).
- Baselines recorded 2026-10-01 (a task must not make these worse):
  - backend `npm test`: 4 pass
  - backend unused-vars lint (command in Task 1): 11 errors
  - admin `npm run lint`: 16 errors, 18 warnings; `npm run build`: succeeds
  - ML `venv/Scripts/python.exe -m pytest`: 92 pass
  - mobile `testDebugUnitTest`: 124 tests, 0 failures; `lintDebug`: 31 errors, 379 warnings (fails on pre-existing errors such as BottomAppBar and MissingSuperCall, which are unrelated)
- Mobile Gradle needs `export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"` (Git Bash) first. `assembleRelease` uses the local, gitignored `keystore.properties` and `sigla-release.jks`.

## Review Focus

1. **An import script hitting a removed endpoint.** A re-run of `import_words.py` must still find words, count stored samples, wait out live jobs and upload. This is pinned by the exact-list route test in Task 1 (`GET /:id/samples`, `GET /:id/upload-jobs/active`, `GET /upload-jobs/:jobId`, `POST /admin-add`, `POST /:id/upload-videos` asserted present).
2. **A password-reset or email-change code after the helper refactor.** Expected behavior: a resend within 60s still gets 429; a wrong code still counts down "N attempt(s) remaining"; the 5th wrong guess invalidates the session; a fresh code invalidates earlier ones. Pinned by `test/verificationCodes.test.js` in Task 7.
3. **A parity test that reads Kotlin source as text.** Deleting a "dead" Kotlin constant breaks `test_mobile_parity_flags.py` without breaking the Android build. Pinned by running the ML pytest suite at the end of Task 5.
4. **Speech on the word page before the TTS engine is ready, and voice preference changes.** Tapping a word should speak it once the engine binds, and a voice change in Settings should apply on the next utterance in both screens. Pinned by the manual device steps in Task 9 (TextToSpeech is not unit-testable here; there is no Robolectric).
5. **Admin colors drifting when the palette is shared.** The training banner's green must stay `#16a34a`; every `C.<key>` a file uses must exist in the shared palette. Pinned by the palette-key check script in Task 8.

---

# Phase 1 — Delete verified-dead code (no behavior change)

### Task 1: Backend — retire the word-bank-page endpoints and unrouted handlers

**Files:**
- Create: `sigla-backend/test/routes.test.js`
- Modify: `sigla-backend/src/controllers/wordController.js`
- Modify: `sigla-backend/src/routes/wordRoutes.js`
- Modify: `sigla-backend/src/controllers/mlController.js`
- Modify: `sigla-backend/src/routes/mlRoutes.js`
- Modify: `sigla-backend/src/seeders/seedSuperAdmin.js:59`
- Modify: `sigla-backend/package.json` and `package-lock.json` (via `npm uninstall`)

**Interfaces:**
- Produces: `wordController` exports exactly `failStaleUploadJobs, getAllWords, getSignerIds, getActiveUploadJobs, getWordStats, getWordById, adminAddWord, updateWord, deleteWord, getSamples, deleteAllSamplesForWord, setVideo, uploadVideos, getUploadJob, getActiveUploadJob`. `mlController` exports `getApprovedDataset` only. Task 2 extends `test/routes.test.js`.

- [ ] **Step 1: Create the branch**

```bash
cd /c/Users/Dell/Desktop/trysigla/sigla && git checkout -b chore/redundancy-cleanup
```

- [ ] **Step 2: Write the failing route-table test**

Create `sigla-backend/test/routes.test.js`:

```js
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd sigla-backend && npm test`
Expected: FAIL in "word routes are exactly the ones something calls" (the actual list also contains `POST /:id/admin-samples`, `PATCH /:id/activate`, …) and in "ml routes…" (contains `GET /word-samples/:wordId`). The model-routes test passes already; it guards the decision to keep those endpoints.

- [ ] **Step 4: Delete the dead handlers from `wordController.js`**

Delete each of these whole blocks: the declaration line through its closing `};` (or `}` for the two `async function`s), plus the `// ── …` header comment directly above it. Work bottom-up so earlier positions don't shift while you edit:

| Block | Starts with |
|---|---|
| `checkWordExists` | `const checkWordExists = async (req, res) => {` |
| `setThumbnail` | `async function setThumbnail(req, res) {` |
| `generateVideo` (~230 lines, the only ffmpeg user) | `const generateVideo = async (req, res) => {` |
| `getMotionSequences` | `const getMotionSequences = async (req, res) => {` |
| `rejectAllSamplesForWord` | `const rejectAllSamplesForWord = async (req, res) => {` |
| `approveAllSamplesForWord` | `const approveAllSamplesForWord = async (req, res) => {` |
| `getUserSampleCountForWord` | `const getUserSampleCountForWord = async (req, res) => {` |
| `rejectWord` | `const rejectWord = async (req, res) => {` |
| `approveWord` | `const approveWord = async (req, res) => {` |
| `activateWord` | `const activateWord = async (req, res) => {` |
| `rejectSubmission` | `const rejectSubmission = async (req, res) => {` |
| `approveSubmission` | `const approveSubmission = async (req, res) => {` |
| `rejectAllSamplesByUser` | `const rejectAllSamplesByUser = async (req, res) => {` |
| `approveAllSamplesByUser` | `const approveAllSamplesByUser = async (req, res) => {` |
| `rejectSample` | `const rejectSample = async (req, res) => {` |
| `approveSample` | `const approveSample = async (req, res) => {` |
| `adminUploadSamples` | `const adminUploadSamples = async (req, res) => {` |
| `submitWord` | `const submitWord = async (req, res) => {` |
| `saveImage` (+ its 2-line "upload a base64 image" comment) | `const saveImage = async (base64, index, folder = "static") => {` |
| `getUserSampleCount` | `const getUserSampleCount = async (userId, wordId) => {` |
| `getPerUserCap` | `const getPerUserCap = () => PER_USER_CAP;` |

Also delete these single lines:
- `const IMAGE_RX = /\.(jpe?g|png)$/i;`
- `const PER_USER_CAP = 25;         // max samples ONE user can contribute to a word`
- `const SUPABASE_BUCKET      = process.env.SUPABASE_BUCKET_GESTURES || "gesture-samples";`
- the three local-fallback lines (only `saveImage` and `generateVideo` used them):

```js
// Fall back to local disk only when Supabase env vars are missing (dev without .env)
const UPLOADS_DIR = path.join(__dirname, "../../uploads/samples");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
```

Keep `getSampleCap`, `getApprovedSampleCount`, `normalizeLabel`, `checkAndActivateWord`, `extractAndStoreSample`, `saveVideo`: live handlers still call them.

`saveVideo`'s header comment starts `// Mirrors saveImage: pushes to the gesture-videos bucket`. Change that to `// Pushes to the gesture-videos bucket`, because `saveImage` no longer exists.

Replace the whole `module.exports = { … };` at the end of the file with:

```js
module.exports = {
  failStaleUploadJobs,
  getAllWords,
  getSignerIds,
  getActiveUploadJobs,
  getWordStats,
  getWordById,
  adminAddWord,
  updateWord,
  deleteWord,
  getSamples,
  deleteAllSamplesForWord,
  setVideo,
  uploadVideos,
  getUploadJob,
  getActiveUploadJob,
};
```

(The old "Shared helpers reused by the FSL-105 bulk importer" exports had no consumer: that importer is Python and talks HTTP.)

- [ ] **Step 5: Trim `wordRoutes.js`**

Replace the controller import (currently lines 9-39) with:

```js
const {
  getAllWords,
  getWordStats,
  getWordById,
  adminAddWord,
  updateWord,
  deleteWord,
  getSamples,
  deleteAllSamplesForWord,
  setVideo,
  uploadVideos,
  getUploadJob,
  getSignerIds,
  getActiveUploadJobs,
  getActiveUploadJob,
} = require("../controllers/wordController.js");
```

Delete the stray line `// ... other requires`.

Delete these `router.*` registrations, including any comment block that only explains them (the "Sample review routes" ordering comment and the "Submission level routes" comment both go, because nothing is left for them to order):
- `router.post("/:id/admin-samples", …)`
- the six `router.patch("/:id/samples/…")` calls (`approve-all`, `reject-all`, `user/:userId/approve-all`, `user/:userId/reject-all`, `:sampleId/approve`, `:sampleId/reject`)
- `router.patch("/:id/approve-submission/:userId?", …)` and `router.patch("/:id/reject-submission/:userId?", …)`
- `router.patch("/:id/activate", …)`
- `router.get("/:id/motion-sequences", …)` and its `// ── Motion sequence routes` header
- `router.post("/:id/generate-video", …)`
- `router.patch("/:id/set-thumbnail", …)`
- `router.patch("/:id/approve", …)` and `router.patch("/:id/reject", …)`

Delete everything after `module.exports = router;` (the stale `// Test in Postman:` block, which lists endpoints that no longer exist).

Keep the comment above `router.delete("/:id/samples", …)` explaining why that route must precede wildcard routes.

- [ ] **Step 6: Drop the video-sample feed from the ML routes**

In `src/controllers/mlController.js`, delete the whole `const getWordSamplesForVideo = async (req, res) => { … };` block, plus its header comment if it has one, and change the last line to:

```js
module.exports = { getApprovedDataset };
```

In `src/routes/mlRoutes.js`, change the import to `const { getApprovedDataset } = require("../controllers/mlController.js");` and delete the line `router.get("/word-samples/:wordId", apiKeyAuth, getWordSamplesForVideo);`.

- [ ] **Step 7: Fix the unused seeder variable**

In `src/seeders/seedSuperAdmin.js`, change `    const user = await Administrator.create({` to `    await Administrator.create({`.

- [ ] **Step 8: Remove dependencies nothing requires**

```bash
cd sigla-backend && npm uninstall ffmpeg-static fluent-ffmpeg ffprobe-static nodemailer node-cron uuid
```

(`pg` and `pg-hstore` stay: Sequelize loads them implicitly.)

- [ ] **Step 9: Verify nothing dangling remains**

Run:

```bash
cd sigla-backend && npm test
../sigla-admin/node_modules/.bin/eslint --no-config-lookup \
  --rule '{"no-unused-vars":["error",{"args":"none","caughtErrors":"none"}],"no-undef":"error"}' \
  --parser-options ecmaVersion:latest --parser-options sourceType:commonjs \
  --global require,module,process,console,__dirname,Buffer,setTimeout,setInterval,clearInterval,clearTimeout \
  src server.js
git grep -nE "IMAGE_RX|saveImage|UPLOADS_DIR|getPerUserCap|getWordSamplesForVideo|ffmpeg|nodemailer|node-cron|\buuid\b" -- src server.js package.json
```

Expected:
- `npm test`: all 7 tests pass.
- eslint: 0 errors (the baseline had 11, all in deleted code or the seeder). At most one warning, "Unused eslint-disable directive" at `getSampleCap`, which is a pre-existing artifact of the `args: none` setting.
- grep: no output.

A dry-run simulation of Steps 4-5 on 2026-10-01 left exactly `SUPABASE_BUCKET` and `PER_USER_CAP` unused (handled above) and nothing undefined.

- [ ] **Step 10: Commit**

```bash
git add sigla-backend
git commit -m "chore(backend): remove endpoints only the retired word-bank page used

Deletes per-sample/submission review, admin image samples, activate,
set-thumbnail, motion-sequences and ffmpeg video generation, plus the
unrouted submitWord/checkWordExists/getUserSampleCountForWord handlers
and the ML word-samples feed. A route-table test pins every route the
admin UI, mobile app and ML import scripts still call.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Backend — category route hygiene

**Files:**
- Modify: `sigla-backend/src/routes/categoryRoutes.js`
- Test: `sigla-backend/test/routes.test.js`

**Interfaces:**
- Consumes: `routesOf` from Task 1's test file.

- [ ] **Step 1: Add the failing test**

Append to `sigla-backend/test/routes.test.js`:

```js
// GET / is public (mobile + guests). The old GET /public duplicate sat behind
// auth, so it was never actually public, and nothing called it.
test("category routes have no duplicate list endpoint", () => {
  assert.deepEqual(routesOf("categoryRoutes.js"), [
    "DELETE /:id",
    "GET /",
    "POST /",
    "PUT /:id",
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd sigla-backend && npm test`
Expected: FAIL. The actual list includes `GET /public`.

- [ ] **Step 3: Rewrite the route body**

Replace everything from `// Public — anyone…` to `module.exports = router;` with:

```js
// Public — anyone, including guests and the mobile app, can read the list.
router.get("/", getAllCategories);

// Everything below requires a logged-in admin who has finished setup.
router.use(authMiddleware);
router.use(requireSetupComplete);
router.post("/", roleMiddleware("admin"), createCategory);
router.put("/:id", roleMiddleware("admin"), updateCategory);
router.delete("/:id", roleMiddleware("admin"), deleteCategory);

module.exports = router;
```

(This removes the second `router.use(authMiddleware)`, which ran the token check twice per request, and the unreachable `GET /public`.)

- [ ] **Step 4: Verify**

Run: `npm test` and expect 8 passing tests. Then `git grep -n "categories/public" -- ..` should print nothing.

- [ ] **Step 5: Commit**

```bash
git add sigla-backend
git commit -m "chore(backend): drop duplicate category auth and dead /public route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Admin — delete the retired page and every orphan it leaves

**Files:**
- Delete: `sigla-admin/src/pages/words/ManageWordBank.jsx`
- Modify: `sigla-admin/src/App.jsx:15-18`
- Modify: `sigla-admin/src/api/wordApi.js`, `src/api/modelApi.js`, `src/api/administratorApi.js`
- Modify: `sigla-admin/src/utils/constants.js`
- Modify: `sigla-admin/src/pages/model/ManageModel.jsx`
- Modify: `sigla-admin/src/components/TrainingJobBanner.jsx:76`
- Modify: `sigla-admin/src/pages/activitylogs/ActivityLogs.jsx:1`
- Modify: `sigla-admin/package.json` and `package-lock.json` (via `npm uninstall`)

The admin app has no test runner. The guard is ESLint (unused imports and undefined names surface as errors) plus `vite build` (which fails on any import of a deleted export).

- [ ] **Step 1: Delete the page and update the App.jsx comment**

```bash
cd sigla-admin && git rm src/pages/words/ManageWordBank.jsx
```

In `src/App.jsx`, delete the four comment lines starting `// ManageWordBank is intentionally not imported`. Leave the `/word_bank` → `/dataset` `<Navigate>` route and its comment alone.

- [ ] **Step 2: Remove the orphaned API wrappers**

In `src/api/wordApi.js`, delete these exports (each is a complete `export const … ;` statement):
- Only the deleted page called these: `approveWord`, `rejectWord`, `getWordSamples`, `approveSample`, `rejectSample`, `approveAllSamplesByUser`, `rejectAllSamplesByUser`, `approveSubmission`, `rejectSubmission`, `adminUploadSamples`, `activateWord`, `approveAllSamplesForWord`, `rejectAllSamplesForWord`, `setWordThumbnail`, `getMotionSequences`, `generateVideoFromSequence`.
- These call routes that do not exist: `lockWord`, `unlockWord`, `submitWord`, `getUserSampleCount`.
- These are never called (the backend routes stay for scripts and manual use): `getWordById`, `getActiveUploadJob` (delete its 2-line comment too).

In `src/api/modelApi.js`, delete `getModelById`, `getLatestModel`, and `testModel` with its 3-line "No longer called from the UI" comment. Backend `POST /models/test` stays, per the user's decision.

In `src/api/administratorApi.js`, delete `getAdministratorById`.

- [ ] **Step 3: Trim constants.js to what is used**

Replace the whole of `src/utils/constants.js` with:

```js
export const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3000/api";
```

- [ ] **Step 4: Remove dead variables that lint already flags**

- `src/components/TrainingJobBanner.jsx`: delete the line `  const stepLabel = wordsDone ? "Alphabet model" : "Words model";`.
- `src/pages/activitylogs/ActivityLogs.jsx` line 1: drop `useMemo` from the React import.
- `src/pages/model/ManageModel.jsx`. The deploy dialog no longer reads `wordStats` (see the comment near "Describe what deploy ACTUALLY does"), so its fetch is dead:
  - delete `import { getWordStats } from "../../api/wordApi.js";`
  - delete `  const [wordStats, setWordStats] = useState(() => getCached(CACHE_KEYS.wordStats) || null);`
  - delete `  useCacheSubscription(CACHE_KEYS.wordStats, setWordStats);`
  - in `fetchData`, delete `const cachedWordStats = …` and `if (cachedWordStats) setWordStats(cachedWordStats);`, change the `Promise.all` destructuring to `const [statsData, modelsData] = await Promise.all([getModelStats(), getAllModels()]);`, and delete `setWordStats(wordStatsData);`
  - change `} catch (err) {` in `fetchData` to `} catch {`
  - delete the two empty section headers `// ── Stat Card ───…` and `// ── Skeleton Components ───…`

- [ ] **Step 5: Remove unused dependencies**

```bash
npm uninstall @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-slot @supabase/supabase-js class-variance-authority clsx tailwind-merge
```

- [ ] **Step 6: Verify**

Run:

```bash
npm run lint 2>&1 | tail -3
npm run build 2>&1 | tail -3
git grep -nE "ManageWordBank|lockWord|submitWord|getUserSampleCount|testModel|getModelById|getAdministratorById|WORD_STATUS|MODEL_STATUS|stepLabel" -- src
```

Expected:
- lint: **8 errors** (baseline 16, minus the 4 in ManageWordBank, `stepLabel`, `useMemo`, `wordStats` and `err`). The 8 that remain are all pre-existing:
  - 4 `react-refresh/only-export-components` in the AuthContext, ToastContext, TrainingJobContext and UploadJobsContext files
  - 2 "Cannot access refs during render" in `useCacheSubscription.js` and `pageViewState.js`
  - 2 `no-useless-escape` in ManageModel
- build: `✓ built`.
- grep: no output.

- [ ] **Step 7: Commit**

```bash
git add -A sigla-admin
git commit -m "chore(admin): delete retired ManageWordBank page and its orphans

Removes the unimported page, 22 API wrappers no page calls (four of
them hit routes that never existed), unused constants, dead state and
seven unused npm packages.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ML service — remove uncalled endpoints and their services

**Files:**
- Create: `sigla-ml/tests/test_router_surface.py`
- Modify: `sigla-ml/app/routers/model.py`
- Delete: `sigla-ml/app/services/deploy.py`, `sigla-ml/app/services/video.py`
- Modify: `sigla-ml/app/utils/supabase_client.py`

- [ ] **Step 1: Write the failing test**

Create `sigla-ml/tests/test_router_surface.py`:

```python
"""
The ML service's HTTP surface is exactly what the Node backend calls.

Read with ast rather than importing app.main: importing pulls in TensorFlow and
requires Supabase credentials, which this check does not need.
"""
import ast
import pathlib

ROUTER = pathlib.Path(__file__).resolve().parents[1] / "app" / "routers" / "model.py"


def _routes() -> set[str]:
    tree = ast.parse(ROUTER.read_text(encoding="utf-8"))
    found = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if (
                isinstance(dec, ast.Call)
                and isinstance(dec.func, ast.Attribute)
                and isinstance(dec.func.value, ast.Name)
                and dec.func.value.id == "router"
            ):
                found.add(f"{dec.func.attr.upper()} {dec.args[0].value}")
    return found


def test_router_exposes_only_what_the_backend_calls():
    # modelController: /train, /training/{id}/progress, /test.
    # wordController.extractAndStoreSample: /extract-landmarks.
    assert _routes() == {
        "GET /training/{model_id}/progress",
        "POST /train",
        "POST /test",
        "POST /extract-landmarks",
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_router_surface.py -q`
Expected: FAIL. The set also contains `POST /deploy`, `POST /checksum`, `GET /checksum` and `POST /generate-video`.

- [ ] **Step 3: Strip the router**

In `app/routers/model.py`:
- Delete the imports `from app.services.deploy  import deploy` and `from app.services.video   import generate_word_video`, and remove `Form`, `hashlib` and `httpx` from the imports (after this step nothing uses them; `Form` was already unused).
- Delete the classes `DeployRequest`, `ChecksumRequest`, `VideoRequest`.
- Delete `compute_sha256_from_url` with its `# ── Helper: compute SHA256…` header.
- Delete the route functions `deploy_model` (`@router.post("/deploy")`), `get_model_checksum` (`@router.post("/checksum")`), `get_deployed_model_checksum` (`@router.get("/checksum")`) and `generate_video` (`@router.post("/generate-video")`), each with its decorator and docstring. Note: the `/checksum` docstring claims the Kotlin app calls it. It does not: `ModelUpdateManager.kt` verifies the SHA-256 locally against the checksum in `GET /models/latest`.

- [ ] **Step 4: Delete the orphaned services and helpers**

```bash
git rm app/services/deploy.py app/services/video.py
```

In `app/utils/supabase_client.py`, delete `list_files` and `delete_file`. Keep `upload_file`, `download_file`, `get_public_url`: `train.py` and `test.py` still use the first two, and verify the third with the grep below before deleting anything else.

- [ ] **Step 5: Verify**

Run:

```bash
venv/Scripts/python.exe -m pytest -q
venv/Scripts/python.exe -c "import app.main; print('app imports OK')"
git grep -nE "services\.(deploy|video)|generate_word_video|compute_sha256|list_files|delete_file|get_public_url" -- app tools scripts tests
```

Expected:
- pytest: 93 passed.
- import: `app imports OK`. This loads TensorFlow and reads `.env`; it proves nothing still imports a deleted module.
- grep: only `get_public_url` inside `supabase_client.py` itself. If nothing outside that file uses it, delete it too and re-run the import check.

- [ ] **Step 6: Commit**

```bash
git add -A sigla-ml
git commit -m "chore(ml): remove /deploy, /checksum and /generate-video

The backend validates and checksums deployments itself and never called
these; video generation had no caller. An AST test pins the router to
the four routes the backend uses.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Mobile — delete dead Kotlin declarations

**Files:**
- Modify: `sigla-mobile/app/src/main/kotlin/com/example/sigla/MainActivity.kt`
- Modify: `…/ModelUpdateManager.kt`, `…/TranslationHistoryManager.kt`, `…/HandLandmarkHelper.kt`, `…/CategoryGridItem.kt`
- Modify: `sigla-ml/app/utils/preprocessor.py` (docstring that names `mirrorHandX`)

- [ ] **Step 1: Delete the declarations**

Each has zero references in `app/src/main`, `app/src/test`, the manifest, or any repo file (checked 2026-10-01):
- `MainActivity.kt`: the whole `private fun mirrorHandX(features: FloatArray): FloatArray { … }` (~18 lines, just after `resetHandednessLatch`). Hand mirroring is now done per slot inline, around the `if (decided) { for (j in 0..20) … }` block.
- `ModelUpdateManager.kt`:
  - `fun hasLocalMotionModel(context: Context): Boolean = hasLocalModel(context)` (a pure alias)
  - `fun invalidateCheckThrottle() { lastCheckAt = 0L }` with its KDoc
  - `fun getLocalFile(context: Context, filename: String): File? { … }` with its KDoc
- `TranslationHistoryManager.kt`: `fun getCount(): Int = getAll().size`.
- `HandLandmarkHelper.kt`:
  - `val isLiveStream: Boolean get() = onResult != null`
  - the companion's `fun destroy() { … }` with its KDoc. Before deleting, confirm it is not referenced: `git grep -n "\.destroy()" -- app/src` should list nothing for HandLandmarkHelper.
- `CategoryGridItem.kt`: the `val dbCategory: CategoryItem? = null // null for Favorites/All Words` property, and the trailing comma on the line above it (`val isAllWords: Boolean = false,` becomes `val isAllWords: Boolean = false`).

**Do NOT delete** `TAP_FEATURE_SIZE` in `ClipPreparer.kt`. `sigla-ml/tests/test_mobile_parity_flags.py:380` reads it as text.

If removing a function leaves an import unused (for example `java.io.File` in ModelUpdateManager), the Kotlin compiler warns. Remove the import only if `grep -n "File(" ModelUpdateManager.kt` shows no other use.

- [ ] **Step 2: Fix the Python docstring that names the deleted function**

In `sigla-ml/app/utils/preprocessor.py`, in `mirror_sequence`'s docstring, change
`convention as MainActivity.kt's mirrorHandX/mirrorPoseBlock — operates on`
to
`convention as MainActivity.kt's per-slot hand mirror and mirrorPoseBlock — operates on`.

- [ ] **Step 3: Verify**

```bash
cd sigla-mobile && export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
./gradlew testDebugUnitTest --console=plain -q
cd ../sigla-ml && venv/Scripts/python.exe -m pytest -q
git grep -nE "mirrorHandX|hasLocalMotionModel|invalidateCheckThrottle|getLocalFile|isLiveStream|dbCategory" -- ../sigla-mobile/app/src ../sigla-ml
```

Expected:
- Gradle: BUILD SUCCESSFUL. The unit-test task compiles all main sources, so a dangling reference fails here.
- pytest: 93 passed. The parity flags still match.
- grep: no output.

- [ ] **Step 4: Commit**

```bash
git add sigla-mobile sigla-ml/app/utils/preprocessor.py
git commit -m "chore(mobile): delete unreferenced Kotlin functions and properties

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Mobile — delete unused resources

**Files:**
- Delete: 67 resource files (list below)
- Delete: `app/src/main/res/values/colors.xml`, `app/src/main/res/values-night/colors.xml`, `app/src/main/res/values/styles.xml`
- Modify: `app/src/main/res/values/colors_sigla.xml` (gains the one live legacy color)

**Verification approach:** Two independent methods agreed on every item:
1. A whole-word search across every tracked file in `sigla-mobile`: code, all XML, the manifest, Gradle files, `tools/`, and the `debug`/`test` source sets.
2. Android lint's `UnusedResources` report from the 2026-10-01 baseline `lintDebug`.

Five layouts that the search flagged (`activity_home`, `activity_main`, `activity_splash`, `item_home_category`, `item_home_recent`) are **excluded**: they are inflated through ViewBinding classes. The 14 colors lint flagged beyond the search are referenced only from files on this deletion list.

- [ ] **Step 1: Delete the resource files**

```bash
cd sigla-mobile/app/src/main/res && git rm \
  animator/button_elevation.xml \
  color/counter_color.xml color/gesture_type_text.xml \
  color/nav_text_primary.xml color/nav_text_primary_selector.xml \
  color/nav_text_secondary.xml color/nav_text_secondary_selector.xml \
  color/speed_toggle_bg.xml color/speed_toggle_text.xml \
  color/switch_thumb_tint.xml color/switch_track_tint.xml \
  drawable/bg_active_dot.xml drawable/bg_ai_ready.xml drawable/bg_badge_glass.xml \
  drawable/bg_badge_soft.xml drawable/bg_chip_blue_light.xml drawable/bg_chip_pill.xml \
  drawable/bg_dialog_rounded.xml drawable/bg_drag_handle.xml drawable/bg_error_soft.xml \
  drawable/bg_filterrow.xml drawable/bg_gesture_option.xml drawable/bg_glow_circle.xml \
  drawable/bg_glow_soft_blue.xml drawable/bg_gradient_soft.xml drawable/bg_hint_blue.xml \
  drawable/bg_hint_soft.xml drawable/bg_icon_button.xml drawable/bg_icon_button_modern.xml \
  drawable/bg_icon_circle_blue_light.xml drawable/bg_icon_circle_dark.xml \
  drawable/bg_icon_circle_orange_light.xml drawable/bg_icon_circle_red_light.xml \
  drawable/bg_line_detector_progress.xml drawable/bg_logo_hex.xml \
  drawable/bg_nav_active_modern.xml drawable/bg_nav_pressed.xml drawable/bg_nav_selected.xml \
  drawable/bg_radio_modern.xml drawable/bg_radio_option.xml drawable/bg_ready_badge.xml \
  drawable/bg_selection_active.xml drawable/bg_selection_inactive.xml drawable/bg_stat_card.xml \
  drawable/bg_toggle_selected.xml drawable/bg_toggle_track.xml drawable/bg_toggle_unselected_blue.xml \
  drawable/btn_gradient_primary.xml drawable/btn_sidebar_gradient.xml \
  drawable/circle_icon_background.xml drawable/ic_book_outline.xml drawable/ic_camera_line.xml \
  drawable/ic_check_circle.xml drawable/ic_chevron_down_circle.xml drawable/ic_info.png \
  drawable/ic_menu_line.xml drawable/ic_menu_lines.xml drawable/ic_motion.png \
  drawable/ic_one_hand.png drawable/ic_sparkle.png drawable/ic_static.png drawable/ic_two_hands.png \
  drawable/sidebar_bg_gradient.xml drawable/sidebar_divider_gradient.xml drawable/sidebar_glow_top.xml \
  drawable/sigla.png \
  layout/item_manage_category.xml layout/item_sample_thumbnail.xml
```

- [ ] **Step 2: Retire the legacy color files**

`values/colors.xml` holds 68 colors, and 67 are unused: the live palette is `colors_sigla.xml`. The one survivor is `colorIndicatorInactive`, used by `drawable/bg_indicator_dot.xml`. `values-night/colors.xml` holds 33 night overrides, all of them for deleted colors. `values/styles.xml` holds only the unused `TopBarShape`.

Add the survivor to `values/colors_sigla.xml`, just before `</resources>`:

```xml
    <!-- Onboarding pager dot, inactive state (bg_indicator_dot.xml). -->
    <color name="colorIndicatorInactive">#D7DBE4</color>
```

Then:

```bash
git rm values/colors.xml values-night/colors.xml values/styles.xml
```

The 67 deleted colors are:
- `cardAllWordsBg cardAllWordsFg cardAllWordsTitle cardAlphabetBg cardAlphabetTitle cardDailyLifeBg cardDailyLifeTitle cardEmotionsBg cardEmotionsTitle cardFavoritesBg cardFavoritesFg cardFavoritesTitle cardGreetingsBg cardGreetingsTitle cardIconBg`
- `colorBackground colorDivider colorError colorIconBoxFill colorIconBoxStroke colorNavy colorPrimary colorSidebarBg colorSuccess colorSurface colorSurfaceVariant colorTeal colorTextMuted colorTextPrimary colorTextSecondary colorWarning colorWbBg colorWbCountMuted colorWbSectionLabel`
- `sig_accent sig_accent_pill sig_border_card sig_border_chrome sig_border_icon_badge sig_border_reset_card sig_border_reset_icon sig_chrome_halo sig_chrome_navy sig_delete_icon sig_divider sig_favtile_badge sig_favtile_icon sig_header_button_bg sig_icon_accent sig_icon_badge_icon sig_icon_bg_danger sig_icon_bg_soft sig_icon_box_bg sig_nav_selected_fill sig_nav_selected_text sig_page_bg sig_reset_accent sig_reset_card_bg sig_reset_subtitle sig_stage_bg sig_stage_text sig_surface_card sig_switch_thumb sig_text_primary sig_text_secondary sig_toggle_unselected sig_toggle_unselected_text`

`themes.xml`'s `<item name="colorPrimary">@color/sg_brand</item>` is a theme **attribute** named colorPrimary pointing at `sg_brand`. It does not reference the deleted `@color/colorPrimary`.

- [ ] **Step 3: Verify with the compiler, lint, and the release build**

```bash
cd sigla-mobile && export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
./gradlew testDebugUnitTest assembleRelease --console=plain -q
./gradlew lintDebug --console=plain -q; true
grep -cE ": Error: " app/build/reports/lint-results-debug.txt
grep -E "UnusedResources" app/build/reports/lint-results-debug.txt | grep -oE "R\.[a-z]+\.[A-Za-z0-9_]+" | sort -u
```

Expected:
- Tests plus `assembleRelease`: BUILD SUCCESSFUL. AAPT fails the build on any `@drawable/…` or `@color/…` that no longer resolves, and the release build adds R8 and `shrinkResources`.
- lint errors: **31** (unchanged from baseline). If it is higher, open the report: a new error means a dangling reference.
- remaining UnusedResources: only `R.font.*` entries or items not on this list. If lint now flags something new that was referenced only by a deleted file, verify it the same way (`git grep -nE "(@color/|R\.color\.)NAME\b" -- app/src`) and delete it in this task.

- [ ] **Step 4: Smoke-test on the phone**

Install the release APK (`adb install -r app/build/outputs/apk/release/app-release.apk`; see the MIUI notes in memory if a fresh install is blocked). Then open, in both light and dark mode:
- Home
- Words: grid mode and list mode
- a category
- a word's page
- Translator
- History
- Settings
- the onboarding pager dots

Expected: no visual changes. Everything deleted was unreferenced.

- [ ] **Step 5: Commit**

```bash
git add -A sigla-mobile/app/src/main/res
git commit -m "chore(mobile): delete 67 unused resources and the legacy color files

Cross-checked by repo-wide search and Android lint UnusedResources;
colorIndicatorInactive, the one live legacy color, moves to
colors_sigla.xml.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Phase 2 — Consolidate duplicated live logic

### Task 7: Backend — one verification-code helper, one ML service URL

**Files:**
- Create: `sigla-backend/src/utils/verificationCodes.js`
- Create: `sigla-backend/src/config/mlService.js`
- Create: `sigla-backend/test/verificationCodes.test.js`
- Modify: `sigla-backend/src/controllers/authController.js` (`generateCode`, `getLatestVerification`, `resendCode`, `forgotPassword`, `verifyResetCode`)
- Modify: `sigla-backend/src/controllers/emailController.js` (constants, `generateCode`, `getLatestVerification`, `requestEmailCode`, `verifyEmailCode`)
- Modify: `sigla-backend/src/controllers/modelController.js:16`, `src/controllers/wordController.js` (inside `extractAndStoreSample`)

**Interfaces:**
- Produces from `src/utils/verificationCodes.js`:
  - `CODE_TTL_MS`, `RESEND_COOLDOWN_MS`, `MAX_ATTEMPTS`
  - `generateCode(): string`
  - `getLatestVerification(email: string, type: string): Promise<EmailVerification|null>`
  - `issueVerificationCode({ email, type, administratorId }): Promise<{ cooldown: true } | { code: string }>`
  - `recordWrongAttempt(record): Promise<object>`, which returns the JSON body for the 400 response
- Produces from `src/config/mlService.js`: `ML_SERVICE_URL: string`

- [ ] **Step 1: Write the failing tests**

Create `sigla-backend/test/verificationCodes.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PG_URI ??= "postgres://user:pass@127.0.0.1:1/codes_test";

const { EmailVerification } = require("../src/models/index.js");
const {
  MAX_ATTEMPTS,
  CODE_TTL_MS,
  generateCode,
  issueVerificationCode,
  recordWrongAttempt,
} = require("../src/utils/verificationCodes.js");

const fakeRecord = (attempt_count) => {
  const rec = { attempt_count, updates: [] };
  rec.update = async (fields) => {
    rec.updates.push(fields);
    Object.assign(rec, fields);
  };
  return rec;
};

test("generateCode returns six digits", () => {
  for (let i = 0; i < 50; i++) assert.match(generateCode(), /^\d{6}$/);
});

test("issueVerificationCode refuses a resend inside the cooldown", async (t) => {
  t.mock.method(EmailVerification, "findOne", async () => ({ id: 1 }));
  const update = t.mock.method(EmailVerification, "update", async () => [0]);
  const create = t.mock.method(EmailVerification, "create", async () => ({}));

  const result = await issueVerificationCode({
    email: "a@b.co", type: "password_reset", administratorId: 7,
  });

  assert.deepEqual(result, { cooldown: true });
  assert.equal(update.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
});

test("issueVerificationCode invalidates earlier codes, then stores a fresh one", async (t) => {
  t.mock.method(EmailVerification, "findOne", async () => null);
  const update = t.mock.method(EmailVerification, "update", async () => [1]);
  const create = t.mock.method(EmailVerification, "create", async () => ({}));
  const before = Date.now();

  const { code } = await issueVerificationCode({
    email: "a@b.co", type: "email_change", administratorId: 7,
  });

  assert.match(code, /^\d{6}$/);
  assert.deepEqual(update.mock.calls[0].arguments, [
    { session_invalidated: true },
    { where: { email: "a@b.co", type: "email_change", is_used: false } },
  ]);
  const row = create.mock.calls[0].arguments[0];
  assert.equal(row.administrator_id, 7);
  assert.equal(row.code, code);
  assert.equal(row.type, "email_change");
  assert.equal(row.attempt_count, 0);
  assert.equal(row.session_invalidated, false);
  const ttl = row.expires_at.getTime() - before;
  assert.ok(ttl >= CODE_TTL_MS && ttl < CODE_TTL_MS + 1000, `ttl ${ttl}`);
});

test("recordWrongAttempt counts down the remaining attempts", async () => {
  const rec = fakeRecord(0);
  const body = await recordWrongAttempt(rec);
  assert.deepEqual(body, {
    message: `Incorrect code. ${MAX_ATTEMPTS - 1} attempt(s) remaining.`,
    attempts_remaining: MAX_ATTEMPTS - 1,
  });
  assert.deepEqual(rec.updates, [{ attempt_count: 1 }]);
});

test("recordWrongAttempt invalidates the session on the last attempt", async () => {
  const rec = fakeRecord(MAX_ATTEMPTS - 1);
  const body = await recordWrongAttempt(rec);
  assert.equal(body.session_invalidated, true);
  assert.match(body.message, /Maximum attempts exceeded/);
  assert.deepEqual(rec.updates, [
    { attempt_count: MAX_ATTEMPTS, session_invalidated: true },
  ]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sigla-backend && npm test`
Expected: FAIL with `Cannot find module '../src/utils/verificationCodes.js'`.

- [ ] **Step 3: Implement the helper**

Create `sigla-backend/src/utils/verificationCodes.js`:

```js
const { Op } = require("sequelize");
const { EmailVerification } = require("../models/index.js");

// Shared by password reset (authController) and email change (emailController).
// Both issue and check codes identically; only `type` and who owns the code
// differ. Each flow used to carry its own copy, and the two attempt limits were
// a named constant in one file and a bare 5 in the other.
const CODE_TTL_MS = 5 * 60 * 1000;    // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute
const MAX_ATTEMPTS = 5;

const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const getLatestVerification = (email, type) =>
  EmailVerification.findOne({
    where: {
      email,
      type,
      is_used: false,
      session_invalidated: false,
      expires_at: { [Op.gt]: new Date() },
    },
    order: [["created_at", "DESC"]],
  });

// { cooldown: true } when a code for this email+type went out within the last
// minute. Otherwise invalidates every earlier unused code and stores a fresh
// one, returning { code } for the caller to send.
const issueVerificationCode = async ({ email, type, administratorId }) => {
  const recent = await EmailVerification.findOne({
    where: {
      email,
      type,
      last_sent_at: { [Op.gt]: new Date(Date.now() - RESEND_COOLDOWN_MS) },
    },
    order: [["created_at", "DESC"]],
  });
  if (recent) return { cooldown: true };

  await EmailVerification.update(
    { session_invalidated: true },
    { where: { email, type, is_used: false } },
  );

  const code = generateCode();
  await EmailVerification.create({
    administrator_id: administratorId,
    email,
    code,
    type,
    expires_at: new Date(Date.now() + CODE_TTL_MS),
    attempt_count: 0,
    session_invalidated: false,
    last_sent_at: new Date(),
  });
  return { code };
};

// Counts one wrong guess against `record` and returns the 400 response body.
// The last allowed guess invalidates the session outright.
const recordWrongAttempt = async (record) => {
  const attempts = record.attempt_count + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await record.update({ attempt_count: attempts, session_invalidated: true });
    return {
      message: "Maximum attempts exceeded. Please request a new verification code.",
      session_invalidated: true,
    };
  }
  await record.update({ attempt_count: attempts });
  return {
    message: `Incorrect code. ${MAX_ATTEMPTS - attempts} attempt(s) remaining.`,
    attempts_remaining: MAX_ATTEMPTS - attempts,
  };
};

module.exports = {
  CODE_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_ATTEMPTS,
  generateCode,
  getLatestVerification,
  issueVerificationCode,
  recordWrongAttempt,
};
```

Run `npm test` and expect all tests to pass.

- [ ] **Step 4: Use it in authController**

- Delete the local `generateCode` (with its `// ── Helper: generate 6-digit code` header) and the local `getLatestVerification` (with its header).
- Add near the other requires:

```js
const {
  getLatestVerification,
  issueVerificationCode,
  recordWrongAttempt,
} = require("../utils/verificationCodes.js");
```

- In **resendCode**, replace everything from `// Check 1-minute cooldown` through the closing `});` of `EmailVerification.create(…)` with:

```js
    const issued = await issueVerificationCode({
      email: normalizedEmail,
      type,
      administratorId: user.id,
    });
    if (issued.cooldown) {
      return res.status(429).json({
        message: "Please wait 1 minute before requesting a new code",
      });
    }
    const { code } = issued;
```

The `res.status(200)…` and `sendVerificationCode(normalizedEmail, code, type)` lines after it stay unchanged.

- In **forgotPassword**, make the same replacement, with `type: "password_reset"` (from `// Check 1-minute resend cooldown` through the end of `EmailVerification.create(…)`). Its success response and `sendVerificationCode(…, "password_reset")` stay unchanged.

- In **verifyResetCode**, replace the whole `if (record.code !== code) { … }` block with:

```js
    if (record.code !== code) {
      return res.status(400).json(await recordWrongAttempt(record));
    }
```

- Then run `git grep -n "Op\b" src/controllers/authController.js`. If `Op` is still used elsewhere in the file (it is, for the reset-grant and revoked-token queries), keep its import.

- [ ] **Step 5: Use it in emailController**

- Delete `const CODE_TTL_MS = …`, `const RESEND_COOLDOWN_MS = …`, `const MAX_ATTEMPTS = …`, the local `generateCode`, and the local `getLatestVerification`. Keep `const TYPE = "email_change";`.
- Add:

```js
const {
  getLatestVerification,
  issueVerificationCode,
  recordWrongAttempt,
} = require("../utils/verificationCodes.js");
```

- In **requestEmailCode**, replace everything from `// 1-minute resend cooldown` through the end of `EmailVerification.create(…)` with:

```js
    const issued = await issueVerificationCode({
      email: normalizedEmail,
      type: TYPE,
      administratorId: req.user.id,
    });
    if (issued.cooldown) {
      return res
        .status(429)
        .json({ message: "Please wait 1 minute before requesting a new code" });
    }
    const { code } = issued;
```

- In **verifyEmailCode**:
  - change `getLatestVerification(normalizedEmail)` to `getLatestVerification(normalizedEmail, TYPE)`
  - replace its `if (record.code !== code) { … }` block with the same two-line `recordWrongAttempt` form as in Step 4
- If `Op` is now unused in emailController, remove its import. The lint in Step 7 reports it.

- [ ] **Step 6: One ML service URL**

Create `sigla-backend/src/config/mlService.js`:

```js
// Base URL of the FastAPI ML service (training, evaluation, landmark extraction).
module.exports = {
  ML_SERVICE_URL: process.env.ML_SERVICE_URL || "http://localhost:8000",
};
```

- In `modelController.js`, replace `const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";` with `const { ML_SERVICE_URL } = require("../config/mlService.js");`.
- In `wordController.js`:
  - delete the line `  const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";` inside `extractAndStoreSample`
  - add `const { ML_SERVICE_URL } = require("../config/mlService.js");` with the other top-of-file requires

`server.js` calls `require("dotenv").config()` before requiring any controller, so reading the variable at module load sees the same value as before.

- [ ] **Step 7: Verify**

Run `npm test` (all pass) and the Task 1 Step 9 eslint command (0 errors). Then:

```bash
git grep -nE "generateCode =|getLatestVerification =|MAX_ATTEMPTS =|attempt_count \+ 1|ML_SERVICE_URL =" -- src
```

Expected: matches only in `src/utils/verificationCodes.js` and `src/config/mlService.js`.

Manual check with the backend and admin running locally:
- Forgot Password → request a code → request again immediately: expect 429.
- Enter a wrong code: expect "4 attempt(s) remaining".
- Enter the right code: expect it to proceed.
- Repeat with Administrator Account → change email.

- [ ] **Step 8: Commit**

```bash
git add sigla-backend
git commit -m "refactor(backend): share verification-code issuing and checking

Password reset and email change carried three copies of the
cooldown/invalidate/create sequence and two of the attempt counter.
Also reads ML_SERVICE_URL from one config module.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Admin — shared palette, Pagination, SortableHeader, formatter, dock sizes

**Files:**
- Create: `sigla-admin/src/utils/colors.js`, `src/utils/format.js`, `src/components/Pagination.jsx`, `src/components/SortableHeader.jsx`, `src/components/jobDock.js`
- Modify: `src/components/ClipResultsList.jsx`, `PageNav.jsx`, `TrainingJobBanner.jsx`, `UploadJobBanner.jsx`; `src/pages/activitylogs/ActivityLogs.jsx`, `administrators/ManageAdministrators.jsx`, `auth/Login.jsx`, `categories/ManageCategories.jsx`, `model/ManageModel.jsx`, `words/ManageWord.jsx`

**Interfaces:**
- Produces:
  - `export const C` (palette object) from `utils/colors.js`
  - `export const formatPercent = (val) => string` from `utils/format.js`
  - `export default Pagination({ page, totalPages, onPage, pageSize, onPageSize, total })`
  - `export default SortableHeader({ label, sortKey, sortField, sortDir, onSort })`
  - `DOCK_CARD_WIDTH`, `DOCK_CARD_HEIGHT`, `DOCK_PILL_HEIGHT`, `DOCK_Z_INDEX` from `components/jobDock.js`

Visible changes, accepted as part of consolidation:
- ManageModel's column headers take ManageAdministrators' header style (`py-3.5` and an inline hover color instead of `py-3` with a `hover:bg-gray-100` class).
- ManageAdministrators' page-size select goes from `text-xs` to `text-sm`, matching ActivityLogs.
- Pagination buttons get real aria-labels.

- [ ] **Step 1: Capture "before" screenshots**

With `npm run dev` running and the backend up, screenshot:
- Manage Administrators: table header and pagination
- Activity Logs: pagination
- Manage Model: table header
- Manage Words
- Manage Categories
- Login
- a running upload and a running training banner, if one can be started

Keep them for comparison in Step 8.

- [ ] **Step 2: Create the shared palette**

`src/utils/colors.js`:

```js
// The admin palette. Ten files each declared their own subset of this object;
// every shared key already had the same value, so one copy keeps them in step.
export const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  surface: "#ffffff",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
  muted: "#9ca3af",
  border: "#e5e7eb",
  borderLight: "#f0f0f0",
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
  orange: "#f97316",
  purple: "#7c3aed",
};
```

In each of these files, delete the local `const C = { … };` block (and a `// ── Color Palette ──` header directly above it, if present). Then add the import with the right relative path:
- `src/components/{ClipResultsList,PageNav,UploadJobBanner}.jsx`: `import { C } from "../utils/colors.js";`
- `src/pages/*/{ActivityLogs,ManageAdministrators,Login,ManageCategories,ManageModel,ManageWord}.jsx`: `import { C } from "../../utils/colors.js";`

`TrainingJobBanner.jsx` is the one file whose green differs. Replace its local `C` block with:

```js
import { C as PALETTE } from "../utils/colors.js";

// The success state here has always used the darker green-600, not the
// palette's green-500; kept so the banner looks exactly as before.
const C = { ...PALETTE, green: "#16a34a" };
```

- [ ] **Step 3: Check every used key exists**

Run from `sigla-admin`:

```bash
node -e '
const fs=require("fs");const {execSync}=require("child_process");
const pal=fs.readFileSync("src/utils/colors.js","utf8");
const keys=new Set([...pal.matchAll(/^\s+(\w+):/gm)].map(m=>m[1]));
const files=execSync("git grep -l \"\\bC\\.\" -- src").toString().trim().split("\n");
let bad=0;for(const f of files){for(const m of fs.readFileSync(f,"utf8").matchAll(/\bC\.(\w+)/g)){if(!keys.has(m[1])){console.log(f,m[1]);bad++;}}}
console.log(bad?"MISSING KEYS":"all palette keys resolve");process.exit(bad?1:0)'
```

Expected: `all palette keys resolve`.

- [ ] **Step 4: Shared Pagination and SortableHeader**

`src/components/Pagination.jsx`:

```jsx
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import { C } from "../utils/colors.js";

// The full table footer: result count, page-size picker, first/prev/next/last.
// ActivityLogs and ManageAdministrators each carried a copy. PageNav is the
// lighter Prev/Next control that sits in a table's header row.
const Pagination = ({ page, totalPages, onPage, pageSize, onPageSize, total }) => {
  const buttons = (items) =>
    items.map((b) => (
      <button
        key={b.label}
        onClick={b.action}
        disabled={b.disabled}
        aria-label={b.label}
        className="p-1.5 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition hover:bg-gray-100"
      >
        {b.icon}
      </button>
    ));

  return (
    <div
      className="data-pagination meta-text flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-gray-500"
      style={{ borderTop: `1px solid ${C.border}` }}
    >
      <div className="flex items-center gap-3">
        <span>
          {total} result{total !== 1 ? "s" : ""}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(+e.target.value)}
          className="rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
          style={{ border: `1px solid ${C.border}` }}
        >
          <option value={10}>10 / page</option>
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
      </div>
      <div className="flex items-center gap-1">
        {buttons([
          { label: "First page", icon: <ChevronsLeft size={16} />, action: () => onPage(1), disabled: page === 1 },
          { label: "Previous page", icon: <ChevronLeft size={16} />, action: () => onPage(page - 1), disabled: page === 1 },
        ])}
        <span className="px-3 font-medium" style={{ color: C.text }}>
          Page {page} of {totalPages || 1}
        </span>
        {buttons([
          { label: "Next page", icon: <ChevronRight size={16} />, action: () => onPage(page + 1), disabled: page >= totalPages },
          { label: "Last page", icon: <ChevronsRight size={16} />, action: () => onPage(totalPages), disabled: page >= totalPages },
        ])}
      </div>
    </div>
  );
};

export default Pagination;
```

`src/components/SortableHeader.jsx` is ManageAdministrators' version, verbatim, because it also supports non-sortable columns:

```jsx
import { ChevronUp, ChevronDown } from "lucide-react";
import { C } from "../utils/colors.js";

// A <th> that toggles sort on click. Pass no sortKey for a plain, unsortable
// column header with the same look.
const SortableHeader = ({ label, sortKey, sortField, sortDir, onSort }) => {
  const active = sortField === sortKey;
  return (
    <th
      className="px-5 py-3.5 select-none"
      style={{
        cursor: sortKey ? "pointer" : "default",
        transition: "background-color var(--dur-fast) var(--ease-standard)",
      }}
      onClick={() => sortKey && onSort(sortKey)}
      onMouseEnter={(e) =>
        sortKey && (e.currentTarget.style.background = "#f9fafb")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: C.muted }}
        >
          {label}
        </span>
        {sortKey &&
          (active ? (
            sortDir === "asc" ? (
              <ChevronUp size={14} style={{ color: C.primary }} />
            ) : (
              <ChevronDown size={14} style={{ color: C.primary }} />
            )
          ) : (
            <ChevronUp size={14} style={{ color: C.border }} />
          ))}
      </div>
    </th>
  );
};

export default SortableHeader;
```

Then:
- `ActivityLogs.jsx`: delete the local `const Pagination = … );` block, add `import Pagination from "../../components/Pagination.jsx";`, and drop `ChevronsLeft`, `ChevronsRight`, `ChevronLeft`, `ChevronRight` from its lucide import if lint reports them unused.
- `ManageAdministrators.jsx`: delete the local `SortableHeader` and `Pagination` blocks (and their `// ── …` headers), add `import Pagination from "../../components/Pagination.jsx";` and `import SortableHeader from "../../components/SortableHeader.jsx";`, then drop whichever Chevron imports lint reports unused.
- `ManageModel.jsx`: delete the local `SortableHeader` block and add `import SortableHeader from "../../components/SortableHeader.jsx";`. Keep `ChevronLeft`/`ChevronRight` (its inline pagination uses them) and `ChevronDown` (the row expander uses it). Drop `ChevronUp` if lint reports it unused.

- [ ] **Step 5: Shared percent formatter**

`src/utils/format.js`:

```js
// 0.8734 -> "87.3%"; null/undefined -> "—".
export const formatPercent = (val) =>
  val != null ? `${(val * 100).toFixed(1)}%` : "—";
```

- In `TrainingJobBanner.jsx`: delete `const fmt = …`, add `import { formatPercent } from "../utils/format.js";`, and rename the calls.
- In `ManageModel.jsx`: delete the inner `const fmt = …` and its `// ── Format metric ──` comment, add `import { formatPercent } from "../../utils/format.js";`, and rename the calls.

To rename, run `sed -i 's/\bfmt(/formatPercent(/g' <file>` on each file. Before running it, confirm `git grep -n "fmt(" -- <file>` shows only those call sites.

- [ ] **Step 6: Shared dock sizes for the two job banners**

`src/components/jobDock.js`:

```js
// UploadJobBanner and TrainingJobBanner are both position: fixed to the same
// bottom-right corner and stack in one dock, so they share one footprint. These
// were hand-copied into both files with a "kept in sync" comment.
export const DOCK_CARD_WIDTH = 360;
export const DOCK_CARD_HEIGHT = 92;
// Height of TrainingJobBanner's minimized pill.
export const DOCK_PILL_HEIGHT = 40;
// Above the mobile topbar (900), under the drawer (1040+), modals (1100) and toasts (2100).
export const DOCK_Z_INDEX = 1000;
```

In `UploadJobBanner.jsx`:
- delete `STACK_Z_INDEX`, `CARD_WIDTH`, `CARD_HEIGHT`, `TRAINING_CARD_HEIGHT` and `TRAINING_PILL_HEIGHT`, together with the comment paragraph "Fixed heights of TrainingJobBanner's own card…"
- keep `MAX_VISIBLE_CARDS`, the `PANEL_*` constants and `DOCK_GAP`, plus their comments
- import `{ DOCK_CARD_WIDTH, DOCK_CARD_HEIGHT, DOCK_PILL_HEIGHT, DOCK_Z_INDEX }` from `./jobDock.js`
- rename the uses: `STACK_Z_INDEX`→`DOCK_Z_INDEX`, `CARD_WIDTH`→`DOCK_CARD_WIDTH`, `CARD_HEIGHT`→`DOCK_CARD_HEIGHT`, `TRAINING_CARD_HEIGHT`→`DOCK_CARD_HEIGHT`, `TRAINING_PILL_HEIGHT`→`DOCK_PILL_HEIGHT`

In `TrainingJobBanner.jsx`:
- delete `CARD_WIDTH`, `CARD_HEIGHT`, `STACK_Z_INDEX` and their comment
- import `{ DOCK_CARD_WIDTH, DOCK_CARD_HEIGHT, DOCK_PILL_HEIGHT, DOCK_Z_INDEX }` from `./jobDock.js`
- rename the uses
- change the pill's `height: "40px",` to `` height: `${DOCK_PILL_HEIGHT}px`, ``

- [ ] **Step 7: Verify statically**

```bash
npm run lint 2>&1 | tail -3
npm run build 2>&1 | tail -3
git grep -nE "^const (C|Pagination|SortableHeader|fmt) = |const fmt = |CARD_WIDTH = |STACK_Z_INDEX = |TRAINING_CARD_HEIGHT" -- src
```

Expected:
- lint: 8 errors (same as after Task 3) and no new warnings about unused imports.
- build: succeeds.
- grep: only `const C = { ...PALETTE, green: "#16a34a" };` in `TrainingJobBanner.jsx`.

- [ ] **Step 8: Verify visually**

With `npm run dev`, repeat Step 1's screenshots and compare. The only differences should be the three listed under "Visible changes" above. Also check:
- sorting on every sortable column in Manage Administrators and Manage Model
- paging (first, previous, next, last, and page size) in Manage Administrators and Activity Logs
- the training banner's success green
- the upload stack sitting above the training card and above the minimized pill

- [ ] **Step 9: Commit**

```bash
git add sigla-admin/src
git commit -m "refactor(admin): share palette, Pagination, SortableHeader and dock sizes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Mobile — shared word search, word-bank refresh, detail launcher, speech player

**Files:**
- Create: `sigla-mobile/app/src/main/kotlin/com/example/sigla/WordSearch.kt`
- Create: `…/WordBankRefresh.kt`
- Create: `…/SpeechPlayer.kt`
- Create: `sigla-mobile/app/src/test/kotlin/com/example/sigla/WordSearchTest.kt`
- Create: `…/test/…/WordBankRefreshTest.kt`
- Modify: `CategoryWordListActivity.kt`, `WordBankActivity.kt`, `MainActivity.kt`, `WordDetailActivity.kt`

**Interfaces:**
- Produces:
  - `fun WordBankWord.matchesSearch(query: String): Boolean`
  - `sealed interface WordBankRefresh { data class Updated(val words: List<WordBankWord>); data object Unchanged; data object ServerError; data object NetworkError }`
  - `internal fun classifyWordBankResponse(successful: Boolean, fresh: List<WordBankWord>?, current: List<WordBankWord>): WordBankRefresh`
  - `suspend fun refreshWordBank(context: Context, current: List<WordBankWord>): WordBankRefresh`
  - `WordDetailActivity.start(context: Context, wordId: Int)`
  - `class SpeechPlayer(context: Context, appSettings: AppSettings, scope: CoroutineScope)` with `speak(text: String, queueUntilReady: Boolean = false)` and `release()`

- [ ] **Step 1: Write the failing tests**

`app/src/test/kotlin/com/example/sigla/WordSearchTest.kt`:

```kotlin
package com.example.sigla

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WordSearchTest {

    private val word = WordBankWord(
        id = 1,
        label = "Good Morning",
        description = "Greeting used before noon",
        filipino_translation = "Magandang umaga",
    )

    @Test
    fun emptyQueryMatchesEverything() {
        assertTrue(word.matchesSearch(""))
    }

    @Test
    fun matchesLabelTranslationAndDescriptionIgnoringCase() {
        assertTrue(word.matchesSearch("good"))
        assertTrue(word.matchesSearch("MAGANDANG"))
        assertTrue(word.matchesSearch("noon"))
    }

    @Test
    fun missingOptionalFieldsDoNotMatchOrCrash() {
        val bare = WordBankWord(id = 2, label = "Hello")
        assertFalse(bare.matchesSearch("umaga"))
        assertTrue(bare.matchesSearch("hell"))
    }

    @Test
    fun blankButNotEmptyQueryIsASearchForSpace() {
        // Matches the old inline filters, which tested isEmpty(), not isBlank().
        assertTrue(word.matchesSearch(" "))
        assertFalse(WordBankWord(id = 3, label = "Hi").matchesSearch(" "))
    }
}
```

`app/src/test/kotlin/com/example/sigla/WordBankRefreshTest.kt`:

```kotlin
package com.example.sigla

import org.junit.Assert.assertEquals
import org.junit.Test

class WordBankRefreshTest {

    private val a = WordBankWord(id = 1, label = "A")
    private val b = WordBankWord(id = 2, label = "B")

    @Test
    fun unsuccessfulResponseIsAServerError() {
        assertEquals(WordBankRefresh.ServerError, classifyWordBankResponse(false, listOf(a), emptyList()))
    }

    @Test
    fun emptyOrMissingBodyLeavesTheCurrentListAlone() {
        assertEquals(WordBankRefresh.Unchanged, classifyWordBankResponse(true, null, listOf(a)))
        assertEquals(WordBankRefresh.Unchanged, classifyWordBankResponse(true, emptyList(), listOf(a)))
    }

    @Test
    fun identicalListIsUnchanged() {
        assertEquals(WordBankRefresh.Unchanged, classifyWordBankResponse(true, listOf(a, b), listOf(a, b)))
    }

    @Test
    fun differentListIsAnUpdate() {
        assertEquals(
            WordBankRefresh.Updated(listOf(a, b)),
            classifyWordBankResponse(true, listOf(a, b), listOf(a)),
        )
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sigla-mobile && ./gradlew testDebugUnitTest --tests "*WordSearchTest" --tests "*WordBankRefreshTest" --console=plain -q`
Expected: compilation FAILS with `Unresolved reference: matchesSearch` / `classifyWordBankResponse`.

- [ ] **Step 3: Implement**

`WordSearch.kt`:

```kotlin
package com.example.sigla

/**
 * The search every word list uses: English label, Filipino translation, or
 * description, ignoring case. An empty query matches everything.
 */
fun WordBankWord.matchesSearch(query: String): Boolean =
    query.isEmpty() ||
        label.contains(query, ignoreCase = true) ||
        filipino_translation?.contains(query, ignoreCase = true) == true ||
        description?.contains(query, ignoreCase = true) == true
```

`WordBankRefresh.kt`:

```kotlin
package com.example.sigla

import android.content.Context

/** Outcome of asking the backend for the word bank. */
sealed interface WordBankRefresh {
    /** A non-empty list that differs from what the screen holds; already cached. */
    data class Updated(val words: List<WordBankWord>) : WordBankRefresh
    /** Same list, or an empty body: keep what is on screen. */
    data object Unchanged : WordBankRefresh
    data object ServerError : WordBankRefresh
    data object NetworkError : WordBankRefresh
}

internal fun classifyWordBankResponse(
    successful: Boolean,
    fresh: List<WordBankWord>?,
    current: List<WordBankWord>,
): WordBankRefresh = when {
    !successful -> WordBankRefresh.ServerError
    fresh.isNullOrEmpty() || fresh == current -> WordBankRefresh.Unchanged
    else -> WordBankRefresh.Updated(fresh)
}

/**
 * Fetches the word bank and caches it when it changed. Each screen used to
 * repeat this fetch-compare-cache sequence; what a screen does with each
 * outcome (toasts, spinners, grids) stays with the screen.
 */
suspend fun refreshWordBank(context: Context, current: List<WordBankWord>): WordBankRefresh {
    val result = try {
        val response = ApiClient.get().getWordBank()
        classifyWordBankResponse(response.isSuccessful, response.body()?.words, current)
    } catch (e: Exception) {
        return WordBankRefresh.NetworkError
    }
    if (result is WordBankRefresh.Updated) ModelUpdateManager.cacheWordBank(context, result.words)
    return result
}
```

Run the Step 2 command again and expect PASS.

- [ ] **Step 4: Adopt them in the word lists**

**CategoryWordListActivity.kt**
- In `applyFilters`, change `val filtered = categoryWords.filter { word -> … }` (the 4-line search condition) to `val filtered = categoryWords.filter { it.matchesSearch(searchQuery) }`.
- In `loadWords`, replace the `try { val response = … } catch (e: Exception) { … } finally { … }` with the block below. The `finally` body is unchanged.

```kotlin
            try {
                when (val refresh = refreshWordBank(this@CategoryWordListActivity, allWords)) {
                    is WordBankRefresh.Updated -> {
                        allWords = refresh.words
                        hideSpinner()
                        onWordsUpdated()
                    }
                    WordBankRefresh.ServerError -> if (allWords.isEmpty()) {
                        Toast.makeText(this@CategoryWordListActivity, "Failed to load words", Toast.LENGTH_SHORT).show()
                    }
                    WordBankRefresh.NetworkError -> if (allWords.isEmpty()) {
                        Toast.makeText(this@CategoryWordListActivity, "Network error. Using cached data if available.", Toast.LENGTH_LONG).show()
                    }
                    WordBankRefresh.Unchanged -> Unit
                }
            } finally {
                isLoading = false
                hideSpinner()
                // Settles the empty state now that "still loading" no longer holds it back.
                applyFilters()
            }
```

- Replace the `openWordDetail` body with `WordDetailActivity.start(this, word.id)`.

**WordBankActivity.kt**
- In `applyFilters`, change `val matchesSearch = searchQuery.isEmpty() || … description …` to `val matchesSearch = word.matchesSearch(searchQuery)`.
- In `loadWords`, replace the `try`/`catch` portion. Note `ServerError` toasts unconditionally here, as before.

```kotlin
            try {
                when (val refresh = refreshWordBank(this@WordBankActivity, allWords)) {
                    is WordBankRefresh.Updated -> {
                        allWords = refresh.words
                        hideSpinner()
                        applyFilters()
                        refreshCategoryGrid()
                        refreshDownloadAllEnabled()
                        launch { ModelUpdateManager.downloadWordBankImages(this@WordBankActivity, refresh.words) }
                    }
                    WordBankRefresh.ServerError ->
                        Toast.makeText(this@WordBankActivity, "Failed to load words", Toast.LENGTH_SHORT).show()
                    WordBankRefresh.NetworkError -> if (allWords.isEmpty()) {
                        Toast.makeText(this@WordBankActivity, "Network error. Using cached data if available.", Toast.LENGTH_LONG).show()
                    }
                    WordBankRefresh.Unchanged -> Unit
                }
            } finally {
```

  The `finally` body that follows is unchanged.
- Replace the `openWordDetail` body with `WordDetailActivity.start(this, word.id)`.

**MainActivity.kt** (translation map refresh, around `val words: List<WordBankWord> = try {`). Replace the `try { … } catch (e: Exception) { … }` expression with:

```kotlin
        val words: List<WordBankWord> =
            when (val refresh = refreshWordBank(this@MainActivity, emptyList())) {
                is WordBankRefresh.Updated -> refresh.words
                else -> {
                    // Offline, server down or empty: whatever was cached is still better than nothing.
                    if (refresh == WordBankRefresh.NetworkError) Log.w(TAG, "Word bank fetch failed, using cache")
                    ModelUpdateManager.loadCachedWordBank(this@MainActivity) ?: emptyList()
                }
            }
```

Passing `emptyList()` as `current` keeps the old rule that any non-empty fresh list is used and cached. Keep the existing comment block above it.

**WordDetailActivity.kt**: add to the `companion object`, after `EXTRA_WORD_ID`:

```kotlin
        fun start(context: Context, wordId: Int) {
            context.startActivity(
                Intent(context, WordDetailActivity::class.java).putExtra(EXTRA_WORD_ID, wordId)
            )
        }
```

Add `import android.content.Context` and `import android.content.Intent` if they are not already present. Remove `import android.content.Intent` from CategoryWordListActivity and WordBankActivity only if the compiler reports it unused.

- [ ] **Step 5: Implement SpeechPlayer**

`SpeechPlayer.kt`:

```kotlin
package com.example.sigla

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.concurrent.Executors

// One serial lane for every voice change and utterance, so a speak() can never
// overtake the voice change queued just before it. Daemon: it must not hold the
// process open.
private val speechLane = Executors.newSingleThreadExecutor { r ->
    Thread(r, "sigla-tts").apply { isDaemon = true }
}.asCoroutineDispatcher()

/**
 * The app's text-to-speech: English, the user's preferred voice and volume.
 * MainActivity and WordDetailActivity each built and tore this down by hand.
 *
 * The voice is applied before every utterance. After the first call this is
 * TtsVoiceHelper's cached fast path, and it means a voice changed in Settings
 * takes effect on the next utterance on either screen.
 */
class SpeechPlayer(
    context: Context,
    private val appSettings: AppSettings,
    private val scope: CoroutineScope,
) {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var pending: String? = null

    init {
        // applicationContext: release() shuts the engine down off the main thread,
        // so the unbind can land after the Activity is gone. Bound through the
        // Activity, that would leak its ServiceConnection.
        tts = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.ENGLISH
                ready = true
                pending?.let { speak(it) }
                pending = null
            }
        }
    }

    /**
     * Speaks [text]. Before the engine is ready it is dropped, or held and spoken
     * once ready when [queueUntilReady] (only the latest held text survives).
     */
    fun speak(text: String, queueUntilReady: Boolean = false) {
        if (!ready) {
            if (queueUntilReady) pending = text
            return
        }
        val engine = tts ?: return
        val params = Bundle().apply {
            putFloat(
                TextToSpeech.Engine.KEY_PARAM_VOLUME,
                (appSettings.volume / 100f).coerceIn(0f, 1f),
            )
        }
        // Resolving the voice can block on a query into the TTS engine process
        // (cached after the first time), so it must not run on the main thread.
        scope.launch(speechLane) {
            TtsVoiceHelper.applyPreferredVoice(engine, appSettings)
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, null)
        }
    }

    /**
     * shutdown() blocks until the engine connection started in the constructor
     * has finished binding, so leaving right after entering stalled the main
     * thread for 0.6-1.25 s. Shut down on teardownExecutor instead.
     */
    fun release() {
        val doomed = tts
        tts = null
        ready = false
        pending = null
        if (doomed != null) teardownExecutor.execute { doomed.shutdown() }
    }
}
```

**MainActivity.kt**
- Replace `private var tts: TextToSpeech? = null` and `private var isTtsReady = false` with `private var speech: SpeechPlayer? = null`.
- Replace the body of `initTts()` with `speech = SpeechPlayer(this, appSettings, lifecycleScope)`, keeping no comment (the applicationContext note now lives in SpeechPlayer).
- Replace the whole `private fun speak(text: String) { … }` with `private fun speak(text: String) { speech?.speak(text) }`.
- In `onDestroy`, replace the `val doomedTts = tts … }` block and its comment with `speech?.release()` and `speech = null`.
- Remove the now-unused `import android.speech.tts.TextToSpeech` and, if the compiler flags them, `Bundle`/`Locale`.

**WordDetailActivity.kt**
- Replace `tts`, `isTtsReady` and `pendingSpeech` with `private var speech: SpeechPlayer? = null`.
- Replace the `tts = TextToSpeech(applicationContext) { … }` block and its comment in `onCreate` with `speech = SpeechPlayer(this, appSettings, lifecycleScope)`.
- Replace the whole `private fun speakWord(label: String) { … }` with `private fun speakWord(label: String) { speech?.speak(label, queueUntilReady = true) }`.
- In `onDestroy`, replace the `val doomedTts = tts … }` block and its comment with `speech?.release()` and `speech = null`.
- Remove the now-unused imports.

- [ ] **Step 6: Verify**

```bash
cd sigla-mobile && ./gradlew testDebugUnitTest assembleRelease --console=plain -q
git grep -nE "TextToSpeech\(|isTtsReady|pendingSpeech|word\.label\.contains\(searchQuery|getWordBank\(\)" -- app/src/main
```

Expected:
- Gradle: BUILD SUCCESSFUL, 132 tests (124 + 8 new), 0 failures.
- grep: `TextToSpeech(` only in `SpeechPlayer.kt`; `getWordBank()` only in `ApiService.kt`, `WordBankRefresh.kt` and `WordDetailActivity.kt` (its find-by-id fallback is intentionally separate). The other patterns produce no output.

Then run `cd ../sigla-ml && venv/Scripts/python.exe -m pytest -q` and expect 93 passed. MainActivity is read by the parity test.

- [ ] **Step 7: Device check (Review Focus 4)**

Install the release APK and check:
1. Translator: sign a word and hear it spoken. Tap the "Help me" action and hear it.
2. Settings → switch the voice (male/female) → back to Translator → sign: the voice has changed.
3. Words → open a word: it speaks the label once the engine is ready, including on a cold app start. Tap the speak button: it speaks again. Change the voice in Settings, reopen a word: the new voice is used.
4. Words search: type part of a Filipino translation, and the word is found. Do the same inside a category.
5. Turn on airplane mode, then reopen Words: the cached list shows. On a cold start with no cache, the network-error toast shows.

- [ ] **Step 8: Commit**

```bash
git add sigla-mobile/app/src
git commit -m "refactor(mobile): share word search, word-bank refresh and speech

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: ML scripts — share the backend-import client and sample keys

**Files:**
- Create: `sigla-ml/scripts/_backend_import.py`
- Create: `sigla-ml/tools/_sample_keys.py`
- Create: `sigla-ml/tests/test_backend_import.py`, `sigla-ml/tests/test_sample_keys.py`
- Modify: `sigla-ml/scripts/import_words.py`, `sigla-ml/scripts/import_alphabets.py`
- Modify: `sigla-ml/tools/audit_duplicates.py`, `sigla-ml/tools/dedupe_samples.py`, `sigla-ml/tools/import_fsl105.py`

**Interfaces:**
- Produces:
  - `class BackendImporter(backend_url: str, admin_token: str, *, job_timeout_seconds: int, upload_timeout_seconds: float, job_poll_seconds: float = 5)`, with methods `headers() -> dict`, `find_or_create_word(client, payload: dict) -> int`, `stored_per_signer(client, word_id) -> dict[str, int]`, `wait_for_job(client, job_id, label, signer) -> dict`, `upload_batch(client, word_id, label, signer, clips) -> dict`
  - `MAX_FILES_PER_BATCH = 50`
  - From `tools/_sample_keys.py`: `class_key(label: str) -> str` and `sequence_hash(sequence) -> str`

`import_words.py` and `import_alphabets.py` stay two scripts. Their docstrings explain the on-disk layouts differ ("hence two scripts"), so `discover` and the word payloads stay per-script. Only the HTTP protocol is shared. That protocol is the batching rule from the upload-videos memory: one request per (word, signer), and wait for the job to drain before the next.

- [ ] **Step 1: Write the failing tests**

`sigla-ml/tests/test_sample_keys.py`:

```python
import numpy as np

from tools._sample_keys import class_key, sequence_hash


def test_class_key_folds_curly_apostrophes_and_case():
    assert class_key("  don’t know ") == "DON'T KNOW"
    assert class_key("Don't Know") == "DON'T KNOW"


def test_sequence_hash_ignores_json_formatting_differences():
    a = [[0.1, 0.25], [1.0, 0.0]]
    b = np.array([[0.10, 0.250], [1, 0]], dtype=np.float64)
    assert sequence_hash(a) == sequence_hash(b)
    assert sequence_hash(a) != sequence_hash([[0.1, 0.25], [1.0, 0.5]])
```

`sigla-ml/tests/test_backend_import.py`:

```python
import httpx
import pytest

from scripts._backend_import import BackendImporter

BASE = "http://backend.test/api"


def _importer():
    return BackendImporter(BASE, "tok", job_timeout_seconds=5,
                           upload_timeout_seconds=5, job_poll_seconds=0)


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_find_or_create_word_reuses_the_id_from_a_409():
    def handler(req):
        assert req.headers["Authorization"] == "Bearer tok"
        return httpx.Response(409, json={"word_id": 42})
    with _client(handler) as c:
        assert _importer().find_or_create_word(c, {"label": "HELLO"}) == 42


def test_stored_per_signer_counts_each_session():
    rows = [{"session_id": "s1"}, {"session_id": "s1"}, {"session_id": "s2"}]
    with _client(lambda req: httpx.Response(200, json={"samples": rows})) as c:
        assert _importer().stored_per_signer(c, 7) == {"s1": 2, "s2": 1}


def test_wait_for_job_survives_a_dropped_poll_then_returns_the_final_row():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("dropped")
        if calls["n"] == 2:
            return httpx.Response(200, json={"job": {"status": "processing"}})
        return httpx.Response(200, json={"job": {"status": "completed", "id": 9}})

    with _client(handler) as c:
        assert _importer().wait_for_job(c, 9, "HELLO", "s1")["status"] == "completed"


def test_upload_batch_sends_one_request_with_the_signer_and_waits(tmp_path):
    clip = tmp_path / "a.mov"
    clip.write_bytes(b"x")
    seen = []

    def handler(req):
        seen.append((req.method, req.url.path))
        if req.url.path.endswith("/upload-jobs/active"):
            return httpx.Response(200, json={"job": None})
        if req.url.path.endswith("/upload-videos"):
            assert b'name="session_id"' in req.content and b"s1" in req.content
            return httpx.Response(202, json={"job": {"id": 3}})
        return httpx.Response(200, json={"job": {"status": "completed", "id": 3}})

    with _client(handler) as c:
        result = _importer().upload_batch(c, 7, "HELLO", "s1", [str(clip)])
    assert result["status"] == "completed"
    assert [m for m, _ in seen].count("POST") == 1


def test_upload_batch_refuses_more_than_the_server_cap(tmp_path):
    with _client(lambda req: httpx.Response(200, json={"job": None})) as c:
        with pytest.raises(SystemExit):
            _importer().upload_batch(c, 7, "HELLO", "s1", ["x"] * 51)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sigla-ml && venv/Scripts/python.exe -m pytest tests/test_sample_keys.py tests/test_backend_import.py -q`
Expected: FAIL with `ModuleNotFoundError` for `tools._sample_keys` and `scripts._backend_import`.

- [ ] **Step 3: Implement `tools/_sample_keys.py`**

```python
"""Keys shared by the dataset audit and dedupe tools."""
import hashlib

import numpy as np


def class_key(label: str) -> str:
    """Curly and straight apostrophes both occur in the word list."""
    return label.replace("’", "'").strip().upper()


def sequence_hash(sequence) -> str:
    """
    Stable content hash of one 30x147 sequence.

    float32 because that is the dtype training uses -- hashing the raw JSON text
    would make formatting differences (trailing zeros, exponent form) look like
    different data.
    """
    return hashlib.sha1(
        np.asarray(sequence, dtype=np.float32).tobytes()
    ).hexdigest()
```

In `tools/audit_duplicates.py` and `tools/dedupe_samples.py`:
- delete the local `normalize_label` and `sequence_hash`
- after the existing `sys.path.insert(...)` line, add `from tools._sample_keys import class_key, sequence_hash  # noqa: E402`
- rename the `normalize_label(` call sites to `class_key(` with `sed -i 's/\bnormalize_label(/class_key(/g'`
- remove `import hashlib` if nothing else in the file uses it

In `tools/import_fsl105.py`, rename its own `normalize_label` (both the definition and its four call sites) to `backend_label_key`. It deliberately mirrors the backend's lowercase normalizeLabel, which is a different rule from `class_key`; giving the two the same name invited swapping them.

- [ ] **Step 4: Implement `scripts/_backend_import.py`**

Move the shared functions into a class. The bodies are the existing ones from `import_words.py`, with `BACKEND_URL`, `_headers()`, `JOB_TIMEOUT_SECONDS`, `JOB_POLL_SECONDS` and the upload timeout taken from `self`:

```python
"""
HTTP protocol shared by scripts/import_words.py and scripts/import_alphabets.py.

POST /words/:id/upload-videos answers 202 and extracts in the BACKGROUND,
refusing a second concurrent batch for the same word with 409. So: one request
per (word, signer) with every clip in it, then wait for that job to leave
'processing' before the next batch for the same word. A per-clip loop gets 409
on everything after the first and loses it silently.
"""
from __future__ import annotations

import os
import sys
import time

import httpx

# The server caps a batch here (multer's videoUpload.array("videos", 50)).
MAX_FILES_PER_BATCH = 50


class BackendImporter:
    def __init__(self, backend_url: str, admin_token: str, *,
                 job_timeout_seconds: int, upload_timeout_seconds: float,
                 job_poll_seconds: float = 5):
        self.backend_url = backend_url
        self.admin_token = admin_token
        self.job_timeout_seconds = job_timeout_seconds
        self.upload_timeout_seconds = upload_timeout_seconds
        self.job_poll_seconds = job_poll_seconds

    def headers(self) -> dict:
        if not self.admin_token:
            sys.exit("ADMIN_TOKEN is not set — needs a JWT for an admin user.")
        return {"Authorization": f"Bearer {self.admin_token}"}

    def find_or_create_word(self, client: httpx.Client, payload: dict) -> int:
        """Word id for payload["label"], creating it if the backend has none.

        adminAddWord answers 409 with the existing word_id when the label is
        taken, so a re-run reuses the word instead of duplicating it.
        """
        label = payload["label"]
        r = client.post(f"{self.backend_url}/words/admin-add",
                        headers=self.headers(), json=payload, timeout=30.0)
        if r.status_code in (200, 201):
            body = r.json()
            wid = body.get("word", {}).get("id") or body.get("id") or body.get("word_id")
            if wid is None:
                sys.exit(f"created {label} but could not find its id in {body}")
            return int(wid)
        if r.status_code == 409:
            wid = r.json().get("word_id")
            if wid is None:
                sys.exit(f"{label} exists but the 409 body carried no word_id: {r.text}")
            return int(wid)
        sys.exit(f"creating word {label} failed: {r.status_code} {r.text}")

    def stored_per_signer(self, client: httpx.Client, word_id: int) -> dict[str, int]:
        """How many samples each session_id already has stored for this word.

        Counts rather than presence: an interrupted batch leaves a PARTIAL one,
        and treating "signer appears at all" as done would abandon the rest.
        """
        r = client.get(f"{self.backend_url}/words/{word_id}/samples",
                       headers=self.headers(), timeout=120.0)
        if r.status_code != 200:
            return {}
        body = r.json()
        rows = body.get("samples", body if isinstance(body, list) else [])
        counts: dict[str, int] = {}
        for s in rows:
            if isinstance(s, dict):
                sid = s.get("session_id")
                counts[sid] = counts.get(sid, 0) + 1
        return counts

    def wait_for_job(self, client: httpx.Client, job_id: int, label: str, signer: str) -> dict:
        """Block until a job leaves 'processing'; returns the final job row."""
        deadline = time.time() + self.job_timeout_seconds
        while time.time() < deadline:
            time.sleep(self.job_poll_seconds)
            # A dropped connection is not a failed import. The job runs on the
            # SERVER, detached from this request, so losing the socket only costs
            # the status update. Letting the transport error propagate once killed
            # a whole run on its first batch while the backend finished it alone.
            try:
                r = client.get(f"{self.backend_url}/words/upload-jobs/{job_id}",
                               headers=self.headers(), timeout=30.0)
            except httpx.HTTPError as e:
                print(f"    poll dropped ({type(e).__name__}); retrying")
                continue
            if r.status_code != 200:
                print(f"    poll failed ({r.status_code}); retrying")
                continue
            job = r.json().get("job", r.json())
            status = job.get("status")
            if status and status != "processing":
                return job
            done = job.get("processed_count") or job.get("success_count") or 0
            total = job.get("total_count") or "?"
            print(f"    {label}/{signer}: {done}/{total} …", end="\r", flush=True)
        return {"status": "timeout", "job_id": job_id}

    def upload_batch(self, client: httpx.Client, word_id: int, label: str,
                     signer: str, clips: list[str]) -> dict:
        """One (word, signer) batch, then wait for its job to finish.

        Waits out any job already live for this word first: an interrupted
        earlier run, or an upload started in the admin UI, leaves one that must
        finish before the word accepts more.
        """
        live = client.get(f"{self.backend_url}/words/{word_id}/upload-jobs/active",
                          headers=self.headers(), timeout=30.0)
        if live.status_code == 200:
            job = (live.json() or {}).get("job")
            if job and job.get("status") == "processing":
                print(f"    a job is already live for {label}; waiting for it")
                self.wait_for_job(client, job["id"], label, job.get("session_id", "?"))

        if len(clips) > MAX_FILES_PER_BATCH:
            sys.exit(f"{label}/{signer} has {len(clips)} clips; the server caps a "
                     f"batch at {MAX_FILES_PER_BATCH}")

        files = []
        handles = []
        try:
            for p in clips:
                fh = open(p, "rb")
                handles.append(fh)
                files.append(("videos", (os.path.basename(p), fh, "video/quicktime")))
            try:
                r = client.post(
                    f"{self.backend_url}/words/{word_id}/upload-videos",
                    headers=self.headers(),
                    data={"session_id": signer},
                    files=files,
                    timeout=self.upload_timeout_seconds,
                )
            except httpx.HTTPError as e:
                # Deliberately NOT retried. The server may already have accepted
                # the batch, so re-POSTing risks a second job for the same clips.
                # Re-running picks up from the live job instead.
                return {"status": "transport-error", "detail": f"{type(e).__name__}: {e}"}
        finally:
            for fh in handles:
                fh.close()

        if r.status_code == 409:
            # Someone else's batch is live for this word — not recoverable here,
            # and continuing would interleave two jobs on the same counters.
            return {"status": "conflict", "detail": r.json()}
        if r.status_code != 202:
            return {"status": "error", "code": r.status_code, "detail": r.text[:300]}

        job = r.json().get("job", {})
        job_id = job.get("id")
        if job_id is None:
            return {"status": "error", "detail": f"202 without a job id: {r.text[:200]}"}
        return self.wait_for_job(client, job_id, label, signer)
```

Note for `test_upload_batch_refuses_more_than_the_server_cap`: the cap check runs before any file is opened, so the fake `"x"` paths are never read.

Run the Step 2 command again and expect PASS.

- [ ] **Step 5: Point both scripts at the shared client**

In `scripts/import_words.py`:
- delete `MAX_FILES_PER_BATCH`, `JOB_POLL_SECONDS` and the functions `_headers`, `find_or_create_word`, `stored_per_signer`, `wait_for_job`, `upload_batch`
- keep `JOB_TIMEOUT_SECONDS`, `read_labels`, `discover`, `main`
- add after the constants:

```python
from _backend_import import BackendImporter  # noqa: E402  (scripts/ is on sys.path when run directly)

IMPORTER = BackendImporter(BACKEND_URL, ADMIN_TOKEN,
                           job_timeout_seconds=JOB_TIMEOUT_SECONDS,
                           upload_timeout_seconds=600.0)
```

- in `main`, change the calls:
  - `find_or_create_word(client, label, c["category"])` → `IMPORTER.find_or_create_word(client, {"label": label, "sign_type": "FSL", "category": c["category"], "description": f"FSL sign for {label}"})`
  - `stored_per_signer(` → `IMPORTER.stored_per_signer(`
  - `upload_batch(` → `IMPORTER.upload_batch(`
  - `_headers()` (if `main` calls it directly) → `IMPORTER.headers()`
- move the deleted `find_or_create_word` docstring's vocabulary note ("vocabulary is left to default ("words")…") to a comment above that call

In `scripts/import_alphabets.py`, make the same deletions and the same `IMPORTER` block with `upload_timeout_seconds=300.0` (its existing value). Its call becomes:

```python
            # vocabulary "letters" is stated explicitly rather than inferred from
            # the label: FSL's NG is one letter spelled with two characters, so no
            # spelling rule can classify the alphabet correctly on its own.
            word_id = IMPORTER.find_or_create_word(client, {
                "label": letter,
                "sign_type": "FSL",
                "category": CATEGORY,
                "description": f"FSL fingerspelling letter {letter}",
                "vocabulary": "letters",
            })
```

Before deleting `find_or_create_word` from the alphabet script, read its body: if its `json=` payload has any key not listed above, add it to this dict.

- [ ] **Step 6: Verify**

```bash
cd sigla-ml && venv/Scripts/python.exe -m pytest -q
venv/Scripts/python.exe scripts/import_words.py --all --dry-run
venv/Scripts/python.exe scripts/import_alphabets.py --help
venv/Scripts/python.exe tools/audit_duplicates.py --help
venv/Scripts/python.exe tools/dedupe_samples.py --help
git grep -nE "def (normalize_label|sequence_hash|_headers|wait_for_job|upload_batch|stored_per_signer|find_or_create_word)" -- scripts tools
```

Expected:
- pytest: 100 passed (93 + 7).
- The dry run lists classes and batches without sending a write. It needs the `datasets/` folder; if that is absent, expect its "not found" exit, which still proves the module imports.
- `--help` prints usage for each tool.
- grep: matches only in `scripts/_backend_import.py` (as methods) and `tools/_sample_keys.py`.

Finally, before relying on it for a real import, run one small real batch with `--labels HELLO` against the local backend. Then confirm the stored row count in Supabase (per the upload-videos memory: a 202 is not proof of storage).

- [ ] **Step 7: Commit**

```bash
git add sigla-ml
git commit -m "refactor(ml): share the backend import client and sample keys

import_words and import_alphabets keep their own discovery; the
upload/wait protocol now lives once, with MockTransport tests. The
FSL-105 importer's backend-mirroring label key is renamed so it can't
be confused with the uppercase class key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Wrap-up

- [ ] Run every suite one last time from a clean tree:
  - `cd sigla-backend && npm test`
  - `cd sigla-admin && npm run lint; npm run build`
  - `cd sigla-ml && venv/Scripts/python.exe -m pytest -q`
  - `cd sigla-mobile && ./gradlew testDebugUnitTest assembleRelease`

  Expected: backend 13 tests pass. Admin lint shows 8 errors (all pre-existing) and the build succeeds. ML shows 100 passed. Mobile shows 132 tests and BUILD SUCCESSFUL.
- [ ] Deploy order:
  1. Backend (Hostinger): `npm ci`, since dependencies changed.
  2. ML service.
  3. Admin build.

  None of the removed endpoints has a live caller, so the order is not load-bearing. Shipping the mobile changes needs a version bump per the release memory; there is no rush, because the mobile changes are internal only.
- [ ] Use superpowers:finishing-a-development-branch to merge or open a PR.

## Explicitly not doing (and why)

- **Merging `UploadJobsContext` and `TrainingJobContext`.** Both poll, but over different job models, timeouts and adoption rules. A shared hook would be more abstract than either use.
- **Admin ↔ backend validation mirrors** (`emailValidation.js`, `credentialValidation.js` against `validators.js`). They run in different runtimes; sharing would need a build-time package.
- **Kotlin ↔ Python extraction mirrors.** Intentional and parity-tested.
- **`ManageModel`'s inline pagination.** A different control (5/page, compact). Forcing it into `Pagination` changes the UI.
- **`bcrypt.hash(password, 10)` repeats.** One line each. A wrapper adds indirection without removing risk.
- **`GET /administrators/deactivated` and `/deleted` overlapping `GET /administrators?status=`.** Both are used by two pages; removing them would mean changing those pages.
- **Response DTO fields the app never reads** (`deployed_at`, `motion_tflite_url`, `sign_type`). They document the server's JSON shape and cost nothing.
- **`tools/import_fsl105.py` adopting `BackendImporter`.** Its upload loop has its own dry-run, trimming and checkpoint logic. It can move over later if it is touched for another reason.
