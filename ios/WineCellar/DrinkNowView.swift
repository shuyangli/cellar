import SwiftUI

struct DrinkNowView: View {
    @State private var payload: DrinkNowPayload?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            AsyncContent(value: payload, error: error, retry: { Task { await load() } }) { payload in
                List {
                    bucket("Past peak", payload.pastPeak, .destructive, payload.year,
                           "Probably fading — open these first, adjust expectations.")
                    bucket("Drink first", payload.drinkFirst, .destructive, payload.year,
                           "In their window with a year or less left — prioritize these.")
                    bucket("Drink soon", payload.drinkSoon, .filled, payload.year,
                           "Ready now with two to three years left in the window.")
                    bucket("Ready, can hold", payload.readyToHold, .secondary, payload.year,
                           "Good to open, but still worth aging.")
                    bucket("Long-term potential", payload.longTerm, .outline, payload.year,
                           "The window runs eight or more years — aging may add complexity.")
                    bucket("Hold", payload.approaching, .secondary, payload.year,
                           "The drinking window has not opened yet.")
                    bucket("No window set", payload.noWindow, .outline, payload.year,
                           "Ask your agent to research drinking windows for these.")
                }
                .listStyle(.insetGrouped)
                .cellarBackground()
                .refreshable { await load() }
            }
            .navigationTitle("Drink Now")
            .navigationDestination(for: Int.self) { wineId in
                WineDetailView(wineId: wineId)
            }
            .task { if payload == nil { await load() } }
        }
    }

    @ViewBuilder
    private func bucket(
        _ title: String,
        _ wines: [DrinkNowWine],
        _ badgeVariant: TextBadge.Variant,
        _ year: Int,
        _ description: String
    ) -> some View {
        if !wines.isEmpty {
            Section {
                ForEach(wines) { wine in
                    NavigationLink(value: wine.id) {
                        HStack(spacing: 10) {
                            WineTypeIcon(wineType: wine.wineType, size: 32)
                            TextBadge(text: "×\(wine.quantity)", variant: .secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(wine.producer)
                                    .font(.subheadline.weight(.medium))
                                    .lineLimit(1)
                                Text(
                                    [
                                        [wine.wineName, wine.vintage].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " "),
                                        [wine.region, wine.wineType].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "),
                                    ]
                                    .filter { !$0.isEmpty }
                                    .joined(separator: " — ")
                                )
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                            }
                            Spacer()
                            DrinkingWindowView(
                                start: wine.drinkingWindowStart,
                                end: wine.drinkingWindowEnd,
                                referenceYear: year
                            )
                            .font(.caption)
                        }
                    }
                }
            } header: {
                HStack {
                    Text(title)
                    TextBadge(text: "\(wines.count)", variant: badgeVariant)
                }
            } footer: {
                Text(description)
            }
            .listRowBackground(Color.appCard)
        }
    }

    private func load() async {
        do {
            payload = try await CellarAPI.shared.drinkNow()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
