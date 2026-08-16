import SwiftUI

// MARK: - Colors

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    static func wineFill(_ wineType: String?) -> Color {
        switch wineType {
        case "red": Color(hex: 0x7F1D3F)
        case "white": Color(hex: 0xE7C96B)
        case "rose": Color(hex: 0xE8909D)
        case "orange": Color(hex: 0xD97706)
        case "sparkling": Color(hex: 0xD9B84F)
        case "dessert": Color(hex: 0xB7791F)
        case "fortified": Color(hex: 0x92400E)
        case "other": Color(hex: 0x8B8B8B)
        default: Color(hex: 0xA1A1AA)
        }
    }
}

// MARK: - Wine type icon

/// Vector wine glass whose liquid color encodes the wine type; sparkling adds bubbles.
struct WineTypeIcon: View {
    var wineType: String?
    var size: CGFloat = 28

    var body: some View {
        let fill = Color.wineFill(wineType)
        ZStack {
            GlassBowlShape()
                .fill(fill.opacity(0.92))
            GlassOutlineShape()
                .stroke(Color.secondary.opacity(0.75), lineWidth: 1.6)
            if wineType == "sparkling" {
                BubblesShape()
                    .fill(Color(hex: 0xFFF7CC).opacity(0.95))
            }
        }
        .frame(width: size * 0.8, height: size)
        .accessibilityLabel(wineType.map { "\($0) wine" } ?? "Wine type unknown")
    }
}

/// The liquid inside the bowl (drawn in a 32x40 design space).
private struct GlassBowlShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 32, sy = rect.height / 40
        var path = Path()
        // Liquid: lower half of the bowl.
        path.move(to: CGPoint(x: 7 * sx, y: 14 * sy))
        path.addLine(to: CGPoint(x: 25 * sx, y: 14 * sy))
        path.addCurve(
            to: CGPoint(x: 16 * sx, y: 24 * sy),
            control1: CGPoint(x: 25 * sx, y: 20 * sy),
            control2: CGPoint(x: 21.5 * sx, y: 24 * sy)
        )
        path.addCurve(
            to: CGPoint(x: 7 * sx, y: 14 * sy),
            control1: CGPoint(x: 10.5 * sx, y: 24 * sy),
            control2: CGPoint(x: 7 * sx, y: 20 * sy)
        )
        path.closeSubpath()
        return path
    }
}

private struct GlassOutlineShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 32, sy = rect.height / 40
        var path = Path()
        // Bowl
        path.move(to: CGPoint(x: 6 * sx, y: 6 * sy))
        path.addLine(to: CGPoint(x: 26 * sx, y: 6 * sy))
        path.addCurve(
            to: CGPoint(x: 16 * sx, y: 24.5 * sy),
            control1: CGPoint(x: 26 * sx, y: 17 * sy),
            control2: CGPoint(x: 22.5 * sx, y: 24.5 * sy)
        )
        path.addCurve(
            to: CGPoint(x: 6 * sx, y: 6 * sy),
            control1: CGPoint(x: 9.5 * sx, y: 24.5 * sy),
            control2: CGPoint(x: 6 * sx, y: 17 * sy)
        )
        path.closeSubpath()
        // Stem
        path.move(to: CGPoint(x: 16 * sx, y: 24.5 * sy))
        path.addLine(to: CGPoint(x: 16 * sx, y: 34 * sy))
        // Foot
        path.move(to: CGPoint(x: 9 * sx, y: 36 * sy))
        path.addLine(to: CGPoint(x: 23 * sx, y: 36 * sy))
        return path
    }
}

private struct BubblesShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 32, sy = rect.height / 40
        var path = Path()
        for (x, y, r) in [(13.0, 16.0, 0.9), (18.0, 14.5, 0.75), (15.5, 19.0, 0.6)] {
            path.addEllipse(in: CGRect(
                x: (x - r) * sx, y: (y - r) * sy,
                width: 2 * r * sx, height: 2 * r * sy
            ))
        }
        return path
    }
}

// MARK: - Rating badges

/// `93S` pill — the rating followed by the reviewer's initial.
struct RatingBadge: View {
    var rating: Double
    var initials: String?

    private var ratingText: String {
        rating.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(rating))
            : String(format: "%.1f", rating)
    }

    var body: some View {
        HStack(spacing: 1) {
            Text(ratingText)
                .fontWeight(.semibold)
                .monospacedDigit()
            if let initials {
                Text(initials).opacity(0.8)
            }
        }
        .font(.caption2)
        .fixedSize()
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Color.burgundyGradient, in: Capsule())
        .foregroundStyle(.white)
    }
}

struct RatingBadges: View {
    var ratings: [RatingSummary]

    var body: some View {
        if !ratings.isEmpty {
            HStack(spacing: 4) {
                ForEach(ratings) { entry in
                    if let rating = entry.rating {
                        RatingBadge(rating: rating, initials: entry.initials)
                    }
                }
            }
        }
    }
}

// MARK: - Drinking window

/// Extract the first 19xx/20xx year from free-text window fields.
func windowYear(_ value: String?) -> Int? {
    guard let value else { return nil }
    guard let range = value.range(of: #"(19|20)\d{2}"#, options: .regularExpression) else {
        return nil
    }
    return Int(value[range])
}

/// `start → end` with per-year urgency coloring, mirroring the web DrinkingWindow.
struct DrinkingWindowView: View {
    var start: String?
    var end: String?
    var referenceYear: Int = Calendar.current.component(.year, from: .now)

    var body: some View {
        if start == nil && end == nil {
            Text("—").foregroundStyle(.secondary)
        } else {
            HStack(spacing: 3) {
                yearText(start, fallback: "now")
                Text("→").foregroundStyle(.secondary.opacity(0.5))
                yearText(end, fallback: "open")
            }
            .font(.subheadline)
        }
    }

    @ViewBuilder
    private func yearText(_ value: String?, fallback: String) -> some View {
        if let value, !value.isEmpty {
            let year = windowYear(value)
            Text(value)
                .fontWeight(year == referenceYear ? .medium : .regular)
                .foregroundStyle(yearColor(year))
                .opacity(year != nil && year! < referenceYear ? 0.5 : 1)
        } else {
            Text(fallback).foregroundStyle(.secondary)
        }
    }

    private func yearColor(_ year: Int?) -> Color {
        guard let year else { return .secondary }
        if year < referenceYear { return .secondary }
        if year == referenceYear { return .windowCurrent }
        return .windowFuture
    }
}

// MARK: - Inventory delta badge

struct InventoryDeltaBadge: View {
    var delta: Int

    var body: some View {
        Text(delta > 0 ? "+\(delta)" : "\(delta)")
            .font(.caption)
            .fontWeight(.medium)
            .monospacedDigit()
            .frame(minWidth: 36)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(background, in: Capsule())
            .overlay(Capsule().stroke(border, lineWidth: 1))
            .foregroundStyle(foreground)
    }

    private var background: Color {
        if delta > 0 { return .deltaUpFill }
        if delta < 0 { return .deltaDownFill }
        return .clear
    }

    private var border: Color {
        if delta > 0 { return .deltaUpEdge }
        if delta < 0 { return .deltaDownEdge }
        return Color.secondary.opacity(0.3)
    }

    private var foreground: Color {
        if delta > 0 { return .deltaUpText }
        if delta < 0 { return .deltaDownText }
        return .primary
    }
}

// MARK: - Small text badges

struct TextBadge: View {
    enum Variant { case filled, secondary, outline, destructive }

    var text: String
    var variant: Variant = .outline

    var body: some View {
        Text(text)
            .font(.caption2)
            .fontWeight(.medium)
            .fixedSize()
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(background, in: Capsule())
            .overlay(
                Capsule().stroke(
                    variant == .outline ? Color.secondary.opacity(0.35) : .clear,
                    lineWidth: 1
                )
            )
            .foregroundStyle(foreground)
    }

    private var background: Color {
        switch variant {
        case .filled: .accentColor
        case .secondary: Color.secondary.opacity(0.15)
        case .outline: .clear
        case .destructive: Color.red.opacity(0.12)
        }
    }

    private var foreground: Color {
        switch variant {
        case .filled: .white
        case .secondary: .primary
        case .outline: .secondary
        case .destructive: .red
        }
    }
}

// MARK: - Flow layout

/// Wraps subviews onto new lines when a row runs out of width, so badge rows
/// never get width-compressed.
struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            totalWidth = max(totalWidth, x - spacing)
        }
        return CGSize(width: proposal.width ?? totalWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Formatters

enum Format {
    /// `$12.50` — most screens hard-code USD.
    static func dollars(_ value: Double, fractionDigits: Int = 2) -> String {
        String(format: "$%.\(fractionDigits)f", value)
    }

    /// Currency-aware price used on the Ordered screen.
    static func price(_ value: Double, currency: String?) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = (currency?.isEmpty == false ? currency! : "USD")
        formatter.locale = Locale(identifier: "en_US")
        return formatter.string(from: NSNumber(value: value))
            ?? "\(String(format: "%.2f", value)) \(currency ?? "USD")"
    }

    /// `Mar 14` from `YYYY-MM-DD`; falls back to the raw string.
    static func shortDate(_ iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.locale = Locale(identifier: "en_US_POSIX")
        guard let date = parser.date(from: iso) else { return iso }
        let printer = DateFormatter()
        printer.dateFormat = "MMM d"
        printer.locale = Locale(identifier: "en_US")
        return printer.string(from: date)
    }

    /// `1.5 L` / `750 mL`; nil defaults to 750.
    static func bottleSize(_ ml: Int?) -> String {
        let size = ml ?? 750
        if size >= 1000 {
            let liters = Double(size) / 1000
            return liters.truncatingRemainder(dividingBy: 1) == 0
                ? "\(Int(liters)) L"
                : String(format: "%.1f L", liters)
        }
        return "\(size) mL"
    }

    static func todayISO() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: .now)
    }

    static func isoDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: date)
    }

    static func parseISODate(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.date(from: String(iso.prefix(10)))
    }
}

// MARK: - Async content wrapper

/// Standard loading / error / loaded scaffolding used by every screen.
struct AsyncContent<Value, Content: View>: View {
    var value: Value?
    var error: String?
    var retry: () -> Void
    @ViewBuilder var content: (Value) -> Content

    var body: some View {
        if let value {
            content(value)
        } else if let error {
            ContentUnavailableView {
                Label("Couldn't load", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Retry", action: retry)
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, minHeight: 160)
        }
    }
}
