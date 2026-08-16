import SwiftUI

@MainActor
@Observable
final class CellarListModel {
    var page: CellarPage?
    var error: String?
    var items: [Wine] = []
    var searchText = ""
    var wineType: String?
    var showAll = false
    var currentPage = 1
    var loadingMore = false
    var pendingWineIds: Set<Int> = []
    var rowErrors: [Int: String] = [:]

    private let pageSize = 50

    func load(reset: Bool = true) async {
        if reset {
            currentPage = 1
            error = nil
        }
        do {
            let result = try await CellarAPI.shared.listCellar(
                page: currentPage,
                pageSize: pageSize,
                q: searchText.trimmingCharacters(in: .whitespaces),
                wineType: wineType,
                inStockOnly: !showAll
            )
            page = result
            items = reset ? result.items : items + result.items
        } catch {
            if reset { page = nil }
            self.error = error.localizedDescription
        }
    }

    func loadMore() async {
        guard let page, page.pagination.hasNext, !loadingMore else { return }
        loadingMore = true
        currentPage += 1
        await load(reset: false)
        loadingMore = false
    }

    func drink(_ wine: Wine, count: Int) async {
        guard !pendingWineIds.contains(wine.id), count >= 1, count <= wine.quantity else { return }
        pendingWineIds.insert(wine.id)
        rowErrors[wine.id] = nil
        do {
            try await CellarAPI.shared.adjustInventory(
                wineId: wine.id,
                delta: -count,
                reason: "drunk (marked in iOS app)",
                eventType: "consume"
            )
            await load()
        } catch {
            rowErrors[wine.id] = error.localizedDescription
        }
        pendingWineIds.remove(wine.id)
    }
}

struct CellarListView: View {
    @State private var model = CellarListModel()
    @State private var confirmDrinkAll: Wine?
    @State private var showSettings = false
    @State private var showAddWine = false

    var body: some View {
        NavigationStack {
            List {
                if let summary = model.page?.summary {
                    summarySection(summary)
                }
                filterSection
                wineRows
            }
            .listStyle(.insetGrouped)
            .cellarBackground()
            .navigationTitle("Cellar")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showAddWine = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .searchable(text: $model.searchText, prompt: "Producer, wine, region, grape…")
            .onSubmit(of: .search) { Task { await model.load() } }
            .onChange(of: model.searchText) { _, newValue in
                if newValue.isEmpty { Task { await model.load() } }
            }
            .refreshable { await model.load() }
            .task { if model.page == nil { await model.load() } }
            .navigationDestination(for: Int.self) { wineId in
                WineDetailView(wineId: wineId)
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .sheet(isPresented: $showAddWine) {
                AddWineForm { Task { await model.load() } }
            }
            .confirmationDialog(
                confirmDrinkAll.map {
                    "Drink all \($0.quantity) bottles of \($0.title)?"
                } ?? "",
                isPresented: Binding(
                    get: { confirmDrinkAll != nil },
                    set: { if !$0 { confirmDrinkAll = nil } }
                ),
                titleVisibility: .visible
            ) {
                if let wine = confirmDrinkAll {
                    Button("Drink all \(wine.quantity)", role: .destructive) {
                        Task { await model.drink(wine, count: wine.quantity) }
                    }
                }
            }
            .overlay {
                if model.page == nil {
                    AsyncContent(value: model.page, error: model.error, retry: {
                        Task { await model.load() }
                    }) { _ in EmptyView() }
                }
            }
        }
    }

    private func summarySection(_ summary: CellarSummary) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                KickerText(text: "Private cellar view")
                HStack(spacing: 0) {
                    stat(summary.labels.bottles, "bottles")
                    stat(summary.labels.labels, "labels")
                    stat(summary.labels.producers ?? 0, "producers")
                    stat(summary.labels.regions ?? 0, "regions")
                }
            }
            .listRowInsets(EdgeInsets(top: 14, leading: 14, bottom: 12, trailing: 14))
            if let cost = summary.estimatedCost {
                Text("Estimated acquisition cost: \(Format.dollars(cost))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .listRowBackground(Color.appCard)
    }

    private func stat(_ value: Int, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text("\(value)")
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

    private var filterSection: some View {
        Section {
            // All chips wrap onto as many rows as needed (like the web app);
            // a horizontal scroller here hid half the filters.
            FlowLayout(spacing: 6) {
                chip("all types", active: model.wineType == nil) {
                    model.wineType = nil
                    Task { await model.load() }
                }
                ForEach(WineType.allCases) { type in
                    chip(type.label, active: model.wineType == type.rawValue) {
                        model.wineType = model.wineType == type.rawValue ? nil : type.rawValue
                        Task { await model.load() }
                    }
                }
                // Stable label (filled = filter on) — a self-renaming chip
                // reads as appearing/disappearing and shifts the layout.
                chip("in stock only", active: !model.showAll) {
                    model.showAll.toggle()
                    Task { await model.load() }
                }
            }
            .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
            .listRowBackground(Color.appCard)
        }
    }

    @ViewBuilder
    private func chip(_ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        let shape = Capsule()
        Button(action: action) {
            // Constant weight: a weight change on activation resizes the chip
            // and reflows the whole wrapped row.
            Text(label)
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background {
                    if active {
                        shape.fill(Color.burgundyGradient)
                    } else {
                        shape.fill(Color.secondary.opacity(0.12))
                    }
                }
                .overlay(shape.stroke(Color.appBorder.opacity(active ? 0 : 0.6), lineWidth: 1))
                .foregroundStyle(active ? .white : .primary)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var wineRows: some View {
        if let page = model.page {
            Section {
                if model.items.isEmpty {
                    ContentUnavailableView(
                        "Nothing here yet.",
                        systemImage: "wineglass",
                        description: Text("Tell your agent about a bottle, or clear the filters above.")
                    )
                } else {
                    ForEach(model.items) { wine in
                        WineRow(
                            wine: wine,
                            pending: model.pendingWineIds.contains(wine.id),
                            error: model.rowErrors[wine.id],
                            drinkOne: { Task { await model.drink(wine, count: 1) } },
                            drinkAll: { confirmDrinkAll = wine }
                        )
                    }
                    if page.pagination.hasNext {
                        HStack {
                            Spacer()
                            if model.loadingMore {
                                ProgressView()
                            } else {
                                Text("Loading more…")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .onAppear { Task { await model.loadMore() } }
                    }
                }
            } header: {
                Text("\(page.pagination.totalItems) labels")
            }
            .listRowBackground(Color.appCard)
        }
    }
}

struct WineRow: View {
    var wine: Wine
    var pending = false
    var error: String?
    var drinkOne: () -> Void = {}
    var drinkAll: () -> Void = {}

    private var subtitle: String {
        [
            wine.vintage?.isEmpty == false ? wine.vintage! : "Vintage unknown",
            wine.wineType,
            wine.varietal,
            wine.region,
        ]
        .compactMap { $0?.isEmpty == false ? $0 : nil }
        .joined(separator: " · ")
    }

    var body: some View {
        NavigationLink(value: wine.id) {
            HStack(spacing: 10) {
                WineTypeIcon(wineType: wine.wineType, size: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(wine.producer) — \(wine.wineName)")
                        .font(.subheadline.weight(.medium))
                        .lineLimit(2)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let error {
                        Text(error)
                            .font(.caption2)
                            .foregroundStyle(.red)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text("\(wine.quantity)×")
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                    RatingBadges(ratings: wine.ratings ?? [])
                }
            }
            .opacity(pending ? 0.5 : 1)
        }
        .swipeActions(edge: .trailing) {
            if wine.quantity >= 1 {
                Button("Drink one", action: drinkOne)
                    .tint(Color.appBurgundy)
            }
            if wine.quantity > 1 {
                Button("Drink all", action: drinkAll)
                    .tint(.red)
            }
        }
        .disabled(pending)
    }
}
