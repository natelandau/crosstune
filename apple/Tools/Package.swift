// swift-tools-version: 6.2
// Pins the code generator that `just apple::contract` runs, and holds the contract
// normalizer it feeds, so the app never links either.
import PackageDescription

let package = Package(
    name: "Tools",
    platforms: [.macOS(.v26)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.0.0")
    ],
    targets: [
        .executableTarget(name: "normalize-contract"),
        .executableTarget(name: "generate-vocabulary"),
    ]
)
