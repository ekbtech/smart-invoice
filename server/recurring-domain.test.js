import test from "node:test";
import assert from "node:assert/strict";
import { addDays, addRecurringFrequency } from "./recurring-domain.js";

test("monthly and quarterly schedules preserve their original month day", () => {
  assert.equal(addRecurringFrequency("2026-01-31", "monthly", 31), "2026-02-28");
  assert.equal(addRecurringFrequency("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(addRecurringFrequency("2026-01-31", "quarterly", 31), "2026-04-30");
  assert.equal(addRecurringFrequency("2026-04-30", "quarterly", 31), "2026-07-31");
});

test("weekly and yearly schedules advance across calendar boundaries", () => {
  assert.equal(addRecurringFrequency("2026-12-29", "weekly", 29), "2027-01-05");
  assert.equal(addRecurringFrequency("2024-02-29", "yearly", 29), "2025-02-28");
  assert.equal(addRecurringFrequency("2025-02-28", "yearly", 29), "2026-02-28");
});

test("recurring date helpers reject invalid dates and intervals", () => {
  assert.throws(() => addRecurringFrequency("2026-02-30", "monthly", 30), RangeError);
  assert.throws(() => addRecurringFrequency("2026-01-01", "daily", 1), RangeError);
  assert.throws(() => addDays("2026-01-01", -1), RangeError);
  assert.equal(addDays("2026-12-31", 14), "2027-01-14");
});
