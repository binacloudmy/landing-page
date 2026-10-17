"""Map each Revit element handle to its path in BmJsonExportEx's metadata tree.

usage: python3 scripts/hero-categories.py out/meta.json out/cat.json

The tree nests ["objects", [header, header, ..., element, ...]] lists, where a
header is {"objectId": "", "name": <category or family>} and an element carries
"object": <handle>. Each handle maps to the header names above it, e.g.
["Model", "Floors", "Floor"]; build-hero-model.mjs reads the family at index 2.
"""
import json
import sys


def walk(node, path, out):
    if isinstance(node, list):
        here = path + [it["name"] for it in node if isinstance(it, dict) and it.get("objectId") == ""]
        for it in node:
            if isinstance(it, dict) and "object" in it:
                out[it["object"]] = here
            if isinstance(it, (list, dict)):
                walk(it, here, out)
    elif isinstance(node, dict):
        for value in node.values():
            if isinstance(value, (list, dict)):
                walk(value, path, out)


if __name__ == "__main__":
    src, dst = sys.argv[1:3]
    with open(src) as f:
        tree = json.load(f)
    cat = {}
    walk(tree["data"]["objects"], [], cat)
    with open(dst, "w") as f:
        json.dump(cat, f)
    print(f"{len(cat)} elements")
