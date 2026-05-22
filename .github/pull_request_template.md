<!--
  Thanks for opening a PR! This template mirrors the conventions
  in CONTRIBUTING.md so you don't have to remember them from a
  separate doc. Keep the sections that apply, delete the ones that
  don't.

  The `Verified:` paragraph below the divider is for the COMMIT
  MESSAGE — keep it concise there. This PR body is for the prose
  that frames the diff for reviewers.
-->

## Summary

<!-- 1-3 sentences. What does this PR change at the user / API
     level? -->

## Why

<!-- What problem does this solve? Link the plan / issue / PR
     conversation that this implements, if any:

       Implements `docs/plans/<plan>.md` Phase N.
       Fixes #123.
       Follow-up to PR #456.
-->

## What's in the diff

<!-- Concrete bullet points of what changed. New files, new
     functions, behaviour changes, schema changes. Skip if the
     diff is small and self-explanatory.

     For schema / API changes, call out the migration shape:

     - `data-annot-version` bump from N to N+1
     - `StorageProvider.foo` added (optional, defaulted in all four backends)
     - `ElementTree.bar` added (additive only)
-->

## Out of scope

<!-- Things that LOOK like they should be in this PR but aren't,
     and why (separate follow-up, larger discussion, etc.).
     Optional but useful for review focus. -->

## Test plan

<!-- What you ran locally + what reviewers should re-run.
     Replace the placeholders with actual results. Keep the
     boxes the change actually requires; remove the rest. -->

- [ ] `pnpm -r typecheck` — green
- [ ] `pnpm test` — N files / N tests pass
- [ ] `pnpm lint` — exit 0
- [ ] `pnpm --filter <pkg> build` — green (per package whose
      source changed)
- [ ] If touching SVG schema: `data-annot-version` bumped +
      `docs/svg-format.md` updated
- [ ] If touching `StorageProvider`: all backends compile + new
      methods marked optional
- [ ] If touching `ElementTree`: change is additive (no renames,
      no field removals)
- [ ] If UI-visible: tested in the relevant host (PWA / extension
      / desktop / VSCode); behaviour with **and without** the
      change verified
- [ ] No new DOM dependencies introduced into `packages/core`
      outside of the editor UI layer
- [ ] Diagnostic `console.log` lines removed (or clearly marked
      `// DEBUG:` with a cleanup ticket)

<!--
──────────────────────────────────────────────────────────────────
  COMMIT MESSAGE REMINDER (not part of the PR body)
──────────────────────────────────────────────────────────────────

  - Title in Conventional Commits: `<type>(<scope>): <subject>`
    e.g. `feat(web): …`, `fix(extension): …`, `docs(plans): …`
  - Body has Markdown ## subsections + a trailing
    `Verified: pnpm -r typecheck / pnpm test (N files / N tests)`
    paragraph
  - NO `Co-Authored-By:` trailers (including the Claude Code
    default). If AI assistance is worth noting, mention it here
    in the PR description, not the permanent commit log.

  See CONTRIBUTING.md for the full convention.
-->
