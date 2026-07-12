// @vitest-environment happy-dom
//
// Tests for the cloud auth-source additions to github-auth.ts
// (github-app-user-tokens plan Phase 2): token fetch from the
// annot.work Worker, auth-source persistence, silent refresh,
// and the PAT-paste source switch.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudTokenError,
  fetchCloudToken,
  getAccessToken,
  getAuthSource,
  getTokenExpiresAt,
  refreshCloudTokenSilently,
  revokeCloudToken,
  signInWithPat,
  signOut,
} from "./github-auth.js";

afterEach(() => {
  vi.unstubAllGlobals();
  signOut();
  localStorage.clear();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchCloudToken", () => {
  it("persists the token + expiry and flips the auth source to cloud", async () => {
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    const stub = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/github/token");
      expect(init?.credentials).toBe("include");
      return jsonResponse({ ok: true, token: "ghu_abc", expiresAt, githubLogin: "octocat" });
    });
    vi.stubGlobal("fetch", stub);

    const result = await fetchCloudToken("");
    expect(result.token).toBe("ghu_abc");
    expect(result.githubLogin).toBe("octocat");
    expect(getAccessToken()).toBe("ghu_abc");
    expect(getAuthSource()).toBe("cloud");
    expect(getTokenExpiresAt()).toBe(expiresAt);
  });

  it("prefixes the cloud base URL for self-hosted deploys", async () => {
    const stub = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.example.com/api/github/token");
      return jsonResponse({ ok: true, token: "t", expiresAt: null, githubLogin: null });
    });
    vi.stubGlobal("fetch", stub);
    await fetchCloudToken("https://api.example.com");
    expect(getTokenExpiresAt()).toBeNull();
  });

  it("throws a CloudTokenError carrying the Worker's error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ok: false, error: "not_connected", message: "no row" }, 404),
      ),
    );
    await expect(fetchCloudToken("")).rejects.toMatchObject({ code: "not_connected" });
    // Failure must not disturb the persisted state.
    expect(getAccessToken()).toBeNull();
    expect(getAuthSource()).toBe("pat");
  });

  it("maps 5xx and network failures to the retryable transport code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: false, error: "upstream_error" }, 502)),
    );
    await expect(fetchCloudToken("")).rejects.toMatchObject({ code: "transport" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const err: unknown = await fetchCloudToken("").catch((e) => e);
    expect(err).toBeInstanceOf(CloudTokenError);
    expect((err as CloudTokenError).code).toBe("transport");
  });
});

describe("refreshCloudTokenSilently", () => {
  it("returns the fresh token on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ok: true, token: "ghu_next", expiresAt: null, githubLogin: null }),
      ),
    );
    expect(await refreshCloudTokenSilently("")).toBe("ghu_next");
    expect(getAccessToken()).toBe("ghu_next");
  });

  it("returns null instead of throwing on any failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: false, error: "reauth_required" }, 401)),
    );
    expect(await refreshCloudTokenSilently("")).toBeNull();
  });
});

describe("auth-source switching", () => {
  it("a validated PAT paste switches the source back to pat and drops the expiry", async () => {
    // Start in cloud mode.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ok: true, token: "ghu_cloud", expiresAt: Date.now(), githubLogin: null }),
      ),
    );
    await fetchCloudToken("");
    expect(getAuthSource()).toBe("cloud");

    // Paste a PAT (the /user validity check succeeds).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ login: "octocat" })),
    );
    await signInWithPat("ghp_manual");
    expect(getAuthSource()).toBe("pat");
    expect(getAccessToken()).toBe("ghp_manual");
    expect(getTokenExpiresAt()).toBeNull();
  });

  it("a failed PAT paste leaves the cloud source intact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ok: true, token: "ghu_cloud", expiresAt: null, githubLogin: null }),
      ),
    );
    await fetchCloudToken("");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 })),
    );
    await expect(signInWithPat("ghp_bad")).rejects.toThrow();
    expect(getAuthSource()).toBe("cloud");
    expect(getAccessToken()).toBe("ghu_cloud");
  });

  it("signOut clears the token + expiry but keeps the source for reconnect UX", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ok: true, token: "ghu_cloud", expiresAt: Date.now(), githubLogin: null }),
      ),
    );
    await fetchCloudToken("");
    signOut();
    expect(getAccessToken()).toBeNull();
    expect(getTokenExpiresAt()).toBeNull();
    expect(getAuthSource()).toBe("cloud");
  });
});

describe("revokeCloudToken", () => {
  it("DELETEs the Worker endpoint with credentials", async () => {
    const stub = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/github/token");
      expect(init?.method).toBe("DELETE");
      expect(init?.credentials).toBe("include");
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", stub);
    await revokeCloudToken("");
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("swallows network failures (best-effort)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(revokeCloudToken("")).resolves.toBeUndefined();
  });
});
