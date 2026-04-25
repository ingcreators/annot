/**
 * Built-in `drawer.last-commit` section — author, date, message
 * headline + short SHA for the file's most recent commit. GitHub-
 * only today; the section's `visible(ctx)` predicate gates on
 * presence of `data.lastCommit`, so non-GitHub backends (and
 * GitHub before the async lookup completes) don't render the
 * heading.
 *
 * Migrated from the previous monolithic
 * `FileDetailsDrawer.#renderLastCommitSection` as part of Phase 2
 * of `docs/plans/plugin-ui-slots.md`.
 *
 * Reactive lifecycle: `update(ctx)` re-renders the rows when
 * `setLastCommit` fires with new info. The drawer host handles
 * visibility transitions (commit appearing for the first time)
 * via its own re-render path.
 */

import { setTooltip } from "@ingcreators/annot-core/utils";
import type { UISection } from "../../app/plugin-host.js";
import type { FileDetailsData, LastCommitInfo } from "../file-details-drawer-types.js";
import { formatDate, makeRow } from "./helpers.js";

export interface LastCommitSectionDeps {
  getData(): FileDetailsData;
}

export function createLastCommitSection(deps: LastCommitSectionDeps): UISection {
  let bodyRef: HTMLElement | null = null;

  const render = (container: HTMLElement) => {
    container.innerHTML = "";
    const commit = deps.getData().lastCommit;
    if (!commit) return; // visible() guard usually prevents this; defensive no-op
    renderRows(container, commit);
  };

  return {
    id: "drawer.last-commit",
    title: "Last commit",
    priority: 30,
    visible() {
      return Boolean(deps.getData().lastCommit);
    },
    mount(container) {
      bodyRef = container;
      render(container);
      return {
        update() {
          if (bodyRef) render(bodyRef);
        },
        unmount() {
          bodyRef = null;
        },
      };
    },
  };
}

function renderRows(container: HTMLElement, commit: LastCommitInfo): void {
  // Author row: avatar + name side by side when we have the avatar.
  const authorRow = document.createElement("div");
  authorRow.className = "file-details-row";
  const authorLbl = document.createElement("span");
  authorLbl.className = "file-details-row-label";
  authorLbl.textContent = "Author";
  authorRow.appendChild(authorLbl);
  const authorVal = document.createElement("span");
  authorVal.className = "file-details-row-value selectable";
  if (commit.authorAvatarUrl) {
    const avatar = document.createElement("img");
    avatar.className = "file-details-avatar";
    avatar.src = commit.authorAvatarUrl;
    avatar.alt = "";
    avatar.width = 16;
    avatar.height = 16;
    authorVal.appendChild(avatar);
  }
  const authorText = document.createTextNode(commit.authorName);
  authorVal.appendChild(authorText);
  authorRow.appendChild(authorVal);
  container.appendChild(authorRow);

  container.appendChild(makeRow("Date", formatDate(commit.date)));

  // Message: clickable link to the commit when we have a URL,
  // plain text otherwise. Short SHA shown in monospace alongside.
  const msgRow = document.createElement("div");
  msgRow.className = "file-details-row";
  const msgLbl = document.createElement("span");
  msgLbl.className = "file-details-row-label";
  msgLbl.textContent = "Message";
  msgRow.appendChild(msgLbl);
  const msgWrap = document.createElement("span");
  msgWrap.className = "file-details-row-value selectable";
  if (commit.url) {
    const a = document.createElement("a");
    a.href = commit.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = commit.messageHeadline;
    msgWrap.appendChild(a);
  } else {
    msgWrap.appendChild(document.createTextNode(commit.messageHeadline));
  }
  msgWrap.appendChild(document.createTextNode(" "));
  const sha = document.createElement("code");
  sha.className = "file-details-sha";
  sha.textContent = commit.shortSha;
  msgWrap.appendChild(sha);
  setTooltip(msgWrap, commit.messageHeadline);
  msgRow.appendChild(msgWrap);
  container.appendChild(msgRow);
}
