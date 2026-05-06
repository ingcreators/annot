# macOS Notarization Recipe

> Phase 7 of [`docs/plans/desktop-electron-migration.md`](../../../docs/plans/desktop-electron-migration.md).
> A **manual** recipe for producing a signed + notarized macOS
> build of Annot. CI automation is intentionally deferred — it
> needs Apple credentials in the CI secret store, which has its
> own organisational prerequisites tracked separately.

The default `pnpm --filter @ingcreators/annot-desktop build` on
macOS produces an UN-notarized `.dmg`. macOS will show the
"unidentified developer" / "Apple cannot check this app for
malicious software" gatekeeper warning when a fresh user opens
it. Following this recipe replaces that with a normal Open
dialog.

## Prerequisites

You need:

1. An **Apple Developer Program** membership ($99/year). The
   personal-developer free tier won't sign apps for distribution
   outside the App Store.
2. A **Developer ID Application** certificate installed in the
   build host's Keychain. Create + download from the
   [Apple Developer portal](https://developer.apple.com/account/resources/certificates).
   Confirm with:
   ```bash
   security find-identity -v -p codesigning
   ```
   You should see a line like
   `1) <fingerprint> "Developer ID Application: <Your Name> (<TEAMID>)"`.
3. **One** of these notarization auth methods (pick the one
   you'll bake into env vars below):
   - **App-specific password** — generate at
     [appleid.apple.com](https://appleid.apple.com/) under
     "App-Specific Passwords". Recommended for one-off manual
     builds — easier to revoke than an API key.
   - **App Store Connect API key** — generate at
     [App Store Connect → Users and Access → Integrations](https://appstoreconnect.apple.com/access/integrations/api).
     The API key is a `.p8` file plus an Issuer ID and Key ID.
     Recommended if you'll automate later.
4. **Xcode command-line tools**:
   ```bash
   xcode-select --install
   ```
5. A clean clone of this repo with `pnpm install` already run
   on the build host.

## One-time setup

Annot ships a `mac` block in
[`packages/desktop/package.json`](../package.json) that already
configures hardened runtime, the entitlements file, and the
target DMG / zip artifacts. The notarization step is gated
behind `notarize: false` in that config — flipped to `true` via
an env-var override at build time so you don't accidentally
trigger network calls to Apple's notary service when iterating
locally.

The entitlements live at
[`packages/desktop/build/entitlements.mac.plist`](../build/entitlements.mac.plist).
Each entitlement is justified inline; do not relax library
validation or sandbox-related entries without revisiting
`packages/desktop/docs/notarization.md`.

## Build + sign + notarize

### Step 1 — set credentials in the shell

For the **app-specific password** path:

```bash
export APPLE_ID="ichimura@example.com"             # your Apple ID email
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCD123456"                  # 10-char string, from `security find-identity`
```

For the **API-key** path (preferred for automation):

```bash
export APPLE_API_KEY="$HOME/secrets/AuthKey_<KEY_ID>.p8"
export APPLE_API_KEY_ID="<10-char Key ID>"
export APPLE_API_ISSUER="<UUID issuer>"
```

In either case also set the team ID as the signing identity
selector (electron-builder picks the matching certificate from
Keychain):

```bash
export CSC_NAME="Developer ID Application: <Your Name> (ABCD123456)"
```

### Step 2 — flip `notarize: true` for this build

The simplest path is a one-shot env-var override. `electron-builder`
honours `--config` JSON merge:

```bash
pnpm --filter @ingcreators/annot-desktop build \
  --mac \
  -c.mac.notarize='{"teamId":"ABCD123456"}'
```

Or commit a `--config` override file
(`packages/desktop/build/notarize.config.json`) for repeated
builds — kept out of `package.json` so accidental `pnpm build`
runs without credentials don't fail noisily on Apple's notary
service.

### Step 3 — run the build

```bash
pnpm --filter @ingcreators/annot-desktop build --mac
```

Expected output (truncated):

```
  • electron-builder  version=26.x.x
  • signing           file=Annot.app identityName="Developer ID Application: Naoki Ichimura (ABCD123456)"
  • notarizing        bundleId=com.ingcreators.annot file=dist-electron/mac/Annot.app
  • notarization started
  • notarization successful
  • stapling          file=dist-electron/mac/Annot.app
  • building          target=DMG arch=x64
```

A passing run produces:
- `packages/desktop/dist-electron/Annot-<version>.dmg`
- `packages/desktop/dist-electron/Annot-<version>-mac.zip`
- An `.app` inside the DMG with a stapled notarization ticket.

A failing run typically prints
`notarization failed: <reason>` with a UUID. Pull the full log
with:

```bash
xcrun notarytool log <UUID> \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"
```

## Verify the result

### On the build host

```bash
spctl --assess --verbose --type execute \
  packages/desktop/dist-electron/mac/Annot.app
```

Expected:

```
Annot.app: accepted
source=Notarized Developer ID
```

If you see `source=Unnotarized Developer ID` or `source=Developer
ID`, the staple step failed — re-run notarization or staple
manually:

```bash
xcrun stapler staple packages/desktop/dist-electron/mac/Annot.app
```

### On a fresh Mac (the real test)

1. Copy the DMG to a Mac that has **never** run Annot before.
2. Mount the DMG. Drag `Annot` to `/Applications`.
3. Right-click → Open. macOS should display the standard "Open"
   dialog — NOT the "Apple cannot check this app for malicious
   software" warning. Confirm Open; the app launches without
   further prompts.
4. Trigger a screen capture. macOS prompts once for the Screen
   Recording permission (uses the
   `NSScreenCaptureUsageDescription` string from
   `package.json#build.mac.extendInfo`). Grant it.
5. Quit + relaunch. Verify the permission persists and capture
   works without re-prompting.

## Troubleshooting

| Error                                                                                         | Likely cause                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code object is not signed at all`                                                            | The Developer ID certificate isn't in the Keychain or Keychain access is locked. Run `security unlock-keychain login.keychain` and retry.                                                     |
| `notarization failed` with `Sandbox not allowed`                                               | The entitlements file enabled `com.apple.security.app-sandbox`. Remove it — Annot writes outside the sandbox at `~/Library/Application Support/Annot/library/`.                               |
| `notarization failed` with `unsigned` for a specific framework                                 | A native module (e.g. a future napi-rs addon) is missing a Developer-ID signature. Rebuild the addon with `electron-rebuild` so its `.node` file ships signed.                                |
| App opens fine on the build host but shows the "unidentified developer" warning on a fresh Mac | The DMG isn't notarized. The build host's local Keychain bypass + cached gatekeeper assessment hides the issue. Always test on a Mac that has never seen the bundle ID.                       |
| `Annot quit unexpectedly` on first launch on a fresh Mac                                       | Hardened-runtime entitlement missing. Symbolicate the crash report from `~/Library/Logs/DiagnosticReports/`; look for `EXC_BAD_ACCESS` and "JIT" or "library validation" errors and add the matching entitlement to `entitlements.mac.plist`. |
| `notarization started` then hangs > 15 min                                                    | Apple's notary service is intermittently slow. Up to 24 hours is normal during peak times. Don't kill the build — the notary call resumes if your shell stays open.                           |

## Out of scope

- **CI automation**. Adding `APPLE_*` env vars to GitHub
  Actions secrets needs the org's security review. Tracked as
  a separate plan.
- **Apple Silicon-specific arch builds**. The default
  `electron-builder` config emits universal binaries when both
  Intel and ARM are required — see
  [electron-builder's `arch` option](https://www.electron.build/configuration/configuration#arch)
  if a single-arch build matters.
- **App Store distribution**. Annot uses the Developer ID
  pathway (notarization), not the App Store. App Store
  distribution requires the sandbox entitlement which would
  break the gallery's filesystem access — not currently
  planned.

## Related

- [Apple's notarization documentation](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [`@electron/notarize` README](https://github.com/electron/notarize)
- [`electron-builder` macOS code signing](https://www.electron.build/code-signing)
- [`packages/desktop/build/entitlements.mac.plist`](../build/entitlements.mac.plist) — the entitlements list, with each key justified inline.
