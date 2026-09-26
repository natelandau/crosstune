// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "CrosstuneKit",
    platforms: [.iOS("26.1"), .macOS(.v26)],
    products: [
        .library(name: "CrosstuneAPI", targets: ["CrosstuneAPI"]),
        .library(name: "CrosstuneAudio", targets: ["CrosstuneAudio"]),
        .library(name: "CrosstuneAuth", targets: ["CrosstuneAuth"]),
        .library(name: "CrosstuneCommands", targets: ["CrosstuneCommands"]),
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
        // Constraint only, reached through swift-openapi-urlsession. 1.7.0 calls
        // swift_initBorrow, which the Swift runtime in iOS 26 and macOS 26 does not have, so
        // the app fails to launch there. Lift the cap when a release gates that call.
        .package(url: "https://github.com/apple/swift-collections", "1.6.0"..<"1.7.0"),
    ],
    targets: [
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
            dependencies: [
                "CrosstuneStore", "CrosstuneCommands", "CrosstuneVocabulary",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .target(
            name: "CrosstuneAuth",
            dependencies: [
                "CrosstuneAPI",
                "CrosstuneAudio",
                "CrosstuneStore",
                "CrosstuneSync",
                .product(name: "ClerkKit", package: "clerk-ios"),
                .product(name: "ClerkKitUI", package: "clerk-ios"),
            ]
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
            name: "CrosstuneSync",
            dependencies: [
                "CrosstuneAPI",
                "CrosstuneStore",
                "CrosstuneVocabulary",
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ]
        ),
        .target(
            name: "CrosstuneUI",
            dependencies: [
                "CrosstuneAudio", "CrosstuneAuth", "CrosstuneCommands", "CrosstuneStore", "CrosstuneSync",
                "CrosstuneVocabulary", .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .target(name: "CrosstuneVocabulary"),
        .target(
            name: "CrosstuneTestSupport",
            dependencies: ["CrosstuneStore", .product(name: "GRDB", package: "GRDB.swift")],
            path: "Tests/CrosstuneTestSupport"
        ),
        .testTarget(
            name: "CrosstuneStoreTests",
            dependencies: ["CrosstuneStore", "CrosstuneTestSupport", .product(name: "GRDB", package: "GRDB.swift")]
        ),
        .testTarget(
            name: "CrosstuneAudioTests",
            dependencies: [
                "CrosstuneAudio", "CrosstuneCommands", "CrosstuneStore", "CrosstuneTestSupport",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .testTarget(
            name: "CrosstuneAuthTests",
            dependencies: [
                "CrosstuneAuth", "CrosstuneStore", "CrosstuneTestSupport",
                .product(name: "GRDB", package: "GRDB.swift"),
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
            name: "CrosstuneVocabularyTests",
            dependencies: ["CrosstuneVocabulary"]
        ),
        .testTarget(
            name: "CrosstuneUITests",
            dependencies: [
                "CrosstuneUI", "CrosstuneAudio", "CrosstuneCommands", "CrosstuneStore", "CrosstuneSync",
                "CrosstuneVocabulary", "CrosstuneTestSupport", .product(name: "GRDB", package: "GRDB.swift"),
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
