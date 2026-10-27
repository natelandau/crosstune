// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "CrosstuneKit",
    platforms: [.iOS("26.1"), .macOS(.v26)],
    products: [
        .library(name: "CrosstuneAnalytics", targets: ["CrosstuneAnalytics"]),
        .library(name: "CrosstuneAPI", targets: ["CrosstuneAPI"]),
        .library(name: "CrosstuneAudio", targets: ["CrosstuneAudio"]),
        .library(name: "CrosstuneAuth", targets: ["CrosstuneAuth"]),
        .library(name: "CrosstuneBilling", targets: ["CrosstuneBilling"]),
        .library(name: "CrosstuneCommands", targets: ["CrosstuneCommands"]),
        .library(name: "CrosstuneDesign", targets: ["CrosstuneDesign"]),
        .library(name: "CrosstuneDiagnostics", targets: ["CrosstuneDiagnostics"]),
        .library(name: "CrosstuneExport", targets: ["CrosstuneExport"]),
        .library(name: "CrosstuneRecording", targets: ["CrosstuneRecording"]),
        .library(name: "CrosstuneStore", targets: ["CrosstuneStore"]),
        .library(name: "CrosstuneSync", targets: ["CrosstuneSync"]),
        .library(name: "CrosstuneUI", targets: ["CrosstuneUI"]),
        .library(name: "CrosstuneVocabulary", targets: ["CrosstuneVocabulary"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-http-types", from: "1.0.0"),
        .package(url: "https://github.com/clerk/clerk-ios", from: "1.5.6"),
        .package(url: "https://github.com/groue/GRDB.swift", from: "7.11.1"),
        .package(url: "https://github.com/PostHog/posthog-ios", from: "3.90.0"),
        .package(url: "https://github.com/RevenueCat/purchases-ios-spm", from: "5.91.0"),
        .package(url: "https://github.com/getsentry/sentry-cocoa", from: "9.30.2"),
        // Constraint only, reached through swift-openapi-urlsession. Built with Swift 6.4, 1.7.0
        // strongly links swift_initBorrow, which the Swift runtime in iOS 26 and macOS 26 does
        // not have, so the app fails to launch there.
        .package(url: "https://github.com/apple/swift-collections", from: "1.7.1"),
    ],
    targets: [
        .target(
            name: "CrosstuneAnalytics",
            dependencies: ["CrosstuneVocabulary", .product(name: "PostHog", package: "posthog-ios")]
        ),
        .target(
            name: "CrosstuneAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ],
            exclude: ["openapi-generator-config.yaml"]
        ),
        .target(
            name: "CrosstuneAudio",
            dependencies: ["CrosstuneVocabulary"]
        ),
        .target(
            name: "CrosstuneAuth",
            dependencies: [
                "CrosstuneAnalytics",
                "CrosstuneAPI",
                "CrosstuneDiagnostics",
                "CrosstuneStore",
                "CrosstuneSync",
                .product(name: "ClerkKit", package: "clerk-ios"),
                .product(name: "ClerkKitUI", package: "clerk-ios"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ]
        ),
        .target(
            name: "CrosstuneBilling",
            dependencies: [
                "CrosstuneAnalytics", "CrosstuneDiagnostics",
                .product(name: "RevenueCat", package: "purchases-ios-spm"),
            ]
        ),
        .target(
            name: "CrosstuneDiagnostics",
            dependencies: ["CrosstuneAnalytics", .product(name: "Sentry", package: "sentry-cocoa")]
        ),
        .target(
            name: "CrosstuneStore",
            dependencies: [.product(name: "GRDB", package: "GRDB.swift")]
        ),
        .target(
            name: "CrosstuneCommands",
            dependencies: [
                "CrosstuneStore", "CrosstuneVocabulary",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .target(
            name: "CrosstuneExport",
            dependencies: [
                "CrosstuneStore", "CrosstuneVocabulary", "CrosstuneCommands",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .target(
            name: "CrosstuneRecording",
            dependencies: [
                "CrosstuneAudio", "CrosstuneCommands", "CrosstuneStore", "CrosstuneVocabulary",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .target(
            name: "CrosstuneSync",
            dependencies: [
                "CrosstuneAnalytics",
                "CrosstuneDiagnostics",
                "CrosstuneAPI",
                "CrosstuneStore",
                "CrosstuneVocabulary",
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ]
        ),
        .target(
            name: "CrosstuneDesign",
            dependencies: ["CrosstuneAnalytics", "CrosstuneVocabulary"]
        ),
        .target(
            name: "CrosstuneUI",
            dependencies: [
                "CrosstuneAnalytics", "CrosstuneAudio", "CrosstuneAuth", "CrosstuneBilling", "CrosstuneCommands",
                "CrosstuneDesign", "CrosstuneDiagnostics", "CrosstuneExport", "CrosstuneRecording", "CrosstuneStore",
                "CrosstuneSync", "CrosstuneVocabulary",
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            resources: [.process("Resources")]
        ),
        .target(name: "CrosstuneVocabulary"),
        .target(
            name: "CrosstuneTestSupport",
            dependencies: [
                "CrosstuneAnalytics", "CrosstuneAudio", "CrosstuneBilling", "CrosstuneDiagnostics", "CrosstuneStore",
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Tests/CrosstuneTestSupport"
        ),
        .testTarget(
            name: "CrosstuneAnalyticsTests",
            dependencies: ["CrosstuneAnalytics", "CrosstuneTestSupport", "CrosstuneVocabulary"]
        ),
        .testTarget(
            name: "CrosstuneDiagnosticsTests",
            dependencies: [
                "CrosstuneAnalytics", "CrosstuneDiagnostics", "CrosstuneTestSupport",
                .product(name: "Sentry", package: "sentry-cocoa"),
            ]
        ),
        .testTarget(
            name: "CrosstuneBillingTests",
            dependencies: [
                "CrosstuneAnalytics", "CrosstuneBilling", "CrosstuneDiagnostics", "CrosstuneTestSupport",
                .product(name: "RevenueCat", package: "purchases-ios-spm"),
            ]
        ),
        .testTarget(
            name: "CrosstuneStoreTests",
            dependencies: ["CrosstuneStore", "CrosstuneTestSupport", .product(name: "GRDB", package: "GRDB.swift")]
        ),
        .testTarget(
            name: "CrosstuneAudioTests",
            dependencies: ["CrosstuneAudio", "CrosstuneTestSupport", "CrosstuneVocabulary"]
        ),
        .testTarget(
            name: "CrosstuneRecordingTests",
            dependencies: [
                "CrosstuneAudio", "CrosstuneCommands", "CrosstuneRecording", "CrosstuneStore", "CrosstuneTestSupport",
                "CrosstuneVocabulary", .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .testTarget(
            name: "CrosstuneAuthTests",
            dependencies: [
                "CrosstuneAnalytics", "CrosstuneAPI", "CrosstuneAuth", "CrosstuneStore", "CrosstuneTestSupport",
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ]
        ),
        .testTarget(
            name: "CrosstuneAPITests",
            dependencies: [
                "CrosstuneAPI",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ],
            resources: [.copy("Fixtures")]
        ),
        .testTarget(
            name: "CrosstuneSyncTests",
            dependencies: [
                "CrosstuneAnalytics",
                "CrosstuneDiagnostics",
                "CrosstuneSync",
                "CrosstuneAPI",
                "CrosstuneStore",
                "CrosstuneTestSupport",
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ]
        ),
        .testTarget(
            name: "CrosstuneExportTests",
            dependencies: [
                "CrosstuneExport", "CrosstuneStore", "CrosstuneTestSupport",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .testTarget(
            name: "CrosstuneVocabularyTests",
            dependencies: ["CrosstuneVocabulary"]
        ),
        .testTarget(
            name: "CrosstuneUITests",
            dependencies: [
                "CrosstuneUI", "CrosstuneAudio", "CrosstuneBilling", "CrosstuneRecording", "CrosstuneCommands",
                "CrosstuneDesign",
                "CrosstuneDiagnostics",
                "CrosstuneStore",
                "CrosstuneSync",
                "CrosstuneVocabulary", "CrosstuneTestSupport", .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "ClerkKitUI", package: "clerk-ios"),
            ]
        ),
        .testTarget(
            name: "CrosstuneCommandsTests",
            dependencies: [
                "CrosstuneCommands", "CrosstuneStore", "CrosstuneVocabulary", "CrosstuneTestSupport",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
    ]
)
