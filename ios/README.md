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
- `AppIcon.svg` — icon source (Zalto-style glass, gold on aubergine). To
  change the icon, edit the SVG and re-render the asset:
  `rsvg-convert -w 1024 -h 1024 AppIcon.svg -o WineCellar/Assets.xcassets/AppIcon.appiconset/AppIcon.png`.
- `WineCellar/` — all sources:
  - `Models.swift`, `CellarAPI.swift` — Codable models + URLSession client for
    the full API surface (cellar, wines, tastings, purchases, inventory
    events, wishlist, ordered wines, stats, drink-now, history, users).
  - `Components.swift` — wine-type glass icons (liquid color per type,
    champagne flute for sparkling), rating badges (`93S`), drinking-window
    coloring, inventory delta badges, formatters.
  - `Theme.swift` — adaptive palette (warm parchment in light mode; the web
    UI's plum-black with crimson corner glows in dark), serif navigation
    titles, burgundy→rose gradients. Follows the system appearance, with a
    Light/Dark override in the app's Settings.
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

## Deploying updates (TestFlight)

The app ships to phones through TestFlight as **Cellar Browser**
(App Store Connect, team `RM2BB7S3BX`, bundle `li.shuyang.cellar`). Once a
build is uploaded, distribution is automatic: internal testers get a
notification and TestFlight auto-updates the app on their phones. No cables,
no Xcode GUI, no review for internal testers.

### The one credential you need

Everything — code signing, provisioning, and upload — authenticates with a
single App Store Connect **API key**:

- Key file: `~/.appstoreconnect/private_keys/AuthKey_9277CZY57L.p8`
- Key ID: `9277CZY57L`
- Issuer ID: `69a6de7f-99c8-47e3-e053-5b8c7c11a4d1`

The `.p8` file is the secret (treat it like a password for the whole developer
account; don't commit it). If it's ever lost, generate a replacement in App
Store Connect → Users and Access → Integrations → App Store Connect API
(role: App Manager or Admin), drop it in the same directory, and update the
two IDs in the commands below. No Apple ID login or Xcode account session is
required on the build machine.

### Shipping a new build

1. Bump `CURRENT_PROJECT_VERSION` (both Debug and Release) in
   `ios/WineCellar.xcodeproj/project.pbxproj` — App Store Connect rejects a
   build number it has already seen for the same version. Bump
   `MARKETING_VERSION` too when it's a meaningful release.
2. Archive, export, upload (from the repo root):

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

3. That's it. Apple processes the build (~5–15 min), then pushes it to every
   internal tester automatically.

### Manual actions (all one-time, all already done)

These were needed once to set the pipeline up and should never recur:

- Register the bundle ID and create the **Cellar Browser** app record in App
  Store Connect (the app record is the one thing the public API can't create).
- Set `ITSAppUsesNonExemptEncryption=false` in `Info.plist` so builds skip the
  per-build export-compliance question.
- Create the internal-tester group under the app's TestFlight tab.

The only recurring manual action is people-management: adding a new tester
means adding them in App Store Connect → Users and Access, then ticking them
in the TestFlight internal group.

### Expiry

TestFlight builds expire **90 days** after upload; phones warn as the date
approaches. Shipping any new build (steps above) resets the clock — there is
no way to extend a build in place, but re-uploading is the whole three-command
process, so just ship whatever is on `main`.
