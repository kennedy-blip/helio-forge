"""
HELIO-FORGE — /api/helio_ephemeris.py
================================================================================
Vercel Python 3.12 Serverless Function  ·  online ephemeris engine
================================================================================
Routes (single function, action dispatch):

  GET  /api/helio_ephemeris?action=health
  GET  /api/helio_ephemeris?action=position&lat=&lon=&doy=&minutes=
  GET  /api/helio_ephemeris?action=ephemeris&lat=&lon=&doy=&tilt=&azimuth=&kw=
  GET  /api/helio_ephemeris?action=annual&lat=&lon=&kw=&tilt=&azimuth=
  GET  /api/helio_ephemeris?action=arcs&lat=&lon=
  GET  /api/helio_ephemeris?action=irradiance-curve&lat=&lon=&tilt=
  POST /api/helio_ephemeris  { "action": "quote" | "autonomy" | "strings" | "soc" | "shade" }

Zero third-party dependencies: Python standard library only, so the Vercel
build never needs a pip install and the same file is importable by the
Pyodide/WASM bridge for 100% offline operation.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import parse_qs, urlparse

# --------------------------------------------------------------------------- #
# Import the shared physics kernel (single source of truth).
# --------------------------------------------------------------------------- #
_HERE = os.path.dirname(os.path.abspath(__file__))
for _candidate in (
    os.path.join(_HERE, "..", "src", "lib", "python"),
    os.path.join(_HERE, "src", "lib", "python"),
    os.path.join(os.getcwd(), "src", "lib", "python"),
    "/var/task/src/lib/python",
):
    if os.path.isdir(_candidate) and _candidate not in sys.path:
        sys.path.insert(0, _candidate)

try:  # pragma: no cover - import guard
    from helio_kernel import (  # noqa: E402
        BATTERY_CHEMISTRY,
        annual_irradiance_curve,
        annual_yield,
        audit_quote,
        battery_autonomy,
        clear_sky_irradiance,
        daylight_hours,
        ephemeris_payload,
        horizon_efficiency,
        optimal_tilt,
        simulate_soc,
        solar_position,
        solstice_arcs,
        string_sizing,
    )

    KERNEL_OK = True
    KERNEL_ERROR = None
except Exception as exc:  # noqa: BLE001
    BATTERY_CHEMISTRY = {}
    KERNEL_OK = False
    KERNEL_ERROR = f"{type(exc).__name__}: {exc}"

VERSION = "1.0.0"
KERNEL_VERSION = "helio_kernel.py@python3.12"


# --------------------------------------------------------------------------- #
# Parameter coercion
# --------------------------------------------------------------------------- #

def _f(params: dict[str, Any], key: str, default: float) -> float:
    raw = params.get(key, default)
    if isinstance(raw, list):
        raw = raw[0] if raw else default
    if raw is None or raw == "":
        return float(default)
    return float(raw)


def _i(params: dict[str, Any], key: str, default: int) -> int:
    return int(round(_f(params, key, default)))


def _horizon(params: dict[str, Any]) -> list[dict[str, float]] | None:
    raw = params.get("horizon")
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if not raw:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, list) or not raw:
        return None
    clean = []
    for point in raw:
        if isinstance(point, dict):
            clean.append({
                "azimuth": float(point.get("azimuth", 0.0)),
                "elevation": float(point.get("elevation", 0.0)),
            })
    return clean or None


# --------------------------------------------------------------------------- #
# Action handlers
# --------------------------------------------------------------------------- #

def _health(_: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": KERNEL_OK,
        "kernelError": KERNEL_ERROR,
        "service": "helio-ephemeris",
        "version": VERSION,
        "kernel": KERNEL_VERSION,
        "runtime": f"python {sys.version.split()[0]}",
        "engine": "NOAA/NREL SPA + ASHRAE clear-sky + Peukert",
        "chemistry": list(BATTERY_CHEMISTRY.keys()),
        "offlineMirror": "src/lib/solar/kernel.js",
        "parityToleranceDeg": 0.01,
    }


def _position(p: dict[str, Any]) -> Any:
    lat = _f(p, "lat", 30.2672)
    lon = _f(p, "lon", -97.7431)
    doy = _i(p, "doy", 172)
    minutes = _f(p, "minutes", 12 * 60)
    pos = solar_position(lat, lon, doy=doy, utc_minutes=minutes)
    sky = clear_sky_irradiance(pos["elevation"])
    return {**{k: round(v, 5) for k, v in pos.items()}, **{k: round(v, 2) for k, v in sky.items()}}


def _ephemeris(p: dict[str, Any]) -> Any:
    lat = _f(p, "lat", 30.2672)
    lon = _f(p, "lon", -97.7431)
    doy = _i(p, "doy", 172)
    return ephemeris_payload(
        lat, lon, doy,
        tilt=_f(p, "tilt", optimal_tilt(lat, doy, "fixed")),
        panel_azimuth=_f(p, "azimuth", 180.0),
        timezone_offset_hours=_f(p, "tz", round(lon / 15.0)),
        horizon=_horizon(p),
        kw_stc=_f(p, "kw", 1.0),
    )


def _annual(p: dict[str, Any]) -> Any:
    lat = _f(p, "lat", 30.2672)
    lon = _f(p, "lon", -97.7431)
    kw = _f(p, "kw", 5.0)
    tilt = _f(p, "tilt", optimal_tilt(lat, 172, "fixed"))
    return annual_yield(
        lat, lon, kw, tilt,
        panel_azimuth=_f(p, "azimuth", 180.0),
        ambient_c=_f(p, "ambient", 25.0),
        wind_ms=_f(p, "wind", 1.5),
        mount=str(p.get("mount", "roof")),
        gamma_pct_per_c=_f(p, "gamma", -0.38),
        horizon=_horizon(p),
        years=_i(p, "years", 25),
    )


def _arcs(p: dict[str, Any]) -> Any:
    return solstice_arcs(
        _f(p, "lat", 30.2672),
        _f(p, "lon", -97.7431),
        timezone_offset_hours=_f(p, "tz", 0.0),
        step_minutes=_i(p, "step", 15),
    )


def _curve(p: dict[str, Any]) -> Any:
    lat = _f(p, "lat", 30.2672)
    return annual_irradiance_curve(
        lat,
        _f(p, "lon", -97.7431),
        _f(p, "tilt", optimal_tilt(lat, 172, "fixed")),
        panel_azimuth=_f(p, "azimuth", 180.0),
        horizon=_horizon(p),
    )


def _quote(p: dict[str, Any]) -> Any:
    return audit_quote(
        latitude=_f(p, "lat", 30.2672),
        longitude=_f(p, "lon", -97.7431),
        system_kw=_f(p, "systemKw", 8.0),
        quoted_price_usd=_f(p, "quotedPrice", 24000.0),
        promised_kwh_per_year=_f(p, "promisedKwh", 13000.0),
        utility_rate_usd=_f(p, "utilityRate", 0.16),
        tilt=_f(p, "tilt", -1) if _f(p, "tilt", -1) >= 0 else None,
        panel_azimuth=_f(p, "azimuth", 180.0),
        horizon=_horizon(p),
        ambient_c=_f(p, "ambient", 25.0),
    )


def _autonomy(p: dict[str, Any]) -> Any:
    return battery_autonomy(
        chemistry=str(p.get("chemistry", "lifepo4")),
        capacity_ah=_f(p, "capacityAh", 200.0),
        voltage=_f(p, "voltage", 48.0),
        load_watts=_f(p, "loadWatts", 450.0),
        dod_pct=_f(p, "dod", 80.0),
        inverter_efficiency_pct=_f(p, "inverter", 92.0),
        temperature_c=_f(p, "temperature", 25.0),
    )


def _strings(p: dict[str, Any]) -> Any:
    return string_sizing(
        panel_voc=_f(p, "panelVoc", 41.2),
        panel_vmp=_f(p, "panelVmp", 34.1),
        panel_isc=_f(p, "panelIsc", 11.5),
        panel_watt=_f(p, "panelWatt", 400.0),
        panels_series=_i(p, "series", 4),
        strings_parallel=_i(p, "parallel", 2),
        controller_max_voc=_f(p, "controllerMaxVoc", 150.0),
        controller_mppt_low=_f(p, "mpptLow", 30.0),
        controller_mppt_high=_f(p, "mpptHigh", 115.0),
        controller_max_amps=_f(p, "maxAmps", 100.0),
        record_low_c=_f(p, "recordLowC", -15.0),
    )


def _soc(p: dict[str, Any]) -> Any:
    loads = p.get("loads") or []
    if isinstance(loads, str):
        loads = json.loads(loads)
    return simulate_soc(
        chemistry=str(p.get("chemistry", "lifepo4")),
        capacity_ah=_f(p, "capacityAh", 200.0),
        voltage=_f(p, "voltage", 48.0),
        ac_loads=loads,
        array_kw=_f(p, "arrayKw", 2.0),
        tilt=_f(p, "tilt", 30.0),
        panel_azimuth=_f(p, "azimuth", 180.0),
        latitude=_f(p, "lat", 30.2672),
        longitude=_f(p, "lon", -97.7431),
        doy=_i(p, "doy", 355),
        dod_pct=_f(p, "dod", 80.0),
        inverter_efficiency_pct=_f(p, "inverter", 92.0),
        initial_soc_pct=_f(p, "initialSoc", 100.0),
        ambient_c=_f(p, "ambient", 25.0),
        horizon=_horizon(p),
        hours=_i(p, "hours", 48),
    )


def _shade(p: dict[str, Any]) -> Any:
    lat = _f(p, "lat", 30.2672)
    return horizon_efficiency(
        lat,
        _f(p, "lon", -97.7431),
        _horizon(p) or [],
        _f(p, "tilt", optimal_tilt(lat, 172, "fixed")),
        _f(p, "azimuth", 180.0),
    )


def _daylight(p: dict[str, Any]) -> Any:
    lat = _f(p, "lat", 30.2672)
    doy = _i(p, "doy", 172)
    return {
        **daylight_hours(lat, doy),
        "optimalTilt": {
            "today": optimal_tilt(lat, doy, "today"),
            "fixed": optimal_tilt(lat, doy, "fixed"),
            "winter": optimal_tilt(lat, doy, "winter"),
            "summer": optimal_tilt(lat, doy, "summer"),
            "annual": optimal_tilt(lat, doy, "annual"),
        },
    }


ACTIONS = {
    "health": _health,
    "position": _position,
    "ephemeris": _ephemeris,
    "annual": _annual,
    "arcs": _arcs,
    "irradiance-curve": _curve,
    "quote": _quote,
    "autonomy": _autonomy,
    "strings": _strings,
    "soc": _soc,
    "shade": _shade,
    "daylight": _daylight,
}


# --------------------------------------------------------------------------- #
# Core request router (shared by Vercel + the local dev server)
# --------------------------------------------------------------------------- #

def dispatch(action: str, params: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    handler = ACTIONS.get(action)
    if handler is None:
        return 404, {
            "ok": False,
            "error": f"unknown action '{action}'",
            "actions": sorted(ACTIONS),
        }
    if not KERNEL_OK:
        return 500, {"ok": False, "error": f"kernel unavailable: {KERNEL_ERROR}"}
    try:
        payload = handler(params)
    except Exception as exc:  # noqa: BLE001
        return 400, {
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "trace": traceback.format_exc(limit=4).splitlines()[-6:],
        }
    return 200, {
        "ok": True,
        "action": action,
        "engine": "python3.12-serverless",
        "version": VERSION,
        "elapsedKernel": KERNEL_VERSION,
        "payload": payload,
    }


def _merge_params(query: dict[str, list[str]], body: dict[str, Any] | None) -> dict[str, Any]:
    merged: dict[str, Any] = {k: (v[0] if len(v) == 1 else v) for k, v in query.items()}
    if body:
        merged.update(body)
    return merged


class handler(BaseHTTPRequestHandler):
    """Vercel Python runtime entrypoint."""

    protocol_version = "HTTP/1.1"

    def _emit(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Cache-Control", "public, max-age=60, s-maxage=300")
        self.send_header("X-Helio-Engine", "python3.12-serverless")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._emit(204, {})

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        action = (query.get("action") or ["health"])[0]
        status, payload = dispatch(action, _merge_params(query, None))
        self._emit(status, payload)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError as exc:
            self._emit(400, {"ok": False, "error": f"invalid JSON body: {exc}"})
            return
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        action = body.pop("action", (query.get("action") or ["ephemeris"])[0])
        status, payload = dispatch(action, _merge_params(query, body))
        self._emit(status, payload)

    def log_message(self, fmt: str, *args: Any) -> None:  # keep Vercel logs clean
        if os.environ.get("HELIO_DEBUG"):
            super().log_message(fmt, *args)
