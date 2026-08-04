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
