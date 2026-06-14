import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationFor } from "./notifier.js";

test("waiting level fires only on → waiting (the loud case)", () => {
  assert.equal(notificationFor("running", "waiting", "waiting"), "waiting");
  assert.equal(notificationFor("ready", "waiting", "waiting"), "waiting");
  // not for finishing a turn
  assert.equal(notificationFor("running", "ready", "waiting"), null);
});

test("all level also fires on → ready", () => {
  assert.equal(notificationFor("running", "ready", "all"), "ready");
  assert.equal(notificationFor("running", "waiting", "all"), "waiting");
});

test("off fires nothing", () => {
  assert.equal(notificationFor("running", "waiting", "off"), null);
  assert.equal(notificationFor("running", "ready", "off"), null);
});

test("no transition (same status) never fires — per-session dedupe", () => {
  assert.equal(notificationFor("waiting", "waiting", "waiting"), null);
  assert.equal(notificationFor("ready", "ready", "all"), null);
});

test("leaving waiting/ready does not fire", () => {
  assert.equal(notificationFor("waiting", "running", "all"), null);
  assert.equal(notificationFor("ready", "idle", "all"), null);
});
