import SwiftUI

struct WineDetailView: View {
    var wineId: Int

    @Environment(\.dismiss) private var dismiss
    @State private var wine: Wine?
    @State private var error: String?
    @State private var actionError: String?
    @State private var pending = false
    @State private var showEdit = false
    @State private var showLogTasting = false
    @State private var adjustDirection: Int?
    @State private var adjustReason = "manual correction"
    @State private var markDrunkPrompt = false
    @State private var drinkCountText = "1"
    @State private var confirmDelete = false

    var body: some View {
        AsyncContent(value: wine, error: error, retry: { Task { await load() } }) { wine in
            List {
                headerSection(wine)
                actionsSection(wine)
                detailsSection(wine)
                photosSection(wine)
                tastingsSection(wine)
                purchasesSection(wine)
                eventsSection(wine)
            }
            .listStyle(.insetGrouped)
            .refreshable { await load() }
        }
        .navigationTitle(wine?.producer ?? "Wine")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $showEdit) {
            if let wine {
                EditWineForm(wine: wine) { Task { await load() } }
            }
        }
        .sheet(isPresented: $showLogTasting) {
            if let wine {
                LogTastingForm(wine: wine) { Task { await load() } }
            }
        }
        .alert(
            adjustDirection == 1 ? "Reason for adding a bottle?" : "Reason for removing a bottle?",
            isPresented: Binding(
                get: { adjustDirection != nil },
                set: { if !$0 { adjustDirection = nil } }
            )
        ) {
            TextField("Reason", text: $adjustReason)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                if let direction = adjustDirection {
                    Task { await adjust(delta: direction, reason: adjustReason, eventType: "adjust") }
                }
            }
        }
        .alert("How many bottles did you drink?", isPresented: $markDrunkPrompt) {
            TextField("Count", text: $drinkCountText)
                .keyboardType(.numberPad)
            Button("Cancel", role: .cancel) {}
            Button("Mark drunk") {
                Task { await markDrunk() }
            }
        } message: {
            Text("\(wine?.quantity ?? 0) in cellar")
        }
        .confirmationDialog(
            "Delete \"\(wine?.producer ?? "") \(wine?.wineName ?? "")\" and ALL its purchases, tastings, and photos? This cannot be undone.",
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button("Delete wine", role: .destructive) {
                Task { await deleteWine() }
            }
        }
    }

    // MARK: Sections

    private func headerSection(_ wine: Wine) -> some View {
        Section {
            HStack(alignment: .top, spacing: 12) {
                WineTypeIcon(wineType: wine.wineType, size: 48)
                    .padding(8)
                    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 4) {
                    Text(wine.producer)
                        .font(.title3.weight(.semibold))
                    Text([wine.wineName, wine.vintage].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    HStack(spacing: 4) {
                        if let type = wine.wineType, !type.isEmpty {
                            TextBadge(text: type, variant: .outline)
                        }
                        if let varietal = wine.varietal, !varietal.isEmpty {
                            TextBadge(text: varietal, variant: .secondary)
                        }
                        RatingBadges(ratings: wine.ratings ?? [])
                        if (wine.ratings?.count ?? 0) > 1, let avg = wine.avgRating {
                            TextBadge(text: "\(avg.formatted()) avg", variant: .outline)
                        }
                    }
                }
                Spacer()
                VStack(spacing: 0) {
                    Text("\(wine.quantity)")
                        .font(.title.weight(.bold))
                        .monospacedDigit()
                    Text(wine.quantity == 1 ? "bottle" : "bottles")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            if let actionError {
                Text(actionError)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
    }

    private func actionsSection(_ wine: Wine) -> some View {
        Section {
            Button {
                drinkCountText = "1"
                markDrunkPrompt = true
            } label: {
                Label("Mark drunk", systemImage: "wineglass")
            }
            .disabled(wine.quantity < 1 || pending)

            Button {
                showLogTasting = true
            } label: {
                Label("Log a tasting", systemImage: "square.and.pencil")
            }

            HStack {
                Button {
                    adjustReason = "manual correction"
                    adjustDirection = 1
                } label: {
                    Label("+1 bottle", systemImage: "plus.circle")
                }
                .buttonStyle(.borderless)
                .disabled(pending)
                Spacer()
                Button {
                    adjustReason = "manual correction"
                    adjustDirection = -1
                } label: {
                    Label("−1 bottle", systemImage: "minus.circle")
                }
                .buttonStyle(.borderless)
                .disabled(wine.quantity < 1 || pending)
            }

            Button {
                showEdit = true
            } label: {
                Label("Edit details", systemImage: "pencil")
            }

            Button(role: .destructive) {
                confirmDelete = true
            } label: {
                Label("Delete wine", systemImage: "trash")
            }
        }
    }

    @ViewBuilder
    private func detailsSection(_ wine: Wine) -> some View {
        Section("Details") {
            fact("Country", wine.country)
            fact("Region", wine.region)
            fact("Appellation", wine.appellation)
            fact("Grapes", wine.grapes?.isEmpty == false ? wine.grapes : wine.varietal)
            fact("Bottle size", "\(wine.bottleSizeMl ?? 750) mL")
            if wine.drinkingWindowStart != nil || wine.drinkingWindowEnd != nil {
                LabeledContent("Drinking window") {
                    DrinkingWindowView(start: wine.drinkingWindowStart, end: wine.drinkingWindowEnd)
                }
            }
            fact("Location", wine.location)
            fact("Last paid", wine.acquiredPrice.map { Format.dollars($0) })
            fact("Last vendor", wine.acquiredFrom)
            if let notes = wine.notes, !notes.isEmpty {
                Text(notes)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func fact(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            LabeledContent(label, value: value)
        }
    }

    @ViewBuilder
    private func photosSection(_ wine: Wine) -> some View {
        if let photos = wine.photos, !photos.isEmpty {
            Section("Photos") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(photos) { photo in
                            if let path = photo.path, let url = CellarAPI.shared.photoURL(path) {
                                PhotoThumbnail(url: url, kind: photo.kind)
                            }
                        }
                    }
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
            }
        }
    }

    private func tastingsSection(_ wine: Wine) -> some View {
        Section {
            let tastings = (wine.tastings ?? []).reversed()
            if tastings.isEmpty {
                Text("Not tasted yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(tastings)) { tasting in
                    TastingRow(tasting: tasting) {
                        Task { await load() }
                    }
                }
            }
        } header: {
            Text("Tastings & reviews")
        } footer: {
            let count = wine.tastings?.count ?? 0
            if count > 0 {
                Text("\(count) tasting\(count == 1 ? "" : "s") logged")
            }
        }
    }

    @ViewBuilder
    private func purchasesSection(_ wine: Wine) -> some View {
        Section("Purchases") {
            let purchases = wine.purchases ?? []
            if purchases.isEmpty {
                Text("No purchases recorded.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(purchases) { purchase in
                    PurchaseRow(purchase: purchase) {
                        Task { await load() }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func eventsSection(_ wine: Wine) -> some View {
        let events = (wine.events ?? []).reversed()
        if !events.isEmpty {
            Section("Inventory history") {
                ForEach(Array(events)) { event in
                    HStack(spacing: 10) {
                        InventoryDeltaBadge(delta: event.delta)
                        Text(event.reason?.isEmpty == false ? event.reason! : event.eventType)
                            .font(.footnote)
                        Spacer()
                        Text(String((event.occurredAt ?? "").prefix(10)))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: Actions

    private func load() async {
        do {
            wine = try await CellarAPI.shared.getWine(wineId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func adjust(delta: Int, reason: String, eventType: String) async {
        pending = true
        actionError = nil
        do {
            try await CellarAPI.shared.adjustInventory(
                wineId: wineId, delta: delta, reason: reason, eventType: eventType
            )
            await load()
        } catch {
            actionError = error.localizedDescription
        }
        pending = false
    }

    private func markDrunk() async {
        guard let wine else { return }
        guard let count = Int(drinkCountText.trimmingCharacters(in: .whitespaces)),
              count >= 1, count <= wine.quantity
        else {
            actionError = "Enter a whole number between 1 and \(wine.quantity) bottle\(wine.quantity == 1 ? "" : "s")."
            return
        }
        await adjust(delta: -count, reason: "drunk (marked in iOS app)", eventType: "consume")
    }

    private func deleteWine() async {
        pending = true
        do {
            try await CellarAPI.shared.deleteWine(wineId)
            dismiss()
        } catch {
            actionError = error.localizedDescription
        }
        pending = false
    }
}

// MARK: - Rows

struct PhotoThumbnail: View {
    var url: URL
    var kind: String?

    @State private var fullScreen = false

    var body: some View {
        Button {
            fullScreen = true
        } label: {
            AsyncImage(url: url) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                ProgressView()
            }
            .frame(width: 120, height: 160)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.secondary.opacity(0.25), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(kind ?? "photo")
        .fullScreenCover(isPresented: $fullScreen) {
            ZStack(alignment: .topTrailing) {
                Color.black.ignoresSafeArea()
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fit)
                } placeholder: {
                    ProgressView().tint(.white)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                Button {
                    fullScreen = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title)
                        .foregroundStyle(.white.opacity(0.8))
                        .padding()
                }
            }
        }
    }
}

struct TastingRow: View {
    var tasting: Tasting
    var onChanged: () -> Void

    @State private var editing = false
    @State private var confirmDelete = false
    @State private var error: String?

    private var meta: String {
        var parts: [String] = []
        if let date = tasting.tastedOn, !date.isEmpty { parts.append(date) }
        if let context = tasting.contextType, !context.isEmpty, context != "home" {
            parts.append(context)
        }
        if let venue = tasting.venue, !venue.isEmpty { parts.append(venue) }
        if let price = tasting.pricePaid { parts.append(Format.dollars(price)) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if let rating = tasting.rating {
                    RatingBadge(
                        rating: Double(rating),
                        initials: tasting.userInitials,
                        name: tasting.userName
                    )
                }
                Text(tasting.userName ?? "Unknown")
                    .font(.subheadline.weight(.medium))
                if (tasting.buyAgain ?? 0) != 0 {
                    TextBadge(text: "would buy again", variant: .outline)
                }
                Spacer()
                Menu {
                    Button("Edit") { editing = true }
                    Button("Delete", role: .destructive) { confirmDelete = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(.secondary)
                }
            }
            if !meta.isEmpty {
                Text(meta)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let notes = tasting.tastingNotes, !notes.isEmpty {
                Text(notes).font(.footnote)
            }
            if let pairing = tasting.foodPairing, !pairing.isEmpty {
                Text("Paired with \(pairing)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let error {
                Text(error).font(.caption2).foregroundStyle(.red)
            }
        }
        .padding(.vertical, 2)
        .sheet(isPresented: $editing) {
            TastingEditor(tasting: tasting, onSaved: onChanged)
        }
        .confirmationDialog(
            "Delete this tasting? Any bottle it consumed will be returned to inventory.",
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button("Delete tasting", role: .destructive) {
                Task {
                    do {
                        try await CellarAPI.shared.deleteTasting(tasting.id)
                        onChanged()
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
        }
    }
}

struct PurchaseRow: View {
    var purchase: Purchase
    var onChanged: () -> Void

    @State private var confirmDelete = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(purchase.purchaseDate ?? "—")
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text("\(purchase.quantity) × \(purchase.pricePerBottle.map { Format.price($0, currency: purchase.currency) } ?? "—")")
                    .font(.subheadline)
                    .monospacedDigit()
            }
            HStack {
                Text([purchase.vendor, purchase.source].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            if let notes = purchase.notes, !notes.isEmpty {
                Text(notes)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let error {
                Text(error).font(.caption2).foregroundStyle(.red)
            }
        }
        .swipeActions {
            Button("Delete", role: .destructive) { confirmDelete = true }
        }
        .confirmationDialog(
            "Delete this purchase of \(purchase.quantity) bottle\(purchase.quantity == 1 ? "" : "s")? Its bottles are removed from inventory.",
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button("Delete purchase", role: .destructive) {
                Task {
                    do {
                        try await CellarAPI.shared.deletePurchase(purchase.id)
                        onChanged()
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
        }
    }
}
