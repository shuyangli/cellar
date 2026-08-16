import SwiftUI

struct WishlistListView: View {
    @State private var entries: [WishlistEntry]?
    @State private var error: String?
    @State private var pendingIds: Set<Int> = []
    @State private var rowErrors: [Int: String] = [:]
    @State private var showAddForm = false

    var body: some View {
        AsyncContent(value: entries, error: error, retry: { Task { await load() } }) { entries in
            List {
                if entries.isEmpty {
                    ContentUnavailableView(
                        "Nothing on the wishlist yet",
                        systemImage: "heart",
                        description: Text("Add the next thing someone recommends.")
                    )
                }
                ForEach(entries) { entry in
                    WishlistRow(
                        entry: entry,
                        pending: pendingIds.contains(entry.id),
                        error: rowErrors[entry.id],
                        remove: { Task { await remove(entry) } }
                    )
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await load() }
        }
        .navigationTitle("Wishlist")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showAddForm = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showAddForm) {
            WishlistForm { Task { await load() } }
        }
        .task { if entries == nil { await load() } }
    }

    private func load() async {
        do {
            entries = try await CellarAPI.shared.wishlist()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ entry: WishlistEntry) async {
        guard !pendingIds.contains(entry.id) else { return }
        pendingIds.insert(entry.id)
        rowErrors[entry.id] = nil
        do {
            try await CellarAPI.shared.wishlistRemove(entry.id)
            await load()
        } catch {
            rowErrors[entry.id] = error.localizedDescription
        }
        pendingIds.remove(entry.id)
    }
}

struct WishlistRow: View {
    var entry: WishlistEntry
    var pending: Bool
    var error: String?
    var remove: () -> Void

    private var meta: String {
        var parts: [String] = []
        if let by = entry.recommendedBy, !by.isEmpty { parts.append("via \(by)") }
        let origin = [entry.region, entry.country]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: ", ")
        if !origin.isEmpty { parts.append(origin) }
        if let shop = entry.shopName, !shop.isEmpty { parts.append(shop) }
        if let price = entry.listedPrice { parts.append(Format.dollars(price)) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        NavigationLink(value: entry.wineId) {
            HStack(alignment: .top, spacing: 10) {
                WineTypeIcon(wineType: entry.wineType, size: 34)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(entry.wineTitle)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(2)
                        if entry.quantity > 0 {
                            TextBadge(text: "already have \(entry.quantity)", variant: .secondary)
                        }
                    }
                    if !meta.isEmpty {
                        Text(meta)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let reason = entry.reason, !reason.isEmpty {
                        Text(reason).font(.caption)
                    }
                    if let error {
                        Text(error).font(.caption2).foregroundStyle(.red)
                    }
                }
            }
            .opacity(pending ? 0.5 : 1)
        }
        .swipeActions {
            Button(pending ? "Removing…" : "Remove", role: .destructive, action: remove)
        }
        .disabled(pending)
    }
}

// MARK: - Add to wishlist

struct WishlistForm: View {
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedWine: Wine?
    @State private var producer = ""
    @State private var wineName = ""
    @State private var vintage = ""
    @State private var wineType = ""
    @State private var region = ""
    @State private var country = ""
    @State private var recommendedBy = ""
    @State private var shopName = ""
    @State private var priceText = ""
    @State private var reason = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Records a wine to try later without adding any bottles to inventory.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                WinePickerSection(
                    selected: $selectedWine,
                    producer: $producer,
                    wineName: $wineName,
                    vintage: $vintage,
                    wineType: $wineType,
                    region: $region,
                    country: $country
                )
                Section("Details") {
                    TextField("Who suggested it?", text: $recommendedBy)
                    TextField("Seen at (optional)", text: $shopName)
                    TextField("Listed price (optional)", text: $priceText)
                        .keyboardType(.decimalPad)
                    TextField("What did they say about it?", text: $reason, axis: .vertical)
                        .lineLimit(2...5)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Add to the wishlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Add") { Task { await save() } }
                        .disabled(saving)
                }
            }
        }
    }

    private func save() async {
        var price: Double?
        let trimmedPrice = priceText.trimmingCharacters(in: .whitespaces)
        if !trimmedPrice.isEmpty {
            guard let value = Double(trimmedPrice), value >= 0 else {
                error = "Price must be a number of 0 or more."
                return
            }
            price = value
        }

        saving = true
        error = nil
        let picker = WinePickerSection(
            selected: $selectedWine,
            producer: $producer, wineName: $wineName, vintage: $vintage,
            wineType: $wineType, region: $region, country: $country
        )
        do {
            let wineId = try await picker.resolveWineId()
            var fields: [String: Any] = [
                "wine_id": wineId,
                "recommended_by": recommendedBy.trimmingCharacters(in: .whitespaces),
                "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
                "shop_name": shopName.trimmingCharacters(in: .whitespaces),
            ]
            if let price { fields["listed_price"] = price }
            try await CellarAPI.shared.wishlistAdd(fields)
            onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
