#!/usr/bin/env python3
"""Package the three finalized r32 forms without invoking Blender or editing meshes.

This is deliberately a hash-locked subset operation for the single completed
release, not a general exporter. Only GLB JSON references and buffer offsets are
remapped; every reachable buffer view is copied verbatim. No mesh is decoded,
generated, transformed, rebaked, or re-exported by this helper.

python3 blender/package_env_stage5_r32.py --out <scratch>/env_stage5_forms_r32.glb
"""

import argparse
import copy
import hashlib
import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "progress/tmp/env-r32-stage5-kit/release/env_stage5_kit.glb"
SOURCE_SHA256 = "9b3b537b709841a5469b70565371ae957fdb09aa98d0c2b63fc4f43383fe1fb4"
MODULES = ("pillar", "pillar_lo", "throne")
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_source(path):
    raw = Path(path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    require(digest == SOURCE_SHA256,
            f"source SHA-256 mismatch: expected {SOURCE_SHA256}, got {digest}")
    require(len(raw) >= 28, "truncated GLB")
    magic, version, length = struct.unpack_from("<4sII", raw)
    require((magic, version, length) == (b"glTF", 2, len(raw)), "invalid GLB header")
    chunks = []
    offset = 12
    while offset < len(raw):
        require(offset + 8 <= len(raw), "truncated chunk header")
        size, kind = struct.unpack_from("<II", raw, offset)
        offset += 8
        require(size % 4 == 0 and offset + size <= len(raw), "invalid chunk size")
        chunks.append((kind, raw[offset:offset + size]))
        offset += size
    require([kind for kind, _ in chunks] == [JSON_CHUNK, BIN_CHUNK],
            "expected exactly one JSON and one BIN chunk")
    doc = json.loads(chunks[0][1])
    binary = chunks[1][1]
    require(set(doc) == {"asset", "scene", "scenes", "nodes", "meshes",
                         "accessors", "bufferViews", "buffers"},
            "unexpected source dependencies; refusing to drop unsupported data")
    require(len(doc["buffers"]) == 1 and "uri" not in doc["buffers"][0],
            "expected one embedded buffer")
    size = doc["buffers"][0]["byteLength"]
    require(size <= len(binary) <= size + 3, "invalid embedded buffer length")
    require(doc["scene"] == 0 and len(doc["scenes"]) == 1, "expected one scene")
    return doc, binary


def subset(doc, binary, names=MODULES):
    """Return a compact subset. Single-name subsets are for isolated QA only."""
    require(bool(names) and len(set(names)) == len(names) and set(names) <= set(MODULES),
            "only finalized pillar, pillar_lo, throne modules may be selected")
    nodes = []
    for name in names:
        found = [i for i, node in enumerate(doc["nodes"]) if node.get("name") == name]
        require(len(found) == 1, f"expected exactly one node named {name}")
        nodes.append(found[0])
    nodes.sort()
    for index in nodes:
        node = doc["nodes"][index]
        require(set(node) <= {"name", "mesh", "translation", "rotation", "scale",
                              "matrix", "weights", "extras"} and "mesh" in node,
                "selected nodes must be standalone meshes without other dependencies")
        require(index in doc["scenes"][0]["nodes"] and
                all(index not in n.get("children", []) for n in doc["nodes"]),
                "selected nodes must retain their original root transforms")

    meshes = sorted({doc["nodes"][i]["mesh"] for i in nodes})
    accessors = set()
    for index in meshes:
        mesh = doc["meshes"][index]
        require(set(mesh) <= {"name", "primitives", "weights", "extras"},
                "unsupported mesh dependency")
        for primitive in mesh["primitives"]:
            require(set(primitive) <= {"attributes", "indices", "mode", "targets", "extras"},
                    "unexpected primitive material/extension dependency")
            accessors.update(primitive["attributes"].values())
            if "indices" in primitive:
                accessors.add(primitive["indices"])
            for target in primitive.get("targets", []):
                accessors.update(target.values())
    accessors = sorted(accessors)
    views = set()
    for index in accessors:
        accessor = doc["accessors"][index]
        require("bufferView" in accessor and "sparse" not in accessor and
                "extensions" not in accessor, "unsupported accessor dependency")
        views.add(accessor["bufferView"])
    views = sorted(views)

    node_map = {old: new for new, old in enumerate(nodes)}
    mesh_map = {old: new for new, old in enumerate(meshes)}
    accessor_map = {old: new for new, old in enumerate(accessors)}
    view_map = {old: new for new, old in enumerate(views)}
    out = {"asset": copy.deepcopy(doc["asset"]), "scene": 0,
           "scenes": copy.deepcopy(doc["scenes"]),
           "nodes": [copy.deepcopy(doc["nodes"][i]) for i in nodes],
           "meshes": [copy.deepcopy(doc["meshes"][i]) for i in meshes],
           "accessors": [copy.deepcopy(doc["accessors"][i]) for i in accessors],
           "bufferViews": [], "buffers": copy.deepcopy(doc["buffers"])}
    out["scenes"][0]["nodes"] = [node_map[i] for i in doc["scenes"][0]["nodes"] if i in node_map]
    for node in out["nodes"]:
        node["mesh"] = mesh_map[node["mesh"]]
    for mesh in out["meshes"]:
        for primitive in mesh["primitives"]:
            primitive["attributes"] = {key: accessor_map[value]
                                       for key, value in primitive["attributes"].items()}
            if "indices" in primitive:
                primitive["indices"] = accessor_map[primitive["indices"]]
            for target in primitive.get("targets", []):
                for key, value in target.items():
                    target[key] = accessor_map[value]
    for accessor in out["accessors"]:
        accessor["bufferView"] = view_map[accessor["bufferView"]]

    packed = bytearray()
    for index in views:
        view = copy.deepcopy(doc["bufferViews"][index])
        require(view["buffer"] == 0 and "extensions" not in view,
                "unsupported buffer view dependency")
        start, length = view.get("byteOffset", 0), view["byteLength"]
        require(0 <= start and start + length <= doc["buffers"][0]["byteLength"],
                "buffer view outside embedded buffer")
        packed.extend(b"\0" * (-len(packed) % 4))
        view["buffer"], view["byteOffset"] = 0, len(packed)
        packed.extend(binary[start:start + length])
        out["bufferViews"].append(view)
    out["buffers"][0]["byteLength"] = len(packed)
    return out, bytes(packed)


def encode(doc, binary):
    metadata = json.dumps(doc, ensure_ascii=False, allow_nan=False,
                          separators=(",", ":"), sort_keys=True).encode("utf-8")
    metadata += b" " * (-len(metadata) % 4)
    binary += b"\0" * (-len(binary) % 4)
    length = 12 + 8 + len(metadata) + 8 + len(binary)
    return (struct.pack("<4sII", b"glTF", 2, length) +
            struct.pack("<II", len(metadata), JSON_CHUNK) + metadata +
            struct.pack("<II", len(binary), BIN_CHUNK) + binary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE,
                        help="completed release GLB; fixed SHA-256 is always enforced")
    parser.add_argument("--out", type=Path, required=True, help="output GLB file in scratch")
    args = parser.parse_args()
    try:
        require(args.out.resolve() != args.source.resolve(), "output must not overwrite source")
        require(not args.out.exists(), "output already exists; choose a fresh scratch path")
        doc, binary = read_source(args.source)
        output_doc, output_binary = subset(doc, binary)
        raw = encode(output_doc, output_binary)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("xb") as stream:
            stream.write(raw)
    except (ValueError, OSError, KeyError, struct.error) as exc:
        parser.exit(1, f"package_env_stage5_r32: {exc}\n")
    print(json.dumps({"path": str(args.out), "sha256": hashlib.sha256(raw).hexdigest(),
                      "bytes": len(raw), "modules": list(MODULES),
                      "source_sha256": SOURCE_SHA256}, sort_keys=True))


if __name__ == "__main__":
    main()
