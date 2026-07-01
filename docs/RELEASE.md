# Releasing Kyu

Releases are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml),
triggered by pushing a `v*` tag. It runs the test suites, builds the macOS app
for both architectures, and uploads a GitHub Release.

## Code signing & notarization

Without a Developer ID certificate the app is only **ad-hoc signed**, so macOS
Gatekeeper shows *"Kyu is damaged and can't be opened"* on downloaded copies.
To ship installable builds, sign with a **Developer ID Application** certificate
and notarize. `tauri-action` does this automatically when these repository
secrets are set (Settings → Secrets and variables → Actions):

| Secret | What it is | How to get it |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | base64 of your Developer ID `.p12` | Export the cert from Keychain Access as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | password you set when exporting the `.p12` | — |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` | `security find-identity -v -p codesigning` |
| `APPLE_ID` | your Apple ID email | — |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for notarization | appleid.apple.com → Sign-In & Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | 10-character team ID | developer.apple.com → Membership |

Prerequisites: an **Apple Developer Program** membership ($99/yr) and a
**Developer ID Application** certificate (create at developer.apple.com →
Certificates, or via Xcode → Settings → Accounts → Manage Certificates).

Once the secrets are set, the next tagged release is signed + notarized and
installs without the Gatekeeper warning. Until then, builds still succeed
(ad-hoc) and users must strip quarantine manually:
`xattr -dr com.apple.quarantine /Applications/Kyu.app`.

## Cutting a release

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml` (and refresh `Cargo.lock`).
2. Commit, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. After the release publishes, update the Homebrew cask
   (`packaging/homebrew/kyu.rb` and the tap's `Casks/kyu.rb`) — bump `version`
   and both `sha256` values (see `packaging/homebrew/README.md`).
