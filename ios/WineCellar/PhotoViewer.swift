import SwiftUI

struct PhotoViewer: View {
    var photo: PhotoItem

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content
                .background(Color.black.ignoresSafeArea())
                .toolbarBackground(.hidden, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            dismiss()
                        } label: {
                            Label("Close", systemImage: "xmark")
                        }
                        .tint(.white)
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if #available(iOS 27.1, *) {
            ArrangementView {
                caption
                    .overlayArrangementEdge(VerticalEdge.bottom)
                    .overlayArrangementEdge(HorizontalEdge.trailing)
            } secondary: {
                image
            }
            .arrangementViewStyle(.overlay)
        } else {
            ZStack {
                image
                caption
            }
        }
    }

    private var image: some View {
        AsyncImage(url: photo.url) { image in
            image.resizable().aspectRatio(contentMode: .fit)
        } placeholder: {
            ProgressView().tint(.white)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(photo.kind ?? "photo")
    }

    private var caption: some View {
        Text(photo.kind ?? "")
            .font(.footnote)
            .foregroundStyle(.white.opacity(0.7))
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            .allowsHitTesting(false)
    }
}
