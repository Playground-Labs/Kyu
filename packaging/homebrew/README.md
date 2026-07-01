# Homebrew cask

`kyu.rb` is the source of truth for the Homebrew cask, but Homebrew serves casks
from a **tap** repository, not from this repo.

## Publish the tap (one-time)

1. Create a repo named `homebrew-kyu` under the Playground-Labs org — the tap
   `playground-labs/kyu` maps to `Playground-Labs/homebrew-kyu`.
2. Copy `kyu.rb` to `Casks/kyu.rb` in that repo and push.
3. Users can then install with:

   ```bash
   brew install --cask playground-labs/kyu/kyu
   ```

## On each release

Bump `version` and refresh **both** sha256 values from the published DMGs:

```bash
gh release download vX.Y.Z --repo Playground-Labs/Kyu --pattern '*.dmg'
shasum -a 256 Kyu_X.Y.Z_aarch64.dmg Kyu_X.Y.Z_x64.dmg
```

Then copy the updated `kyu.rb` into the tap's `Casks/kyu.rb`.
Validate before pushing with `brew audit --cask --new kyu.rb` (run inside the tap).
