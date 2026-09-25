// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "CrosstuneKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "CrosstuneAPI", targets: ["CrosstuneAPI"]),
        .library(name: "CrosstuneAuth", targets: ["CrosstuneAuth"]),
        .library(name: "CrosstuneStore", targets: ["CrosstuneStore"]),
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
            name: "CrosstuneAuth",
            dependencies: [
                "CrosstuneAPI",
                "CrosstuneStore",
                .product(name: "ClerkKit", package: "clerk-ios"),
                .product(name: "ClerkKitUI", package: "clerk-ios"),
            ]
        ),
        .target(
            name: "CrosstuneStore",
            dependencies: [.product(name: "GRDB", package: "GRDB.swift")]
        ),
        .testTarget(
            name: "CrosstuneStoreTests",
            dependencies: ["CrosstuneStore", .product(name: "GRDB", package: "GRDB.swift")]
        ),
        .testTarget(
            name: "CrosstuneAuthTests",
            dependencies: ["CrosstuneAuth", "CrosstuneStore"]
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
    ]
)
