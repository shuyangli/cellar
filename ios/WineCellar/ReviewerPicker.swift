import SwiftUI

/// Reviewer selection: loads /api/users once, defaults to the server-flagged
/// default user, and offers a "Someone else…" free-text path that creates the
/// user on save. Value semantics mirror the web app: the bound string is the
/// reviewer's *name*; empty means unassigned/default.
struct ReviewerPicker: View {
    @Binding var name: String
    var allowUnassigned = false

    @State private var users: [User] = []
    @State private var loaded = false
    @State private var customEntry = false

    private let customTag = "__new_reviewer__"

    var body: some View {
        if !loaded {
            LabeledContent("Reviewer") {
                Text("Loading reviewers…").foregroundStyle(.secondary)
            }
            .task { await load() }
        } else if customEntry || (!name.isEmpty && !users.contains { $0.name == name }) {
            HStack {
                TextField("Reviewer's name", text: $name)
                    .textInputAutocapitalization(.words)
                Button("Cancel") {
                    customEntry = false
                    name = defaultName
                }
                .font(.callout)
            }
        } else {
            Picker("Reviewer", selection: pickerBinding) {
                if allowUnassigned {
                    Text("Unassigned").tag("")
                }
                ForEach(users) { user in
                    Text("\(user.name) (\(user.initials ?? "?"))").tag(user.name)
                }
                Text("Someone else…").tag(customTag)
            }
        }
    }

    private var defaultName: String {
        users.first(where: { ($0.isDefault ?? 0) != 0 })?.name ?? users.first?.name ?? ""
    }

    private var pickerBinding: Binding<String> {
        Binding(
            get: { name },
            set: { newValue in
                if newValue == customTag {
                    customEntry = true
                    name = ""
                } else {
                    name = newValue
                }
            }
        )
    }

    private func load() async {
        do {
            users = try await CellarAPI.shared.users()
            if !allowUnassigned && name.isEmpty {
                name = defaultName
            }
        } catch {
            customEntry = true
        }
        loaded = true
    }
}
