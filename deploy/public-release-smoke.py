#!/usr/bin/env python3
"""Проверяет опубликованные байты кандидата, включая фактический CDN из HTML."""
import argparse
import concurrent.futures
import hashlib
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import re
import sys
import time
import urllib.parse
import urllib.request


class EntryAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []
        self.modules = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and values.get("type") == "module" and values.get("src"):
            self.modules.append(values["src"])
            self.paths.append(values["src"])
        if tag == "link" and values.get("rel") in ("stylesheet", "modulepreload") and values.get("href"):
            self.paths.append(values["href"])


def validate_origin(value):
    parsed = urllib.parse.urlsplit(value)
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Invalid public origin")
    if parsed.scheme != "https":
        try:
            local = parsed.hostname == "localhost" or ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError:
            local = False
        if parsed.scheme != "http" or not local:
            raise ValueError("Public origin requires HTTPS")
    if parsed.path not in ("", "/"):
        raise ValueError("Public origin must not include a path")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def png_paths(value):
    if isinstance(value, str):
        return [value] if value.endswith(".png") else []
    if isinstance(value, dict):
        return [path for child in value.values() for path in png_paths(child)]
    if isinstance(value, list):
        return [path for child in value for path in png_paths(child)]
    return []


def runtime_png_sections(manifest):
    # Mirror catalog, micro-ambient and city-transport consumers. Authoring
    # provenance (sourceSheet, sources, source) is not a published asset URL.
    def entry_paths(entries):
        return [entry["path"] for entry in entries.values()]

    return {
        "terrain": manifest.get("terrain", {}),
        "transitions": manifest.get("transitions", {}),
        "tiles": entry_paths(manifest.get("tiles", {})),
        "blockSurfaces": entry_paths(manifest.get("blockSurfaces", {}).get("tiles", {})),
        "buildings": [entry["stages"] for entry in manifest.get("buildings", {}).values()],
        "props": entry_paths(manifest.get("props", {})),
        "propAtlas": manifest.get("propAtlas", {}).get("path"),
        "microAmbient": entry_paths(manifest.get("microAmbient", {}).get("sprites", {})),
        "atlasClouds": manifest.get("atlasClouds", []),
        "cityTransport": entry_paths(manifest.get("cityTransport", {}).get("sprites", {})),
    }


def verify(args):
    origin = validate_origin(args.origin)
    root = Path(args.public_root).resolve(strict=True)
    expected_html = (root / "index.html").read_bytes()
    parser = EntryAssets()
    parser.feed(expected_html.decode("utf-8"))
    if not parser.modules:
        raise ValueError("Candidate has no module entry")
    entry_url = urllib.parse.urljoin(origin + "/", parser.modules[0])
    static_origin = validate_origin(urllib.parse.urlunsplit((*urllib.parse.urlsplit(entry_url)[:2], "", "", "")))
    allowed = {origin, static_origin}
    objects = {origin + "/": expected_html}

    def local_bytes(path):
        if not isinstance(path, str) or not re.fullmatch(r"[A-Za-z0-9_.\-/]+", path) or ".." in path.split("/"):
            raise ValueError("Unsafe candidate asset path")
        source = (root / path.lstrip("/")).resolve(strict=True)
        if not source.is_relative_to(root) or not source.is_file():
            raise ValueError("Candidate asset escapes public tree")
        return source.read_bytes()

    revision_prefix = "game-assets/v5/revisions/" + args.asset_revision + "/"
    manifest_bytes = local_bytes(revision_prefix + "manifest.json")
    if manifest_bytes != local_bytes("game-assets/v5/manifest.json"):
        raise ValueError("Published revision manifest differs from candidate manifest")
    manifest = json.loads(manifest_bytes)
    if manifest.get("assetRevision") != args.asset_revision:
        raise ValueError("Candidate asset revision does not match exporter")

    for reference in parser.paths:
        url = urllib.parse.urljoin(origin + "/", reference)
        parsed = urllib.parse.urlsplit(url)
        ref_origin = validate_origin(urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", "")))
        if ref_origin not in allowed or parsed.query or parsed.fragment or not parsed.path.startswith("/assets/"):
            raise ValueError("Unexpected candidate entry asset URL")
        objects[url] = local_bytes(parsed.path)
    # Check lazy code as well: a successful entry does not prove that opening
    # CITY, a task or account settings will be able to load its module.
    compiled = sorted(path for path in (root / "assets").iterdir() if path.suffix in (".js", ".css", ".woff", ".woff2"))
    if len(compiled) > 256:
        raise ValueError("Compiled asset smoke budget exceeded")
    for path in compiled:
        objects[static_origin + "/assets/" + path.name] = local_bytes("assets/" + path.name)
    asset_base = static_origin + "/game-assets/v5/revisions/" + args.asset_revision + "/"
    objects[asset_base + "manifest.json"] = manifest_bytes
    # A bounded sample covers each manifest section plus all five stages of a
    # representative building. Full sprite geometry is a separate asset gate.
    samples = set()
    for value in runtime_png_sections(manifest).values():
        paths = png_paths(value)
        if paths:
            samples.update((paths[0], paths[-1]))
    buildings = manifest.get("buildings", {})
    if isinstance(buildings, dict) and buildings:
        samples.update(png_paths(next(iter(buildings.values()))["stages"]))
    if len(samples) > 40:
        raise ValueError("PNG smoke budget exceeded")
    for path in sorted(samples):
        expected = local_bytes(revision_prefix + path)
        if not expected.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Candidate PNG signature is invalid")
        objects[asset_base + path] = expected
    deadline = time.monotonic() + args.deadline

    class KnownOrigins(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            parsed = urllib.parse.urlsplit(newurl)
            if urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", "")) not in allowed:
                raise ValueError("Public asset redirected outside candidate origins")
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    def check(item):
        url, expected = item
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Public release smoke deadline exceeded")
        request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "Pragma": "no-cache", "Accept-Encoding": "identity"})
        opener = urllib.request.build_opener(KnownOrigins())
        with opener.open(request, timeout=min(args.timeout, remaining)) as response:
            if not url.startswith(origin + "/"):
                if response.headers.get("Access-Control-Allow-Origin") not in ("*", origin):
                    raise ValueError("Public CDN CORS does not allow application origin")
                if response.headers.get("Cross-Origin-Resource-Policy") in ("same-origin", "same-site"):
                    raise ValueError("Public CDN resource policy blocks application origin")
            parts = []
            size = 0
            while size <= len(expected):
                if time.monotonic() >= deadline:
                    raise TimeoutError("Public release smoke deadline exceeded")
                # read1 returns available bytes; read(n) could wait indefinitely
                # when a gateway keeps trickling data just before each timeout.
                part = response.read1(min(65536, len(expected) + 1 - size))
                if not part:
                    break
                parts.append(part)
                size += len(part)
            received = b"".join(parts)
            if len(received) != len(expected) or hashlib.sha256(received).digest() != hashlib.sha256(expected).digest():
                raise ValueError("Public candidate bytes mismatch: " + urllib.parse.urlsplit(url).path)
        return {"path": urllib.parse.urlsplit(url).path, "bytes": len(expected), "sha256": hashlib.sha256(expected).hexdigest()}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(check, objects.items()))
    return {"status": "ok", "checked": len(results), "assetRevision": args.asset_revision, "origins": sorted(allowed), "objects": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--public-root", required=True)
    parser.add_argument("--asset-revision", required=True)
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--deadline", type=float, default=90)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{16}", args.asset_revision) or not 0 < args.timeout <= 30 or not 0 < args.deadline <= 180:
        parser.error("Invalid asset revision or deadline")
    try:
        print(json.dumps(verify(args)))
    except Exception as error:
        print("Public release smoke failed: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
