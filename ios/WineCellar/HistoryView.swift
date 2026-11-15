import SwiftUI

struct HistoryView: View {
    @State private var entries: [HistoryEntry]?
    @State private var error: String?
    @State private var showLogTasting = false
    @State private var selectedWineId: Int?
    @State private var detailRefresh = 0

    var body: some View {
        WineSplitView {
            sidebar
        } detail: {
            WineDetailPlaceholder(title: "Select a wine")
        }
        .sheet(isPresented: $showLogTasting) {
            ExternalTastingForm { Task { await load() } }
        }
    }

    private var sidebar: some View {
        // Plain ScrollView instead of List: expansion animates smoothly
        // (no UIKit row-height fighting) and each button in a card is
        // hit-tested individually (List fires every borderless button in
        // a row on any tap).
        AsyncContent(value: entries, error: error, retry: { Task { await load() } }) { entries in
            ScrollView {
                LazyVStack(spacing: 10) {
                    if entries.isEmpty {
                        ContentUnavailableView(
                            "No history yet",
                            systemImage: "clock.arrow.circlepath",
                            description: Text("Add a bottle or log a tasting.")
                        )
                        .padding(.top, 60)
                    }
                    ForEach(entries) { entry in
                        HistoryRowView(entry: entry, openWine: { selectedWineId = $0 }) {
                            Task { await load() }
                            detailRefresh += 1
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.appCard, in: RoundedRectangle(cornerRadius: 14))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
            }
            .background(CellarBackground())
            .refreshable { await load() }
        }
        .navigationTitle("History")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showLogTasting = true
                } label: {
                    Label("Log a tasting", systemImage: "square.and.pencil")
                }
            }
        }
        .navigationDestination(item: $selectedWineId) { id in
            WineDetailView(wineId: id, refreshToken: detailRefresh, onChanged: { change in
                Task { await load() }
                if case .deleted = change { selectedWineId = nil }
            })
            .id(id)
        }
        .task { if entries == nil { await load() } }
    }

    private func load() async {
        do {
            entries = try await CellarAPI.shared.history()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Row

struct HistoryRowView: View {
    var entry: HistoryEntry
    var openWine: (Int) -> Void
    var onChanged: () -> Void

    @Environment(WinePresenter.self) private var presenter
    @Environment(\.wineListNarrow) private var compact
    @State private var expanded = false

    private var verb: String {
        guard let event = entry.event else { return expanded ? "Tasting logged" : "Tasting" }
        switch event.eventType {
        case "purchase", "migration": return "Added"
        case "consume": return "Drank"
        case "gift": return event.delta < 0 ? "Gifted" : "Received"
        default: return event.delta < 0 ? "Removed" : "Added"
        }
    }

    private var activity: String {
        guard let event = entry.event else { return verb }
        let bottles = abs(event.delta)
        return "\(verb) \(bottles) bottle\(bottles == 1 ? "" : "s")"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                collapsedRow
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded {
                expandedPanel
            }
        }
    }

    private var collapsedRow: some View {
        HStack(spacing: 10) {
            WineTypeIcon(wineType: entry.wineType, size: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.wineTitle)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                if compact {
                    HStack(spacing: 6) {
                        Text("\(entry.displayDate) · \(verb)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let event = entry.event {
                            InventoryDeltaBadge(delta: event.delta)
                        }
                    }
                } else {
                    Text("\(entry.displayDate) · \(activity)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if !compact {
                reviewSummary
                if let event = entry.event {
                    InventoryDeltaBadge(delta: event.delta)
                } else {
                    TextBadge(text: "Review", variant: .secondary)
                }
            }
            Image(systemName: "chevron.down")
                .font(.caption)
                .foregroundStyle(.secondary)
                .rotationEffect(.degrees(expanded ? 180 : 0))
        }
    }

    @ViewBuilder
    private var reviewSummary: some View {
        let rated = entry.reviews.filter { $0.rating != nil }
        if let first = rated.first, let rating = first.rating {
            HStack(spacing: 3) {
                RatingBadge(rating: Double(rating), initials: first.userInitials)
                if rated.count > 1 {
                    Text("+\(rated.count - 1)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        } else if !entry.reviews.isEmpty {
            Text("\(entry.reviews.count) review\(entry.reviews.count == 1 ? "" : "s")")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var expandedPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                detailRow("Date", entry.displayDate)
                detailRow("Activity", activity)
                let origin = [entry.region, entry.country]
                    .compactMap { $0?.isEmpty == false ? $0 : nil }
                    .joined(separator: ", ")
                if !origin.isEmpty {
                    detailRow("Origin", origin)
                }
                if let event = entry.event, purchaseLine(event) != nil {
                    detailRow("Purchase", purchaseLine(event)!)
                }
                if let reason = entry.event?.reason, !reason.isEmpty {
                    detailRow("Note", reason)
                }
            }
            .font(.caption)

            Button("Full details") { openWine(entry.wineId) }
                .font(.caption.weight(.medium))

            ForEach(entry.reviews) { review in
                HistoryReviewBlock(review: review, onChanged: onChanged)
            }
            if entry.event != nil && entry.reviews.isEmpty {
                Text("No review attached.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let event = entry.event {
                Button(entry.reviews.isEmpty ? "Add review" : "Add another review") {
                    presenter.sheet = WineSheet(
                        kind: .eventReview(eventId: event.id, defaultDate: entry.displayDate),
                        onSaved: onChanged
                    )
                }
                .font(.caption.weight(.medium))
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private func purchaseLine(_ event: InventoryEvent) -> String? {
        guard event.purchaseVendor != nil || event.purchasePricePerBottle != nil else { return nil }
        var parts: [String] = []
        if let vendor = event.purchaseVendor, !vendor.isEmpty { parts.append(vendor) }
        if let price = event.purchasePricePerBottle {
            parts.append("\(event.purchaseCurrency ?? "USD") \(String(format: "%.2f", price)) per bottle")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        GridRow(alignment: .top) {
            Text(label.uppercased())
                .foregroundStyle(.secondary)
                .gridColumnAlignment(.leading)
            Text(value)
        }
    }
}

// MARK: - Review block

struct HistoryReviewBlock: View {
    var review: Tasting
    var onChanged: () -> Void

    @Environment(WinePresenter.self) private var presenter

    private var meta: String {
        var parts: [String] = []
        if let date = review.tastedOn, !date.isEmpty { parts.append(date) }
        if let context = review.contextType, !context.isEmpty, context != "home" {
            parts.append(context)
        }
        if let venue = review.venue, !venue.isEmpty { parts.append(venue) }
        if let price = review.pricePaid { parts.append(Format.dollars(price)) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if let rating = review.rating {
                    RatingBadge(rating: Double(rating), initials: review.userInitials)
                }
                Text(review.userName ?? "Unassigned reviewer")
                    .font(.caption.weight(.medium))
                if (review.buyAgain ?? 0) != 0 {
                    TextBadge(text: "would buy again", variant: .outline)
                }
                Spacer()
                Button("Edit") { presenter.sheet = WineSheet(kind: .editTasting(review), onSaved: onChanged) }
                    .font(.caption)
            }
            if !meta.isEmpty {
                Text(meta).font(.caption2).foregroundStyle(.secondary)
            }
            if let notes = review.tastingNotes, !notes.isEmpty {
                Text(notes).font(.caption)
            }
            if let pairing = review.foodPairing, !pairing.isEmpty {
                Text("Paired with \(pairing)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .systemBackground).opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Add review to an inventory event

struct InventoryEventReviewForm: View {
    var eventId: Int
    var defaultDate: String
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reviewer = ""
    @State private var ratingText = ""
    @State private var tastedOn: Date
    @State private var pairing = ""
    @State private var notes = ""
    @State private var buyAgain = false
    @State private var saving = false
    @State private var error: String?

    init(eventId: Int, defaultDate: String, onSaved: @escaping () -> Void) {
        self.eventId = eventId
        self.defaultDate = defaultDate
        self.onSaved = onSaved
        _tastedOn = State(initialValue: Format.parseISODate(defaultDate) ?? .now)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ReviewerPicker(name: $reviewer)
                    TextField("Rating (0–100)", text: $ratingText)
                        .keyboardType(.numberPad)
                    DatePicker("Tasted on", selection: $tastedOn, displayedComponents: .date)
                    TextField("Food pairing", text: $pairing)
                    TextField("What stood out?", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                    Toggle("Would buy again", isOn: $buyAgain)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Add review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save review") { Task { await save() } }
                        .disabled(saving)
                }
            }
        }
    }

    private func save() async {
        var rating: Int?
        let trimmed = ratingText.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            guard let value = Int(trimmed), (0...100).contains(value) else {
                error = "Rating must be between 0 and 100."
                return
            }
            rating = value
        }
        var fields: [String: Any] = [
            "tasting_notes": notes.trimmingCharacters(in: .whitespacesAndNewlines),
            "food_pairing": pairing.trimmingCharacters(in: .whitespaces),
            "context_type": "home",
            "buy_again": buyAgain,
            "tasted_on": Format.isoDate(tastedOn),
        ]
        if let rating { fields["rating"] = rating }
        let trimmedReviewer = reviewer.trimmingCharacters(in: .whitespaces)
        if !trimmedReviewer.isEmpty { fields["user"] = trimmedReviewer }

        saving = true
        error = nil
        do {
            try await CellarAPI.shared.reviewInventoryEvent(eventId, fields: fields)
            onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

// MARK: - External tasting ("tasted somewhere else")

struct ExternalTastingForm: View {
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedWine: Wine?
    @State private var producer = ""
    @State private var wineName = ""
    @State private var vintage = ""
    @State private var wineType = ""
    @State private var region = ""
    @State private var country = ""
    @State private var reviewer = ""
    @State private var contextType = "restaurant"
    @State private var venue = ""
    @State private var tastedOn = Date.now
    @State private var ratingText = ""
    @State private var priceText = ""
    @State private var buyAgain = false
    @State private var notes = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Records the wine and your review without touching cellar inventory.")
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
                Section("Review") {
                    ReviewerPicker(name: $reviewer)
                    Picker("Where", selection: $contextType) {
                        ForEach(tastingContextOptions, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("Restaurant or bar name", text: $venue)
                    DatePicker("Tasted on", selection: $tastedOn, displayedComponents: .date)
                    TextField("Rating (0–100)", text: $ratingText)
                        .keyboardType(.numberPad)
                    TextField("Price per glass/bottle", text: $priceText)
                        .keyboardType(.decimalPad)
                    Toggle("Would buy this", isOn: $buyAgain)
                    TextField("What made it good?", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Tasted somewhere else")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save tasting") { Task { await save() } }
                        .disabled(saving)
                }
            }
        }
    }

    private func save() async {
        guard var fields = TastingPayload.build(
            reviewer: reviewer, ratingText: ratingText, priceText: priceText,
            contextType: contextType, venue: venue, notes: notes, pairing: "",
            buyAgain: buyAgain, tastedOn: tastedOn, error: &error
        ) else { return }
        fields["consume_bottle"] = false

        saving = true
        error = nil
        let picker = WinePickerSection(
            selected: $selectedWine,
            producer: $producer, wineName: $wineName, vintage: $vintage,
            wineType: $wineType, region: $region, country: $country
        )
        do {
            let wineId = try await picker.resolveWineId()
            try await CellarAPI.shared.logTasting(wineId: wineId, fields: fields)
            onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
