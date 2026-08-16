import SwiftUI

struct StatsView: View {
    @State private var stats: StatsPayload?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            AsyncContent(value: stats, error: error, retry: { Task { await load() } }) { stats in
                List {
                    summarySection(stats)
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
                    spendSection(stats)
                    topRatedSection(stats)
                    recentTastingsSection(stats)
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
            .navigationTitle("Stats")
            .navigationDestination(for: Int.self) { wineId in
                WineDetailView(wineId: wineId)
            }
            .task { if stats == nil { await load() } }
        }
    }

    private func load() async {
        do {
            stats = try await CellarAPI.shared.stats()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
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
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
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
    }

    @ViewBuilder
    private func spendSection(_ stats: StatsPayload) -> some View {
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
                                RatingBadge(rating: rating, initials: nil, name: nil)
                            }
                        }
                    }
                }
            }
        } header: {
            Text("Top rated")
        } footer: {
            Text("Average across all reviewers.")
        }
    }

    @ViewBuilder
    private func recentTastingsSection(_ stats: StatsPayload) -> some View {
        if !stats.recentTastings.isEmpty {
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
                                RatingBadge(
                                    rating: Double(rating),
                                    initials: tasting.userInitials,
                                    name: tasting.userName
                                )
                            }
                        }
                    }
                }
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
