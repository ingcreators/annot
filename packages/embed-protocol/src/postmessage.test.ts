/**
 * Phase 5c of `docs/plans/living-spec-authoring-roadmap.md`.
 * postMessage dispatcher round-trip + edge-case coverage.
 *
 * Tests use a minimal in-memory `FakeWindow` that satisfies the
 * subset of the `Window` surface the messengers actually touch
 * (`addEventListener` / `removeEventListener` /
 * `dispatchEvent` / `postMessage` / `parent`). Sidesteps the
 * happy-dom vs lib.dom.ts type-universe mismatch that comes up
 * when casting a real `happy-dom` `Window` into the DOM
 * `Window` the messengers' parameters declare.
 *
 * The messenger code itself is written against `lib.dom`'s
 * `Window` / `MessageEvent` / `HTMLIFrameElement`. The
 * `FakeWindow` here is structurally compatible — the messenger
 * only ever sees the methods it calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBED_PROTOCOL_VERSION, type EmbedEvent } from "./events.js";
import {
  createEmbedClientMessenger,
  createEmbedHostMessenger,
  type EmbedMessenger,
} from "./postmessage.js";

const HOST_ORIGIN = "https://docs.example.com";
const EDITOR_ORIGIN = "https://annot.work";

const READY_EVENT: EmbedEvent = {
  type: "EditorReady",
  protocolVersion: EMBED_PROTOCOL_VERSION,
  editorId: "ed-1",
};
const COMMIT_EVENT: EmbedEvent = {
  type: "EditCommitted",
  editId: "e1",
  commitSha: "abc1234",
};

interface FakeMessageEvent {
  type: "message";
  data: unknown;
  origin: string;
  source: FakeWindow | null;
}

type MessageListener = (event: FakeMessageEvent) => void;

class FakeWindow {
  // The messenger reads `.parent`. Defaults to self so the
  // client messenger's "not embedded" guard can fire when
  // tests construct a standalone window.
  parent: FakeWindow = this;
  private readonly listeners = new Set<MessageListener>();
  /** Stub set by tests to route postMessage to the peer
   *  window. Not part of the real Window surface — only used by
   *  the cross-window relay below. */
  onPostMessage?: (data: unknown, targetOrigin: string) => void;

  addEventListener(type: string, listener: MessageListener): void {
    if (type !== "message") return;
    this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: MessageListener): void {
    if (type !== "message") return;
    this.listeners.delete(listener);
  }

  dispatchEvent(event: FakeMessageEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  postMessage(data: unknown, targetOrigin: string): void {
    this.onPostMessage?.(data, targetOrigin);
  }
}

interface TestRig {
  hostWin: FakeWindow;
  editorWin: FakeWindow;
  frame: HTMLIFrameElement;
}

function makeRig(): TestRig {
  const hostWin = new FakeWindow();
  const editorWin = new FakeWindow();
  editorWin.parent = hostWin;
  const frame = {
    contentWindow: editorWin as unknown as Window,
  } as unknown as HTMLIFrameElement;
  return { hostWin, editorWin, frame };
}

function asWindow(fake: FakeWindow): Window {
  return fake as unknown as Window;
}

let rig: TestRig;
let messengers: EmbedMessenger[];

beforeEach(() => {
  rig = makeRig();
  messengers = [];
});

afterEach(() => {
  for (const m of messengers) {
    try {
      m.cleanup();
    } catch {
      // ignore
    }
  }
});

function track<T extends EmbedMessenger>(m: T): T {
  messengers.push(m);
  return m;
}

describe("createEmbedHostMessenger", () => {
  it("requires a non-null content window", () => {
    const frame = { contentWindow: null } as unknown as HTMLIFrameElement;
    expect(() =>
      createEmbedHostMessenger({
        frame,
        expectedOrigin: EDITOR_ORIGIN,
        onEvent: () => {},
        window: asWindow(rig.hostWin),
      }),
    ).toThrow(/contentWindow is null/);
  });

  it("dispatches typed EmbedEvents from the matching origin", () => {
    const onEvent = vi.fn();
    track(
      createEmbedHostMessenger({
        frame: rig.frame,
        expectedOrigin: EDITOR_ORIGIN,
        onEvent,
        window: asWindow(rig.hostWin),
      }),
    );

    rig.hostWin.dispatchEvent({
      type: "message",
      data: READY_EVENT,
      origin: EDITOR_ORIGIN,
      source: rig.editorWin,
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(READY_EVENT);
  });

  it("drops messages from a different origin", () => {
    const onEvent = vi.fn();
    track(
      createEmbedHostMessenger({
        frame: rig.frame,
        expectedOrigin: EDITOR_ORIGIN,
        onEvent,
        window: asWindow(rig.hostWin),
      }),
    );

    rig.hostWin.dispatchEvent({
      type: "message",
      data: READY_EVENT,
      origin: "https://malicious.example.com",
      source: rig.editorWin,
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("drops messages from a different source window", () => {
    const onEvent = vi.fn();
    track(
      createEmbedHostMessenger({
        frame: rig.frame,
        expectedOrigin: EDITOR_ORIGIN,
        onEvent,
        window: asWindow(rig.hostWin),
      }),
    );

    const otherWin = new FakeWindow();
    rig.hostWin.dispatchEvent({
      type: "message",
      data: READY_EVENT,
      origin: EDITOR_ORIGIN,
      source: otherWin,
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("drops non-EmbedEvent payloads", () => {
    const onEvent = vi.fn();
    track(
      createEmbedHostMessenger({
        frame: rig.frame,
        expectedOrigin: EDITOR_ORIGIN,
        onEvent,
        window: asWindow(rig.hostWin),
      }),
    );

    for (const payload of [null, "EditCommitted", 42, { type: "Unknown" }, { type: 5 }, {}]) {
      rig.hostWin.dispatchEvent({
        type: "message",
        data: payload,
        origin: EDITOR_ORIGIN,
        source: rig.editorWin,
      });
    }

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("sendEvent posts to the iframe's content window", () => {
    const messenger = track(
      createEmbedHostMessenger({
        frame: rig.frame,
        expectedOrigin: EDITOR_ORIGIN,
        onEvent: () => {},
        window: asWindow(rig.hostWin),
      }),
    );

    const editorPost = vi.spyOn(rig.editorWin, "postMessage");
    messenger.sendEvent(COMMIT_EVENT);
    expect(editorPost).toHaveBeenCalledTimes(1);
    expect(editorPost).toHaveBeenCalledWith(COMMIT_EVENT, EDITOR_ORIGIN);
  });

  it("cleanup is idempotent", () => {
    const onEvent = vi.fn();
    const messenger = track(
      createEmbedHostMessenger({
        frame: rig.frame,
        expectedOrigin: EDITOR_ORIGIN,
        onEvent,
        window: asWindow(rig.hostWin),
      }),
    );

    messenger.cleanup();
    messenger.cleanup();
    messenger.cleanup();

    rig.hostWin.dispatchEvent({
      type: "message",
      data: READY_EVENT,
      origin: EDITOR_ORIGIN,
      source: rig.editorWin,
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("sendEvent after cleanup throws", () => {
    const messenger = track(
      createEmbedHostMessenger({
        frame: rig.frame,
        expectedOrigin: EDITOR_ORIGIN,
        onEvent: () => {},
        window: asWindow(rig.hostWin),
      }),
    );

    messenger.cleanup();
    expect(() => messenger.sendEvent(COMMIT_EVENT)).toThrow(/after cleanup/);
  });
});

describe("createEmbedClientMessenger", () => {
  it("rejects construction when not actually embedded", () => {
    const standalone = new FakeWindow();
    expect(() =>
      createEmbedClientMessenger({
        parentOrigin: HOST_ORIGIN,
        onEvent: () => {},
        window: asWindow(standalone),
      }),
    ).toThrow(/not embedded/);
  });

  it("dispatches typed EmbedEvents from the parent origin", () => {
    const onEvent = vi.fn();
    track(
      createEmbedClientMessenger({
        parentOrigin: HOST_ORIGIN,
        onEvent,
        window: asWindow(rig.editorWin),
      }),
    );

    rig.editorWin.dispatchEvent({
      type: "message",
      data: COMMIT_EVENT,
      origin: HOST_ORIGIN,
      source: rig.hostWin,
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(COMMIT_EVENT);
  });

  it("drops messages from a different parent origin", () => {
    const onEvent = vi.fn();
    track(
      createEmbedClientMessenger({
        parentOrigin: HOST_ORIGIN,
        onEvent,
        window: asWindow(rig.editorWin),
      }),
    );

    rig.editorWin.dispatchEvent({
      type: "message",
      data: COMMIT_EVENT,
      origin: "https://attacker.example.com",
      source: rig.hostWin,
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("drops messages from a non-parent source", () => {
    const onEvent = vi.fn();
    track(
      createEmbedClientMessenger({
        parentOrigin: HOST_ORIGIN,
        onEvent,
        window: asWindow(rig.editorWin),
      }),
    );

    const other = new FakeWindow();
    rig.editorWin.dispatchEvent({
      type: "message",
      data: COMMIT_EVENT,
      origin: HOST_ORIGIN,
      source: other,
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("sendEvent posts to window.parent with the configured origin", () => {
    const messenger = track(
      createEmbedClientMessenger({
        parentOrigin: HOST_ORIGIN,
        onEvent: () => {},
        window: asWindow(rig.editorWin),
      }),
    );

    const parentPost = vi.spyOn(rig.hostWin, "postMessage");
    messenger.sendEvent(READY_EVENT);
    expect(parentPost).toHaveBeenCalledTimes(1);
    expect(parentPost).toHaveBeenCalledWith(READY_EVENT, HOST_ORIGIN);
  });

  it("cleanup is idempotent", () => {
    const onEvent = vi.fn();
    const messenger = track(
      createEmbedClientMessenger({
        parentOrigin: HOST_ORIGIN,
        onEvent,
        window: asWindow(rig.editorWin),
      }),
    );
    messenger.cleanup();
    messenger.cleanup();
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("end-to-end host ↔ client exchange", () => {
  it("delivers events both directions over a single pair of messengers", () => {
    const hostReceived: EmbedEvent[] = [];
    const clientReceived: EmbedEvent[] = [];

    // Bridge the two FakeWindows so a `postMessage` on one
    // delivers a `message` event on that same window (matching
    // the spec — the target of `postMessage` is the window
    // it's called on; `source` is the sender) but with
    // `origin` + `source` set to the actual sender's identity.
    //
    //   host.sendEvent → editorWin.postMessage(data, EDITOR_ORIGIN)
    //     → editor receives a message with
    //       origin=HOST_ORIGIN, source=hostWin.
    rig.editorWin.onPostMessage = (data, _targetOrigin) => {
      rig.editorWin.dispatchEvent({
        type: "message",
        data,
        origin: HOST_ORIGIN,
        source: rig.hostWin,
      });
    };
    rig.hostWin.onPostMessage = (data, _targetOrigin) => {
      rig.hostWin.dispatchEvent({
        type: "message",
        data,
        origin: EDITOR_ORIGIN,
        source: rig.editorWin,
      });
    };

    const host = track(
      createEmbedHostMessenger({
        frame: rig.frame,
        expectedOrigin: EDITOR_ORIGIN,
        onEvent: (event) => hostReceived.push(event),
        window: asWindow(rig.hostWin),
      }),
    );
    const client = track(
      createEmbedClientMessenger({
        parentOrigin: HOST_ORIGIN,
        onEvent: (event) => clientReceived.push(event),
        window: asWindow(rig.editorWin),
      }),
    );

    client.sendEvent(READY_EVENT);
    host.sendEvent(COMMIT_EVENT);

    expect(hostReceived).toEqual([READY_EVENT]);
    expect(clientReceived).toEqual([COMMIT_EVENT]);
  });
});
