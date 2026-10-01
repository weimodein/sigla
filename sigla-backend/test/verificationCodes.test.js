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
