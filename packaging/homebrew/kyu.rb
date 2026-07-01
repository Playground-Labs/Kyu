cask "kyu" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.3"
  sha256 arm:   "e3185bd2fa275b537ebeb3389246bf54fea6fe52977f1a4698d09ef2c38535a0",
         intel: "efd255cbaf700b3a106be01e72a01258c6f795fe5a5b0633d754621afcd98373"

  url "https://github.com/Playground-Labs/Kyu/releases/download/v#{version}/Kyu_#{version}_#{arch}.dmg"
  name "Kyu"
  desc "Menu bar prompt queue for AI agents"
  homepage "https://github.com/Playground-Labs/Kyu"

  depends_on macos: :catalina

  app "Kyu.app"

  zap trash: [
    "~/Library/Application Support/dev.kyu",
    "~/Library/Caches/dev.kyu",
    "~/Library/HTTPStorages/dev.kyu",
    "~/Library/WebKit/dev.kyu",
  ]
end
