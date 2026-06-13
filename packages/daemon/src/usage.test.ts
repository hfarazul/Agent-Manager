import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestUsage } from "./usage.js";
import { store } from "./store.js";

test("parses real 2.1.x rate_limits shape (five_hour / seven_day)", async () => {
  const u = await ingestUsage({
    rate_limits: {
      five_hour: { used_percentage: 38, resets_at: 1781360000 },
      seven_day: { used_percentage: 62, resets_at: 1781700000 },
    },
    cost: { total_cost_usd: 1.23 },
  });
  assert.equal(u.source, "statusline");
  assert.equal(u.session?.usedPercent, 38);
  assert.equal(u.session?.resetsAt, 1781360000);
  assert.equal(u.weekly?.usedPercent, 62);
  assert.equal(u.costToday, 1.23);
});

test("empty payload → source 'none', no windows", async () => {
  const u = await ingestUsage({});
  assert.equal(u.source, "none");
  assert.equal(u.session, undefined);
  assert.equal(u.weekly, undefined);
});

test("attaches session_name only to an existing session", async () => {
  store.upsertSession("u1", "/tmp/proj", "running");
  await ingestUsage({ session_id: "u1", session_name: "My task", cwd: "/tmp/proj", rate_limits: {} });
  const s = store.getState().sessions.find((x) => x.sessionId === "u1");
  assert.equal(s?.name, "My task");

  // unknown session id must not be created from a statusLine push
  await ingestUsage({ session_id: "u2-unknown", session_name: "X", cwd: "/tmp/proj" });
  assert.equal(store.getState().sessions.find((x) => x.sessionId === "u2-unknown"), undefined);
});
