/// What the API says about the caller's region.
public struct Region: Sendable, Equatable {
    /// Whether consent is required there; nil when the country is unknown.
    public let consentRequired: Bool?

    public init(consentRequired: Bool?) {
        self.consentRequired = consentRequired
    }
}
