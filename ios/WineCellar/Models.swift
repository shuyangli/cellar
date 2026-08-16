import Foundation

// MARK: - Constants

enum WineType: String, CaseIterable, Identifiable {
    case red, white, rose, sparkling, dessert, fortified, orange, other

    var id: String { rawValue }

    var label: String { rawValue == "rose" ? "rosé" : rawValue }
}

let tastingContextOptions = ["restaurant", "wine bar", "tasting room", "friend", "event", "other"]

// MARK: - Cellar list

struct CellarPage: Decodable {
    var summary: CellarSummary
    var items: [Wine]
    var pagination: Pagination
}

struct CellarSummary: Decodable {
    var labels: LabelCounts
    var estimatedCost: Double?
}

struct LabelCounts: Decodable {
    var bottles: Int
    var labels: Int
    var producers: Int?
    var regions: Int?
}

struct Pagination: Decodable {
    var page: Int
    var pageSize: Int
    var totalItems: Int
    var totalPages: Int
    var hasPrev: Bool
    var hasNext: Bool
}

struct RatingSummary: Decodable, Identifiable, Hashable {
    var userId: Int?
    var userName: String?
    var rating: Double?
    var tastings: Int?
    var initials: String?

    var id: String { "\(userId.map(String.init) ?? "?")-\(initials ?? "?")" }
}

/// Wine row from the cellar list; the same shape (plus history arrays) is the
/// full dossier returned by GET /api/wines/{id}.
struct Wine: Decodable, Identifiable {
    var id: Int
    var producer: String
    var wineName: String
    var vintage: String?
    var country: String?
    var region: String?
    var appellation: String?
    var varietal: String?
    var sourceApp: String?
    var cellartrackerWineId: String?
    var photoRef: String?
    var notes: String?
    var createdAt: String?
    var updatedAt: String?
    var quantity: Int
    var bottleSizeMl: Int?
    var location: String?
    var acquiredFrom: String?
    var acquiredPrice: Double?
    var drinkingWindowStart: String?
    var drinkingWindowEnd: String?
    var lastEventReason: String?
    var wineType: String?
    var grapes: String?
    var avgRating: Double?
    var labelPhoto: String?
    var ratings: [RatingSummary]?
    // Dossier-only fields
    var purchases: [Purchase]?
    var tastings: [Tasting]?
    var events: [InventoryEvent]?
    var photos: [Photo]?

    var title: String {
        var text = "\(producer) \(wineName)"
        if let vintage, !vintage.isEmpty { text += " \(vintage)" }
        return text
    }
}

struct Purchase: Decodable, Identifiable {
    var id: Int
    var wineId: Int
    var quantity: Int
    var pricePerBottle: Double?
    var currency: String?
    var vendor: String?
    var purchaseDate: String?
    var source: String?
    var notes: String?
    var createdAt: String?
}

struct Tasting: Decodable, Identifiable {
    var id: Int
    var wineId: Int
    var contextType: String?
    var venue: String?
    var pricePaid: Double?
    var rating: Int?
    var liked: Int?
    var buyAgain: Int?
    var tastingNotes: String?
    var foodPairing: String?
    var tastedOn: String?
    var createdAt: String?
    var userId: Int?
    var purchaseId: Int?
    var inventoryEventId: Int?
    var userName: String?
    var userInitials: String?
    // Present on GET /api/tastings rows
    var producer: String?
    var wineName: String?
    var vintage: String?
    var wineType: String?
    var region: String?
    var country: String?
}

struct InventoryEvent: Decodable, Identifiable {
    var id: Int
    var wineId: Int
    var delta: Int
    var eventType: String
    var reason: String?
    var purchaseId: Int?
    var tastingId: Int?
    var occurredAt: String?
    // History enrichment (joined purchase)
    var purchaseQuantity: Int?
    var purchasePricePerBottle: Double?
    var purchaseCurrency: String?
    var purchaseVendor: String?
    var purchaseDate: String?
}

struct Photo: Decodable, Identifiable {
    var id: Int
    var kind: String?
    var path: String?
}

// MARK: - Users

struct User: Decodable, Identifiable {
    var id: Int
    var name: String
    var isDefault: Int?
    var tastingCount: Int?
    var lastTastedOn: String?
    var initials: String?
}

// MARK: - Drink now

struct DrinkNowPayload: Decodable {
    var year: Int
    var drinkFirst: [DrinkNowWine]
    var drinkSoon: [DrinkNowWine]
    var readyToHold: [DrinkNowWine]
    var longTerm: [DrinkNowWine]
    var approaching: [DrinkNowWine]
    var pastPeak: [DrinkNowWine]
    var noWindow: [DrinkNowWine]
}

struct DrinkNowWine: Decodable, Identifiable {
    var id: Int
    var producer: String
    var wineName: String
    var vintage: String?
    var wineType: String?
    var region: String?
    var quantity: Int
    var drinkingWindowStart: String?
    var drinkingWindowEnd: String?
}

// MARK: - History

struct HistoryEntry: Decodable, Identifiable {
    var key: String
    var kind: String
    var sortAt: String
    var wineId: Int
    var producer: String
    var wineName: String
    var vintage: String?
    var wineType: String?
    var region: String?
    var country: String?
    var event: InventoryEvent?
    var reviews: [Tasting]

    var id: String { key }

    var displayDate: String {
        if let date = event?.purchaseDate, !date.isEmpty { return date }
        return String(sortAt.prefix(10))
    }

    var wineTitle: String {
        var text = "\(producer) \(wineName)"
        if let vintage, !vintage.isEmpty { text += " \(vintage)" }
        return text
    }
}

// MARK: - Wishlist

struct WishlistEntry: Decodable, Identifiable {
    var id: Int
    var wineId: Int
    var shopName: String?
    var listedPrice: Double?
    var matchConfidence: Double?
    var reason: String?
    var createdAt: String?
    var recommendedBy: String?
    var producer: String
    var wineName: String
    var vintage: String?
    var wineType: String?
    var region: String?
    var country: String?
    var quantity: Int

    var wineTitle: String {
        var text = "\(producer) \(wineName)"
        if let vintage, !vintage.isEmpty { text += " \(vintage)" }
        return text
    }
}

// MARK: - Ordered wines

struct OrderedWine: Decodable, Identifiable {
    var id: Int
    var wineId: Int
    var quantity: Int
    var pricePerBottle: Double?
    var currency: String?
    var vendor: String?
    var orderReference: String?
    var orderedOn: String?
    var trackingUrl: String?
    var expectedOn: String?
    var status: String
    var arrivedOn: String?
    var purchaseId: Int?
    var sourceMessageId: String?
    var notes: String?
    var createdAt: String?
    var updatedAt: String?
    var producer: String
    var wineName: String
    var vintage: String?
    var wineType: String?
    var region: String?
    var country: String?
    var bottleSizeMl: Int?
}

// MARK: - Stats

struct StatsPayload: Decodable {
    var summary: CellarSummary
    var reviewers: [User]
    var byType: [TypeCount]
    var byCountry: [CountryCount]
    var byRegion: [RegionCount]
    var spendByMonth: [MonthSpend]
    var topRated: [TopRatedWine]
    var recentTastings: [RecentTasting]
}

struct TypeCount: Decodable, Identifiable {
    var wineType: String
    var bottles: Int
    var labels: Int
    var id: String { wineType }
}

struct CountryCount: Decodable, Identifiable {
    var country: String
    var bottles: Int
    var labels: Int
    var id: String { country }
}

struct RegionCount: Decodable, Identifiable {
    var region: String
    var bottles: Int
    var labels: Int
    var id: String { region }
}

struct MonthSpend: Decodable, Identifiable {
    var month: String?
    var spend: Double
    var bottles: Int
    var id: String { month ?? "unknown" }
}

struct TopRatedWine: Decodable, Identifiable {
    var id: Int
    var producer: String
    var wineName: String
    var vintage: String?
    var quantity: Int
    var avgRating: Double?
    var tastings: Int
}

struct RecentTasting: Decodable, Identifiable {
    var id: Int
    var wineId: Int
    var userId: Int?
    var producer: String
    var wineName: String
    var vintage: String?
    var rating: Int?
    var tastedOn: String?
    var userName: String?
    var userInitials: String?
}

// MARK: - Health

struct HealthStatus: Decodable {
    var ok: Bool
    var db: String?
    var bottles: Int?
    var labels: Int?
}
