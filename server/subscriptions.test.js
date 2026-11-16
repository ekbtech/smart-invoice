import assert from "node:assert/strict";
import test from "node:test";
import { assertInvoiceCapacity, assertUserCapacity, requirePlanFeature, subscriptionAllowsWrites } from "./subscriptions.js";

test("active subscriptions allow writes", () => {
  assert.equal(subscriptionAllowsWrites({ status: "active" }), true);
});

test("unexpired trials allow writes but expired trials are read-only", () => {
  const now = new Date("2026-11-16T00:00:00.000Z");
  assert.equal(subscriptionAllowsWrites({ status: "trialing", trialEndsAt: "2026-11-17T00:00:00.000Z" }, now), true);
  assert.equal(subscriptionAllowsWrites({ status: "trialing", trialEndsAt: "2026-11-15T00:00:00.000Z" }, now), false);
  assert.equal(subscriptionAllowsWrites({ status: "trialing", trialEndsAt: null }, now), false);
});

test("past-due, suspended, and cancelled subscriptions do not allow writes", () => {
  for (const status of ["past_due", "suspended", "cancelled"]) {
    assert.equal(subscriptionAllowsWrites({ status }), false);
  }
});

test("platform administrators bypass subscription feature and usage limits", async () => {
  let featureError;
  requirePlanFeature("reports")({ isPlatformAdmin: true }, null, (error) => { featureError = error; });
  assert.equal(featureError, undefined);
  await assert.doesNotReject(assertInvoiceCapacity(null, "tenant-id", undefined, undefined, true));
  await assert.doesNotReject(assertUserCapacity(null, "tenant-id", true));
});
