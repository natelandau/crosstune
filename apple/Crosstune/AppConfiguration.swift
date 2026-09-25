import Foundation

/// The values a build configuration writes into Info.plist from `Config/*.xcconfig`.
struct AppConfiguration {
    let apiOrigin: URL
    let clerkPublishableKey: String
    let clientVersion: String

    static let main = AppConfiguration(bundle: .main)

    init(bundle: Bundle) {
        func value(_ key: String) -> String {
            guard let value = bundle.object(forInfoDictionaryKey: key) as? String, !value.isEmpty else {
                fatalError("Info.plist has no \(key). Set it in apple/Config/*.xcconfig.")
            }
            return value
        }
        guard let origin = URL(string: value("CrosstuneAPIOrigin")) else {
            fatalError("CrosstuneAPIOrigin is not a URL.")
        }
        apiOrigin = origin
        clerkPublishableKey = value("ClerkPublishableKey")
        clientVersion = value("CFBundleShortVersionString")
    }
}
