import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server.js";
import { store } from "./store.js";

/* ── Loopback hardening (High) ── */

test("rejects requests carrying an Origin header (browser CSRF)", async () => {
  const app = await buildServer();
  const res = await app.inject({
    method: "GET",
    url: "/state",
    headers: { origin: "https://example.invalid" },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("rejects a non-local Host header (DNS rebinding)", async () => {
  const app = await buildServer();
  const res = await app.inject({
    method: "GET",
    url: "/state",
    headers: { host: "evil.example.com" },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("blocks a mutating route from a CORS-safelisted form post", async () => {
  const app = await buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/notify",
    headers: { origin: "https://evil.example.com", "content-type": "application/x-www-form-urlencoded" },
    payload: 'level=off',
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("allows a normal local client (no Origin, localhost Host)", async () => {
  const app = await buildServer();
  const res = await app.inject({ method: "GET", url: "/state" });
  assert.equal(res.statusCode, 200);
  await app.close();
});

/* ── Concurrent /focus race (Medium) ── */

test("two concurrent /focus for one session both see the claim", async () => {
  const app = await buildServer();
  store.upsertSession("race-1", "/tmp/p", "running", { ancestorPids: [424242] });

  const f1 = app.inject({ method: "POST", url: "/focus", payload: { sessionId: "race-1" } });
  const f2 = app.inject({ method: "POST", url: "/focus", payload: { sessionId: "race-1" } });

  // Let both register, then claim once (no folder → no window raise).
  await new Promise((r) => setTimeout(r, 60));
  await app.inject({ method: "POST", url: "/focus/claim", payload: { sessionId: "race-1" } });

  const [r1, r2] = await Promise.all([f1, f2]);
  assert.equal(JSON.parse(r1.body).claimed, true, "first focus claimed");
  assert.equal(JSON.parse(r2.body).claimed, true, "second focus claimed (not clobbered)");
  await app.close();
});
