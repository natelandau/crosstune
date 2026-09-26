// Rewrites the API's OpenAPI document into the shape Swift OpenAPI Generator reads.
//
// Usage: normalize-contract <input.json> <output.json>
//
// Pydantic writes a nullable field as `anyOf: [X, {"type": "null"}]`. The generator
// skips a `null` branch and, with it, the whole field, so each one becomes:
//   - `type: [T, "null"]` when X is an inline schema, which the generator makes Optional.
//   - A bare `$ref` to X, dropped from its object's `required`, so it is still Optional.
// An installed app lags the API it talks to, so two constraints that would make it reject
// a newer server's payload are removed, as the web client's local rows loosen them too:
//   - `additionalProperties: false`, which fails on a field the API adds later.
//   - `enum` on a string, which fails on a vocabulary value the API adds later. The
//     client reads each such value through its own list of the ones it knows.
// Each sync row schema also gets `additionalProperties: true`, so the generated type carries
// an `additionalProperties` container the store reads into a pulled row's `extra`, matching
// the web client's own untyped pass-through of unknown row fields.

import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    FileHandle.standardError.write(Data("usage: normalize-contract <input.json> <output.json>\n".utf8))
    exit(64)
}

/// The tables synced with the API; the store keeps any field of these it does not model.
let syncRowSchemas: Set<String> = [
    "TuneRow", "UserTuneRow", "ListRow", "ListItemRow",
    "RecordingLinkRow", "RecordingRow", "UserSettingsRow",
]

/// Marks each sync row schema open to additional properties, before the generic pass below
/// normalizes the document.
func openSyncRowSchemas(_ document: Any) -> Any {
    guard var document = document as? [String: Any],
        var components = document["components"] as? [String: Any],
        var schemas = components["schemas"] as? [String: Any]
    else { return document }
    for name in syncRowSchemas {
        guard var schema = schemas[name] as? [String: Any] else { continue }
        schema["additionalProperties"] = true
        schemas[name] = schema
    }
    components["schemas"] = schemas
    document["components"] = components
    return document
}

/// The rewritten schema, and whether it is a nullable reference its parent must stop requiring.
func normalize(_ value: Any) -> (value: Any, dropFromRequired: Bool) {
    if let array = value as? [Any] {
        return (array.map { normalize($0).value }, false)
    }
    guard var node = value as? [String: Any] else {
        return (value, false)
    }

    if node["additionalProperties"] as? Bool == false {
        node.removeValue(forKey: "additionalProperties")
    }
    if node["enum"] != nil, isString(node["type"]) {
        node.removeValue(forKey: "enum")
    }

    var dropFromRequired = false
    for key in ["anyOf", "oneOf"] {
        guard let branches = node[key] as? [Any] else { continue }
        let kept = branches.filter { !isNull($0) }
        guard kept.count < branches.count else { continue }
        node.removeValue(forKey: key)
        if kept.count == 1, let branch = kept[0] as? [String: Any], let type = branch["type"] as? String,
            branch["$ref"] == nil
        {
            node.merge(branch) { outer, _ in outer }
            node["type"] = [type, "null"]
        } else if kept.count == 1, let branch = kept[0] as? [String: Any], let ref = branch["$ref"] {
            node = ["$ref": ref]
            dropFromRequired = true
        } else {
            node[key] = kept
            dropFromRequired = true
        }
    }

    var dropped: Set<String> = []
    for (key, child) in node {
        if key == "properties", let properties = child as? [String: Any] {
            var rewritten: [String: Any] = [:]
            for (name, schema) in properties {
                let result = normalize(schema)
                rewritten[name] = result.value
                if result.dropFromRequired { dropped.insert(name) }
            }
            node[key] = rewritten
        } else {
            node[key] = normalize(child).value
        }
    }
    if !dropped.isEmpty, let required = node["required"] as? [String] {
        node["required"] = required.filter { !dropped.contains($0) }
    }
    return (node, dropFromRequired)
}

func isString(_ type: Any?) -> Bool {
    if let type = type as? String { return type == "string" }
    return (type as? [String])?.contains("string") ?? false
}

func isNull(_ schema: Any) -> Bool {
    guard let schema = schema as? [String: Any] else { return false }
    return schema.count == 1 && schema["type"] as? String == "null"
}

do {
    let input = try Data(contentsOf: URL(fileURLWithPath: arguments[1]))
    let document = openSyncRowSchemas(try JSONSerialization.jsonObject(with: input))
    let output = try JSONSerialization.data(
        withJSONObject: normalize(document).value,
        options: [.prettyPrinted, .sortedKeys]
    )
    let outputURL = URL(fileURLWithPath: arguments[2])
    try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try output.write(to: outputURL)
} catch {
    // A top-level throw traps with a crash report; a contract problem is the reader's to fix.
    FileHandle.standardError.write(Data("normalize-contract: \(error.localizedDescription)\n".utf8))
    exit(1)
}
