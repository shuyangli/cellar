# WineCellar iOS

Native SwiftUI companion to the cellar web UI. Talks to the same FastAPI JSON
API; the tailnet deployment (`http://claw/cellar`) is baked in as the default
server, overridable in the app's Settings (gear icon on the Cellar tab — use
`http://127.0.0.1:8788` for local development against `cellar-web`).

## Layout

- `WineCellar.xcodeproj` — hand-rolled project using a filesystem-synchronized
  source group: every file added under `WineCellar/` is picked up
  automatically, no pbxproj edits needed.
- `Info.plist` — ATS exception (`NSAllowsArbitraryLoads`) because the tailnet
  origin is plain HTTP; WireGuard already encrypts the transport.
- `WineCellar/` — all sources:
  - `Models.swift`, `CellarAPI.swift` — Codable models + URLSession client for
    the full API surface (cellar, wines, tastings, purchases, inventory
    events, wishlist, ordered wines, stats, drink-now, history, users).
  - `Components.swift` — wine-type glass icon (liquid color per type),
    rating badges (`93S`, tap to expand the reviewer name), drinking-window
    coloring, inventory delta badges, formatters.
  - Screens: `CellarListView`, `WineDetailView`, `DrinkNowView`,
    `OrderedView`, `WishlistView`, `HistoryView`, `StatsView`.
  - Forms: `Forms.swift` (tasting editor, log tasting, edit/add wine,
    settings), `HistoryView.swift` (external tasting, event review),
    `WishlistView.swift` (wishlist add), shared `WinePicker.swift` and
    `ReviewerPicker.swift`.

Tabs: Cellar · Drink Now · Shopping (Ordered/Wishlist) · History · Stats.

## Build & run

Open in Xcode and run on any iOS 17+ simulator or device, or headless:

```bash
xcodebuild -project ios/WineCellar.xcodeproj -scheme WineCellar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

On a real phone, install the Tailscale app so `claw` resolves via MagicDNS.

## Release (TestFlight)

The app ships to phones through TestFlight as **Cellar Browser**
(team `RM2BB7S3BX`, bundle `li.shuyang.cellar`). Signing and upload are fully
headless via an App Store Connect API key at
`~/.appstoreconnect/private_keys/AuthKey_9277CZY57L.p8`
(key ID `9277CZY57L`, issuer `69a6de7f-99c8-47e3-e053-5b8c7c11a4d1`):

```bash
AUTH=(-allowProvisioningUpdates
      -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_9277CZY57L.p8
      -authenticationKeyID 9277CZY57L
      -authenticationKeyIssuerID 69a6de7f-99c8-47e3-e053-5b8c7c11a4d1)
xcodebuild -project ios/WineCellar.xcodeproj -scheme WineCellar \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath /tmp/WineCellar.xcarchive "${AUTH[@]}" archive
xcodebuild -exportArchive -archivePath /tmp/WineCellar.xcarchive \
  -exportPath /tmp/WineCellar-export \
  -exportOptionsPlist ios/ExportOptions.plist "${AUTH[@]}"
xcrun altool --upload-app -f /tmp/WineCellar-export/WineCellar.ipa -t ios \
  --apiKey 9277CZY57L --apiIssuer 69a6de7f-99c8-47e3-e053-5b8c7c11a4d1
```

Bump `CURRENT_PROJECT_VERSION` before each upload — App Store Connect rejects
duplicate build numbers for the same version.
