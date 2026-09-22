# Manual migrations

This project has no migration tooling and `server.js` never calls
`sequelize.sync()` — the Postgres schema is maintained by hand. When a Sequelize
model gains a column, the matching `ALTER TABLE` must be run against every
environment or the app will fail at query time.

Each file here is idempotent (`IF NOT EXISTS`), so re-running one is safe.

Run against the database in `PG_URI`:

```bash
psql "$PG_URI" -f migrations/001_model_versions_trained_word_ids.sql
```

| File | Applied to dev | Purpose |
|---|---|---|
| `001_model_versions_trained_word_ids.sql` | yes — 2026-07-29 | Word bank follows the deployed model |
| `002_gesture_samples_session_id.sql` | yes — 2026-08-17 | Signer grouping for cross-validation |
| `003_upload_jobs.sql` | **not yet** | Clip upload becomes a tracked background job |
| `004_gesture_samples_dedupe_guard.sql` | **not yet** | Reject duplicate and cross-labelled samples |
| `005_model_versions_model_kind.sql` | yes — 2026-09-22 | Words and alphabet deploy as separate models |
| `006_model_versions_version_unique_per_kind.sql` | yes — 2026-09-22 | One version names a words+letters pair |
| `007_words_vocabulary.sql` | yes — 2026-09-22 | Word carries its model explicitly, not by label shape |

`psql` is not always on PATH, and the database is Supabase-hosted. Two alternatives that
need no extra tooling: paste the file into the **Supabase SQL Editor**, or run it through
the connection the app already uses:

```js
// from sigla-backend/, with the file contents in `sql`
require("dotenv").config();
const { Sequelize } = require("sequelize");
const s = new Sequelize(process.env.PG_URI, { dialect: "postgres", logging: false });
await s.query(sql);
```
