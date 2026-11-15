import SwiftUI

private enum StatsWidth: Comparable {
    case narrow, medium, wide

    init(_ width: CGFloat) {
        self = width < 640 ? .narrow : width < 800 ? .medium : .wide
    }
}

/// A single list in narrow windows; a two-column dashboard, split at the fold, from 640pt.
struct StatsView: View {
    @State private var stats: StatsPayload?
    @State private var error: String?
    @State private var width = StatsWidth.narrow

    var body: some View {
        NavigationStack {
            AsyncContent(value: stats, error: error, retry: { Task { await load() } }) { stats in
                if width > .narrow {
                    StatsDashboard(stats: stats, showsTastingCounts: width == .wide)
                } else {
                    StatsList(stats: stats)
                }
            }
            .refreshable { await load() }
            .onGeometryChange(for: StatsWidth.self) { StatsWidth($0.size.width) } action: { width = $0 }
            .navigationTitle("Stats")
            .navigationDestination(for: Int.self) { wineId in
                WineDetailView(wineId: wineId, onChanged: { _ in Task { await load() } })
            }
            .task { if stats == nil { await load() } }
        }
        .winePresenterHost()
    }

    private func load() async {
        do {
            stats = try await CellarAPI.shared.stats()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Narrow: one list

private struct StatsList: View {
    var stats: StatsPayload

    var body: some View {
        List {
            Group {
                Section {
                    StatsSummaryRow(summary: stats.summary)
                        .listRowInsets(EdgeInsets(top: 12, leading: 8, bottom: 12, trailing: 8))
                }
                barSection("By type", bars: stats.typeBars, emptyText: "Nothing in stock.")
                barSection("By country", bars: stats.countryBars, emptyText: "Nothing in stock.")
                barSection("By region", bars: stats.regionBars, emptyText: "Nothing in stock.")
                barSection(
                    "Spend by month",
                    bars: stats.spendBars,
                    emptyText: "No purchases logged.",
                    footer: "Last 12 months with purchases."
                )
                Section {
                    if stats.topRated.isEmpty {
                        Text("No ratings yet.").foregroundStyle(.secondary)
                    } else {
                        ForEach(stats.topRated) { wine in
                            NavigationLink(value: wine.id) { TopRatedRow(wine: wine) }
                        }
                    }
                } header: {
                    Text("Top rated")
                } footer: {
                    Text("Average across all reviewers.")
                }
                if !stats.recentTastings.isEmpty {
                    Section("Recent tastings") {
                        ForEach(stats.recentTastings) { tasting in
                            NavigationLink(value: tasting.wineId) { RecentTastingRow(tasting: tasting) }
                        }
                    }
                }
            }
            .listRowBackground(Color.appCard)
        }
        .listStyle(.insetGrouped)
        .cellarBackground()
    }

    private func barSection(
        _ title: String,
        bars: [StatsBar],
        emptyText: String,
        footer: String? = nil
    ) -> some View {
        Section {
            if bars.isEmpty {
                Text(emptyText).foregroundStyle(.secondary)
            } else {
                ForEach(bars) { BarRow(label: $0.label, fraction: $0.fraction, value: $0.value) }
            }
        } header: {
            Text(title)
        } footer: {
            if let footer {
                Text(footer)
            }
        }
    }
}

// MARK: - Wide: dashboard

/// The cellar's composition on the leading side of the fold, activity on the trailing side.
private struct StatsDashboard: View {
    var stats: StatsPayload
    var showsTastingCounts: Bool

    @State private var fold: ClosedRange<CGFloat>?

    var body: some View {
        ScrollView {
            FoldColumns(fold: fold) {
                VStack(spacing: 22) {
                    StatsCard(title: "Cellar") {
                        StatsSummaryRow(summary: stats.summary)
                            .padding(.vertical, 6)
                    }
                    barCard("By type", bars: stats.typeBars, emptyText: "Nothing in stock.")
                    barCard("By country", bars: stats.countryBars, emptyText: "Nothing in stock.")
                    barCard("By region", bars: stats.regionBars, emptyText: "Nothing in stock.")
                }
                VStack(spacing: 22) {
                    barCard(
                        "Spend by month",
                        bars: stats.spendBars,
                        emptyText: "No purchases logged.",
                        footer: "Last 12 months with purchases."
                    )
                    StatsCard(title: "Top rated", footer: "Average across all reviewers.") {
                        if stats.topRated.isEmpty {
                            emptyRow("No ratings yet.")
                        } else {
                            DividedRows(items: stats.topRated) { wine in
                                wineLink(wine.id) { TopRatedRow(wine: wine, showsTastingCount: showsTastingCounts) }
                            }
                        }
                    }
                    if !stats.recentTastings.isEmpty {
                        StatsCard(title: "Recent tastings") {
                            DividedRows(items: stats.recentTastings) { tasting in
                                wineLink(tasting.wineId) { RecentTastingRow(tasting: tasting) }
                            }
                        }
                    }
                }
            }
            .onGeometryChange(for: ClosedRange<CGFloat>?.self) { verticalFold(in: $0) } action: { fold = $0 }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(CellarBackground())
    }

    private func barCard(
        _ title: String,
        bars: [StatsBar],
        emptyText: String,
        footer: String? = nil
    ) -> some View {
        StatsCard(title: title, footer: footer) {
            if bars.isEmpty {
                emptyRow(emptyText)
            } else {
                DividedRows(items: bars) { BarRow(label: $0.label, fraction: $0.fraction, value: $0.value) }
            }
        }
    }

    private func emptyRow(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(.secondary)
            .padding(.vertical, 10)
    }

    private func wineLink(_ wineId: Int, @ViewBuilder label: () -> some View) -> some View {
        NavigationLink(value: wineId) {
            HStack(spacing: 8) {
                label()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The horizontal extent of an active vertical fold that leaves room for a column on each side.
private func verticalFold(in proxy: GeometryProxy) -> ClosedRange<CGFloat>? {
    guard #available(iOS 27.1, *) else { return nil }
    let minColumn: CGFloat = 200
    return proxy.reservedRegions(kind: .division)
        .map(\.frame)
        .first { frame in
            frame.height > frame.width
                && frame.minX >= minColumn
                && frame.maxX <= proxy.size.width - minColumn
        }
        .map { $0.minX...$0.maxX }
}

/// Two top-aligned columns: either side of the fold when there is one, equal halves otherwise.
private struct FoldColumns: Layout {
    var fold: ClosedRange<CGFloat>?
    var spacing: CGFloat = 16

    private func columns(in width: CGFloat) -> [(x: CGFloat, width: CGFloat)] {
        if let fold, fold.lowerBound > 0, fold.upperBound < width {
            return [(0, fold.lowerBound), (fold.upperBound, width - fold.upperBound)]
        }
        let column = max(0, (width - spacing) / 2)
        return [(0, column), (column + spacing, column)]
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.replacingUnspecifiedDimensions().width
        let heights = zip(subviews, columns(in: width)).map { subview, column in
            subview.sizeThatFits(ProposedViewSize(width: column.width, height: nil)).height
        }
        return CGSize(width: width, height: heights.max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (subview, column) in zip(subviews, columns(in: bounds.width)) {
            subview.place(
                at: CGPoint(x: bounds.minX + column.x, y: bounds.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(width: column.width, height: nil)
            )
        }
    }
}

private struct StatsCard<Content: View>: View {
    var title: String?
    var footer: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let title {
                Text(title.uppercased())
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
            }
            VStack(alignment: .leading, spacing: 0) { content }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.appCard, in: RoundedRectangle(cornerRadius: 14))
            if let footer {
                Text(footer)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
            }
        }
    }
}

private struct DividedRows<Item: Identifiable, Row: View>: View {
    var items: [Item]
    @ViewBuilder var row: (Item) -> Row

    var body: some View {
        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
            if index > 0 {
                Divider()
            }
            row(item)
                .padding(.vertical, 10)
        }
    }
}

// MARK: - Shared rows

private struct StatsBar: Identifiable {
    var label: String
    var fraction: Double
    var value: String

    var id: String { label }
}

private extension StatsPayload {
    var typeBars: [StatsBar] { Self.countBars(byType.map { ($0.wineType, $0.bottles) }) }
    var countryBars: [StatsBar] { Self.countBars(byCountry.map { ($0.country, $0.bottles) }) }
    var regionBars: [StatsBar] { Self.countBars(byRegion.map { ($0.region, $0.bottles) }) }

    var spendBars: [StatsBar] {
        let months = spendByMonth.suffix(12)
        let maxSpend = max(1, months.map(\.spend).max() ?? 1)
        return months.map {
            StatsBar(
                label: $0.month ?? "—",
                fraction: $0.spend / maxSpend,
                value: Format.dollars($0.spend, fractionDigits: 0)
            )
        }
    }

    static func countBars(_ rows: [(label: String, count: Int)]) -> [StatsBar] {
        let maxCount = max(1, rows.map(\.count).max() ?? 1)
        return rows.map {
            StatsBar(label: $0.label, fraction: Double($0.count) / Double(maxCount), value: "\($0.count)")
        }
    }
}

private struct StatsSummaryRow: View {
    var summary: CellarSummary

    var body: some View {
        HStack(spacing: 0) {
            stat("\(summary.labels.bottles)", "bottles")
            stat("\(summary.labels.labels)", "labels")
            stat(summary.estimatedCost.map { Format.dollars($0, fractionDigits: 0) } ?? "—", "est. cost")
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title2.weight(.semibold))
                .fontDesign(.serif)
                .monospacedDigit()
                .foregroundStyle(Color.statNumber)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct TopRatedRow: View {
    var wine: TopRatedWine
    var showsTastingCount = true

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(wine.producer)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text([wine.wineName, wine.vintage].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if showsTastingCount {
                Text("\(wine.tastings) tasting\(wine.tastings == 1 ? "" : "s")")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize()
            }
            if let rating = wine.avgRating {
                RatingBadge(rating: rating, initials: nil)
            }
        }
    }
}

private struct RecentTastingRow: View {
    var tasting: RecentTasting

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text([tasting.producer, tasting.wineName, tasting.vintage]
                    .compactMap { $0?.isEmpty == false ? $0 : nil }
                    .joined(separator: " "))
                    .font(.subheadline)
                    .lineLimit(1)
                Text([tasting.tastedOn, tasting.userName]
                    .compactMap { $0?.isEmpty == false ? $0 : nil }
                    .joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if let rating = tasting.rating {
                RatingBadge(rating: Double(rating), initials: tasting.userInitials)
            }
        }
    }
}

struct BarRow: View {
    var label: String
    var fraction: Double
    var value: String

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
                .font(.caption)
                .frame(width: 96, alignment: .leading)
                .lineLimit(1)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.secondary.opacity(0.15))
                    Capsule()
                        .fill(Color.accentColor)
                        .frame(width: max(3, proxy.size.width * fraction))
                }
            }
            .frame(height: 8)
            Text(value)
                .font(.caption.weight(.medium))
                .monospacedDigit()
                .frame(minWidth: 36, alignment: .trailing)
        }
    }
}
