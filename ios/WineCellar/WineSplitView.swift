import SwiftUI

private let twoColumnMinWidth: CGFloat = 800
private let narrowListMaxWidth: CGFloat = 390

/// List/detail split for a tab root: two columns in regular-width windows of
/// at least 800pt, a single stack otherwise.
struct WineSplitView<Sidebar: View, Detail: View>: View {
    @ViewBuilder var sidebar: () -> Sidebar
    @ViewBuilder var detail: () -> Detail

    @Environment(\.horizontalSizeClass) private var systemSizeClass
    @State private var isNarrow = false
    @State private var listIsNarrow = false

    private var isCollapsed: Bool { isNarrow || systemSizeClass == .compact }

    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            sidebar()
                .toolbar(removing: .sidebarToggle)
                .onGeometryChange(for: Bool.self) { (1..<narrowListMaxWidth).contains($0.size.width) } action: { listIsNarrow = $0 }
                .environment(\.wineListNarrow, listIsNarrow)
        } detail: {
            NavigationStack { detail() }
        }
        .navigationSplitViewStyle(.balanced)
        .environment(\.horizontalSizeClass, isNarrow ? .compact : systemSizeClass)
        .environment(\.wineSplitCollapsed, isCollapsed)
        .onGeometryChange(for: Bool.self) { $0.size.width < twoColumnMinWidth } action: { isNarrow = $0 }
        .winePresenterHost()
    }
}

extension EnvironmentValues {
    /// True when the enclosing `WineSplitView` shows a single column.
    @Entry var wineSplitCollapsed: Bool = true

    /// True when the list column is too narrow for the regular row layouts.
    @Entry var wineListNarrow: Bool = false
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
