# Cellar

Wine cellar app with two clients sharing one backend (Python FastAPI in
`server/`): a web UI (`ui/`, TanStack Start) and a native iOS app (`ios/`,
SwiftUI). See `ios/README.md` for iOS build/deploy specifics.

## Keep the two clients' iconography in sync

Both clients draw the same glassware. When either side changes, mirror the
change in the other **in the same commit**:

- **Wine-type glyphs** (list icons: glass per wine type, tulip for sparkling):
  `ui/src/components/wine-type-icon.tsx` and `ios/WineCellar/Components.swift`
  (`WineTypeIcon` + its `Shape`s). Both use the same 32x40 design space with
  identical silhouettes, fill lines, and bubble positions. The liquid must be
  drawn as the bowl silhouette clipped at the fill line — never as a separate
  hand-traced shape (that's how misalignment bugs crept in before).
- **App icon** (Zalto-style glass, gold on aubergine): the source of truth is
  `ios/AppIcon.svg`. The web favicon `ui/public/favicon.svg` is the same art
  with rounded corners and ~3x stroke weights for small sizes. All raster
  assets (`AppIcon.png`, `apple-touch-icon.png`, `logo192/512.png`,
  `favicon.ico`) are rendered from those two SVGs — the render commands are in
  `ios/README.md` under `AppIcon.svg`.
