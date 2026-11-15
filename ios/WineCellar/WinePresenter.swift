import SwiftUI

/// Sheets, text prompts and the photo cover for one tab, hosted by `WineSplitView` outside its columns.
@MainActor @Observable
final class WinePresenter {
    var sheet: WineSheet?
    var photo: PhotoItem?
    var prompt: WinePrompt?
    var promptText = ""

    func ask(_ prompt: WinePrompt) {
        promptText = prompt.text
        self.prompt = prompt
    }
}

/// A single-field alert.
struct WinePrompt {
    var title: String
    var message: String?
    var placeholder: String
    var text: String
    var keyboard: UIKeyboardType = .default
    var confirmTitle: String
    var onConfirm: (String) -> Void
}

struct WineSheet: Identifiable {
    enum Kind {
        case editWine(Wine)
        case logTasting(Wine)
        case editTasting(Tasting)
        case eventReview(eventId: Int, defaultDate: String)
    }

    let id = UUID()
    var kind: Kind
    var onSaved: () -> Void

    @MainActor @ViewBuilder var content: some View {
        switch kind {
        case .editWine(let wine):
            EditWineForm(wine: wine, onSaved: onSaved)
        case .logTasting(let wine):
            LogTastingForm(wine: wine, onSaved: onSaved)
        case .editTasting(let tasting):
            TastingEditor(tasting: tasting, onSaved: onSaved)
        case .eventReview(let eventId, let defaultDate):
            InventoryEventReviewForm(eventId: eventId, defaultDate: defaultDate, onSaved: onSaved)
        }
    }
}

struct PhotoItem: Identifiable {
    let id = UUID()
    var url: URL
    var kind: String?
}
