import { describe, it, expect, beforeEach, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import { NextRequest } from "next/server";

// Sibling `route.test.ts` MOCKS standardwebhooks to cover the handler's
// orchestration breadth (event dispatch, idempotency, allowance resets). That
// mock makes `verify` a spy that ignores its arguments — so it cannot catch a
// regression where the route wires the verifier wrong (wrong secret, body
// re-serialised, headers passed individually instead of as the raw body). This
// file closes that gap: it signs requests with the REAL standardwebhooks
// `Webhook` class and asserts the crypto round-trip end to end.

// DODO_WEBHOOK_SECRET is read at module load (route.ts). The key must be set
// BEFORE the route module imports, and the SAME key reused to sign below — so
// compute it inside vi.hoisted (which runs before imports / before module-level
// const init) and return it. Referencing a module-level const from inside the
// hoisted callback would hit the temporal dead zone.
const SECRET = vi.hoisted(() => {
  const key = Buffer.from("local-test-dodo-secret").toString("base64");
  process.env.DODO_WEBHOOK_SECRET = key;
  return key;
});

vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { createMockSupabaseClient } from "@/test/mocks/supabase";
import { buildSubscriptionEventPayload } from "@/test/mocks/webhook";
import { stubDodoProductEnvs } from "@/test/mocks/env";
import { POST } from "./route";

const WEBHOOK_ID = "evt_real_sig_1";

interface SignOptions {
  /** Send a body that differs from the signed one → signature mismatch. */
  tamper?: boolean;
  /** Sign with a timestamp >5 min old (standardwebhooks default tolerance). */
  stale?: boolean;
  /** Sign with a key that does not match the route's configured secret. */
  wrongSecret?: boolean;
  /** Omit one of the three required webhook-* headers. */
  dropHeader?: "webhook-id" | "webhook-signature" | "webhook-timestamp";
}

/**
 * Builds a request signed with the real `Webhook.sign`. The route runs
 * `new Webhook(SECRET).verify(rawBody, headers)`, so the round-trip succeeds
 * only when the body is untouched, the timestamp is fresh, and the key matches.
 */
function signRequest(opts: SignOptions = {}): NextRequest {
  const body = JSON.stringify(buildSubscriptionEventPayload());
  const sentBody = opts.tamper ? body + "tampered" : body;
  const signingKey = opts.wrongSecret
    ? Buffer.from("a-completely-different-secret").toString("base64")
    : SECRET;
  const timestampDate = opts.stale ? new Date(Date.now() - 10 * 60 * 1000) : new Date();

  const signature = new Webhook(signingKey).sign(WEBHOOK_ID, timestampDate, body);

  const headers: Record<string, string> = {
    "webhook-id": WEBHOOK_ID,
    "webhook-signature": signature,
    "webhook-timestamp": String(Math.floor(timestampDate.getTime() / 1000)),
    "content-type": "application/json",
  };
  if (opts.dropHeader) delete headers[opts.dropHeader];

  return new NextRequest("https://app.test/api/webhooks/dodo", {
    method: "POST",
    headers,
    body: sentBody,
  });
}

// Happy-path supabase config (mirrors route.test.ts installSupabase) so a
// validly signed request fully processes to 200, not just past the gate.
const NON_DUP = { data: { metadata: { provider_updated_at: "2020-01-01T00:00:00Z" } }, error: null };
const EXISTING = { data: { metadata: {} }, error: null };
const OK = { data: null, error: null };

function installHappyPathSupabase() {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({
      rpc: {},
      tables: {
        webhook_event_log: [{ data: { id: "log_1" }, error: null }, OK],
        user_subscriptions: [NON_DUP, EXISTING, OK],
        periodic_allowance: [OK],
      },
    } as never) as never,
  );
}

describe("POST /api/webhooks/dodo — signature verification (real standardwebhooks crypto)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubDodoProductEnvs(vi);
  });

  it("accepts a validly signed request and reaches processing (200)", async () => {
    installHappyPathSupabase();
    const res = await POST(signRequest());
    expect(res.status).toBe(200);
    // Supabase init happens AFTER signature verification, so this proves the
    // signed request cleared the crypto gate and entered processing.
    expect(getSupabaseAdminClient).toHaveBeenCalledTimes(1);
  });

  it("rejects a tampered body with 401 and never touches the database", async () => {
    const res = await POST(signRequest({ tamper: true }));
    expect(res.status).toBe(401);
    expect(getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp (>5 min) with 401", async () => {
    const res = await POST(signRequest({ stale: true }));
    expect(res.status).toBe(401);
    expect(getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a signature made with the wrong secret with 401", async () => {
    const res = await POST(signRequest({ wrongSecret: true }));
    expect(res.status).toBe(401);
    expect(getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("returns 400 when a required signature header is missing (checked before verify)", async () => {
    const res = await POST(signRequest({ dropHeader: "webhook-signature" }));
    expect(res.status).toBe(400);
    expect(getSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
