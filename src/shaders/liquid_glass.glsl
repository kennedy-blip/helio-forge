// ============================================================================
// HELIO-FORGE · liquid_glass.glsl
// WebGL2 atmospheric scattering + refractive chromatic glass caustics.
// Rendered as a single full-screen triangle behind the frosted UI shell.
//
// Split into stages by the //@@VERTEX / //@@FRAGMENT markers (see webgl/gl.js).
// ============================================================================

//@@VERTEX
#version 300 es
precision highp float;

// Full-screen triangle: no attribute buffers needed (gl_VertexID dispatch)
out vec2 vUv;

void main() {
  // 3 verts -> oversized triangle covering the clip space
  vec2 p = vec2(
    (gl_VertexID == 1) ? 3.0 : -1.0,
    (gl_VertexID == 2) ? 3.0 : -1.0
  );
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}

//@@FRAGMENT
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;            // seconds since load
uniform float uSunElevation;    // degrees, -90 .. 90
uniform float uSunAzimuth;      // degrees, 0 .. 360
uniform float uQuality;         // 1.0 = full, 0.35 = battery-saver
uniform float uSpecularX;       // -1 .. 1  (cursor / gyroscope)
uniform float uSpecularY;       // -1 .. 1
uniform vec3  uColorTop;        // atmosphere zenith
uniform vec3  uColorMid;        // mid sky
uniform vec3  uColorHorizon;    // horizon band
uniform vec3  uColorGlow;       // sun / aurora accent
uniform float uNightMix;        // 0 = daylight .. 1 = night
uniform float uAberration;      // chromatic prism strength

#define PI 3.14159265359

// ------------------------------------------------------------------ hashing
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// value noise (cheap, no texture lookups)
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * vnoise(p);
    p = rot * p * 2.03;
    amp *= 0.5;
  }
  return sum;
}

// ------------------------------------------------------- sky gradient model
vec3 skyGradient(vec2 uv, float sunY) {
  // Vertical atmospheric column: zenith -> horizon with a Rayleigh-ish falloff
  float horizon = 1.0 - uv.y;
  float band = pow(clamp(horizon, 0.0, 1.0), 1.35);

  vec3 col = mix(uColorTop, uColorMid, smoothstep(0.05, 0.62, band));
  col = mix(col, uColorHorizon, smoothstep(0.55, 1.0, band));

  // Solar aureole: a warm bloom hugging the sun's azimuth
  float azRad = radians(uSunAzimuth);
  float dx = abs(fract((uv.x - (azRad / (2.0 * PI)) + 1.5)) - 0.5) * 4.0;
  float sunScreenY = clamp(0.5 + sunY / 180.0, -0.2, 1.2);
  float distToSun = length(vec2(dx, (uv.y - sunScreenY) * 1.6));
  float aureole = exp(-distToSun * distToSun * 9.0);
  col += uColorGlow * aureole * (1.0 - uNightMix) * 0.55;

  return col;
}

// -------------------------------------------------------- caustic refraction
vec3 caustics(vec2 uv) {
  vec2 p = uv * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
  vec2 warp = vec2(
    fbm(p * 2.4 + vec2(uTime * 0.05, 0.0), 4),
    fbm(p * 2.4 + vec2(0.0, uTime * 0.042) + 8.3, 4)
  );
  float caustic = fbm(p * 4.5 + warp * 2.6, 4);
  // sharp ridges read as glass refraction
  caustic = pow(clamp(caustic * 1.35, 0.0, 1.0), 3.0);
  vec3 tint = mix(uColorGlow, uColorHorizon, caustic);
  return tint * caustic * 0.55;
}

// ---------------------------------------------------------- prism dispersion
// Three slightly offset samples -> chromatic aberration across the whole field
vec3 chromaticField(vec2 uv) {
  vec3 acc;
  float strength = uAberration * 0.006;
  acc.r = skyGradient(uv + vec2(strength, 0.0), uSunElevation).r;
  acc.g = skyGradient(uv, uSunElevation).g;
  acc.b = skyGradient(uv - vec2(strength, 0.0), uSunElevation).b;
  return acc;
}

// ---------------------------------------------------------------------- main
void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  int octaves = int(mix(3.0, 5.0, clamp(uQuality, 0.0, 1.0)));

  vec3 col = chromaticField(uv);

  // slow-drifting volumetric haze (aurora bands at night, cirrus by day)
  float drift = uTime * 0.035;
  float haze = fbm(p * 1.7 + vec2(drift, -drift * 0.6), octaves);
  haze = smoothstep(0.35, 0.85, haze);
  float horizonBias = smoothstep(0.05, 0.65, uv.y);
  col += uColorGlow * haze * horizonBias * mix(0.28, 0.16, uNightMix);

  // refraction caustics — stronger near the bottom "glass shelf"
  float shelf = smoothstep(0.55, 0.0, uv.y);
  col += caustics(uv) * (0.30 + 0.55 * shelf) * clamp(uQuality, 0.35, 1.0);

  // night starfield: sparse glitter that only appears below the horizon term
  float starField = 0.0;
  if (uNightMix > 0.02) {
    vec2 sp = p * 220.0;
    float h = hash21(floor(sp));
    float twinkle = 0.5 + 0.5 * sin(uTime * 2.3 + h * 62.83);
    starField = step(0.9965, h) * twinkle * uNightMix * (1.0 - horizonBias * 0.7);
    col += vec3(0.72, 0.86, 1.0) * starField;
  }

  // lunar / off-grid teal glow near the bottom edge
  float floorGlow = exp(-uv.y * 7.0);
  col += uColorGlow * floorGlow * 0.22;

  // gyroscope / cursor specular sweep across the glass
  vec2 specCenter = vec2(0.5 + uSpecularX * 0.55, 0.62 + uSpecularY * 0.42);
  float spec = exp(-dot(vec2((uv.x - specCenter.x) * aspect, uv.y - specCenter.y),
                        vec2((uv.x - specCenter.x) * aspect, uv.y - specCenter.y)) * 5.5);
  col += vec3(1.0, 0.96, 0.88) * spec * 0.14;

  // vignette + filmic shoulder
  float vignette = 1.0 - 0.42 * pow(length((uv - 0.5) * vec2(1.15, 1.0)), 1.9);
  col *= vignette;
  col = col / (col + vec3(0.85));
  col = pow(max(col, 0.0), vec3(0.92));

  fragColor = vec4(col, 1.0);
}
