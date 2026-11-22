// ============================================================================
// HELIO-FORGE · heliodon.glsl
// Real-time 60fps 3D Atmospheric Solar Dome (WebGL2).
//
// A glass hemisphere rendered with:
//   * an azimuth/elevation graticule
//   * Summer Solstice / Equinox / Winter Solstice / Today solar arcs
//   * a photoreal solar disc with aureole and iris bloom
//   * the scanned horizon obstruction silhouette ("surveyed rock" band)
//   * the panel normal vector + cast shadow vector
//   * fresnel rim + specular sweep for the liquid-glass look
//
// Uniform layout: uArcPoints is a flat vec4[192] bank of four 48-point arcs.
//   .xy = (azimuth deg, elevation deg)   .z = intensity   .w = above-horizon
// Arc slot k starts at index k * 48.
// ============================================================================

//@@VERTEX
#version 300 es
precision highp float;

in vec3 aPosition;   // unit hemisphere, y = up
in vec2 aUv;

uniform mat4 uViewProj;
uniform mat4 uModel;

out vec3 vDir;
out vec2 vUv;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vDir = normalize(aPosition);
  vUv = aUv;
  gl_Position = uViewProj * world;
}

//@@FRAGMENT
#version 300 es
precision highp float;

in vec3 vDir;
in vec2 vUv;
out vec4 fragColor;

uniform float uTime;
uniform vec3  uSunDir;          // normalised world direction of the sun
uniform vec3  uPanelNormal;     // normalised world direction of the panel face
uniform vec4  uArcPoints[192];  // 4 arcs x 48 points
uniform int   uArcCount;
uniform float uHorizon[36];     // obstruction elevation (deg) per 10 deg azimuth bin
uniform float uHasHorizon;
uniform float uShowGrid;
uniform float uShowObstruction;
uniform vec3  uGlowColor;
uniform vec3  uSkyColor;
uniform vec3  uRimColor;
uniform float uSpecularX;
uniform float uSpecularY;
uniform float uQuality;
uniform float uTiltLine;        // optimum tilt, degrees (<=0 disables)

#define PI 3.14159265359

float azimuthOf(vec3 d) { return degrees(atan(d.x, -d.z)); }   // 0 = north(-z)
float elevationOf(vec3 d) { return degrees(asin(clamp(d.y, -1.0, 1.0))); }

// anti-aliased repeating line on a degree coordinate
float aaLine(float value, float spacing, float weight) {
  float f = abs(fract(value / spacing + 0.5) - 0.5) * spacing;
  float w = fwidth(value) * weight;
  return 1.0 - smoothstep(0.0, w + spacing * 0.004, f);
}

// distance (deg) from point p to segment a->b in the (az, el) plane,
// taking the shorter azimuth wrap into account
float arcDistance(vec2 p, vec2 a, vec2 b) {
  float dab = b.x - a.x;
  if (dab > 180.0) b.x -= 360.0;
  if (dab < -180.0) b.x += 360.0;
  vec2 ap = p - a;
  // keep p within half a turn of the segment
  if (ap.x > 180.0) ap.x -= 360.0;
  if (ap.x < -180.0) ap.x += 360.0;
  vec2 ab = b - a;
  float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
  return length(ap - ab * t);
}

// coverage of one arc, given its slot index
float arcRibbon(vec2 p, int slot, float widthDeg) {
  float best = 1e9;
  int base = slot * 48;
  for (int i = 0; i < 47; i++) {
    if (i + 1 >= uArcCount) break;
    vec4 a = uArcPoints[base + i];
    vec4 b = uArcPoints[base + i + 1];
    if (a.w < 0.5 || b.w < 0.5) continue;
    float d = arcDistance(p, a.xy, b.xy);
    best = min(best, d);
  }
  return 1.0 - smoothstep(widthDeg * 0.45, widthDeg, best);
}

void main() {
  vec3 dir = normalize(vDir);
  float az = azimuthOf(dir);
  float el = elevationOf(dir);
  vec2 ae = vec2(az, el);

  // ------------------------------------------------------------ atmosphere
  float t = clamp(el / 90.0, 0.0, 1.0);
  vec3 sky = mix(uSkyColor * 1.15, uSkyColor * 0.32, pow(t, 0.65));
  float sunAlign = max(0.0, dot(dir, normalize(uSunDir)));
  sky += uGlowColor * pow(sunAlign, 6.0) * 0.55;
  vec3 col = sky;

  // ------------------------------------------------------------- graticule
  if (uShowGrid > 0.5) {
    float grid = aaLine(az + 180.0, 30.0, 1.0) * 0.55;
    grid += aaLine(el, 15.0, 1.0) * 0.55;
    grid += (1.0 - smoothstep(0.0, 1.1, abs(el))) * 1.4;   // horizon ring
    col += vec3(0.75, 0.92, 1.0) * grid * 0.16;
  }

  // ------------------------------------------------------------ solar arcs
  float rSum = arcRibbon(ae, 0, 0.95);
  float rEqu = arcRibbon(ae, 1, 0.85);
  float rWin = arcRibbon(ae, 2, 0.95);
  float rNow = arcRibbon(ae, 3, 1.45);

  col += vec3(1.00, 0.72, 0.20) * rSum * 0.80;   // summer solstice — solar gold
  col += vec3(0.34, 0.94, 0.86) * rEqu * 0.62;   // equinox — bioluminescent teal
  col += vec3(0.56, 0.36, 0.97) * rWin * 0.80;   // winter solstice — ultraviolet
  col += vec3(1.00, 0.99, 0.96) * rNow * 1.05;   // today — white hot

  // ------------------------------------------------------ horizon obstruction
  if (uShowObstruction > 0.5 && uHasHorizon > 0.5) {
    float bin = (az + 180.0) / 10.0;
    int i0 = int(clamp(floor(bin), 0.0, 35.0));
    int i1 = int(clamp(floor(bin) + 1.0, 0.0, 35.0));
    float frac = fract(clamp(bin, 0.0, 35.0));
    float hElev = mix(uHorizon[i0], uHorizon[i1], frac);

    float inside = step(el, hElev);
    float edge = (1.0 - smoothstep(0.0, 0.8, abs(el - hElev))) * step(-0.6, el);
    col = mix(col, vec3(0.030, 0.048, 0.072), inside * 0.90);
    col += vec3(0.10, 0.78, 0.72) * edge * 0.85;
    float hatch = aaLine(ae.x + ae.y * 2.0, 4.0, 0.55);
    col += vec3(0.06, 0.30, 0.28) * hatch * inside * 0.30;
  }

  // --------------------------------------------------------------- sun orb
  float sunAng = acos(clamp(dot(dir, normalize(uSunDir)), -1.0, 1.0));
  float sunDisc = 1.0 - smoothstep(0.011, 0.024, sunAng);
  float sunHalo = exp(-sunAng * 7.5) * 0.95;
  float sunIris = exp(-sunAng * 2.2) * 0.30;
  float aboveHorizon = smoothstep(-0.5, 0.8, el);
  col += vec3(1.0, 0.94, 0.76) * sunDisc * 2.4 * aboveHorizon;
  col += uGlowColor * sunHalo * 1.30;
  col += uGlowColor * sunIris * 0.55;

  // ------------------------------------------------- panel normal + shadow
  float panelAlign = acos(clamp(dot(dir, normalize(uPanelNormal)), -1.0, 1.0));
  float panelMarker = 1.0 - smoothstep(0.020, 0.040, panelAlign);
  col += uRimColor * panelMarker * 1.7;

  vec3 shadowDir = normalize(-uSunDir * vec3(1.0, -1.0, 1.0));
  float shadowAlign = acos(clamp(dot(dir, shadowDir), -1.0, 1.0));
  col += vec3(0.05, 0.07, 0.12) * (1.0 - smoothstep(0.03, 0.09, shadowAlign)) * 0.65;

  // ------------------------------------------------------- optimum tilt ring
  if (uTiltLine > 0.5) {
    float ringEl = 90.0 - uTiltLine;
    float band = 1.0 - smoothstep(0.0, 0.6, abs(el - ringEl));
    float southHalf = smoothstep(-0.15, 0.55, -cos(radians(az)));
    col += vec3(0.34, 0.94, 0.86) * band * southHalf * 0.50;
  }

  // ----------------------------------------------------------- glass finish
  float fres = pow(1.0 - abs(dir.y), 2.4);
  col += uRimColor * fres * 0.30;

  vec3 specVec = normalize(vec3(uSpecularX, 0.85, uSpecularY));
  float spec = pow(max(0.0, dot(dir, specVec)), 42.0);
  col += vec3(1.0) * spec * 0.55;

  if (uQuality < 0.6) {
    col *= 1.0 - 0.03 * step(0.5, fract(vUv.y * 220.0));
  }

  col = col / (col + vec3(0.9));
  col = pow(max(col, 0.0), vec3(0.92));

  fragColor = vec4(col, 1.0);
}
