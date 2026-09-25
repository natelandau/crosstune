// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "CrosstuneKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "CrosstuneAPI", targets: ["CrosstuneAPI"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.0.0"),
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
            ],
            exclude: ["openapi-generator-config.yaml"]
        ),
        .testTarget(
            name: "CrosstuneAPITests",
            dependencies: [
                "CrosstuneAPI",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ],
            resources: [.copy("Fixtures")]
        ),
    ]
)
