import SwiftUI

@main
struct WineCellarApp: App {
    var body: some Scene {
        WindowGroup {
            RootTabView()
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

/// Ordered + Wishlist share one tab behind a segmented picker.
struct ShoppingView: View {
    @State private var section = 0

    var body: some View {
        NavigationStack {
            Group {
                if section == 0 {
                    OrderedListView()
                } else {
                    WishlistListView()
                }
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Section", selection: $section) {
                        Text("Ordered").tag(0)
                        Text("Wishlist").tag(1)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 220)
                }
            }
            .navigationDestination(for: Int.self) { wineId in
                WineDetailView(wineId: wineId)
            }
        }
    }
}
