/**
 * Phase 5a of `docs/plans/living-spec-authoring-roadmap.md`.
 * Type-level + minimal runtime tests for the embed-protocol
 * event types. The package's surface is types + one runtime
 * constant + one runtime guard; this file covers all three.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type EditAbandonedEvent,
  type EditCommittedEvent,
  type EditorReadyEvent,
  type EditRequestedEvent,
  EMBED_EVENT_TYPES,
  EMBED_PROTOCOL_VERSION,
  type EmbedEvent,
  type EmbedEventType,
  type EmbedMode,
  type EmbedProtocolVersion,
  isEmbedEvent,
  type ResizeNeededEvent,
} from "./events.js";

describe("EMBED_PROTOCOL_VERSION", () => {
  it("is the literal 1 (initial wire-format version)", () => {
    expect(EMBED_PROTOCOL_VERSION).toBe(1);
    expectTypeOf<EmbedProtocolVersion>().toEqualTypeOf<1>();
  });
});

describe("EmbedMode", () => {
  it("admits the three known modes and rejects unknowns at the type level", () => {
    const newTab: EmbedMode = "newTab";
    const inline: EmbedMode = "inline";
    const disabled: EmbedMode = "disabled";
    expect([newTab, inline, disabled]).toEqual(["newTab", "inline", "disabled"]);
    expectTypeOf<EmbedMode>().toEqualTypeOf<"newTab" | "inline" | "disabled">();
  });
});

describe("EmbedEvent discriminated union", () => {
  it("narrows EditorReady on the `type` discriminator", () => {
    const event: EmbedEvent = {
      type: "EditorReady",
      protocolVersion: EMBED_PROTOCOL_VERSION,
      editorId: "ed-1",
    };
    if (event.type === "EditorReady") {
      expectTypeOf(event).toEqualTypeOf<EditorReadyEvent>();
      expect(event.protocolVersion).toBe(1);
    } else {
      throw new Error("narrowing failed");
    }
  });

  it("narrows EditRequested on the `type` discriminator", () => {
    const event: EmbedEvent = {
      type: "EditRequested",
      editId: "ed-r-1",
      repo: "ingcreators/annot",
      pngPath: "docs/shots/login.png",
      annotationsPath: "docs/annotations/login.annotations.yaml",
    };
    if (event.type === "EditRequested") {
      expectTypeOf(event).toEqualTypeOf<EditRequestedEvent>();
      expect(event.repo).toBe("ingcreators/annot");
    } else {
      throw new Error("narrowing failed");
    }
  });

  it("narrows EditCommitted on the `type` discriminator", () => {
    const event: EmbedEvent = {
      type: "EditCommitted",
      editId: "ed-c-1",
      commitSha: "abc1234",
      branch: "feat/new-callout",
      prUrl: "https://github.com/ingcreators/annot/pull/9999",
    };
    if (event.type === "EditCommitted") {
      expectTypeOf(event).toEqualTypeOf<EditCommittedEvent>();
      expect(event.commitSha).toBe("abc1234");
      expect(event.prUrl).toMatch(/^https:\/\//);
    } else {
      throw new Error("narrowing failed");
    }
  });

  it("narrows EditAbandoned + admits known + ad-hoc reasons", () => {
    const cancelled: EditAbandonedEvent = {
      type: "EditAbandoned",
      editId: "ed-a-1",
      reason: "userCancelled",
    };
    const adHoc: EditAbandonedEvent = {
      type: "EditAbandoned",
      editId: "ed-a-2",
      reason: "rateLimited",
    };
    expect(cancelled.reason).toBe("userCancelled");
    expect(adHoc.reason).toBe("rateLimited");
  });

  it("narrows ResizeNeeded on the `type` discriminator", () => {
    const event: EmbedEvent = {
      type: "ResizeNeeded",
      width: 1024,
      height: 768,
    };
    if (event.type === "ResizeNeeded") {
      expectTypeOf(event).toEqualTypeOf<ResizeNeededEvent>();
      expect(event.width).toBe(1024);
      expect(event.height).toBe(768);
    } else {
      throw new Error("narrowing failed");
    }
  });

  it("exhausts via a switch over `type` (compile-time guarantee)", () => {
    const labelEvent = (event: EmbedEvent): string => {
      switch (event.type) {
        case "EditorReady":
          return `ready:${event.editorId}`;
        case "EditRequested":
          return `requested:${event.editId}`;
        case "EditCommitted":
          return `committed:${event.commitSha}`;
        case "EditAbandoned":
          return `abandoned:${event.reason}`;
        case "ResizeNeeded":
          return `resize:${event.width}x${event.height}`;
        default: {
          // Build error if a new variant lands without a case.
          const _never: never = event;
          return `unhandled:${_never as unknown as string}`;
        }
      }
    };
    expect(
      labelEvent({
        type: "EditorReady",
        protocolVersion: EMBED_PROTOCOL_VERSION,
        editorId: "ed-x",
      }),
    ).toBe("ready:ed-x");
    expect(
      labelEvent({
        type: "EditCommitted",
        editId: "e-c",
        commitSha: "deadbeef",
      }),
    ).toBe("committed:deadbeef");
    expect(
      labelEvent({
        type: "ResizeNeeded",
        width: 640,
        height: 480,
      }),
    ).toBe("resize:640x480");
  });
});

describe("EMBED_EVENT_TYPES", () => {
  it("lists every EmbedEvent['type'] literal exactly once", () => {
    expect(EMBED_EVENT_TYPES).toEqual([
      "EditorReady",
      "EditRequested",
      "EditCommitted",
      "EditAbandoned",
      "ResizeNeeded",
    ]);
    // Build error if a new EmbedEvent variant lands without
    // being appended to EMBED_EVENT_TYPES (satisfies clause in
    // events.ts enforces it on the source side too).
    expectTypeOf<(typeof EMBED_EVENT_TYPES)[number]>().toEqualTypeOf<EmbedEventType>();
  });
});

describe("isEmbedEvent", () => {
  it("returns true for every EmbedEvent variant", () => {
    const variants: EmbedEvent[] = [
      { type: "EditorReady", protocolVersion: EMBED_PROTOCOL_VERSION, editorId: "x" },
      {
        type: "EditRequested",
        editId: "e1",
        repo: "owner/repo",
        pngPath: "a.png",
        annotationsPath: "a.annotations.yaml",
      },
      { type: "EditCommitted", editId: "e1", commitSha: "abc" },
      { type: "EditAbandoned", editId: "e1", reason: "userCancelled" },
      { type: "ResizeNeeded", width: 100, height: 200 },
    ];
    for (const variant of variants) {
      expect(isEmbedEvent(variant)).toBe(true);
    }
  });

  it("returns false for non-objects, null, and missing/unknown `type`", () => {
    expect(isEmbedEvent(null)).toBe(false);
    expect(isEmbedEvent(undefined)).toBe(false);
    expect(isEmbedEvent("EditorReady")).toBe(false);
    expect(isEmbedEvent(42)).toBe(false);
    expect(isEmbedEvent({})).toBe(false);
    expect(isEmbedEvent({ type: "Unknown" })).toBe(false);
    expect(isEmbedEvent({ type: 123 })).toBe(false);
  });

  it("narrows via the type predicate", () => {
    const message: unknown = {
      type: "EditCommitted",
      editId: "e1",
      commitSha: "abc",
    };
    if (isEmbedEvent(message)) {
      expectTypeOf(message).toEqualTypeOf<EmbedEvent>();
      // Discriminator + further narrowing works after the guard.
      if (message.type === "EditCommitted") {
        expect(message.commitSha).toBe("abc");
      }
    } else {
      throw new Error("guard rejected a valid EmbedEvent");
    }
  });
});
