import SwiftUI

// MARK: - Tasting editor (edit an existing review)

struct TastingEditor: View {
    var tasting: Tasting
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reviewer: String
    @State private var ratingText: String
    @State private var contextType: String
    @State private var venue: String
    @State private var tastedOn: Date
    @State private var priceText: String
    @State private var notes: String
    @State private var pairing: String
    @State private var liked: Bool
    @State private var buyAgain: Bool
    @State private var saving = false
    @State private var error: String?

    private let contextOptions: [String]

    init(tasting: Tasting, onSaved: @escaping () -> Void) {
        self.tasting = tasting
        self.onSaved = onSaved
        _reviewer = State(initialValue: tasting.userName ?? "")
        _ratingText = State(initialValue: tasting.rating.map(String.init) ?? "")
        let context = tasting.contextType ?? "home"
        var options = ["home"] + tastingContextOptions
        if !options.contains(context) { options.insert(context, at: 0) }
        contextOptions = options
        _contextType = State(initialValue: context)
        _venue = State(initialValue: tasting.venue ?? "")
        _tastedOn = State(initialValue: Format.parseISODate(tasting.tastedOn) ?? .now)
        _priceText = State(initialValue: tasting.pricePaid.map { String($0) } ?? "")
        _notes = State(initialValue: tasting.tastingNotes ?? "")
        _pairing = State(initialValue: tasting.foodPairing ?? "")
        _liked = State(initialValue: (tasting.liked ?? 0) != 0)
        _buyAgain = State(initialValue: (tasting.buyAgain ?? 0) != 0)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ReviewerPicker(name: $reviewer, allowUnassigned: true)
                    TextField("Rating (0–100)", text: $ratingText)
                        .keyboardType(.numberPad)
                    Picker("Where", selection: $contextType) {
                        ForEach(contextOptions, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("Venue", text: $venue)
                    DatePicker("Tasted on", selection: $tastedOn, displayedComponents: .date)
                    TextField("Price paid", text: $priceText)
                        .keyboardType(.decimalPad)
                }
                Section {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                    TextField("Food pairing", text: $pairing)
                    Toggle("Liked", isOn: $liked)
                    Toggle("Would buy again", isOn: $buyAgain)
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Edit review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(saving)
                }
            }
        }
    }

    private func save() async {
        let rating: Int?
        let trimmedRating = ratingText.trimmingCharacters(in: .whitespaces)
        if trimmedRating.isEmpty {
            rating = nil
        } else if let value = Int(trimmedRating), (0...100).contains(value) {
            rating = value
        } else {
            error = "Rating must be between 0 and 100."
            return
        }
        let price: Double?
        let trimmedPrice = priceText.trimmingCharacters(in: .whitespaces)
        if trimmedPrice.isEmpty {
            price = nil
        } else if let value = Double(trimmedPrice), value >= 0 {
            price = value
        } else {
            error = "Price paid cannot be negative."
            return
        }

        var fields: [String: Any] = [
            "rating": rating as Any? ?? NSNull(),
            "tasting_notes": notes.trimmingCharacters(in: .whitespacesAndNewlines),
            "food_pairing": pairing.trimmingCharacters(in: .whitespaces),
            "context_type": contextType,
            "venue": venue.trimmingCharacters(in: .whitespaces),
            "price_paid": price as Any? ?? NSNull(),
            "liked": liked,
            "buy_again": buyAgain,
            "tasted_on": Format.isoDate(tastedOn),
        ]
        let trimmedReviewer = reviewer.trimmingCharacters(in: .whitespaces)
        if !trimmedReviewer.isEmpty {
            fields["user"] = trimmedReviewer
        } else if tasting.userName != nil {
            fields["user"] = NSNull()
        }

        saving = true
        error = nil
        do {
            try await CellarAPI.shared.updateTasting(tasting.id, fields: fields)
            onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

// MARK: - Log a tasting (wine detail)

struct LogTastingForm: View {
    var wine: Wine
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reviewer = ""
    @State private var ratingText = ""
    @State private var contextType = "home"
    @State private var venue = ""
    @State private var tastedOn = Date.now
    @State private var priceText = ""
    @State private var notes = ""
    @State private var pairing = ""
    @State private var buyAgain = false
    @State private var consumeBottle: Bool
    @State private var saving = false
    @State private var error: String?

    init(wine: Wine, onSaved: @escaping () -> Void) {
        self.wine = wine
        self.onSaved = onSaved
        _consumeBottle = State(initialValue: wine.quantity > 0)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ReviewerPicker(name: $reviewer)
                    TextField("Rating (0–100)", text: $ratingText)
                        .keyboardType(.numberPad)
                    Picker("Where", selection: $contextType) {
                        ForEach(["home"] + tastingContextOptions, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("Venue", text: $venue)
                    DatePicker("Tasted on", selection: $tastedOn, displayedComponents: .date)
                    TextField("Price paid", text: $priceText)
                        .keyboardType(.decimalPad)
                }
                Section {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                    TextField("Food pairing", text: $pairing)
                    Toggle("Would buy again", isOn: $buyAgain)
                    Toggle("Take a bottle from the cellar", isOn: $consumeBottle)
                        .disabled(wine.quantity < 1)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Log a tasting")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(saving)
                }
            }
        }
    }

    private func save() async {
        guard let payload = TastingPayload.build(
            reviewer: reviewer, ratingText: ratingText, priceText: priceText,
            contextType: contextType, venue: venue, notes: notes, pairing: pairing,
            buyAgain: buyAgain, tastedOn: tastedOn, error: &error
        ) else { return }
        var fields = payload
        fields["consume_bottle"] = consumeBottle

        saving = true
        error = nil
        do {
            try await CellarAPI.shared.logTasting(wineId: wine.id, fields: fields)
            onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

enum TastingPayload {
    /// Shared validation + payload assembly for tasting-creation forms.
    static func build(
        reviewer: String, ratingText: String, priceText: String,
        contextType: String, venue: String, notes: String, pairing: String,
        buyAgain: Bool, tastedOn: Date, error: inout String?
    ) -> [String: Any]? {
        var rating: Int?
        let trimmedRating = ratingText.trimmingCharacters(in: .whitespaces)
        if !trimmedRating.isEmpty {
            guard let value = Int(trimmedRating), (0...100).contains(value) else {
                error = "Rating must be a whole number from 0 to 100."
                return nil
            }
            rating = value
        }
        var price: Double?
        let trimmedPrice = priceText.trimmingCharacters(in: .whitespaces)
        if !trimmedPrice.isEmpty {
            guard let value = Double(trimmedPrice), value >= 0 else {
                error = "Price must be a number of 0 or more."
                return nil
            }
            price = value
        }
        var fields: [String: Any] = [
            "context_type": contextType,
            "venue": venue.trimmingCharacters(in: .whitespaces),
            "tasting_notes": notes.trimmingCharacters(in: .whitespacesAndNewlines),
            "food_pairing": pairing.trimmingCharacters(in: .whitespaces),
            "buy_again": buyAgain,
            "tasted_on": Format.isoDate(tastedOn),
        ]
        if let rating { fields["rating"] = rating }
        if let price { fields["price_paid"] = price }
        let trimmedReviewer = reviewer.trimmingCharacters(in: .whitespaces)
        if !trimmedReviewer.isEmpty { fields["user"] = trimmedReviewer }
        return fields
    }
}

// MARK: - Edit wine details

struct EditWineForm: View {
    var wine: Wine
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var fields: [String: String]
    @State private var saving = false
    @State private var error: String?

    private let original: [String: String]

    private static let editableKeys = [
        "producer", "wine_name", "vintage", "wine_type", "country", "region",
        "appellation", "varietal", "grapes", "bottle_size_ml",
        "drinking_window_start", "drinking_window_end", "location", "notes",
    ]

    init(wine: Wine, onSaved: @escaping () -> Void) {
        self.wine = wine
        self.onSaved = onSaved
        let values: [String: String] = [
            "producer": wine.producer,
            "wine_name": wine.wineName,
            "vintage": wine.vintage ?? "",
            "wine_type": wine.wineType ?? "",
            "country": wine.country ?? "",
            "region": wine.region ?? "",
            "appellation": wine.appellation ?? "",
            "varietal": wine.varietal ?? "",
            "grapes": wine.grapes ?? "",
            "bottle_size_ml": wine.bottleSizeMl.map(String.init) ?? "",
            "drinking_window_start": wine.drinkingWindowStart ?? "",
            "drinking_window_end": wine.drinkingWindowEnd ?? "",
            "location": wine.location ?? "",
            "notes": wine.notes ?? "",
        ]
        _fields = State(initialValue: values)
        original = values
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    field("Producer", "producer")
                    field("Wine name", "wine_name")
                    field("Vintage", "vintage")
                    Picker("Type", selection: binding("wine_type")) {
                        Text("—").tag("")
                        ForEach(WineType.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    field("Country", "country")
                    field("Region", "region")
                    field("Appellation", "appellation")
                    field("Varietal", "varietal")
                    field("Grapes / blend", "grapes")
                    field("Bottle size (mL)", "bottle_size_ml", keyboard: .numberPad)
                    field("Drink from (year)", "drinking_window_start", keyboard: .numberPad)
                    field("Drink until (year)", "drinking_window_end", keyboard: .numberPad)
                    field("Location", "location")
                }
                Section("Notes") {
                    TextField("Notes", text: binding("notes"), axis: .vertical)
                        .lineLimit(3...8)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Edit details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(saving)
                }
            }
        }
    }

    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { fields[key] ?? "" }, set: { fields[key] = $0 })
    }

    private func field(_ label: String, _ key: String, keyboard: UIKeyboardType = .default) -> some View {
        LabeledContent(label) {
            TextField(label, text: binding(key))
                .keyboardType(keyboard)
                .multilineTextAlignment(.trailing)
        }
    }

    private func save() async {
        // Dirty-diff: only send changed fields; numeric fields only when valid.
        var payload: [String: Any] = [:]
        for key in Self.editableKeys {
            let value = (fields[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard value != original[key] else { continue }
            if key == "bottle_size_ml" {
                if let size = Int(value), size > 0 { payload[key] = size }
            } else {
                payload[key] = value
            }
        }
        guard !payload.isEmpty else {
            dismiss()
            return
        }
        saving = true
        error = nil
        do {
            try await CellarAPI.shared.updateWine(wine.id, fields: payload)
            onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

// MARK: - Add a wine directly

struct AddWineForm: View {
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var producer = ""
    @State private var wineName = ""
    @State private var vintage = ""
    @State private var wineType = ""
    @State private var country = ""
    @State private var region = ""
    @State private var varietal = ""
    @State private var quantity = 1
    @State private var priceText = ""
    @State private var vendor = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Wine") {
                    TextField("Producer (required)", text: $producer)
                    TextField("Wine name (required)", text: $wineName)
                    TextField("Vintage", text: $vintage)
                    Picker("Type", selection: $wineType) {
                        Text("—").tag("")
                        ForEach(WineType.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    TextField("Country", text: $country)
                    TextField("Region", text: $region)
                    TextField("Varietal", text: $varietal)
                }
                Section("Bottles") {
                    Stepper("Quantity: \(quantity)", value: $quantity, in: 0...240)
                    TextField("Price per bottle", text: $priceText)
                        .keyboardType(.decimalPad)
                    TextField("Vendor", text: $vendor)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Add a wine")
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
        let trimmedProducer = producer.trimmingCharacters(in: .whitespaces)
        let trimmedName = wineName.trimmingCharacters(in: .whitespaces)
        guard !trimmedProducer.isEmpty, !trimmedName.isEmpty else {
            error = "Producer and wine name are required."
            return
        }
        var fields: [String: Any] = [
            "producer": trimmedProducer,
            "wine_name": trimmedName,
            "vintage": vintage.trimmingCharacters(in: .whitespaces),
            "wine_type": wineType,
            "country": country.trimmingCharacters(in: .whitespaces),
            "region": region.trimmingCharacters(in: .whitespaces),
            "varietal": varietal.trimmingCharacters(in: .whitespaces),
            "quantity": quantity,
            "source_app": "ios",
        ]
        let trimmedPrice = priceText.trimmingCharacters(in: .whitespaces)
        if !trimmedPrice.isEmpty {
            guard let price = Double(trimmedPrice), price >= 0 else {
                error = "Price must be a number of 0 or more."
                return
            }
            fields["acquired_price"] = price
        }
        let trimmedVendor = vendor.trimmingCharacters(in: .whitespaces)
        if !trimmedVendor.isEmpty { fields["acquired_from"] = trimmedVendor }

        saving = true
        error = nil
        do {
            _ = try await CellarAPI.shared.createWine(fields)
            onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

// MARK: - Settings

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var serverURL = UserDefaults.standard.string(forKey: CellarAPI.baseURLDefaultsKey)
        ?? CellarAPI.defaultBaseURL
    @State private var healthResult: String?
    @State private var checking = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Server URL", text: $serverURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Cellar server")
                } footer: {
                    Text("The tailnet deployment (\(CellarAPI.defaultBaseURL)) is the default. For local development use http://127.0.0.1:8788.")
                }
                Section {
                    Button(checking ? "Checking…" : "Check connection") {
                        Task { await checkHealth() }
                    }
                    .disabled(checking)
                    if let healthResult {
                        Text(healthResult)
                            .font(.footnote)
                            .foregroundStyle(healthResult.hasPrefix("OK") ? .green : .red)
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        save()
                        dismiss()
                    }
                }
            }
        }
    }

    private func save() {
        let trimmed = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == CellarAPI.defaultBaseURL {
            UserDefaults.standard.removeObject(forKey: CellarAPI.baseURLDefaultsKey)
        } else {
            UserDefaults.standard.set(trimmed, forKey: CellarAPI.baseURLDefaultsKey)
        }
    }

    private func checkHealth() async {
        checking = true
        save()
        do {
            let health = try await CellarAPI.shared.health()
            healthResult = "OK — \(health.bottles ?? 0) bottles, \(health.labels ?? 0) labels."
        } catch {
            healthResult = error.localizedDescription
        }
        checking = false
    }
}
