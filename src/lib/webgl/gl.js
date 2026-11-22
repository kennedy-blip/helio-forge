/**
 * HELIO-FORGE — src/lib/webgl/gl.js
 * Minimal, dependency-free WebGL2 runtime for the two raw `.glsl` shaders.
 *
 *   liquid_glass.glsl  -> full-screen ink pass (atmosphere underlay)
 *   heliodon.glsl      -> lit glass hemisphere (solar dome)
 *
 * Both shader sources are imported as raw text (`?raw`) so the .glsl files stay
 * real, editable GLSL rather than template strings.
 */

// @ts-nocheck — validated by scripts/kernel-parity.mjs instead of the TS checker

import liquidSrc from '$shaders/liquid_glass.glsl?raw';
import heliodonSrc from '$shaders/heliodon.glsl?raw';

const VERTEX_MARK = '//@@VERTEX';
const FRAGMENT_MARK = '//@@FRAGMENT';

/** Split a single `.glsl` file into its vertex + fragment stages. */
function splitStages(source) {
  const vi = source.indexOf(VERTEX_MARK);
  const fi = source.indexOf(FRAGMENT_MARK);
  if (vi < 0 || fi < 0) throw new Error('GLSL file is missing stage markers');
  return {
    vertex: source.slice(vi + VERTEX_MARK.length, fi).trim(),
    fragment: source.slice(fi + FRAGMENT_MARK.length).trim()
  };
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`[helio-glsl] ${log}`);
  }
  return sh;
}

function program(gl, stages) {
  const vs = compile(gl, gl.VERTEX_SHADER, stages.vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, stages.fragment);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    throw new Error(`[helio-link] ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return p;
}

/** Cache of uniform locations, resolved lazily. */
function locator(gl, program) {
  const cache = new Map();
  return (name) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
    return cache.get(name);
  };
}

/* ============================== LIQUID GLASS ============================== */

export function createLiquidGlass(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    ...options
  });
  if (!gl) return null;

  const prog = program(gl, splitStages(liquidSrc));
  const u = locator(gl, prog);
  const vao = gl.createVertexArray();

  let width = 1;
  let height = 1;
  let dpr = 1;

  function resize(nextDpr = 1) {
    dpr = nextDpr;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round((rect.width || window.innerWidth) * dpr));
    height = Math.max(1, Math.round((rect.height || window.innerHeight) * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  const palette = {
    top: [0.043, 0.226, 0.388],
    mid: [0.024, 0.714, 0.831],
    horizon: [0.961, 0.62, 0.043],
    glow: [0.063, 0.725, 0.506]
  };

  function draw(state) {
    const {
      time = 0,
      sunElevation = 45,
      sunAzimuth = 180,
      quality = 1,
      specularX = 0,
      specularY = 0,
      nightMix = 0,
      aberration = 1,
      colors = palette
    } = state;

    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, width, height);

    gl.uniform2f(u('uResolution'), width, height);
    gl.uniform1f(u('uTime'), time);
    gl.uniform1f(u('uSunElevation'), sunElevation);
    gl.uniform1f(u('uSunAzimuth'), sunAzimuth);
    gl.uniform1f(u('uQuality'), quality);
    gl.uniform1f(u('uSpecularX'), specularX);
    gl.uniform1f(u('uSpecularY'), specularY);
    gl.uniform1f(u('uNightMix'), nightMix);
    gl.uniform1f(u('uAberration'), aberration);
    gl.uniform3fv(u('uColorTop'), colors.top);
    gl.uniform3fv(u('uColorMid'), colors.mid);
    gl.uniform3fv(u('uColorHorizon'), colors.horizon);
    gl.uniform3fv(u('uColorGlow'), colors.glow);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    gl,
    resize,
    draw,
    dispose() {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
    }
  };
}

/* ================================ HELIODON ================================ */

function sphereMesh(stacks = 40, slices = 72) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = (i / stacks) * (Math.PI / 2); // 0 (equator) .. pi/2 (zenith)
    const y = Math.sin(phi);
    const r = Math.cos(phi);
    for (let j = 0; j <= slices; j++) {
      const theta = (j / slices) * Math.PI * 2;
      positions.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
      uvs.push(j / slices, i / stacks);
    }
  }
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j;
      const b = a + slices + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

/** Tiny column-major 4x4 matrix helpers (no gl-matrix dependency). */
export const mat4 = {
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),

  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  },

  lookAt(eye, center, up) {
    let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    let len = Math.hypot(z0, z1, z2) || 1;
    z0 /= len; z1 /= len; z2 /= len;
    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    len = Math.hypot(x0, x1, x2) || 1;
    x0 /= len; x1 /= len; x2 /= len;
    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;
    return new Float32Array([
      x0, y0, z0, 0,
      x1, y1, z1, 0,
      x2, y2, z2, 0,
      -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
      -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
      -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
      1
    ]);
  },

  multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  },

  rotationY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }
};

/** Direction vector from compass azimuth + elevation (deg) -> world vec3. */
export function sunVector(azimuthDeg, elevationDeg) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const y = Math.sin(el);
  const r = Math.cos(el);
  return [r * Math.sin(az), y, -r * Math.cos(az)];
}

const ARC_SLOTS = 4;
const ARC_WIDTH = 48;
const HORIZON_BINS = 36;

export function createHeliodon(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    depth: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance'
  });
  if (!gl) return null;

  const prog = program(gl, splitStages(heliodonSrc));
  const u = locator(gl, prog);

  const mesh = sphereMesh(40, 72);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  const aPosition = gl.getAttribLocation(prog, 'aPosition');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
  const aUv = gl.getAttribLocation(prog, 'aUv');
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const arcBank = new Float32Array(ARC_SLOTS * ARC_WIDTH * 4);
  const horizonBank = new Float32Array(HORIZON_BINS);

  let camYaw = 0.6;
  let camPitch = 0.42;
  let camDist = 2.75;
  let width = 1;
  let height = 1;

  function resize(dpr = 1) {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round((rect.width || 640) * dpr));
    height = Math.max(1, Math.round((rect.height || 480) * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  function orbit(dx, dy) {
    camYaw += dx * 0.0075;
    camPitch = Math.max(-0.18, Math.min(1.32, camPitch + dy * 0.006));
  }

  function zoom(delta) {
    camDist = Math.max(1.55, Math.min(4.6, camDist + delta * 0.0016));
  }

  function loadArcs(arcs) {
    arcBank.fill(0);
    const order = ['summer', 'equinox', 'winter', 'today'];
    order.forEach((key, slot) => {
      const pts = arcs?.[key]?.points ?? [];
      const count = Math.min(ARC_WIDTH, pts.length);
      for (let i = 0; i < count; i++) {
        const base = (slot * ARC_WIDTH + i) * 4;
        arcBank[base] = pts[i].azimuth;
        arcBank[base + 1] = pts[i].elevation;
        arcBank[base + 2] = 1;
        arcBank[base + 3] = pts[i].up ? 1 : 0;
      }
    });
  }

  function loadHorizon(points) {
    horizonBank.fill(0);
    if (!points || !points.length) return;
    const pairs = [...points].sort((a, b) => a.azimuth - b.azimuth);
    for (let bin = 0; bin < HORIZON_BINS; bin++) {
      const az = -180 + bin * 10 + 5;
      let best = 0;
      // interpolate between the two nearest survey points
      for (let i = 0; i < pairs.length - 1; i++) {
        const a = pairs[i];
        const b = pairs[i + 1];
        if (az >= a.azimuth && az <= b.azimuth && b.azimuth > a.azimuth) {
          const t = (az - a.azimuth) / (b.azimuth - a.azimuth);
          best = a.elevation + (b.elevation - a.elevation) * t;
          break;
        }
      }
      if (!best) {
        const nearest = pairs.reduce(
          (acc, p) => (Math.abs(p.azimuth - az) < Math.abs(acc.azimuth - az) ? p : acc),
          pairs[0]
        );
        if (Math.abs(nearest.azimuth - az) < 14) best = nearest.elevation;
      }
      horizonBank[bin] = Math.max(0, best);
    }
  }

  function draw(state) {
    const {
      time = 0,
      sunAzimuth = 180,
      sunElevation = 40,
      panelTilt = 30,
      panelAzimuth = 180,
      quality = 1,
      specularX = 0,
      specularY = 0,
      showGrid = true,
      showObstruction = true,
      hasHorizon = false,
      tiltLine = 0,
      glow = [0.961, 0.62, 0.043],
      sky = [0.024, 0.2, 0.32],
      rim = [0.2, 0.85, 0.75],
      arcCount = ARC_WIDTH
    } = state;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const proj = mat4.perspective((48 * Math.PI) / 180, width / height, 0.05, 12);
    const eye = [
      Math.sin(camYaw) * Math.cos(camPitch) * camDist,
      Math.sin(camPitch) * camDist + 0.18,
      Math.cos(camYaw) * Math.cos(camPitch) * camDist
    ];
    const view = mat4.lookAt(eye, [0, 0.16, 0], [0, 1, 0]);
    const viewProj = mat4.multiply(proj, view);
    const model = mat4.identity();

    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, width, height);

    const s = sunVector(sunAzimuth, sunElevation);
    const pn = sunVector(panelAzimuth, 90 - panelTilt); // panel normal

    gl.uniformMatrix4fv(u('uViewProj'), false, viewProj);
    gl.uniformMatrix4fv(u('uModel'), false, model);
    gl.uniform1f(u('uTime'), time);
    gl.uniform3fv(u('uSunDir'), s);
    gl.uniform3fv(u('uPanelNormal'), pn);
    gl.uniform4fv(u('uArcPoints'), arcBank);
    gl.uniform1i(u('uArcCount'), arcCount);
    gl.uniform1fv(u('uHorizon'), horizonBank);
    gl.uniform1f(u('uHasHorizon'), hasHorizon ? 1 : 0);
    gl.uniform1f(u('uShowGrid'), showGrid ? 1 : 0);
    gl.uniform1f(u('uShowObstruction'), showObstruction ? 1 : 0);
    gl.uniform3fv(u('uGlowColor'), glow);
    gl.uniform3fv(u('uSkyColor'), sky);
    gl.uniform3fv(u('uRimColor'), rim);
    gl.uniform1f(u('uSpecularX'), specularX);
    gl.uniform1f(u('uSpecularY'), specularY);
    gl.uniform1f(u('uQuality'), quality);
    gl.uniform1f(u('uTiltLine'), tiltLine);

    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  return {
    gl,
    resize,
    draw,
    orbit,
    zoom,
    loadArcs,
    loadHorizon,
    get camera() {
      return { yaw: camYaw, pitch: camPitch, dist: camDist };
    },
    dispose() {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      [posBuf, uvBuf, idxBuf].forEach((b) => gl.deleteBuffer(b));
    }
  };
}

/** Is WebGL2 usable in this WebView / browser? */
export function hasWebGL2() {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}
