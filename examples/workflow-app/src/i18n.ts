// Tiny i18n: dictionary lookup keyed by stable string ids, with
// en + ja columns. No ICU MessageFormat — the example app doesn't
// need plurals or gender. Locale state is in-memory only;
// reloading the page resets to "en" (paper-show fidelity).

export type Locale = "en" | "ja";

const LOCALES: ReadonlyArray<Locale> = ["en", "ja"];

type DictEntry = Record<Locale, string>;

const DICT: Record<string, DictEntry> = {
  // App shell.
  "app.title": { en: "Workflow App", ja: "ワークフローアプリ" },
  "app.lang.label": { en: "Language", ja: "言語" },
  "app.lang.en": { en: "English", ja: "英語" },
  "app.lang.ja": { en: "Japanese", ja: "日本語" },
  "app.signOut": { en: "Sign out", ja: "サインアウト" },
  "app.signedInAs": { en: "Signed in as", ja: "サインイン中:" },

  // Placeholder screen (still used by Phase 3 routes that
  // haven't shipped their components yet — the approver flow
  // arrives in Phase 3).
  "placeholder.heading": { en: "TODO screen", ja: "TODO 画面" },
  "placeholder.body": {
    en: "This screen will be implemented in a later phase.",
    ja: "この画面は後のフェーズで実装されます。",
  },
  "placeholder.routeLabel": { en: "Current route:", ja: "現在のルート:" },

  // Common widget copy.
  "common.back": { en: "Back", ja: "戻る" },
  "common.cancel": { en: "Cancel", ja: "キャンセル" },
  "common.submit": { en: "Submit", ja: "送信" },
  "common.required": { en: "Required", ja: "必須" },
  "common.optional": { en: "Optional", ja: "任意" },
  "common.yen": { en: "JPY", ja: "円" },

  // Login.
  "login.heading": { en: "Sign in", ja: "サインイン" },
  "login.subheading": {
    en: "Enter your registered email and password.",
    ja: "登録済みのメールアドレスとパスワードを入力してください。",
  },
  "login.email": { en: "Email", ja: "メールアドレス" },
  "login.password": { en: "Password", ja: "パスワード" },
  "login.submit": { en: "Sign in", ja: "サインイン" },
  "login.error.invalid": {
    en: "The email or password is incorrect.",
    ja: "メールアドレスまたはパスワードが正しくありません。",
  },
  "login.hint.title": {
    en: "Demo credentials",
    ja: "デモ用ログイン情報",
  },
  "login.hint.body": {
    en: "Password for every demo account is \"password\".",
    ja: "全てのデモアカウントのパスワードは「password」です。",
  },
  "login.hint.applicant": { en: "Applicant", ja: "申請者" },
  "login.hint.approver": { en: "Approver", ja: "承認者" },

  // Menu.
  "menu.heading": { en: "Menu", ja: "メニュー" },
  "menu.subheading.applicant": {
    en: "Submit a new application or review past ones.",
    ja: "新しい申請を作成するか、過去の申請を確認できます。",
  },
  "menu.subheading.approver": {
    en: "Review applications waiting for your decision.",
    ja: "あなたの判断を待っている申請を確認できます。",
  },
  "menu.card.newApplication.title": {
    en: "New application",
    ja: "新しい申請",
  },
  "menu.card.newApplication.body": {
    en: "Start a new leave / expense / purchase application.",
    ja: "休暇 / 経費 / 購買 の申請を新規作成します。",
  },
  "menu.card.myApplications.title": {
    en: "My applications",
    ja: "申請履歴",
  },
  "menu.card.myApplications.body": {
    en: "Browse the applications you have submitted.",
    ja: "これまでに提出した申請を一覧できます。",
  },
  "menu.card.pendingApprovals.title": {
    en: "Pending approvals",
    ja: "承認待ち一覧",
  },
  "menu.card.pendingApprovals.body": {
    en: "Open the queue of applications awaiting your decision.",
    ja: "あなたの判断を待つ申請一覧を開きます。",
  },
  "menu.myApplications.empty": {
    en: "No applications submitted yet.",
    ja: "まだ申請履歴はありません。",
  },

  // Application form (applicant).
  "form.heading": { en: "New application", ja: "新規申請" },
  "form.category.label": { en: "Category", ja: "申請区分" },
  "form.category.placeholder": {
    en: "Select a category",
    ja: "区分を選択",
  },
  "form.category.leave": { en: "Leave", ja: "休暇" },
  "form.category.expense": { en: "Expense", ja: "経費" },
  "form.category.purchase": { en: "Purchase", ja: "購買" },
  "form.amount.label": { en: "Amount (JPY)", ja: "金額 (円)" },
  "form.amount.help": {
    en: "Hidden for leave applications.",
    ja: "休暇申請では入力不要です。",
  },
  "form.reason.label": { en: "Reason", ja: "申請理由" },
  "form.reason.placeholder": {
    en: "Describe the background and any approval context.",
    ja: "背景や承認に必要な情報を記載してください。",
  },
  "form.next": { en: "Review", ja: "確認画面へ" },
  "form.error.categoryRequired": {
    en: "Select a category.",
    ja: "区分を選択してください。",
  },
  "form.error.amountInvalid": {
    en: "Enter an amount of 0 or more.",
    ja: "0 以上の金額を入力してください。",
  },
  "form.error.reasonRequired": {
    en: "Enter the reason for the application.",
    ja: "申請理由を入力してください。",
  },

  // Application confirm.
  "confirm.heading": { en: "Confirm application", ja: "申請内容の確認" },
  "confirm.subheading": {
    en: "Review every field before submitting.",
    ja: "送信前に各項目をご確認ください。",
  },
  "confirm.field.applicant": { en: "Applicant", ja: "申請者" },
  "confirm.field.category": { en: "Category", ja: "区分" },
  "confirm.field.amount": { en: "Amount", ja: "金額" },
  "confirm.field.reason": { en: "Reason", ja: "理由" },
  "confirm.back": { en: "Back to edit", ja: "戻って修正" },
  "confirm.submit": { en: "Submit application", ja: "申請を送信" },

  // Application submitted (success terminal).
  "submitted.heading": { en: "Application submitted", ja: "申請を送信しました" },
  "submitted.body": {
    en: "Your application has been forwarded for approval.",
    ja: "申請を承認担当者に転送しました。",
  },
  "submitted.idLabel": { en: "Application ID:", ja: "申請番号:" },
  "submitted.backToMenu": { en: "Back to menu", ja: "メニューへ戻る" },

  // Status badges.
  "status.submitted": { en: "Submitted", ja: "申請中" },
  "status.approved": { en: "Approved", ja: "承認済み" },
  "status.rejected": { en: "Rejected", ja: "却下" },

  // Approval list (approver).
  "approve.list.heading": {
    en: "Pending approvals",
    ja: "承認待ち一覧",
  },
  "approve.list.subheading": {
    en: "Open an item to review the full application.",
    ja: "明細を開いて申請内容をご確認ください。",
  },
  "approve.list.column.id": { en: "ID", ja: "申請番号" },
  "approve.list.column.applicant": { en: "Applicant", ja: "申請者" },
  "approve.list.column.category": { en: "Category", ja: "区分" },
  "approve.list.column.amount": { en: "Amount", ja: "金額" },
  "approve.list.column.submittedAt": {
    en: "Submitted at",
    ja: "申請日時",
  },
  "approve.list.column.action": { en: "Action", ja: "操作" },
  "approve.list.review": { en: "Review", ja: "詳細" },
  "approve.list.empty": {
    en: "No applications awaiting approval.",
    ja: "承認待ちの申請はありません。",
  },

  // Approval detail.
  "approve.detail.heading": {
    en: "Review application",
    ja: "申請内容の確認",
  },
  "approve.detail.field.id": { en: "ID", ja: "申請番号" },
  "approve.detail.field.applicant": { en: "Applicant", ja: "申請者" },
  "approve.detail.field.category": { en: "Category", ja: "区分" },
  "approve.detail.field.amount": { en: "Amount", ja: "金額" },
  "approve.detail.field.submittedAt": {
    en: "Submitted at",
    ja: "申請日時",
  },
  "approve.detail.field.reason": { en: "Reason", ja: "申請理由" },
  "approve.detail.comment.label": {
    en: "Decision comment",
    ja: "判断コメント",
  },
  "approve.detail.comment.placeholder": {
    en: "Add an optional comment that will be shown to the applicant.",
    ja: "申請者に共有するコメントを任意で入力できます。",
  },
  "approve.detail.approve": { en: "Approve", ja: "承認" },
  "approve.detail.reject": { en: "Reject", ja: "却下" },
  "approve.detail.notFound": {
    en: "The requested application was not found.",
    ja: "対象の申請が見つかりませんでした。",
  },
  "approve.detail.alreadyDecided": {
    en: "This application has already been decided.",
    ja: "この申請は既に判定済みです。",
  },
  "approve.detail.backToList": {
    en: "Back to list",
    ja: "一覧へ戻る",
  },

  "approve.decided.field.decision": {
    en: "Decision",
    ja: "判断",
  },

  // Approval decided (terminal).
  "approve.decided.heading.approved": {
    en: "Application approved",
    ja: "申請を承認しました",
  },
  "approve.decided.heading.rejected": {
    en: "Application rejected",
    ja: "申請を却下しました",
  },
  "approve.decided.body": {
    en: "The applicant will be notified of your decision.",
    ja: "判断結果は申請者へ通知されます。",
  },
  "approve.decided.backToList": {
    en: "Back to pending list",
    ja: "承認待ち一覧へ戻る",
  },
};

let currentLocale: Locale = "en";
const listeners = new Set<() => void>();

export function t(key: string): string {
  const entry = DICT[key];
  if (!entry) {
    return key;
  }
  return entry[currentLocale] ?? entry.en ?? key;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(next: Locale): void {
  if (!LOCALES.includes(next) || next === currentLocale) {
    return;
  }
  currentLocale = next;
  document.documentElement.lang = next;
  for (const fn of listeners) {
    fn();
  }
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function availableLocales(): ReadonlyArray<Locale> {
  return LOCALES;
}
