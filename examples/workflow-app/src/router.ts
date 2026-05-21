// Hash-based router. Reads `location.hash`, parses it into a
// route descriptor, and notifies subscribers on every change.
//
// Format: `#/segment1/segment2/...`. Param routes use `:name`
// placeholders. Phase 1 ships the routing table with placeholder
// screens; later phases bind real components per `screen` field.

export interface RouteDescriptor {
  readonly hash: string;
  readonly path: string;
  readonly segments: ReadonlyArray<string>;
  readonly screen: ScreenId;
  readonly params: Readonly<Record<string, string>>;
}

export type ScreenId =
  | "login"
  | "menu"
  | "applicationForm"
  | "applicationConfirm"
  | "applicationSubmitted"
  | "approvalList"
  | "approvalDetail"
  | "approvalDecided"
  | "unknown";

interface RouteRule {
  readonly pattern: ReadonlyArray<string>;
  readonly screen: ScreenId;
  readonly paramKeys: ReadonlyArray<string>;
}

const ROUTES: ReadonlyArray<RouteRule> = [
  { pattern: [], screen: "login", paramKeys: [] },
  { pattern: ["login"], screen: "login", paramKeys: [] },
  { pattern: ["menu"], screen: "menu", paramKeys: [] },
  { pattern: ["apply"], screen: "applicationForm", paramKeys: [] },
  {
    pattern: ["apply", "confirm"],
    screen: "applicationConfirm",
    paramKeys: [],
  },
  {
    pattern: ["apply", "submitted"],
    screen: "applicationSubmitted",
    paramKeys: [],
  },
  { pattern: ["approve"], screen: "approvalList", paramKeys: [] },
  { pattern: ["approve", ":id"], screen: "approvalDetail", paramKeys: ["id"] },
  {
    pattern: ["approve", ":id", "decided"],
    screen: "approvalDecided",
    paramKeys: ["id"],
  },
];

function parseHash(hash: string): RouteDescriptor {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const path = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const segments = path.length > 0 ? path.split("/").filter(Boolean) : [];

  for (const rule of ROUTES) {
    if (rule.pattern.length !== segments.length) {
      continue;
    }
    let matched = true;
    const params: Record<string, string> = {};
    for (let i = 0; i < rule.pattern.length; i++) {
      const expected = rule.pattern[i]!;
      const actual = segments[i]!;
      if (expected.startsWith(":")) {
        params[expected.slice(1)] = actual;
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return {
        hash: `#/${segments.join("/")}`,
        path: `/${segments.join("/")}`,
        segments,
        screen: rule.screen,
        params,
      };
    }
  }

  return {
    hash: `#/${segments.join("/")}`,
    path: `/${segments.join("/")}`,
    segments,
    screen: "unknown",
    params: {},
  };
}

const listeners = new Set<(route: RouteDescriptor) => void>();
let currentRoute: RouteDescriptor = parseHash(window.location.hash);

function emit(): void {
  for (const fn of listeners) {
    fn(currentRoute);
  }
}

window.addEventListener("hashchange", () => {
  currentRoute = parseHash(window.location.hash);
  emit();
});

export function getRoute(): RouteDescriptor {
  return currentRoute;
}

export function onRouteChange(
  fn: (route: RouteDescriptor) => void,
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function navigate(path: string): void {
  const next = path.startsWith("#") ? path : `#${path}`;
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

export function buildPath(
  segments: ReadonlyArray<string>,
  params?: Readonly<Record<string, string>>,
): string {
  const filled = segments.map((s) => {
    if (s.startsWith(":")) {
      const key = s.slice(1);
      const value = params?.[key];
      if (value === undefined) {
        throw new Error(`buildPath: missing param "${key}"`);
      }
      return encodeURIComponent(value);
    }
    return s;
  });
  return `/${filled.join("/")}`;
}
