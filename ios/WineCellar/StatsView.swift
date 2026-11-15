import SwiftUI

struct StatsView: View {
    @State private var stats: StatsPayload?
    @State private var error: String?
    @State private var selectedWineId: Int?

    var body: some View {
        WineSplitView {
            StatsSidebar(stats: stats, error: error, selectedWineId: $selectedWineId, load: load)
        } detail: {
            StatsDetail(stats: stats, selectedWineId: $selectedWineId, load: load)
        }
        .task { if stats == nil { await load() } }
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

/// Every section in a single column; the summary and the selectable wines when
/// the breakdown has its own column.
private struct StatsSidebar: View {
    var stats: StatsPayload?
    var error: String?
    @Binding var selectedWineId: Int?
    var load: () async -> Void

    @Environment(\.wineSplitCollapsed) private var collapsed

    var body: some View {
        AsyncContent(value: stats, error: error, retry: { Task { await load() } }) { stats in
            List(selection: $selectedWineId) {
                summarySection(stats)
                if collapsed {
                    StatsBreakdownSections(stats: stats)
                }
                topRatedSection(stats)
                recentTastingsSection(stats)
            }
            .listStyle(.insetGrouped)
            .cellarBackground()
            .refreshable { await load() }
        }
        .navigationTitle("Stats")
    }

    private func summarySection(_ stats: StatsPayload) -> some View {
        Section {
            let labels = stats.summary.labels
            HStack(spacing: 0) {
                stat("\(labels.bottles)", "bottles")
                stat("\(labels.labels)", "labels")
                stat(
                    stats.summary.estimatedCost.map { Format.dollars($0, fractionDigits: 0) } ?? "—",
                    "est. cost"
                )
            }
            .listRowInsets(EdgeInsets(top: 12, leading: 8, bottom: 12, trailing: 8))
        }
        .listRowBackground(Color.appCard)
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

    @ViewBuilder
    private func topRatedSection(_ stats: StatsPayload) -> some View {
        Section {
            if stats.topRated.isEmpty {
                Text("No ratings yet.").foregroundStyle(.secondary)
            } else {
                ForEach(stats.topRated) { wine in
                    NavigationLink(value: wine.id) {
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
                            Spacer()
                            Text("\(wine.tastings) tasting\(wine.tastings == 1 ? "" : "s")")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            if let rating = wine.avgRating {
                                RatingBadge(rating: rating, initials: nil)
                            }
                        }
                        .foregroundStyle(Color.primary)
                    }
                    .tag(wine.id)
                    .wineRowBackground(selected: selectedWineId == wine.id)
                }
            }
        } header: {
            Text("Top rated")
        } footer: {
            Text("Average across all reviewers.")
        }
        .listRowBackground(Color.appCard)
    }

    @ViewBuilder
    private func recentTastingsSection(_ stats: StatsPayload) -> some View {
        if !stats.recentTastings.isEmpty {
            recentSection(stats)
        }
    }

    private func recentSection(_ stats: StatsPayload) -> some View {
        Section("Recent tastings") {
                ForEach(stats.recentTastings) { tasting in
                    NavigationLink(value: tasting.wineId) {
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
                            Spacer()
                            if let rating = tasting.rating {
                                RatingBadge(rating: Double(rating), initials: tasting.userInitials)
                            }
                        }
                        .foregroundStyle(Color.primary)
                    }
                    .tag(tasting.wineId)
                    .wineRowBackground(selected: selectedWineId == tasting.wineId)
                }
        }
        .listRowBackground(Color.appCard)
    }
}

private struct StatsDetail: View {
    var stats: StatsPayload?
    @Binding var selectedWineId: Int?
    var load: () async -> Void

    @Environment(\.wineSplitCollapsed) private var collapsed

    var body: some View {
        if let id = selectedWineId {
            WineDetailView(wineId: id, onChanged: { change in
                Task { await load() }
                if case .deleted = change { selectedWineId = nil }
            })
            .id(id)
            .toolbar {
                if !collapsed {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            selectedWineId = nil
                        } label: {
                            Image(systemName: "chart.bar")
                        }
                        .accessibilityLabel("Show breakdown")
                    }
                }
            }
        } else {
            breakdown.navigationTitle("Breakdown")
        }
    }

    @ViewBuilder
    private var breakdown: some View {
        if let stats {
            List {
                StatsBreakdownSections(stats: stats)
            }
            .listStyle(.insetGrouped)
            .cellarBackground()
            .refreshable { await load() }
        } else {
            CellarBackground()
        }
    }
}

private struct StatsBreakdownSections: View {
    var stats: StatsPayload

    var body: some View {
        barSection(
            "By type",
            rows: stats.byType.map { ($0.wineType, $0.bottles) },
            emptyText: "Nothing in stock."
        )
        barSection(
            "By country",
            rows: stats.byCountry.map { ($0.country, $0.bottles) },
            emptyText: "Nothing in stock."
        )
        barSection(
            "By region",
            rows: stats.byRegion.map { ($0.region, $0.bottles) },
            emptyText: "Nothing in stock."
        )
        spendSection
    }

    @ViewBuilder
    private func barSection(
        _ title: String,
        rows: [(label: String, value: Int)],
        emptyText: String
    ) -> some View {
        Section(title) {
            if rows.isEmpty {
                Text(emptyText).foregroundStyle(.secondary)
            } else {
                let maxValue = max(1, rows.map(\.value).max() ?? 1)
                ForEach(rows, id: \.label) { row in
                    BarRow(
                        label: row.label,
                        fraction: Double(row.value) / Double(maxValue),
                        value: "\(row.value)"
                    )
                }
            }
        }
        .listRowBackground(Color.appCard)
    }

    @ViewBuilder
    private var spendSection: some View {
        Section {
            let months = stats.spendByMonth.suffix(12)
            if months.isEmpty {
                Text("No purchases logged.").foregroundStyle(.secondary)
            } else {
                let maxSpend = max(1, months.map(\.spend).max() ?? 1)
                ForEach(Array(months)) { month in
                    BarRow(
                        label: month.month ?? "—",
                        fraction: month.spend / maxSpend,
                        value: Format.dollars(month.spend, fractionDigits: 0)
                    )
                }
            }
        } header: {
            Text("Spend by month")
        } footer: {
            Text("Last 12 months with purchases.")
        }
        .listRowBackground(Color.appCard)
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
