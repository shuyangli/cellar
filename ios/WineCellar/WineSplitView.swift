import SwiftUI

private let twoColumnMinWidth: CGFloat = 800

/// List/detail split for a tab root: two columns in regular-width windows of
/// at least 800pt, a single stack otherwise.
struct WineSplitView<Sidebar: View, Detail: View>: View {
    @ViewBuilder var sidebar: () -> Sidebar
    @ViewBuilder var detail: () -> Detail

    @Environment(\.horizontalSizeClass) private var systemSizeClass
    @State private var presenter = WinePresenter()
    @State private var isNarrow = false

    private var isCollapsed: Bool { isNarrow || systemSizeClass == .compact }

    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            sidebar().toolbar(removing: .sidebarToggle)
        } detail: {
            NavigationStack { detail() }
        }
        .navigationSplitViewStyle(.balanced)
        .environment(\.horizontalSizeClass, isNarrow ? .compact : systemSizeClass)
        .environment(\.wineSplitCollapsed, isCollapsed)
        .onGeometryChange(for: Bool.self) { $0.size.width < twoColumnMinWidth } action: { isNarrow = $0 }
        .environment(presenter)
        .sheet(item: $presenter.sheet) { $0.content }
        .fullScreenCover(item: $presenter.photo) { PhotoViewer(photo: $0) }
    }
}

extension EnvironmentValues {
    /// True when the enclosing `WineSplitView` shows a single column.
    @Entry var wineSplitCollapsed: Bool = true
}

struct WineDetailPlaceholder: View {
    var title: String

    var body: some View {
        ContentUnavailableView(title, systemImage: "wineglass")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(CellarBackground())
    }
}

extension Color {
    static let appCardSelected = Color(light: 0xE8DCE1, dark: 0x311B29)
}

extension View {
    func wineRowBackground(selected: Bool) -> some View {
        listRowBackground(selected ? Color.appCardSelected : Color.appCard)
    }
}
