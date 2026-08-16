import SwiftUI

@main
struct WineCellarApp: App {
    @AppStorage(Appearance.storageKey) private var appearanceRaw = Appearance.system.rawValue

    init() {
        ThemeSetup.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .preferredColorScheme((Appearance(rawValue: appearanceRaw) ?? .system).colorScheme)
        }
    }
}

struct RootTabView: View {
    var body: some View {
        TabView {
            CellarListView()
                .tabItem { Label("Cellar", systemImage: "wineglass") }
            DrinkNowView()
                .tabItem { Label("Drink Now", systemImage: "sparkles") }
            ShoppingView()
                .tabItem { Label("Shopping", systemImage: "shippingbox") }
            HistoryView()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
            StatsView()
                .tabItem { Label("Stats", systemImage: "chart.bar") }
        }
    }
}

/// Ordered + Wishlist share one tab behind a segmented picker. The picker
/// lives in the content area (not the nav bar) so toolbar layout stays stable
/// across sections, and both lists stay alive so switching never refetches.
struct ShoppingView: View {
    @State private var section = 0
    @State private var showAddWishlistForm = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Section", selection: $section) {
                    Text("Ordered").tag(0)
                    Text("Wishlist").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.bottom, 6)
                ZStack {
                    OrderedListView()
                        .opacity(section == 0 ? 1 : 0)
                        .allowsHitTesting(section == 0)
                        .accessibilityHidden(section != 0)
                    WishlistListView(showAddForm: $showAddWishlistForm)
                        .opacity(section == 1 ? 1 : 0)
                        .allowsHitTesting(section == 1)
                        .accessibilityHidden(section != 1)
                }
            }
            .background(CellarBackground())
            .navigationTitle(section == 0 ? "Ordered" : "Wishlist")
            .toolbar {
                if section == 1 {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showAddWishlistForm = true
                        } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
            }
            .navigationDestination(for: Int.self) { wineId in
                WineDetailView(wineId: wineId)
            }
        }
    }
}
