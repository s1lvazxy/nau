// The Nau mark as a piece of dark glass. One ember beam enters the core;
// the light leaves organised, along the eight rays. Raymarched in one fullscreen pass.

struct Params {
  resolution: vec2f,
  pointer: vec2f,
  center: vec2f,
  time: f32,
  scale: f32,
  presence: f32,
}
@group(0) @binding(0) var<uniform> params: Params;

const DG = vec2f(0.70710678, 0.70710678);
// Mark geometry on the 512 grid, normalised by 256.
const CORE_HALF = 0.1406;
const CORE_R = 0.0703;
const RAY_R = 0.082;
const RAY_START = 0.441;
const CARD_END = 0.816;
const DIAG_END = 0.574;
const HALF_DEPTH = 0.07;
const BEVEL = 0.028;

fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

fn roundBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn fold(p: vec2f) -> vec2f {
  var q = abs(p);
  if (q.y > q.x) { q = q.yx; }
  return q;
}

fn mark2(p: vec2f) -> f32 {
  let q = fold(p);
  let core = roundBox(p, vec2f(CORE_HALF), CORE_R);
  let card = segDist(q, vec2f(RAY_START, 0.0), vec2f(CARD_END, 0.0)) - RAY_R;
  let diag = segDist(q, DG * RAY_START, DG * DIAG_END) - RAY_R;
  return min(core, min(card, diag));
}

fn sdf(p: vec3f) -> f32 {
  let w = vec2f(mark2(p.xy) + BEVEL, abs(p.z) - HALF_DEPTH + BEVEL);
  return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0))) - BEVEL;
}

fn calcNormal(p: vec3f) -> vec3f {
  let e = vec2f(0.0012, -0.0012);
  return normalize(e.xyy * sdf(p + e.xyy) + e.yyx * sdf(p + e.yyx) + e.yxy * sdf(p + e.yxy) + e.xxx * sdf(p + e.xxx));
}

fn rotY(a: f32) -> mat3x3f {
  let c = cos(a);
  let s = sin(a);
  return mat3x3f(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

fn rotX(a: f32) -> mat3x3f {
  let c = cos(a);
  let s = sin(a);
  return mat3x3f(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

fn rotZ(a: f32) -> mat3x3f {
  let c = cos(a);
  let s = sin(a);
  return mat3x3f(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}

// Light carried inside the glass: bright in the core, flowing out along the rays.
fn innerLight(p: vec2f, t: f32) -> f32 {
  let q = fold(p);
  let r = length(p);
  let dc = segDist(q, vec2f(RAY_START - 0.06, 0.0), vec2f(CARD_END, 0.0));
  let dd = segDist(q, DG * (RAY_START - 0.06), DG * DIAG_END);
  let d = min(dc, dd);
  let pulse = 0.55 + 0.45 * sin(r * 15.0 - t * 2.6);
  let ray = exp(-d * d * 320.0) * pulse * smoothstep(0.2, 0.45, r);
  let core = exp(-max(roundBox(p, vec2f(CORE_HALF * 0.6), CORE_R), 0.0) * 22.0);
  return ray + core * 1.3;
}

// Beams lying in the mark's plane: one dim, unsteady beam in; eight clean beams out.
fn beams(b: vec2f, t: f32) -> f32 {
  let q = fold(b);
  // Out along the cardinals
  let ac = q.x;
  let wc = 0.011 + 0.03 * max(ac - 0.85, 0.0);
  let ic = exp(-(q.y * q.y) / (wc * wc)) * smoothstep(0.86, 0.95, ac) * (0.016 / wc) * exp(-max(ac - 0.9, 0.0) * 0.5);
  // Out along the diagonals
  let ad = (q.x + q.y) * 0.70710678;
  let pd = abs(q.x - q.y) * 0.70710678;
  let wd = 0.009 + 0.026 * max(ad - 0.62, 0.0);
  let id = exp(-(pd * pd) / (wd * wd)) * smoothstep(0.64, 0.72, ad) * (0.011 / wd) * exp(-max(ad - 0.66, 0.0) * 0.7) * 0.7;
  let flow = 0.8 + 0.2 * sin(length(b) * 9.0 - t * 2.6);
  // In: from the lower right, between two rays, flickering like raw data
  let dir = vec2f(0.9238795, -0.3826834);
  let ai = dot(b, dir);
  let pi = abs(b.x * dir.y - b.y * dir.x);
  let noise = 0.82 + 0.18 * sin(ai * 6.0 - t * 3.0) * sin(ai * 2.3 + t * 1.7);
  let core_i = exp(-(pi * pi) / 0.00005) * 2.2;
  let glow_i = exp(-(pi * pi) / 0.0016) * 0.35;
  let ii = (core_i + glow_i) * smoothstep(0.12, 0.3, ai) * noise;
  return (ic + id) * flow + ii;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = params.resolution;
  let t = params.time;
  let radiusPx = res.y * params.scale;
  let q = (uv - params.center) * res / radiusPx * vec2f(1.0, -1.0);

  let ember = vec3f(1.0, 0.36, 0.12);
  let peach = vec3f(1.0, 0.72, 0.52);
  let warmWhite = vec3f(1.0, 0.94, 0.88);
  let base = vec3f(0.039);

  // Camera looking at the mark; the object turns, the camera stays.
  let ro = vec3f(0.0, 0.0, -3.0);
  let rd = normalize(vec3f(q * 0.3, 1.0));
  let yaw = -0.5 + 0.1 * sin(t * 0.21) + params.pointer.x * 0.22;
  let pitch = 0.22 + 0.05 * sin(t * 0.27) - params.pointer.y * 0.16;
  let m = rotY(yaw) * rotX(pitch) * rotZ(0.06);
  let mt = transpose(m);
  let roo = mt * ro;
  let rdo = mt * rd;

  var light = vec3f(0.0);

  // Haze around the core
  light += ember * 0.05 * exp(-dot(q, q) * 2.2);

  // Beams in the plane of the mark
  if (abs(rdo.z) > 0.0001) {
    let tp = -roo.z / rdo.z;
    if (tp > 0.0) {
      let b = (roo + rdo * tp).xy;
      let i = beams(b, t);
      light += mix(ember, warmWhite, clamp(i * 0.35, 0.0, 1.0)) * i * 0.85;
    }
  }

  // March the glass
  var hit = false;
  var p = vec3f(0.0);
  let bb = dot(roo, rdo);
  let cc = dot(roo, roo) - 0.96 * 0.96;
  let hh = bb * bb - cc;
  var dmin = 1e9;
  if (hh > 0.0) {
    var tt = -bb - sqrt(hh);
    let tEnd = -bb + sqrt(hh);
    for (var i = 0; i < 90; i++) {
      p = roo + rdo * tt;
      let d = sdf(p);
      dmin = min(dmin, d);
      if (d < 0.0008) { hit = true; break; }
      tt += d * 0.9;
      if (tt > tEnd) { break; }
    }
  }

  var col: vec3f;
  if (hit) {
    let n = calcNormal(p);
    let v = -rdo;
    let ndv = clamp(dot(n, v), 0.0, 1.0);
    let fres = pow(1.0 - ndv, 4.0);
    let keyL = mt * normalize(vec3f(-0.55, 0.65, -0.55));
    let beamL = mt * normalize(vec3f(0.85, -0.35, 0.4));
    let refl = reflect(rdo, n);
    let spec = pow(max(dot(refl, keyL), 0.0), 70.0);
    let sheen = pow(max(dot(refl, keyL), 0.0), 6.0);
    let rim = pow(max(dot(refl, beamL), 0.0), 5.0);
    let inner = innerLight(p.xy, t) * (1.0 + params.presence * 0.4);
    let side = 1.0 - abs(n.z);
    let d2 = mark2(p.xy);
    // A thin inner chamfer on the faces, like the cut edge of a glass block
    let face = smoothstep(0.85, 0.98, abs(n.z));
    let chamfer = (1.0 - smoothstep(0.0, 0.0035, abs(d2 + 0.03))) * face;

    let rc = length(p.xy);
    let coreGlow = exp(-rc * rc * 60.0);
    let coreWhite = exp(-rc * rc * 260.0);
    let reflW = m * refl;
    let env = pow(max(reflW.y, 0.0), 2.0) * 0.12 + pow(max(dot(reflW, normalize(vec3f(0.8, -0.3, 0.5))), 0.0), 3.0) * 0.18;
    var g = vec3f(0.0);
    // Faces stay dark glass with light running inside each ray; edges and bevels carry the glow.
    g += ember * inner * (0.28 + 1.5 * side * side + 0.9 * fres);
    g += ember * coreGlow * 1.6 + warmWhite * coreWhite * 2.4;
    g += mix(vec3f(0.55, 0.58, 0.64), peach, 0.35) * env;
    g += warmWhite * spec * 2.2;
    g += vec3f(0.6, 0.62, 0.66) * sheen * 0.035;
    g += mix(peach, warmWhite, 0.4) * rim * (0.25 + 1.1 * side) * 1.1;
    g += vec3f(0.55, 0.57, 0.62) * fres * 0.28;
    g += peach * chamfer * (0.25 + 0.8 * inner);
    g += light * 0.15;
    let glassBase = vec3f(0.012, 0.012, 0.014);
    col = glassBase + (vec3f(1.0) - glassBase) * (vec3f(1.0) - exp(-g * 1.15));
  } else {
    // A whisper of the silhouette's edge so the shape reads against the beams
    light += peach * 0.06 * exp(-max(dmin, 0.0) * 120.0);
    col = base + (vec3f(1.0) - base) * (vec3f(1.0) - exp(-light * 1.2));
  }
  // Bloom around the core: the light spills past the glass
  let bloom = exp(-dot(q, q) * 28.0) * 0.16 + exp(-dot(q, q) * 7.0) * 0.05;
  col += ember * bloom * (1.0 + params.presence * 0.3);
  return vec4f(col, 1.0);
}
