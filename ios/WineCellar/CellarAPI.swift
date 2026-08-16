import Foundation

enum APIError: LocalizedError {
    case server(String)
    case badURL

    var errorDescription: String? {
        switch self {
        case .server(let detail): return detail
        case .badURL: return "Invalid server URL — check Settings."
        }
    }
}

/// Client for the cellar FastAPI server. The base URL points at the tailnet
/// deployment by default and can be overridden in Settings.
final class CellarAPI: @unchecked Sendable {
    static let shared = CellarAPI()
    static let defaultBaseURL = "http://claw/cellar"
    static let baseURLDefaultsKey = "serverBaseURL"

    private let decoder: JSONDecoder
    private let session: URLSession

    init() {
        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 15
        session = URLSession(configuration: config)
    }

    var baseURLString: String {
        let stored = UserDefaults.standard.string(forKey: Self.baseURLDefaultsKey) ?? ""
        let trimmed = stored.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = trimmed.isEmpty ? Self.defaultBaseURL : trimmed
        return value.hasSuffix("/") ? String(value.dropLast()) : value
    }

    func photoURL(_ path: String) -> URL? {
        URL(string: "\(baseURLString)/photos/\(path)")
    }

    // MARK: Request plumbing

    private func url(_ path: String, query: [String: String?] = [:]) throws -> URL {
        guard var components = URLComponents(string: baseURLString + path) else {
            throw APIError.badURL
        }
        let items = query.compactMap { key, value in
            value.map { URLQueryItem(name: key, value: $0) }
        }
        if !items.isEmpty { components.queryItems = items }
        guard let url = components.url else { throw APIError.badURL }
        return url
    }

    private func request(
        _ method: String,
        _ path: String,
        query: [String: String?] = [:],
        body: [String: Any]? = nil
    ) async throws -> Data {
        var request = URLRequest(url: try url(path, query: query))
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.server(Self.errorDetail(from: data, status: http.statusCode))
        }
        return data
    }

    private static func errorDetail(from data: Data, status: Int) -> String {
        if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let detail = payload["detail"] as? String { return detail }
            if let details = payload["detail"] as? [[String: Any]] {
                let messages = details.compactMap { $0["msg"] as? String }
                if !messages.isEmpty { return messages.joined(separator: "; ") }
            }
        }
        return "Request failed (HTTP \(status))"
    }

    private func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        try decoder.decode(T.self, from: try await request("GET", path, query: query))
    }

    @discardableResult
    private func send<T: Decodable>(
        _ method: String, _ path: String, body: [String: Any]? = nil
    ) async throws -> T {
        try decoder.decode(T.self, from: try await request(method, path, body: body))
    }

    // MARK: Cellar

    func listCellar(
        page: Int = 1,
        pageSize: Int = 25,
        q: String? = nil,
        wineType: String? = nil,
        inStockOnly: Bool = true
    ) async throws -> CellarPage {
        try await get("/api/cellar", query: [
            "page": String(page),
            "page_size": String(pageSize),
            "q": q?.isEmpty == false ? q : nil,
            "wine_type": wineType,
            "in_stock": inStockOnly ? nil : "false",
        ])
    }

    /// POST /api/cellar/items — creates the wine (and an initial purchase when quantity > 0).
    func createWine(_ fields: [String: Any]) async throws -> Wine {
        try await send("POST", "/api/cellar/items", body: fields)
    }

    @discardableResult
    func adjustInventory(wineId: Int, delta: Int, reason: String, eventType: String) async throws -> Wine {
        try await send("POST", "/api/cellar/items/\(wineId)/adjust", body: [
            "delta": delta, "reason": reason, "event_type": eventType,
        ])
    }

    // MARK: Wine dossier

    func getWine(_ id: Int) async throws -> Wine {
        try await get("/api/wines/\(id)")
    }

    @discardableResult
    func updateWine(_ id: Int, fields: [String: Any]) async throws -> Wine {
        try await send("PATCH", "/api/wines/\(id)", body: fields)
    }

    func deleteWine(_ id: Int) async throws {
        _ = try await request("DELETE", "/api/wines/\(id)")
    }

    // MARK: Tastings & reviews

    @discardableResult
    func logTasting(wineId: Int, fields: [String: Any]) async throws -> Wine {
        try await send("POST", "/api/wines/\(wineId)/tastings", body: fields)
    }

    @discardableResult
    func updateTasting(_ id: Int, fields: [String: Any]) async throws -> Wine {
        try await send("PATCH", "/api/tastings/\(id)", body: fields)
    }

    func deleteTasting(_ id: Int) async throws {
        _ = try await request("DELETE", "/api/tastings/\(id)")
    }

    @discardableResult
    func reviewInventoryEvent(_ eventId: Int, fields: [String: Any]) async throws -> Wine {
        try await send("POST", "/api/inventory-events/\(eventId)/reviews", body: fields)
    }

    // MARK: Purchases

    func deletePurchase(_ id: Int) async throws {
        _ = try await request("DELETE", "/api/purchases/\(id)")
    }

    // MARK: Reference data

    func users() async throws -> [User] {
        try await get("/api/users")
    }

    func stats() async throws -> StatsPayload {
        try await get("/api/stats")
    }

    func drinkNow() async throws -> DrinkNowPayload {
        try await get("/api/drink-now")
    }

    func history() async throws -> [HistoryEntry] {
        try await get("/api/history")
    }

    // MARK: Wishlist

    func wishlist() async throws -> [WishlistEntry] {
        try await get("/api/wishlist")
    }

    @discardableResult
    func wishlistAdd(_ fields: [String: Any]) async throws -> WishlistEntry {
        try await send("POST", "/api/wishlist", body: fields)
    }

    func wishlistRemove(_ id: Int) async throws {
        _ = try await request("DELETE", "/api/wishlist/\(id)")
    }

    // MARK: Ordered wines

    func orderedWines(includeArrived: Bool = false) async throws -> [OrderedWine] {
        try await get("/api/ordered-wines", query: [
            "include_arrived": includeArrived ? "true" : nil,
        ])
    }

    @discardableResult
    func orderedWineArrive(_ orderId: Int, arrivedOn: String? = nil) async throws -> OrderedWine {
        var body: [String: Any] = [:]
        if let arrivedOn, !arrivedOn.isEmpty { body["arrived_on"] = arrivedOn }
        return try await send("POST", "/api/ordered-wines/\(orderId)/arrive", body: body)
    }

    @discardableResult
    func orderedWineUpdate(_ orderId: Int, fields: [String: Any]) async throws -> OrderedWine {
        try await send("PATCH", "/api/ordered-wines/\(orderId)", body: fields)
    }

    // MARK: Health

    func health() async throws -> HealthStatus {
        try await get("/health")
    }
}
