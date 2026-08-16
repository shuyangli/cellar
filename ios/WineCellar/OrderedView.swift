import SwiftUI

struct OrderedListView: View {
    @State private var orders: [OrderedWine]?
    @State private var error: String?
    @State private var includeArrived = false
    @State private var pendingIds: Set<Int> = []
    @State private var rowErrors: [Int: String] = [:]

    var body: some View {
        AsyncContent(value: orders, error: error, retry: { Task { await load() } }) { orders in
            List {
                Section {
                    Toggle("Show arrived orders", isOn: $includeArrived)
                        .onChange(of: includeArrived) { _, _ in
                            Task { await load() }
                        }
                }
                .listRowBackground(Color.appCard)
                Section {
                    if orders.isEmpty {
                        ContentUnavailableView(
                            "No bottles on the way",
                            systemImage: "shippingbox",
                            description: Text("Forward an order or tracking email to your agent and ask for it to be added here.")
                        )
                    }
                    ForEach(orders) { order in
                        OrderedWineRow(
                            order: order,
                            pending: pendingIds.contains(order.id),
                            error: rowErrors[order.id],
                            markArrived: { Task { await markArrived(order) } }
                        )
                    }
                } header: {
                    let active = orders.filter { $0.status == "ordered" }
                    let bottles = active.reduce(0) { $0 + $1.quantity }
                    if bottles > 0 {
                        Text("\(bottles) bottle\(bottles == 1 ? "" : "s") across \(active.count) order line\(active.count == 1 ? "" : "s")")
                    }
                }
                .listRowBackground(Color.appCard)
            }
            .listStyle(.insetGrouped)
            .cellarBackground()
            .refreshable { await load() }
        }
        .navigationDestination(for: OrderedWine.self) { order in
            OrderedWineDetailView(order: order) { Task { await load() } }
        }
        .task { if orders == nil { await load() } }
    }

    private func load() async {
        do {
            orders = try await CellarAPI.shared.orderedWines(includeArrived: includeArrived)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func markArrived(_ order: OrderedWine) async {
        guard !pendingIds.contains(order.id) else { return }
        pendingIds.insert(order.id)
        rowErrors[order.id] = nil
        do {
            _ = try await CellarAPI.shared.orderedWineArrive(order.id)
            await load()
        } catch {
            rowErrors[order.id] = error.localizedDescription
        }
        pendingIds.remove(order.id)
    }
}

struct OrderedWineRow: View {
    var order: OrderedWine
    var pending: Bool
    var error: String?
    var markArrived: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NavigationLink(value: order) {
                HStack(alignment: .top, spacing: 10) {
                    WineTypeIcon(wineType: order.wineType, size: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(order.producer)
                            .font(.subheadline.weight(.medium))
                        Text([order.wineName, order.vintage.map { "(\($0))" }]
                            .compactMap { $0?.isEmpty == false ? $0 : nil }
                            .joined(separator: " "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        let origin = [order.region, order.country]
                            .compactMap { $0?.isEmpty == false ? $0 : nil }
                            .joined(separator: " · ")
                        if !origin.isEmpty {
                            Text(origin)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Text("\(order.quantity) × \(Format.bottleSize(order.bottleSizeMl))")
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.secondary.opacity(0.12), in: Capsule())
                }
            }

            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 3) {
                GridRow(alignment: .top) {
                    orderColumn
                    deliveryColumn
                }
            }

            if order.status == "arrived" {
                TextBadge(
                    text: "Arrived\(order.arrivedOn.flatMap(Format.shortDate).map { " \($0)" } ?? "")",
                    variant: .secondary
                )
            } else {
                Button {
                    markArrived()
                } label: {
                    Text(pending ? "Arriving…" : "Mark arrived")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(pending)
            }
            if let error {
                Text(error).font(.caption2).foregroundStyle(.red)
            }
        }
        .padding(.vertical, 4)
    }

    private var orderColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("ORDER")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(order.vendor?.isEmpty == false ? order.vendor! : "Vendor pending")
                .font(.caption)
            if let reference = order.orderReference, !reference.isEmpty {
                Text("#\(reference)").font(.caption2).foregroundStyle(.secondary)
            }
            if let date = Format.shortDate(order.orderedOn) {
                Text("Ordered \(date)").font(.caption2).foregroundStyle(.secondary)
            }
            if let price = order.pricePerBottle {
                Text("\(Format.price(price, currency: order.currency)) each")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var deliveryColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("DELIVERY")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            if let tracking = order.trackingUrl, let url = URL(string: tracking) {
                Link(destination: url) {
                    HStack(spacing: 3) {
                        Text("Track shipment")
                        Image(systemName: "arrow.up.right.square")
                    }
                    .font(.caption)
                }
            } else {
                Text("Tracking pending")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let date = Format.shortDate(order.expectedOn) {
                Text("Expected \(date)").font(.caption2).foregroundStyle(.secondary)
            }
            if let notes = order.notes, !notes.isEmpty {
                Text(notes)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
    }
}

// MARK: - Order detail

/// Full dossier for a single order line: everything the row summarizes plus
/// the complete notes, status, and a link into the wine's own detail view.
struct OrderedWineDetailView: View {
    var onChanged: () -> Void

    @State private var order: OrderedWine
    @State private var pending = false
    @State private var error: String?

    init(order: OrderedWine, onChanged: @escaping () -> Void) {
        self.onChanged = onChanged
        _order = State(initialValue: order)
    }

    var body: some View {
        List {
            wineSection
            orderSection
            deliverySection
            if let notes = order.notes, !notes.isEmpty {
                Section("Order notes") {
                    Text(notes).font(.callout)
                }
                .listRowBackground(Color.appCard)
            }
            if order.status != "arrived" {
                actionSection
            }
        }
        .listStyle(.insetGrouped)
        .cellarBackground()
        .navigationTitle("Order")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var wineSection: some View {
        Section {
            HStack(alignment: .top, spacing: 12) {
                WineTypeIcon(wineType: order.wineType, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(order.producer)
                        .font(.headline)
                    Text([order.wineName, order.vintage.map { "(\($0))" }]
                        .compactMap { $0?.isEmpty == false ? $0 : nil }
                        .joined(separator: " "))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    let origin = [order.region, order.country]
                        .compactMap { $0?.isEmpty == false ? $0 : nil }
                        .joined(separator: " · ")
                    if !origin.isEmpty {
                        Text(origin)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            NavigationLink(value: order.wineId) {
                Label("Full wine details", systemImage: "wineglass")
                    .font(.subheadline)
            }
        }
        .listRowBackground(Color.appCard)
    }

    private var orderSection: some View {
        Section("Order") {
            LabeledContent("Quantity", value: "\(order.quantity) × \(Format.bottleSize(order.bottleSizeMl))")
            LabeledContent("Vendor", value: order.vendor?.isEmpty == false ? order.vendor! : "Pending")
            if let reference = order.orderReference, !reference.isEmpty {
                LabeledContent("Reference", value: reference)
            }
            if let date = Format.longDate(order.orderedOn) {
                LabeledContent("Ordered on", value: date)
            }
            if let price = order.pricePerBottle {
                LabeledContent("Price per bottle", value: Format.price(price, currency: order.currency))
                LabeledContent("Total", value: Format.price(price * Double(order.quantity), currency: order.currency))
            }
        }
        .listRowBackground(Color.appCard)
    }

    private var deliverySection: some View {
        Section("Delivery") {
            LabeledContent("Status") {
                if order.status == "arrived" {
                    TextBadge(
                        text: "Arrived\(Format.longDate(order.arrivedOn).map { " \($0)" } ?? "")",
                        variant: .secondary
                    )
                } else {
                    TextBadge(text: "On the way", variant: .outline)
                }
            }
            if let date = Format.longDate(order.expectedOn) {
                LabeledContent("Expected", value: date)
            }
            if let tracking = order.trackingUrl, let url = URL(string: tracking) {
                Link(destination: url) {
                    HStack {
                        Text("Track shipment")
                        Spacer()
                        Image(systemName: "arrow.up.right.square")
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                LabeledContent("Tracking", value: "Pending")
            }
        }
        .listRowBackground(Color.appCard)
    }

    private var actionSection: some View {
        Section {
            Button {
                Task { await markArrived() }
            } label: {
                Text(pending ? "Arriving…" : "Mark arrived")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(pending)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            if let error {
                Text(error).font(.caption).foregroundStyle(.red)
            }
        }
    }

    private func markArrived() async {
        pending = true
        error = nil
        do {
            order = try await CellarAPI.shared.orderedWineArrive(order.id)
            onChanged()
        } catch {
            self.error = error.localizedDescription
        }
        pending = false
    }
}
