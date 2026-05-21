// In-memory app state. Mutators emit a change event so light-
// DOM Lit components can `requestUpdate()` themselves. Resets
// on page reload by design — the example is paper-show.

export type Role = "applicant" | "approver";

export type ApplicationCategory = "leave" | "expense" | "purchase";

export type ApplicationStatus = "submitted" | "approved" | "rejected";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: { en: string; ja: string };
  readonly role: Role;
}

export interface Application {
  readonly id: string;
  readonly applicantId: string;
  readonly category: ApplicationCategory;
  readonly amount: number;
  readonly reason: string;
  readonly submittedAt: string;
  readonly status: ApplicationStatus;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly decisionComment?: string;
}

export interface DraftApplication {
  category: ApplicationCategory | "";
  amount: number;
  reason: string;
}

export interface AppState {
  currentUser: User | null;
  applications: Application[];
  draft: DraftApplication | null;
  lastSubmittedId: string | null;
}

// Seed users — hard-coded credentials, paper-show only.
export const SEED_USERS: ReadonlyArray<User> = [
  {
    id: "yamada",
    email: "yamada@example.com",
    displayName: { en: "Taro Yamada", ja: "山田 太郎" },
    role: "applicant",
  },
  {
    id: "suzuki",
    email: "suzuki@example.com",
    displayName: { en: "Hanako Suzuki", ja: "鈴木 花子" },
    role: "applicant",
  },
  {
    id: "tanaka",
    email: "tanaka@example.com",
    displayName: { en: "Ichiro Tanaka", ja: "田中 一郎" },
    role: "approver",
  },
];

export const SEED_PASSWORD = "password";

// Seed applications — three pre-existing items spanning all
// three statuses, so the approver list isn't empty and the
// docs tour has interesting state to capture.
const SEED_APPLICATIONS: ReadonlyArray<Application> = [
  {
    id: "APP-001",
    applicantId: "yamada",
    category: "leave",
    amount: 0,
    reason: "Annual leave for family event.",
    submittedAt: "2026-05-19T09:00:00.000Z",
    status: "submitted",
  },
  {
    id: "APP-002",
    applicantId: "suzuki",
    category: "expense",
    amount: 12500,
    reason: "Client lunch — Q2 partnership kickoff.",
    submittedAt: "2026-05-18T13:15:00.000Z",
    status: "approved",
    decidedAt: "2026-05-19T10:30:00.000Z",
    decidedBy: "tanaka",
    decisionComment: "Approved per Q2 budget.",
  },
  {
    id: "APP-003",
    applicantId: "yamada",
    category: "purchase",
    amount: 89000,
    reason: "Replacement laptop after a hardware fault.",
    submittedAt: "2026-05-17T11:45:00.000Z",
    status: "rejected",
    decidedAt: "2026-05-18T09:00:00.000Z",
    decidedBy: "tanaka",
    decisionComment: "Out of budget for this quarter — please re-submit after July.",
  },
];

const state: AppState = {
  currentUser: null,
  applications: [...SEED_APPLICATIONS],
  draft: null,
  lastSubmittedId: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function onStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitChange(): void {
  for (const fn of listeners) {
    fn();
  }
}

export function signIn(email: string, password: string): User | null {
  if (password !== SEED_PASSWORD) {
    return null;
  }
  const lower = email.trim().toLowerCase();
  const user = SEED_USERS.find((u) => u.email.toLowerCase() === lower);
  if (!user) {
    return null;
  }
  state.currentUser = user;
  state.draft = null;
  state.lastSubmittedId = null;
  emitChange();
  return user;
}

export function signOut(): void {
  state.currentUser = null;
  state.draft = null;
  state.lastSubmittedId = null;
  emitChange();
}

export function startDraft(): DraftApplication {
  const next: DraftApplication =
    state.draft ?? { category: "", amount: 0, reason: "" };
  state.draft = next;
  emitChange();
  return next;
}

export function updateDraft(patch: Partial<DraftApplication>): void {
  if (!state.draft) {
    state.draft = { category: "", amount: 0, reason: "" };
  }
  state.draft = { ...state.draft, ...patch };
  emitChange();
}

export function clearDraft(): void {
  state.draft = null;
  emitChange();
}

export function submitDraft(): Application | null {
  const draft = state.draft;
  const user = state.currentUser;
  if (!draft || !user || draft.category === "" || draft.reason.trim() === "") {
    return null;
  }
  const id = nextApplicationId(state.applications);
  const application: Application = {
    id,
    applicantId: user.id,
    category: draft.category,
    amount: draft.category === "leave" ? 0 : Math.max(0, Math.floor(draft.amount)),
    reason: draft.reason.trim(),
    submittedAt: new Date().toISOString(),
    status: "submitted",
  };
  state.applications = [application, ...state.applications];
  state.draft = null;
  state.lastSubmittedId = application.id;
  emitChange();
  return application;
}

export function decideApplication(
  id: string,
  decision: "approved" | "rejected",
  comment: string,
): Application | null {
  const user = state.currentUser;
  if (!user || user.role !== "approver") {
    return null;
  }
  const idx = state.applications.findIndex((a) => a.id === id);
  if (idx < 0) {
    return null;
  }
  const current = state.applications[idx]!;
  if (current.status !== "submitted") {
    return null;
  }
  const decided: Application = {
    ...current,
    status: decision,
    decidedAt: new Date().toISOString(),
    decidedBy: user.id,
    decisionComment: comment.trim() || undefined,
  };
  const next = state.applications.slice();
  next[idx] = decided;
  state.applications = next;
  emitChange();
  return decided;
}

export function findApplication(id: string): Application | undefined {
  return state.applications.find((a) => a.id === id);
}

export function findUser(id: string): User | undefined {
  return SEED_USERS.find((u) => u.id === id);
}

export function applicationsByApplicant(id: string): ReadonlyArray<Application> {
  return state.applications.filter((a) => a.applicantId === id);
}

export function pendingApprovals(): ReadonlyArray<Application> {
  return state.applications.filter((a) => a.status === "submitted");
}

function nextApplicationId(existing: ReadonlyArray<Application>): string {
  let max = 0;
  for (const a of existing) {
    const m = a.id.match(/^APP-(\d+)$/);
    if (m) {
      const n = Number.parseInt(m[1]!, 10);
      if (n > max) max = n;
    }
  }
  return `APP-${String(max + 1).padStart(3, "0")}`;
}

export function resetState(): void {
  state.currentUser = null;
  state.applications = [...SEED_APPLICATIONS];
  state.draft = null;
  state.lastSubmittedId = null;
  emitChange();
}
