// In-memory app state. Phase 1 ships the shape + a no-op
// emitChange listener registry; later phases populate seed
// users + applications and add mutation helpers.

export type Role = "applicant" | "approver";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: { en: string; ja: string };
  readonly role: Role;
}

export interface Application {
  readonly id: string;
  readonly applicantId: string;
  readonly category: "leave" | "expense" | "purchase";
  readonly amount: number;
  readonly reason: string;
  readonly submittedAt: string;
  readonly status: "submitted" | "approved" | "rejected";
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly decisionComment?: string;
}

export interface AppState {
  currentUser: User | null;
  applications: Application[];
  draft: Partial<Application> | null;
}

const state: AppState = {
  currentUser: null,
  applications: [],
  draft: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function onStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitChange(): void {
  for (const fn of listeners) {
    fn();
  }
}

export function resetState(): void {
  state.currentUser = null;
  state.applications = [];
  state.draft = null;
  emitChange();
}
