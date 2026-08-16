import SwiftUI
import UIKit

// MARK: - Appearance override

enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark

    static let storageKey = "appearance"

    var id: String { rawValue }

    var label: String { rawValue.capitalized }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

// MARK: - Palette

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }

    // Light: the original warm-parchment cellar. Dark: the web UI's plum-black
    // with crimson accents (ui/src/styles.css).
    static let appBackground = Color(light: 0xF4EFE7, dark: 0x0D0F14)
    static let appCard = Color(light: 0xFFFDF8, dark: 0x171920)
    static let appBorder = Color(light: 0xD9D0C1, dark: 0x363842)
    static let appBurgundy = Color(light: 0x6C3040, dark: 0x8C2349)
    static let appRose = Color(light: 0x9A634E, dark: 0xC74D78)
    static let appKicker = Color(light: 0x6C3040, dark: 0xFFDBE7)

    // Drinking-window urgency
    static let windowCurrent = Color(light: 0x047857, dark: 0x34D399)
    static let windowFuture = Color(light: 0xB45309, dark: 0xFBBF24)

    // Inventory delta badges
    static let deltaUpText = Color(light: 0x047857, dark: 0x6EE7B7)
    static let deltaUpFill = Color(light: 0xECFDF5, dark: 0x0A2E22)
    static let deltaUpEdge = Color(light: 0xA7F3D0, dark: 0x065F46)
    static let deltaDownText = Color(light: 0xB91C1C, dark: 0xFCA5A5)
    static let deltaDownFill = Color(light: 0xFEF2F2, dark: 0x330D0D)
    static let deltaDownEdge = Color(light: 0xFECACA, dark: 0x7F1D1D)

    /// Signature burgundy→rose used on active chips and rating badges.
    static var burgundyGradient: LinearGradient {
        LinearGradient(
            colors: [.appBurgundy, .appRose],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

// MARK: - Screen background

/// Warm parchment in light mode; in dark, the web app's plum-black with the
/// same crimson and slate corner glows.
struct CellarBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack {
            Color.appBackground
            if scheme == .dark {
                RadialGradient(
                    colors: [Color(hex: 0x79163A).opacity(0.30), .clear],
                    center: UnitPoint(x: 0.11, y: -0.07),
                    startRadius: 0, endRadius: 480
                )
                RadialGradient(
                    colors: [Color(hex: 0x3E4561).opacity(0.24), .clear],
                    center: UnitPoint(x: 0.96, y: 0.03),
                    startRadius: 0, endRadius: 420
                )
                RadialGradient(
                    colors: [Color(hex: 0x671433).opacity(0.16), .clear],
                    center: UnitPoint(x: 0.58, y: 1.1),
                    startRadius: 0, endRadius: 520
                )
            }
        }
        .ignoresSafeArea()
    }
}

extension View {
    /// Themed scroll background for the main screens' Lists.
    func cellarBackground() -> some View {
        scrollContentBackground(.hidden)
            .background(CellarBackground())
    }
}

// MARK: - Navigation title typography

enum ThemeSetup {
    /// Serif (New York) navigation titles, echoing the web's Bodoni headings.
    static func configure() {
        let navBar = UINavigationBar.appearance()
        if let descriptor = UIFont.systemFont(ofSize: 34, weight: .bold)
            .fontDescriptor.withDesign(.serif) {
            navBar.largeTitleTextAttributes = [
                .font: UIFont(descriptor: descriptor, size: 34)
            ]
        }
        if let descriptor = UIFont.systemFont(ofSize: 17, weight: .semibold)
            .fontDescriptor.withDesign(.serif) {
            navBar.titleTextAttributes = [
                .font: UIFont(descriptor: descriptor, size: 17)
            ]
        }
    }
}

// MARK: - Kicker label

/// Tracked-uppercase eyebrow line, like the web's `cellar-kicker`.
struct KickerText: View {
    var text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption2.weight(.semibold))
            .tracking(2.4)
            .foregroundStyle(Color.appKicker.opacity(0.85))
    }
}
