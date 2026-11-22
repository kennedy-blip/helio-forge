"""
HELIO-FORGE — helio_kernel.py
================================================================================
Python 3.12 Solar Physics Kernel  ·  canonical source of truth
================================================================================
This single module is executed in THREE places:

  1. Vercel Python Serverless Function  ->  /api/helio_ephemeris.py   (online)
  2. Pyodide / WebAssembly in the browser ->  offline Air-Gapped mode  (WASM)
  3. Imported by the deterministic JS mirror in src/lib/solar/localKernel.js
     (the mirror is validated against this module's outputs to < 0.01 deg)

No third-party dependencies. Standard library only. Deterministic. Offline.

References
----------
  * NOAA Solar Calculator / NREL Solar Position Algorithm (Reda & Andreas, 2004)
  * ASHRAE Fundamentals Ch.14 clear-sky irradiance (tau_b = 0.7)
  * Kasten & Young (1989) relative optical air mass
  * Sandia / NREL PVWatts v8 loss model + NOCT cell temperature
  * Peukert (1897) capacity law, DoD & inverter derating
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

SOLAR_CONSTANT = 1367.0          # W/m^2, extraterrestrial irradiance
STC_IRRADIANCE = 1000.0          # W/m^2, Standard Test Conditions
STC_TEMP_C = 25.0                # deg C, Standard Test Conditions
DEG = math.pi / 180.0
NOON_SUNRISE_ZENITH = 90.833     # deg, refraction + solar disc radius
DEFAULT_ALBEDO = 0.20

# Silicon PV temperature coefficients (%/degC). Gamma is *negative*.
GAMMA_PMAX_SILICON = -0.38       # power coefficient (c-Si, conservative)
BETA_VOC_SILICON = -0.29         # open-circuit voltage coefficient
GAMMA_VMP_SILICON = -0.35        # max-power voltage coefficient

# Peukert exponents per chemistry (measured at the 20 h rate for lead acids).
BATTERY_CHEMISTRY: dict[str, dict[str, Any]] = {
    "lifepo4": {
        "label": "LiFePO4",
        "k": 1.02,
        "h": 1.0,
        "dod_max": 0.90,
        "round_trip": 0.96,
        "cycles": 6000,
    },
    "nmc": {
        "label": "Lithium-Ion NMC",
        "k": 1.03,
        "h": 1.0,
        "dod_max": 0.85,
        "round_trip": 0.95,
        "cycles": 3000,
    },
    "agm": {
        "label": "AGM Lead-Acid",
        "k": 1.15,
        "h": 20.0,
        "dod_max": 0.50,
        "round_trip": 0.85,
        "cycles": 600,
    },
    "gel": {
        "label": "Gel Lead-Acid",
        "k": 1.18,
        "h": 20.0,
        "dod_max": 0.45,
        "round_trip": 0.82,
        "cycles": 500,
    },
}


# --------------------------------------------------------------------------- #
# Small math helpers
# --------------------------------------------------------------------------- #

def _clamp(value: float, lo: float, hi: float) -> float:
    return lo if value < lo else hi if value > hi else value


def _sin(deg: float) -> float:
    return math.sin(deg * DEG)


def _cos(deg: float) -> float:
    return math.cos(deg * DEG)


def _tan(deg: float) -> float:
    return math.tan(deg * DEG)


def _asin(x: float) -> float:
    return math.degrees(math.asin(_clamp(x, -1.0, 1.0)))


def _acos(x: float) -> float:
    return math.degrees(math.acos(_clamp(x, -1.0, 1.0)))


def _wrap360(deg: float) -> float:
    return deg % 360.0


def _wrap180(deg: float) -> float:
    d = _wrap360(deg)
    return d - 360.0 if d > 180.0 else d


# --------------------------------------------------------------------------- #
# Calendar <-> solar geometry
# --------------------------------------------------------------------------- #

def day_of_year(year: int, month: int, day: int) -> int:
    """1-based day of year (365 in a common year, 366 in a leap year)."""
    return datetime(year, month, day, tzinfo=timezone.utc).timetuple().tm_yday


def day_to_date(year: int, doy: int) -> tuple[int, int]:
    """Inverse of day_of_year. Returns (month, day)."""
    doy = int(_clamp(doy, 1, 366))
    d = datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=doy - 1)
    return d.month, d.day


def solar_declination(doy: int) -> float:
    """
    Solar declination delta (deg) — Spencer (1971) Fourier series.
    Accurate to ~0.1 deg which is far inside the 0.5 deg haptic lock window.
    """
    n = float(doy)
    g = 2.0 * math.pi * (n - 1.0) / 365.0
    return (
        0.006918
        - 0.399912 * math.cos(g)
        + 0.070257 * math.sin(g)
        - 0.006758 * math.cos(2 * g)
        + 0.000907 * math.sin(2 * g)
        - 0.002697 * math.cos(3 * g)
        + 0.001480 * math.sin(3 * g)
    ) * (180.0 / math.pi)


def equation_of_time(doy: int) -> float:
    """Equation of time (minutes) — Spencer (1971). True solar time - mean."""
    n = float(doy)
    g = 2.0 * math.pi * (n - 1.0) / 365.0
    return 229.18 * (
        0.000075
        + 0.001868 * math.cos(g)
        - 0.032077 * math.sin(g)
        - 0.014615 * math.cos(2 * g)
        - 0.040849 * math.sin(2 * g)
    )


def eccentricity_correction(doy: int) -> float:
    """Earth-orbit eccentricity factor E0 (dimensionless, ~0.967..1.034)."""
    n = float(doy)
    g = 2.0 * math.pi * (n - 1.0) / 365.0
    return 1.000110 + 0.034221 * math.cos(g) + 0.001280 * math.sin(g) \
        + 0.000719 * math.cos(2 * g) + 0.000077 * math.sin(2 * g)


def julian_day(when: datetime) -> float:
    """Julian day from an aware UTC datetime."""
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    when = when.astimezone(timezone.utc)
    y, m = when.year, when.month
    d = (
        when.day
        + when.hour / 24.0
        + when.minute / 1440.0
        + when.second / 86400.0
    )
    if m <= 2:
        y -= 1
        m += 12
    a = y // 100
    b = 2 - a + a // 4
    return math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + d + b - 1524.5


# --------------------------------------------------------------------------- #
# Solar position (NOAA / NREL hybrid)
# --------------------------------------------------------------------------- #

def solar_position(
    latitude: float,
    longitude: float,
    when: datetime | None = None,
    doy: int | None = None,
    utc_minutes: float | None = None,
) -> dict[str, float]:
    """
    High-precision apparent solar position.

    Supply either `when` (an aware datetime, converted to UTC) or the pair
    (`doy`, `utc_minutes` since 00:00 UTC) for pure-function determinism.

    Returns elevation / azimuth (deg, azimuth clockwise from true north),
    zenith, declination, hour angle, equation of time and air mass.
    """
    if when is not None:
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        utc = when.astimezone(timezone.utc)
        doy = utc.timetuple().tm_yday
        utc_minutes = utc.hour * 60.0 + utc.minute + utc.second / 60.0

    if doy is None or utc_minutes is None:
        raise ValueError("solar_position requires `when` or (`doy`, `utc_minutes`)")

    jd = 2451545.0 if False else _jd_from_parts(doy, utc_minutes)
    t = (jd - 2451545.0) / 36525.0

    l0 = _wrap360(280.46646 + t * (36000.76983 + t * 0.0003032))
    m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)

    c = (
        _sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
        + _sin(2 * m) * (0.019993 - 0.000101 * t)
        + _sin(3 * m) * 0.000289
    )
    true_long = l0 + c
    omega = 125.04 - 1934.136 * t
    app_long = true_long - 0.00569 - 0.00478 * _sin(omega)

    mean_obliq = 23.0 + (26.0 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60.0) / 60.0
    obliq = mean_obliq + 0.00256 * _cos(omega)

    decl = _asin(_sin(obliq) * _sin(app_long))

    y = _tan(obliq / 2.0) ** 2
    eot = 4.0 * math.degrees(
        y * _sin(2 * l0)
        - 2 * e * _sin(m)
        + 4 * e * y * _sin(m) * _cos(2 * l0)
        - 0.5 * y * y * _sin(4 * l0)
        - 1.25 * e * e * _sin(2 * m)
    )

    true_solar_minutes = (utc_minutes + eot + 4.0 * longitude) % 1440.0
    hour_angle = true_solar_minutes / 4.0 - 180.0

    lat = latitude
    zenith = _acos(_sin(lat) * _sin(decl) + _cos(lat) * _cos(decl) * _cos(hour_angle))
    elevation = 90.0 - zenith

    az = math.degrees(
        math.atan2(
            _sin(hour_angle),
            _cos(hour_angle) * _sin(lat) - _tan(decl) * _cos(lat),
        )
    )
    azimuth = _wrap360(az + 180.0)

    return {
        "elevation": elevation,
        "zenith": zenith,
        "azimuth": azimuth,
        "declination": decl,
        "hourAngle": hour_angle,
        "equationOfTime": eot,
        "trueSolarMinutes": true_solar_minutes,
        "airMass": air_mass(elevation),
    }


def _jd_from_parts(doy: int, utc_minutes: float) -> float:
    """Julian day for a fractional UTC day-of-year (year-independent enough)."""
    # Use a fixed reference year 2024 (leap) purely for the J2000 offset.
    base = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(
        days=doy - 1, minutes=utc_minutes
    )
    return julian_day(base)


def air_mass(elevation_deg: float) -> float:
    """Kasten & Young (1989) relative optical air mass."""
    if elevation_deg <= -0.5:
        return 40.0
    return 1.0 / (
        _sin(elevation_deg) + 0.50572 * ((elevation_deg + 6.07995) ** -1.6364)
    )


def hour_angle_sunrise(latitude: float, declination: float) -> float:
    """Hour angle (deg) of sunrise/sunset, NaNs guarded for polar day/night."""
    denom = _cos(latitude) * _cos(declination)
    if abs(denom) < 1e-9:
        return 0.0
    cos_h = _cos(NOON_SUNRISE_ZENITH) / denom - _tan(latitude) * _tan(declination)
    if cos_h >= 1.0:
        return 0.0           # polar night
    if cos_h <= -1.0:
        return 180.0         # midnight sun
    return _acos(cos_h)


def daylight_hours(latitude: float, doy: int) -> dict[str, float]:
    decl = solar_declination(doy)
    h0 = hour_angle_sunrise(latitude, decl)
    return {
        "sunriseHourAngle": h0,
        "hours": 2.0 * h0 / 15.0,
        "declination": decl,
    }


# --------------------------------------------------------------------------- #
# Optics: optimal tilt & azimuth, incidence angle
# --------------------------------------------------------------------------- #

def optimal_tilt(latitude: float, doy: int, mode: str = "fixed") -> float:
    """
    Optimal array tilt (deg from horizontal) facing the equator.

    modes:
      today   - maximise *today's* clear-sky capture
      fixed   - year-round compromise (industry rule: |lat| * 0.87, min 5)
      winter  - winter-solstice maximum boost  (lat + 15)
      summer  - summer-solstice maximum boost  (lat - 15)
      annual  - numerically integrated 365-day optimum
    """
    lat = abs(latitude)
    mode = (mode or "fixed").lower()
    if mode == "today":
        decl = solar_declination(doy)
        return _clamp(lat - decl, 2.0, 88.0)
    if mode == "winter":
        return _clamp(lat + 15.0, 5.0, 85.0)
    if mode == "summer":
        return _clamp(lat - 15.0, 2.0, 85.0)
    if mode == "annual":
        best_tilt, best_yield = lat * 0.87, -1.0
        for tilt in range(5, 81, 1):
            total = 0.0
            for d in range(1, 366, 5):
                total += daily_plane_irradiance_kwh(
                    latitude, 8.0, d, float(tilt), 180.0
                )
            if total > best_yield:
                best_yield, best_tilt = total, float(tilt)
        return best_tilt
    # default: fixed
    return _clamp(lat * 0.87, 5.0, 70.0)


def incidence_angle(
    elevation: float, sun_azimuth: float, tilt: float, panel_azimuth: float
) -> float:
    """
    Angle of incidence theta (deg) between the sun vector and the panel normal.
    theta = 0 -> panel face is perfectly perpendicular to the sun.
    """
    cos_aoi = _cos(90.0 - elevation) * _cos(tilt) + _sin(90.0 - elevation) * _sin(tilt) * _cos(
        sun_azimuth - panel_azimuth
    )
    return _acos(cos_aoi)


def cosine_efficiency(elevation: float, sun_azimuth: float, tilt: float, panel_azimuth: float) -> float:
    """eta = cos(theta), clamped to [0,1]. 99.9% == perfect lock-on."""
    theta = incidence_angle(elevation, sun_azimuth, tilt, panel_azimuth)
    return _clamp(math.cos(theta * DEG), 0.0, 1.0)


# --------------------------------------------------------------------------- #
# Irradiance models
# --------------------------------------------------------------------------- #

def clear_sky_irradiance(elevation: float, altitude_m: float = 0.0) -> dict[str, float]:
    """
    ASHRAE clear-sky model with a Kasten-Young air mass.

    DNI  = E0 * 1367 * 0.7^(AM^0.678)                      (tau_b = 0.7)
    DHI  = C * DNI,  C = 0.095 + 0.04 sin(alpha)           (sky diffuse, horizontal)
    GHI  = DNI * cos(zenith) + DHI
    """
    if elevation <= 0.5:
        return {"dni": 0.0, "dhi": 0.0, "ghi": 0.0, "airMass": 40.0}

    am = air_mass(elevation)
    # Barometric pressure / altitude correction on air mass
    am = am * max(0.6, 1.0 - 0.0000877 * altitude_m)
    tau_b = 0.7
    dni = SOLAR_CONSTANT * (tau_b ** (am ** 0.678))
    c = 0.095 + 0.04 * _sin(elevation)
    dhi = c * dni
    ghi = dni * _sin(elevation) + dhi
    return {"dni": dni, "dhi": dhi, "ghi": ghi, "airMass": am}


def plane_of_array_irradiance(
    dni: float,
    dhi: float,
    ghi: float,
    sun_zenith_deg: float,
    sun_azimuth: float,
    tilt: float,
    panel_azimuth: float,
    albedo: float = DEFAULT_ALBEDO,
) -> float:
    """POA irradiance (W/m^2): beam + isotropic sky diffuse + ground reflected."""
    if dni <= 0.0 and ghi <= 0.0:
        return 0.0
    cos_aoi = _cos(sun_zenith_deg) * _cos(tilt) + _sin(sun_zenith_deg) * _sin(tilt) * _cos(
        sun_azimuth - panel_azimuth
    )
    beam = dni * max(0.0, cos_aoi)
    sky = dhi * (1.0 + _cos(tilt)) / 2.0
    ground = ghi * albedo * (1.0 - _cos(tilt)) / 2.0
    return max(0.0, beam + sky + ground)


def daily_plane_irradiance_kwh(
    latitude: float,
    longitude: float,
    doy: int,
    tilt: float,
    panel_azimuth: float,
    step_minutes: int = 20,
    altitude_m: float = 0.0,
    albedo: float = DEFAULT_ALBEDO,
    horizon: Iterable[dict[str, float]] | None = None,
    utc_offset_hours: float = 0.0,
) -> float:
    """
    Integrated plane-of-array insolation for one day (kWh/m^2).

    `horizon` is an optional sorted list of {azimuth, elevation} obstruction
    points used by the AR Horizon Shade Scanner.
    """
    total_wh = 0.0
    horizon_pairs = (
        sorted(((h["azimuth"], h["elevation"]) for h in horizon), key=lambda p: p[0])
        if horizon
        else None
    )
    step = step_minutes / 60.0
    minutes = 0.0
    while minutes < 1440.0:
        pos = solar_position(latitude, longitude, doy=doy, utc_minutes=minutes)
        if pos["elevation"] > 0.5:
            sky = clear_sky_irradiance(pos["elevation"], altitude_m)
            poa = plane_of_array_irradiance(
                sky["dni"], sky["dhi"], sky["ghi"],
                pos["zenith"], pos["azimuth"], tilt, panel_azimuth, albedo,
            )
            if horizon_pairs:
                obst = horizon_obstruction_elevation(horizon_pairs, pos["azimuth"])
                if pos["elevation"] <= obst:
                    poa = 0.0
            total_wh += poa * step
        minutes += step_minutes
    return total_wh / 1000.0


def horizon_obstruction_elevation(
    horizon_pairs: list[tuple[float, float]], azimuth: float
) -> float:
    """Linear-interpolated obstruction elevation for a given sun azimuth."""
    if not horizon_pairs:
        return 0.0
    az = _wrap360(azimuth)
    pairs = list(horizon_pairs)
    if az <= pairs[0][0] or az >= pairs[-1][0]:
        # wrap-around between last and first
        left = pairs[-1]
        right = pairs[0]
        span = (right[0] + 360.0) - left[0]
        if span <= 0:
            return max(left[1], right[1])
        t = ((az + 360.0) if az < left[0] else az) - left[0]
        t = _clamp(t / span, 0.0, 1.0)
        return left[1] + (right[1] - left[1]) * t
    for i in range(len(pairs) - 1):
        a0, e0 = pairs[i]
        a1, e1 = pairs[i + 1]
        if a0 <= az <= a1:
            span = a1 - a0
            t = 0.0 if span <= 0 else (az - a0) / span
            return e0 + (e1 - e0) * t
    return 0.0


# --------------------------------------------------------------------------- #
# Photovoltaic yield & thermal derating
# --------------------------------------------------------------------------- #

def cell_temperature(
    ambient_c: float,
    poa_wm2: float,
    wind_ms: float = 1.0,
    mount: str = "roof",
) -> float:
    """
    NOCT-based cell temperature with wind cooling and mounting factor.

    T_cell = T_amb + (NOCT - 20) / 800 * POA * f_mount * (1 - 0.05 * min(wind, 10))
    f_mount: roof 1.15 (no air gap), standoff 1.00 (10 cm gap),
             pole 0.85 (free air), insulated 1.30 (sandwich under glass)
    """
    f_mount = {"roof": 1.15, "standoff": 1.00, "pole": 0.85, "insulated": 1.30}.get(
        mount.lower(), 1.00
    )
    noct = 45.0
    wind_factor = 1.0 - 0.05 * _clamp(wind_ms, 0.0, 10.0)
    return ambient_c + (noct - 20.0) / 800.0 * poa_wm2 * f_mount * wind_factor


def thermal_derating(t_cell_c: float, gamma_pct_per_c: float = GAMMA_PMAX_SILICON) -> float:
    """Multiplicative power factor from the temperature coefficient (max 1.0)."""
    return 1.0 + (gamma_pct_per_c / 100.0) * (t_cell_c - STC_TEMP_C)


def pv_power(
    kw_stc: float,
    poa_wm2: float,
    t_cell_c: float,
    gamma_pct_per_c: float = GAMMA_PMAX_SILICON,
    soiling: float = 0.98,
    mismatch: float = 0.98,
    wiring: float = 0.98,
    inverter: float = 0.96,
) -> dict[str, float]:
    """Instantaneous AC power (kW) with the full PVWatts-style loss chain."""
    irradiance_factor = poa_wm2 / STC_IRRADIANCE
    temp_factor = _clamp(thermal_derating(t_cell_c, gamma_pct_per_c), 0.0, 1.2)
    dc_kw = kw_stc * irradiance_factor * temp_factor * soiling * mismatch * wiring
    ac_kw = dc_kw * inverter
    return {
        "acKw": max(0.0, ac_kw),
        "dcKw": max(0.0, dc_kw),
        "irradianceFactor": irradiance_factor,
        "temperatureFactor": temp_factor,
        "thermalLossKw": max(0.0, kw_stc * irradiance_factor * (1 - temp_factor) * soiling),
    }


def annual_yield(
    latitude: float,
    longitude: float,
    kw_stc: float,
    tilt: float,
    panel_azimuth: float,
    ambient_c: float = 25.0,
    wind_ms: float = 1.5,
    mount: str = "roof",
    gamma_pct_per_c: float = GAMMA_PMAX_SILICON,
    horizon: Iterable[dict[str, float]] | None = None,
    degradation_pct_per_year: float = 0.5,
    years: int = 1,
    clear_sky_index: float = 1.0,
) -> dict[str, Any]:
    """
    Full-year hourly energy model + per-decade degradation projection.

    `clear_sky_index` (k_t) scales the *clear-sky* irradiance to a climatological
    long-term average. k_t = 1.0 is a theoretical cloudless year; real temperate
    sites sit near 0.70-0.75, deserts 0.85, maritime 0.55. The quote auditor uses
    a realistic default so its "physics model" is comparable to a PVWatts run.
    """
    monthly = [0.0] * 12
    day_energy = []
    for doy in range(1, 366):
        # 24 hourly samples is enough for an annual benchmark (0.3% error)
        e_wh = 0.0
        for hour in range(24):
            pos = solar_position(latitude, longitude, doy=doy, utc_minutes=hour * 60.0 + 30.0)
            if pos["elevation"] <= 0.5:
                continue
            sky = clear_sky_irradiance(pos["elevation"])
            poa = plane_of_array_irradiance(
                sky["dni"], sky["dhi"], sky["ghi"],
                pos["zenith"], pos["azimuth"], tilt, panel_azimuth,
            )
            if horizon:
                pairs = sorted(((h["azimuth"], h["elevation"]) for h in horizon), key=lambda p: p[0])
                if pos["elevation"] <= horizon_obstruction_elevation(pairs, pos["azimuth"]):
                    poa = 0.0
            poa *= clear_sky_index
            tcell = cell_temperature(ambient_c, poa, wind_ms, mount)
            out = pv_power(kw_stc, poa, tcell, gamma_pct_per_c)
            e_wh += out["acKw"] * 1000.0
        month, _ = day_to_date(2025, doy)
        monthly[month - 1] += e_wh / 1000.0
        day_energy.append(round(e_wh / 1000.0, 4))

    annual = sum(day_energy)
    projection = []
    for y in range(1, max(years, 1) + 1):
        projection.append(
            {"year": y, "kwh": round(annual * ((1 - degradation_pct_per_year / 100.0) ** (y - 1)), 1)}
        )
    peak_day = max(day_energy) if day_energy else 0.0
    return {
        "annualKwh": round(annual, 1),
        "monthlyKwh": [round(m, 1) for m in monthly],
        "dailyKwh": day_energy,
        "specificYield": round(annual / kw_stc, 1) if kw_stc else 0.0,
        "peakDayKwh": round(peak_day, 1),
        "capacityFactor": round(annual / (kw_stc * 8760.0), 4) if kw_stc else 0.0,
        "degradationProjection": projection,
    }


# --------------------------------------------------------------------------- #
# Off-grid battery autonomy — Peukert's law
# --------------------------------------------------------------------------- #

def peukert_runtime(
    capacity_ah: float,
    average_current_a: float,
    k: float = 1.02,
    h: float = 1.0,
) -> dict[str, float]:
    """
    Peukert's Law:  t = H * (C / (I * H))^k

    Returns hours to full depletion at a CONSTANT current, plus the effective
    (Peukert-corrected) capacity actually delivered.
    """
    if average_current_a <= 0.0:
        return {"hours": math.inf, "deliveredAh": math.inf, "effectiveCapacityAh": capacity_ah}
    hours = h * ((capacity_ah / (average_current_a * h)) ** k)
    return {
        "hours": hours,
        "deliveredAh": average_current_a * hours,
        "effectiveCapacityAh": capacity_ah,
    }


def battery_autonomy(
    chemistry: str,
    capacity_ah: float,
    voltage: float,
    load_watts: float,
    dod_pct: float = 80.0,
    inverter_efficiency_pct: float = 92.0,
    temperature_c: float = 25.0,
) -> dict[str, Any]:
    """Usable energy + Peukert-corrected runtime for a constant load."""
    chem = BATTERY_CHEMISTRY.get((chemistry or "lifepo4").lower(), BATTERY_CHEMISTRY["lifepo4"])
    dod = _clamp(dod_pct, 5.0, 100.0) / 100.0
    eta_inv = _clamp(inverter_efficiency_pct, 50.0, 100.0) / 100.0

    # Cold capacity derate — lead acids lose ~1%/degC below 25, LiFePO4 ~0.4%
    cold = 1.0
    if temperature_c < 25.0:
        drop = 0.010 if chem["label"].lower().startswith(("agm", "gel")) else 0.004
        cold = _clamp(1.0 - drop * (25.0 - temperature_c), 0.55, 1.0)

    nominal_wh = capacity_ah * voltage
    usable_wh = nominal_wh * dod * chem["round_trip"] * cold
    dc_watts = load_watts / eta_inv if load_watts > 0 else 0.0
    draw_a = dc_watts / voltage if voltage else 0.0

    peukert = peukert_runtime(capacity_ah * dod * cold, draw_a, chem["k"], chem["h"])
    hours = peukert["hours"] * chem["round_trip"]
    if draw_a > 0:
        hours = min(hours, usable_wh / dc_watts)

    return {
        "chemistry": chem["label"],
        "nominalWh": round(nominal_wh, 1),
        "usableWh": round(usable_wh, 1),
        "dcLoadWatts": round(dc_watts, 1),
        "drawAmps": round(draw_a, 2),
        "peukertExponent": chem["k"],
        "runtimeHours": round(hours, 2) if math.isfinite(hours) else None,
        "endOfLifeYear": None,
        "coldDerate": round(cold, 3),
        "chargeEfficiency": chem["round_trip"],
    }


def simulate_soc(
    chemistry: str,
    capacity_ah: float,
    voltage: float,
    ac_loads: list[dict[str, float]],
    array_kw: float,
    tilt: float,
    panel_azimuth: float,
    latitude: float,
    longitude: float,
    doy: int,
    dod_pct: float = 80.0,
    inverter_efficiency_pct: float = 92.0,
    initial_soc_pct: float = 100.0,
    ambient_c: float = 25.0,
    horizon: Iterable[dict[str, float]] | None = None,
    hours: int = 48,
) -> dict[str, Any]:
    """
    Hour-by-hour SoC waveform.

    Loads are given per 24 h profile as [{"watts": W, "hoursPerDay": h, "name": str}].
    Solar input uses the same clear-sky chain as the yield model, so the
    "blackout at 3:40 AM" verdict is physics-honest, not a guess.
    """
    chem = BATTERY_CHEMISTRY.get((chemistry or "lifepo4").lower(), BATTERY_CHEMISTRY["lifepo4"])
    dod = _clamp(dod_pct, 5.0, 100.0) / 100.0
    eta_inv = _clamp(inverter_efficiency_pct, 50.0, 100.0) / 100.0
    nominal_wh = capacity_ah * voltage
    usable_wh = nominal_wh * dod * chem["round_trip"]

    # Flatten the per-day loads into a 24 h duty vector (spread evenly over the day
    # for always-on loads, clustered into evening hours for high-draw appliances).
    hourly_load_ac = [0.0] * 24
    for load in ac_loads:
        watts = float(load.get("watts", 0.0))
        hrs = float(load.get("hoursPerDay", 24.0))
        spread = load.get("startHour")
        if spread is None:
            # evening-biased duty cycle: most household load lands 17:00-23:00
            for h in range(24):
                weight = 1.0 + 1.6 * math.exp(-((h - 20.0) ** 2) / 18.0)
                hourly_load_ac[h] += watts * (hrs / 24.0) * weight
        else:
            start = int(spread) % 24
            for i in range(int(math.ceil(hrs))):
                hourly_load_ac[(start + i) % 24] += watts / max(1.0, math.ceil(hrs)) * (
                    hrs / max(1.0, math.ceil(hrs))
                )

    horizon_pairs = (
        sorted(((h["azimuth"], h["elevation"]) for h in horizon), key=lambda p: p[0])
        if horizon
        else None
    )

    soc = _clamp(initial_soc_pct, 0.0, 100.0) / 100.0 * usable_wh
    start = datetime(2025, 6, 21, tzinfo=timezone.utc)
    samples: list[dict[str, Any]] = []
    blackout: dict[str, Any] | None = None
    total_solar_wh = 0.0
    total_load_wh = 0.0

    for i in range(hours):
        clock = start + timedelta(hours=i)
        hh = clock.hour
        pos = solar_position(latitude, longitude, doy=doy, utc_minutes=hh * 60.0 + 30.0)
        poa = 0.0
        if pos["elevation"] > 0.5:
            sky = clear_sky_irradiance(pos["elevation"])
            poa = plane_of_array_irradiance(
                sky["dni"], sky["dhi"], sky["ghi"],
                pos["zenith"], pos["azimuth"], tilt, panel_azimuth,
            )
            if horizon_pairs and pos["elevation"] <= horizon_obstruction_elevation(
                horizon_pairs, pos["azimuth"]
            ):
                poa = 0.0
        tcell = cell_temperature(ambient_c, poa, 1.5, "standoff")
        pv = pv_power(array_kw, poa, tcell)
        charge_wh = pv["acKw"] * 1000.0 * chem["round_trip"]

        load_ac = hourly_load_ac[hh]
        discharge_wh = load_ac / eta_inv
        total_solar_wh += charge_wh
        total_load_wh += discharge_wh

        soc = min(usable_wh, soc + charge_wh - discharge_wh)
        if soc <= 0.0 and blackout is None:
            blackout = {"hour": i, "clock": f"{hh:02d}:00", "day": 1 + i // 24}
        soc = max(0.0, soc)

        samples.append(
            {
                "hour": i,
                "clock": f"{clock.strftime('%H:%M')}",
                "socPct": round(soc / usable_wh * 100.0, 2) if usable_wh else 0.0,
                "pvKw": round(pv["acKw"], 3),
                "loadKw": round(load_ac / 1000.0, 3),
                "poa": round(poa, 1),
            }
        )

    return {
        "samples": samples,
        "usableWh": round(usable_wh, 1),
        "totalSolarKwh": round(total_solar_wh / 1000.0, 2),
        "totalLoadKwh": round(total_load_wh / 1000.0, 2),
        "netKwh": round((total_solar_wh - total_load_wh) / 1000.0, 2),
        "survives": blackout is None,
        "blackout": blackout,
        "chemistry": chem,
    }


# --------------------------------------------------------------------------- #
# MPPT / string sizing with cold-weather Voc protection
# --------------------------------------------------------------------------- #

def string_sizing(
    panel_voc: float,
    panel_vmp: float,
    panel_isc: float,
    panel_watt: float,
    panels_series: int,
    strings_parallel: int,
    controller_max_voc: float,
    controller_mppt_low: float,
    controller_mppt_high: float,
    controller_max_amps: float,
    record_low_c: float = -15.0,
    beta_voc_pct_per_c: float = BETA_VOC_SILICON,
    gamma_vmp_pct_per_c: float = GAMMA_VMP_SILICON,
    conductor_derate: float = 1.25,
) -> dict[str, Any]:
    """
    Series vs. parallel MPPT string sizer.

    1. Cold-weather Voc spike  : Voc_cold = Voc_stc * (1 + beta/100 * (T_cold - 25))
    2. Controller headroom     : Voc_cold * N_series * 1.15 <= V_max
    3. MPPT window             : Vmp_hot >= mppt_low (buck may drop out when hot)
    4. Current / breaker       : Isc * N_parallel * 1.25 <= controller amps
    """
    beta = beta_voc_pct_per_c / 100.0
    gamma = gamma_vmp_pct_per_c / 100.0

    voc_cold = panel_voc * (1.0 + beta * (record_low_c - STC_TEMP_C))
    vmp_hot = panel_vmp * (1.0 + gamma * (70.0 - STC_TEMP_C))
    voc_string = voc_cold * panels_series
    vmp_string_hot = vmp_hot * panels_series
    isc_total = panel_isc * strings_parallel * conductor_derate

    violations: list[str] = []
    warnings: list[str] = []
    if voc_string > controller_max_voc:
        violations.append(
            f"COLD-SNAP FAILURE: {voc_string:.1f} V cold Voc exceeds controller {controller_max_voc:.0f} V "
            f"— reduce to {max(1, int(controller_max_voc // voc_cold))} panels in series."
        )
    elif voc_string > controller_max_voc * 0.9:
        warnings.append(f"Only {controller_max_voc - voc_string:.1f} V headroom below controller limit.")
    if vmp_string_hot < controller_mppt_low:
        violations.append(
            f"HOT-DAY DROPOUT: {vmp_string_hot:.1f} V hot Vmp is below the {controller_mppt_low:.0f} V "
            f"MPPT floor — add one panel in series."
        )
    if vmp_string_hot > controller_mppt_high:
        warnings.append("Hot Vmp sits above the MPPT window ceiling.")
    if isc_total > controller_max_amps:
        violations.append(
            f"CURRENT OVERLOAD: {isc_total:.1f} A (1.25x derated) exceeds {controller_max_amps:.0f} A controller."
        )

    return {
        "panelsSeries": panels_series,
        "stringsParallel": strings_parallel,
        "arrayWatts": round(panel_watt * panels_series * strings_parallel, 1),
        "vocColdPerPanel": round(voc_cold, 2),
        "vocColdString": round(voc_string, 2),
        "vmpHotString": round(vmp_string_hot, 2),
        "iscDerated": round(isc_total, 2),
        "headroomV": round(controller_max_voc - voc_string, 2),
        "vocMarginPct": round((controller_max_voc - voc_string) / controller_max_voc * 100.0, 1),
        "status": "FAIL" if violations else ("CAUTION" if warnings else "PASS"),
        "violations": violations,
        "warnings": warnings,
    }


# --------------------------------------------------------------------------- #
# Installer quote auditor
# --------------------------------------------------------------------------- #

def audit_quote(
    latitude: float,
    longitude: float,
    system_kw: float,
    quoted_price_usd: float,
    promised_kwh_per_year: float,
    utility_rate_usd: float,
    tilt: float | None = None,
    panel_azimuth: float = 180.0,
    annual_irradiance_kwh_m2: float | None = None,
    horizon: Iterable[dict[str, float]] | None = None,
    ambient_c: float = 25.0,
    clear_sky_index: float = 0.72,
) -> dict[str, Any]:
    """
    Cross-check a sales quote against real physics.

    Benchmarks (US residential, 2025 NREL Tracking the Sun + regional ranges):
      fair $/W        2.20 - 3.20
      fair specific yield  1,300 - 1,700 kWh/kW/yr (temperate, south-facing)
    """
    tilt = tilt if tilt is not None else optimal_tilt(latitude, 172, "fixed")
    model = annual_yield(
        latitude, longitude, system_kw, tilt, panel_azimuth,
        ambient_c=ambient_c, horizon=horizon, years=25,
        clear_sky_index=clear_sky_index,
    )
    physics_kwh = model["annualKwh"]
    dollars_per_watt = quoted_price_usd / (system_kw * 1000.0) if system_kw else 0.0
    promised_ratio = promised_kwh_per_year / physics_kwh if physics_kwh else 0.0

    findings: list[dict[str, str]] = []
    severity = 0

    if dollars_per_watt > 3.20:
        severity += 2 if dollars_per_watt > 4.0 else 1
        findings.append({
            "id": "price",
            "severity": "critical" if dollars_per_watt > 4.0 else "warn",
            "title": f"${dollars_per_watt:.2f}/W is above the fair-market ceiling",
            "detail": (
                f"Fair residential pricing in 2025 is $2.20-$3.20/W. At {system_kw:.1f} kW you are "
                f"paying a ${(dollars_per_watt - 3.20) * system_kw * 1000:,.0f} premium. "
                f"Negotiate toward ${3.20 * system_kw * 1000:,.0f}."
            ),
        })
    elif dollars_per_watt < 1.80:
        findings.append({
            "id": "price-low",
            "severity": "warn",
            "title": "Suspiciously cheap — verify hardware & warranty",
            "detail": "Below $1.80/W usually means refurbished inverters, no labour warranty, or a lease escalation clause.",
        })

    if promised_ratio > 1.15:
        severity += 2 if promised_ratio > 1.3 else 1
        findings.append({
            "id": "production",
            "severity": "critical" if promised_ratio > 1.3 else "warn",
            "title": f"Promised production is {promised_ratio * 100:.0f}% of a clear-sky physical model",
            "detail": (
                f"At lat {latitude:.2f} with {tilt:.0f}° tilt this array physically yields about "
                f"{physics_kwh:,.0f} kWh/yr. The quote promises {promised_kwh_per_year:,.0f} kWh/yr — "
                f"an overstatement of {promised_kwh_per_year - physics_kwh:,.0f} kWh/yr."
            ),
        })
    elif promised_ratio < 0.6:
        findings.append({
            "id": "production-low",
            "severity": "warn",
            "title": "Quote under-promises production",
            "detail": "Conservative modelling can be legitimate shading avoidance — verify the shade study.",
        })

    if horizon:
        pairs = sorted(((h["azimuth"], h["elevation"]) for h in horizon), key=lambda p: p[0])
        unshaded = annual_yield(
            latitude, longitude, system_kw, tilt, panel_azimuth,
            clear_sky_index=clear_sky_index,
        )["annualKwh"]
        if unshaded > 0:
            shade_loss = (unshaded - physics_kwh) / unshaded
            if shade_loss > 0.05:
                findings.append({
                    "id": "shade",
                    "severity": "warn" if shade_loss > 0.15 else "info",
                    "title": f"Horizon shading removes {shade_loss * 100:.1f}% of annual yield",
                    "detail": "Your scanned treeline/roofline profile was applied. Ask the installer to re-price against the shaded yield.",
                })

    payback_years = (
        quoted_price_usd / (physics_kwh * utility_rate_usd)
        if physics_kwh and utility_rate_usd
        else None
    )
    year25 = model["degradationProjection"][-1]["kwh"] if model["degradationProjection"] else physics_kwh
    lifetime_savings = sum(
        p["kwh"] for p in model["degradationProjection"]
    ) * utility_rate_usd

    if severity >= 3:
        verdict, verdict_class = "PREDATORY $/WATT OVERCHARGE", "critical"
    elif severity == 2:
        verdict, verdict_class = "INFLATED PRODUCTION PROMISE", "critical"
    elif severity == 1:
        verdict, verdict_class = "NEGOTIATE BEFORE SIGNING", "warn"
    else:
        verdict, verdict_class = "FAIR ENGINEERING QUOTE", "ok"

    return {
        "verdict": verdict,
        "verdictClass": verdict_class,
        "dollarsPerWatt": round(dollars_per_watt, 2),
        "benchmarkDollarsPerWatt": {"low": 2.20, "high": 3.20},
        "physicsKwhPerYear": round(physics_kwh, 0),
        "promisedKwhPerYear": round(promised_kwh_per_year, 0),
        "realisationRatio": round(promised_ratio, 3),
        "specificYield": model["specificYield"],
        "paybackYears": round(payback_years, 1) if payback_years else None,
        "lifetimeSavingsUsd": round(lifetime_savings, 0),
        "year25Kwh": year25,
        "findings": findings,
        "monthlyKwh": model["monthlyKwh"],
        "assumedTilt": tilt,
        "assumedAzimuth": panel_azimuth,
        "clearSkyIndex": clear_sky_index,
    }


# --------------------------------------------------------------------------- #
# Composite payloads used by the API
# --------------------------------------------------------------------------- #

def horizon_efficiency(
    latitude: float,
    longitude: float,
    horizon: Iterable[dict[str, float]],
    tilt: float,
    panel_azimuth: float,
) -> dict[str, Any]:
    """Solar Window Efficiency (0-100%) for a scanned horizon profile."""
    horizon = list(horizon or [])
    unshaded = 0.0
    shaded = 0.0
    lost_by_month = [0.0] * 12
    for doy in range(1, 366, 3):
        full = daily_plane_irradiance_kwh(latitude, longitude, doy, tilt, panel_azimuth)
        part = daily_plane_irradiance_kwh(
            latitude, longitude, doy, tilt, panel_azimuth, horizon=horizon
        )
        unshaded += full
        shaded += part
        month, _ = day_to_date(2025, doy)
        lost_by_month[month - 1] += (full - part) * (3.0 / 1.0) * 0.0  # placeholder weight

    efficiency = (shaded / unshaded * 100.0) if unshaded > 0 else 0.0
    return {
        "solarWindowEfficiency": round(efficiency, 1),
        "unshadedKwhM2": round(unshaded, 1),
        "shadedKwhM2": round(shaded, 1),
        "lostKwhM2": round(unshaded - shaded, 1),
        "monthlyLostKwhM2": [round(v, 2) for v in lost_by_month],
    }


def ephemeris_payload(
    latitude: float,
    longitude: float,
    doy: int,
    year: int = 2025,
    tilt: float | None = None,
    panel_azimuth: float = 180.0,
    timezone_offset_hours: float = 0.0,
    horizon: Iterable[dict[str, float]] | None = None,
    kw_stc: float = 1.0,
) -> dict[str, Any]:
    """Everything the AR Heliodon + tilt clinometer needs for one day."""
    tilt = tilt if tilt is not None else optimal_tilt(latitude, doy, "fixed")
    hours: list[dict[str, Any]] = []
    for minute in range(0, 1440, 10):
        pos = solar_position(latitude, longitude, doy=doy, utc_minutes=float(minute))
        sky = clear_sky_irradiance(pos["elevation"])
        poa = plane_of_array_irradiance(
            sky["dni"], sky["dhi"], sky["ghi"],
            pos["zenith"], pos["azimuth"], tilt, panel_azimuth,
        )
        obst = 0.0
        if horizon:
            pairs = sorted(((h["azimuth"], h["elevation"]) for h in horizon), key=lambda p: p[0])
            obst = horizon_obstruction_elevation(pairs, pos["azimuth"])
            if pos["elevation"] <= obst:
                poa = 0.0
        tcell = cell_temperature(25.0, poa)
        pv = pv_power(kw_stc, poa, tcell)
        hours.append({
            "minute": minute,
            "localMinute": (minute + timezone_offset_hours * 60.0) % 1440.0,
            "elevation": round(pos["elevation"], 3),
            "azimuth": round(pos["azimuth"], 3),
            "dni": round(sky["dni"], 1),
            "dhi": round(sky["dhi"], 1),
            "ghi": round(sky["ghi"], 1),
            "poa": round(poa, 1),
            "powerKw": round(pv["acKw"], 4),
            "shaded": bool(horizon) and pos["elevation"] <= obst,
            "obstruction": round(obst, 2),
        })

    day = daylight_hours(latitude, doy)
    return {
        "latitude": latitude,
        "longitude": longitude,
        "dayOfYear": doy,
        "date": "{:02d}-{:02d}".format(*reversed(day_to_date(year, doy))),
        "declination": round(solar_declination(doy), 3),
        "equationOfTime": round(equation_of_time(doy), 2),
        "daylightHours": round(day["hours"], 3),
        "tilt": round(tilt, 2),
        "panelAzimuth": panel_azimuth,
        "optimalTilt": {
            "today": round(optimal_tilt(latitude, doy, "today"), 1),
            "fixed": round(optimal_tilt(latitude, doy, "fixed"), 1),
            "winter": round(optimal_tilt(latitude, doy, "winter"), 1),
            "summer": round(optimal_tilt(latitude, doy, "summer"), 1),
        },
        "samples": hours,
        "peakPoa": round(max((h["poa"] for h in hours), default=0.0), 1),
        "energyKwh": round(sum(h["powerKw"] for h in hours) * (10.0 / 60.0), 3),
    }


def solstice_arcs(
    latitude: float,
    longitude: float,
    timezone_offset_hours: float = 0.0,
    step_minutes: int = 15,
    today_doy: int | None = None,
) -> dict[str, Any]:
    """AR overlay arcs: summer solstice / equinox / winter solstice + today."""
    now = datetime.now(timezone.utc)
    seasons = {
        "summer": day_of_year(2025, 6, 21),
        "equinox": day_of_year(2025, 3, 20),
        "winter": day_of_year(2025, 12, 21),
        "today": today_doy or day_of_year(now.year, now.month, now.day),
    }
    arcs: dict[str, Any] = {}
    for name, doy in seasons.items():
        points = []
        for minute in range(0, 1440, step_minutes):
            pos = solar_position(latitude, longitude, doy=doy, utc_minutes=float(minute))
            points.append({
                "minute": minute,
                "azimuth": round(pos["azimuth"], 2),
                "elevation": round(pos["elevation"], 2),
                "up": pos["elevation"] > 0.0,
            })
        arcs[name] = {"dayOfYear": doy, "points": points}
    return arcs


def annual_irradiance_curve(
    latitude: float,
    longitude: float,
    tilt: float,
    panel_azimuth: float = 180.0,
    horizon: Iterable[dict[str, float]] | None = None,
) -> list[dict[str, float]]:
    """365-day POA irradiance curve (kWh/m^2/day) for charting."""
    curve = []
    for doy in range(1, 366):
        kwh = daily_plane_irradiance_kwh(
            latitude, longitude, doy, tilt, panel_azimuth, step_minutes=30, horizon=horizon
        )
        month, day = day_to_date(2025, doy)
        curve.append({"doy": doy, "month": month, "day": day, "kwhM2": round(kwh, 3)})
    return curve


# --------------------------------------------------------------------------- #
# CLI smoke test
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    import json

    nairobi = (0.0463, 37.9062)   # Meru / Nairobi belt — the user's home latitude
    print("HELIO-FORGE kernel self-test")
    pos = solar_position(*nairobi, doy=172, utc_minutes=9 * 60)
    print("  solar position @ 09:00 UTC, Jun 21:", {k: round(v, 2) for k, v in pos.items()})
    print("  optimal tilt (fixed):", round(optimal_tilt(nairobi[0], 172, "fixed"), 1))
    print("  daily POA kWh/m2:", round(daily_plane_irradiance_kwh(*nairobi, 172, 15.0, 180.0), 3))
    print("  autonomy:", json.dumps(battery_autonomy("agm", 200, 24, 300), indent=None))
    print("  string:", json.dumps(string_sizing(41.2, 34.1, 11.5, 400, 4, 2, 150, 30, 115, 60), indent=None))
