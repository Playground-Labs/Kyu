cask "kyu" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.0"
  sha256 :no_check

  url "https://github.com/Playground-Labs/Kyu/releases/download/v#{version}/Kyu_#{version}_#{arch}.dmg",
      verified: "github.com/Playground-Labs/Kyu/"
  name "Kyu"
  desc "Menu bar prompt queue for AI agents"
  homepage "https://github.com/Playground-Labs/Kyu"

  app "Kyu.app"

  zap trash: [
    "~/Library/Application Support/dev.kyu.app",
    "~/Library/Preferences/dev.kyu.app.plist",
    "~/Library/Saved Application State/dev.kyu.app.savedState",
  ]
end
