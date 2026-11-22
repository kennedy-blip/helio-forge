#!/usr/bin/env python3
"""
HELIO-FORGE — Android launcher icon generator
============================================================================
    python3 scripts/make-android-icons.py

The AndroidManifest references @mipmap/ic_launcher and ic_launcher_round, but
the Capacitor scaffold was committed without any mipmap density buckets, so
`gradlew assembleRelease` failed resource linking before it ever compiled Kotlin.

This draws the HelioForge mark — a gold sun over a cyan horizon on the deep-navy
app background — and writes every density bucket plus an adaptive icon for API
26+. Pure standard library: PNGs are encoded by hand with zlib, and everything is
supersampled 4x so the circles stay clean at 48 px.

Deterministic: same input, byte-identical output. Safe to re-run.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"

# Brand palette, matching src/lib/state/theme.svelte.js (obsidian).
BG = (0x07, 0x0A, 0x12)
GOLD = (0xF5, 0xB1, 0x3D)
CYAN = (0x38, 0xBD, 0xF8)

ADAPTIVE_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
LEGACY_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

SS = 4  # supersampling factor per axis


def over(dst, src, alpha):
    """Alpha-composite src over dst with a 0..1 coverage value."""
    return tuple(int(round(s * alpha + d * (1 - alpha))) for d, s in zip(dst, src))


def render(size: int, *, adaptive: bool) -> bytes:
    """Return packed RGBA pixels (size*size*4 bytes, no PNG filter bytes)."""
    big = size * SS
    px = [[BG + (255,)] * big for _ in range(big)]

    # Adaptive icons are masked by the launcher; keep the mark inside the safe
    # zone (the inner 66% of the canvas) so nothing important is clipped.
    inset = 0.17 if adaptive else 0.06
    cx = cy = big / 2.0
    span = big * (1 - 2 * inset)

    sun_r = span * 0.27
    sun_y = cy - span * 0.12
    ring_r = span * 0.40
    ring_w = span * 0.055
    horizon_y = cy + span * 0.26
    horizon_r = span * 0.46

    for y in range(big):
        for x in range(big):
            # Squared distance from the sun centre.
            dx, dy = x - cx, y - sun_y
            d = math.hypot(dx, dy)

            # Horizon arc: a cyan stroke along a downward-opening curve.
            hdx, hdy = x - cx, y - horizon_y
            hd = math.hypot(hdx, hdy)

            col = BG
            alpha = 0.0

            # Sun disc.
            if d <= sun_r:
                col, alpha = GOLD, 1.0
            # Halo ring around the sun.
            elif ring_r - ring_w / 2 <= d <= ring_r + ring_w / 2:
                col, alpha = GOLD, 0.30
            # Horizon line, only the lower half of the arc.
            elif abs(hd - horizon_r) <= ring_w * 0.42 and hdy > 0:
                col, alpha = CYAN, 0.85

            if alpha:
                px[y][x] = over(BG, col, alpha) + (255,)

    # Box-downsample the supersampled buffer. Returns packed RGBA with no PNG
    # filter bytes — write_png() prepends exactly one per row.
    out = bytearray()
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    pr, pg, pb, pa = px[y * SS + sy][x * SS + sx]
                    r += pr
                    g += pg
                    b += pb
                    a += pa
            n = SS * SS
            out += bytes((r // n, g // n, b // n, a // n))
    return bytes(out)


def write_png(path: Path, size: int, raw: bytes, *, opaque: bool) -> None:
    """
    Encode packed RGBA pixels into a PNG file.

    `opaque=True` drops the alpha channel (legacy launcher icons, colour type 2).
    `opaque=False` keeps it for adaptively-masked foregrounds (colour type 6).

    Both branches must emit exactly one filter byte per scanline — PNG requires
    it, and omitting it produces a file that looks fine to a lenient viewer but
    that AAPT2 rejects with "AAPT2 process unexpectedly exit".
    """
    stride = size * 4
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter type 0 (None) for this scanline
        base = y * stride
        if opaque:
            for x in range(size):
                o = base + x * 4
                rows += raw[o : o + 3]
        else:
            rows += raw[base : base + stride]
    color_type = 2 if opaque else 6
    body = bytes(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, color_type, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(body, 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def validate(raw: bytes, size: int) -> None:
    """Fail loudly if render() ever emits the wrong number of pixels."""
    expected = size * size * 4
    if len(raw) != expected:
        raise SystemExit(f"render({size}) produced {len(raw)} bytes, expected {expected}")


def main() -> None:
    written = []

    for bucket, size in LEGACY_SIZES.items():
        raw = render(size, adaptive=False)
        validate(raw, size)
        for name in ("ic_launcher.png", "ic_launcher_round.png"):
            p = RES / f"mipmap-{bucket}" / name
            write_png(p, size, raw, opaque=True)
            written.append(p)

    for bucket, size in ADAPTIVE_SIZES.items():
        # Foreground needs alpha so the launcher can mask it.
        raw = render(size, adaptive=True)
        validate(raw, size)
        p = RES / f"mipmap-{bucket}" / "ic_launcher_foreground.png"
        write_png(p, size, raw, opaque=False)
        written.append(p)

    for p in written:
        print(f"{p.relative_to(ROOT)}  {p.stat().st_size:>6} B")
    print(f"\n{len(written)} icons written")


if __name__ == "__main__":
    main()
