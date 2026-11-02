// window.__BA comes from badapple.js, written by extract.py
(function () {
  const W = 1920, H = 1080;
  const COLS = 80, ROWS = 60, TILE = 18;
  const OX = (W - COLS * TILE) / 2; // 240: 4:3 window inside 16:9
  const DUR = 16.3;
  const T_THROW = 12.3; // real-time playback ends here (in sync with the original pv)
  const SLOWMO = 0.33; // bad apple time advances at 0.33x during the zoom (12.3 -> 13.62 s)
  // a pixel inside the apple: dark in every frame from 12.9 s, nearest the apple centre at frame 405
  const TARGET = { c: 42, r: 33 };
  const Z_END = 2000 / TILE; // final tile = 2000 px, logo = 1400 px
  // mit bars logo in 350 x 181 units: x, y, w, h, grey
  const LOGO_W = 350, LOGO_H = 181;
  const LOGO = [
    [0, 0, 38, 181, 0], [62, 0, 38, 123, 0], [124, 0, 38, 181, 0],
    [186, 0, 39, 36, 0], [186, 58, 39, 123, 1],
    [250, 58, 38, 123, 0], [250, 0, 100, 36, 0],
  ];
  const MIT_RED = [163, 31, 52], MIT_GRAY = [138, 139, 140];
  const canvas = document.getElementById("mosaic");
  const ctx = canvas.getContext("2d", { alpha: false });
  let tiles = null, N = 0, sideL = null, sideR = null, apple = null;
  function decode(BA) {
    N = BA.frames;
    const bin = atob(BA.b64);
    tiles = new Uint8Array(N * COLS * ROWS);
    for (let i = 0; i < bin.length; i++) {
      const b = bin.charCodeAt(i);
      tiles[2 * i] = b >> 4;
      tiles[2 * i + 1] = b & 15;
    }
    // per frame: median edge tones for the pillars, and the centroid of the dark tiles (the apple)
    sideL = new Float32Array(N);
    sideR = new Float32Array(N);
    apple = new Float32Array(N * 2);
    for (let f = 0; f < N; f++) {
      const base = f * COLS * ROWS;
      const l = [], r = [];
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < ROWS; y++) {
        l.push(tiles[base + y * COLS]);
        r.push(tiles[base + y * COLS + COLS - 1]);
        for (let x = 0; x < COLS; x++) {
          if (tiles[base + y * COLS + x] <= 4) { sx += x; sy += y; n++; }
        }
      }
      l.sort((a, b) => a - b); r.sort((a, b) => a - b);
      sideL[f] = l[ROWS >> 1] / 15; sideR[f] = r[ROWS >> 1] / 15;
      apple[2 * f] = n ? sx / n : COLS / 2;
      apple[2 * f + 1] = n ? sy / n : ROWS / 2;
    }
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (e0, e1, x) => { const k = clamp((x - e0) / (e1 - e0), 0, 1); return k * k * (3 - 2 * k); };
  const smoother = (k) => k * k * k * (k * (k * 6 - 15) + 10);
  // bad apple source time for a given local time
  function baTime(t) {
    if (t <= T_THROW) return t;
    return T_THROW + (t - T_THROW) * SLOWMO;
  }
  // smoothed apple centroid (world px) around a bad apple time
  // continuous in bt (tent kernel at the fractional source frame) so the slow-mo camera never steps
  function appleAt(bt) {
    let sx = 0, sy = 0, sw = 0;
    const ff = bt * 30, fa = Math.floor(ff);
    for (let f = fa - 6; f <= fa + 7; f++) {
      const w = 1 - Math.abs(f - ff) / 7;
      if (w <= 0) continue;
      const fc = clamp(f, 0, N - 1);
      sx += apple[2 * fc] * w; sy += apple[2 * fc + 1] * w; sw += w;
    }
    return [OX + (sx / sw + 0.5) * TILE, (sy / sw + 0.5) * TILE];
  }
  function camera(t) {
    const target = [OX + (TARGET.c + 0.5) * TILE, (TARGET.r + 0.5) * TILE];
    if (t <= T_THROW) return { z: 1, cx: W / 2, cy: H / 2 };
    const u = clamp((t - T_THROW) / (DUR - T_THROW), 0, 1);
    // log-space zoom: slow start, accelerating, landing exactly on Z_END
    const f = Math.pow(smoother(u), 1.35);
    const z = Math.exp(Math.log(Z_END) * f);
    const ap = appleAt(baTime(t));
    const follow = smooth(0, 0.42, u); // drift from frame centre onto the falling apple
    const lock = smooth(0.38, 0.86, u); // then converge on the chosen pixel
    const cx = lerp(lerp(W / 2, ap[0], follow), target[0], lock);
    const cy = lerp(lerp(H / 2, ap[1], follow), target[1], lock);
    return { z, cx, cy };
  }
  function draw(t) {
    const bt = baTime(t);
    const f = clamp(Math.floor(bt * 30 + 1e-6), 0, N - 1);
    const base = f * COLS * ROWS;
    const cam = camera(t);
    const S = TILE * cam.z;
    // world -> screen
    const sx0 = (0 - cam.cx) * cam.z + W / 2;
    const sy0 = (0 - cam.cy) * cam.z + H / 2;
    // logo contrast grows with on-screen tile size; colour switches to mit red/grey late
    const contrast = clamp((S - 16) / 240, 0.075, 1);
    const colourMix = smooth(90, 420, S);
    const seam = S < 5 ? 0 : clamp(S * 0.05, 0.6, 2.4);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const bx = sx0 + OX * cam.z; // screen x of tile column 0
    const c0 = Math.floor(-bx / S) - 1, c1 = Math.ceil((W - bx) / S) + 1;
    // once the camera moves, rows above/below the grid are extended like the pillars
    // so the drift toward the apple never exposes a black letterbox band
    const ext = t > T_THROW;
    const r0 = ext ? Math.floor((-sy0) / S) - 1 : Math.max(0, Math.floor((-sy0) / S) - 1);
    const r1 = ext ? Math.ceil((H - sy0) / S) + 1 : Math.min(ROWS, Math.ceil((H - sy0) / S) + 1);
    const lw = 0.7 * S, u = lw / LOGO_W, lh = LOGO_H * u;
    for (let r = r0; r < r1; r++) {
      const y = sy0 + r * S;
      const inRow = r >= 0 && r < ROWS, rr = r < 0 ? 0 : r >= ROWS ? ROWS - 1 : r;
      for (let c = c0; c <= c1; c++) {
        const x = bx + c * S;
        if (x > W || x + S < 0) continue;
        let v;
        if (c >= 0 && c < COLS) {
          v = tiles[base + rr * COLS + c] / 15;
          if (!inRow) v = v * 0.86 + 0.02; // above/below the grid: extend the edge row, dimmed like the pillars
        } else v = (c < 0 ? sideL[f] : sideR[f]) * 0.86 + 0.02; // pillar: extend the edge tone, slightly dimmed
        const g = Math.round(v * 242);
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(x, y, S + 0.5, S + 0.5);
        if (S < 2.5) continue;
        // the logo inside this pixel
        const lx = x + 0.15 * S, ly = y + (S - lh) / 2;
        const dark = v < 0.5;
        for (let i = 0; i < LOGO.length; i++) {
          const L = LOGO[i];
          let col;
          if (dark) {
            const mitc = L[4] ? MIT_GRAY : MIT_RED;
            const tr = lerp(255, mitc[0], colourMix), tg = lerp(255, mitc[1], colourMix), tb = lerp(255, mitc[2], colourMix);
            col = [lerp(g, tr, contrast), lerp(g, tg, contrast), lerp(g, tb, contrast)];
          } else {
            const k = contrast * 0.55;
            col = [lerp(g, 96, k), lerp(g, 96, k), lerp(g, 96, k)];
          }
          ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
          ctx.fillRect(lx + L[0] * u, ly + L[1] * u, L[2] * u, L[3] * u);
        }
      }
    }
    // pixel seams
    if (seam > 0) {
      ctx.fillStyle = "rgba(128,128,128,0.16)";
      for (let r = r0; r <= r1; r++) ctx.fillRect(0, sy0 + r * S - seam / 2, W, seam);
      for (let c = c0; c <= c1 + 1; c++) ctx.fillRect(bx + c * S - seam / 2, 0, seam, H);
    }
  }
  decode(window.__BA);
  // play once in real time and hold the last frame; click to replay
  let t0 = performance.now();
  canvas.addEventListener("click", () => { t0 = performance.now(); });
  function loop(now) {
    draw(clamp((now - t0) / 1000, 0, DUR));
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
