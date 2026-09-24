const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validatePassword,
  validateUsername,
} = require("../src/utils/validators.js");

test("username validation rejects whitespace anywhere", () => {
  for (const username of [" admin", "admin ", "admin user", "admin\tuser", "admin\nuser"]) {
    assert.match(validateUsername(username).error, /whitespace/i);
  }
});

test("username validation accepts a whitespace-free username", () => {
  assert.deepEqual(validateUsername("admin_user-01"), { value: "admin_user-01" });
});

test("password validation rejects leading and trailing whitespace", () => {
  for (const password of [" Password1", "Password1 ", "\tPassword1", "Password1\n"]) {
    assert.match(validatePassword(password), /start or end with whitespace/i);
  }
});

test("password validation accepts whitespace between characters", () => {
  assert.equal(validatePassword("Pass word1"), null);
});
