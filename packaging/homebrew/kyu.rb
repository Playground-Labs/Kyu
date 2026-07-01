cask "kyu" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.2"
  sha256 arm:   "e876d17d3f030531de30b2319923199d0e05f864a941e31847bab8ed4524204a",
         intel: "37a92cdd002090ae1913afbd53f61f7a7a478256d976c528878ccb95212c7335"

  url "https://github.com/Playground-Labs/Kyu/releases/download/v#{version}/Kyu_#{version}_#{arch}.dmg"
  name "Kyu"
  desc "Menu bar prompt queue for AI agents"
  homepage "https://github.com/Playground-Labs/Kyu"

  app "Kyu.app"

  zap trash: [
    "~/Library/Application Support/dev.kyu",
    "~/Library/Caches/dev.kyu",
    "~/Library/HTTPStorages/dev.kyu",
    "~/Library/WebKit/dev.kyu",
  ]
end
