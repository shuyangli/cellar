import SwiftUI

/// Result of the shared "match an existing wine or describe a new one" block
/// used by the external tasting and wishlist forms.
enum WineSelection {
    case existing(Wine)
    case newWine(fields: [String: Any])
}

/// Searches the cellar (including out-of-stock wines) or collects the fields
/// for a brand-new label. Mirrors the web app's wine-matching section.
struct WinePickerSection: View {
    @Binding var selected: Wine?
    @Binding var producer: String
    @Binding var wineName: String
    @Binding var vintage: String
    @Binding var wineType: String
    @Binding var region: String
    @Binding var country: String

    @State private var searchTerm = ""
    @State private var results: [Wine] = []
    @State private var searched = false
    @State private var searching = false

    var body: some View {
        Section("Wine") {
            if let wine = selected {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(wine.title).font(.subheadline.weight(.medium))
                        if wine.quantity > 0 {
                            Text("\(wine.quantity) in cellar")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Button("Change") {
                        selected = nil
                        searched = false
                        results = []
                    }
                    .font(.callout)
                }
            } else {
                HStack {
                    TextField("Search wines already on file…", text: $searchTerm)
                        .onSubmit { Task { await search() } }
                    Button(searching ? "…" : "Search") { Task { await search() } }
                        .disabled(searching || searchTerm.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if searched {
                    if results.isEmpty {
                        Text("No match — fill in the details below to add it.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(results) { wine in
                            Button {
                                selected = wine
                            } label: {
                                HStack {
                                    Text(wine.title)
                                        .font(.subheadline)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    if wine.quantity > 0 {
                                        Text("\(wine.quantity) in cellar")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
                TextField("Producer (required)", text: $producer)
                TextField("Wine name (required)", text: $wineName)
                TextField("Vintage", text: $vintage)
                Picker("Type", selection: $wineType) {
                    Text("Type…").tag("")
                    ForEach(WineType.allCases) { Text($0.label).tag($0.rawValue) }
                }
                TextField("Region", text: $region)
                TextField("Country", text: $country)
            }
        }
    }

    private func search() async {
        let term = searchTerm.trimmingCharacters(in: .whitespaces)
        guard !term.isEmpty else { return }
        searching = true
        do {
            let page = try await CellarAPI.shared.listCellar(
                page: 1, pageSize: 8, q: term, inStockOnly: false
            )
            results = page.items
            searched = true
        } catch {
            results = []
            searched = true
        }
        searching = false
    }

    /// Resolve the selection, creating the wine (quantity 0) when it's new.
    func resolveWineId() async throws -> Int {
        if let wine = selected { return wine.id }
        let trimmedProducer = producer.trimmingCharacters(in: .whitespaces)
        let trimmedName = wineName.trimmingCharacters(in: .whitespaces)
        guard !trimmedProducer.isEmpty, !trimmedName.isEmpty else {
            throw APIError.server("Producer and wine name are required.")
        }
        let wine = try await CellarAPI.shared.createWine([
            "producer": trimmedProducer,
            "wine_name": trimmedName,
            "vintage": vintage.trimmingCharacters(in: .whitespaces),
            "wine_type": wineType,
            "region": region.trimmingCharacters(in: .whitespaces),
            "country": country.trimmingCharacters(in: .whitespaces),
            "quantity": 0,
        ])
        return wine.id
    }
}
