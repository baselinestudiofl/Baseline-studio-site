/**
 * lighting-preview.js?v=4
 * Baseline Studio — Uplighting color picker, multi-color palette
 * Select up to 4 uplight colors. Canvas 2D spring-animated room preview
 * shows beams cycling through the palette.
 * API: window.LightingPicker.mount(container, initialLighting, onChange)
 *   initialLighting: { colors: ['#hex', ...] }   (1–4 entries)
 *   onChange: (lightingObj) => void               called on every change
 */

(function () {
  'use strict';

  const PRESETS = [
    { name: 'Miami Cyan',   hex: '#1FA3E0' },
    { name: 'Blush Rose',   hex: '#F6A5C0' },
    { name: 'Amber',        hex: '#FFB347' },
    { name: 'Emerald',      hex: '#2ECC71' },
    { name: 'Royal Violet', hex: '#7C5CFF' },
    { name: 'Crimson',      hex: '#E74C3C' },
    { name: 'Pure White',   hex: '#FFFFFF' },
    { name: 'Champagne',    hex: '#F7E7CE' },
    { name: 'Cobalt',       hex: '#0047AB' },
    { name: 'Peach',        hex: '#FFCBA4' },
    { name: 'Lavender',     hex: '#B79FD6' },
    { name: 'Gold',         hex: '#FFD700' },
  ];

  const MAX_COLORS = 4;
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  // Pick the mark color (white or near-black) that reads best on a swatch color.
  function lum(hex) {
    const c = hexToRgb(hex);
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function markColor(hex) {
    const L = lum(hex);
    return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.0523) ? '#ffffff' : '#07070d';
  }
  function safeHex(hex) { return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(hex)) ? hex : '#1FA3E0'; }

  function makeSpring(hex) {
    const rgb = hexToRgb(hex || '#1FA3E0');
    return { r: rgb.r, g: rgb.g, b: rgb.b, vr: 0, vg: 0, vb: 0, targetHex: hex || '#1FA3E0' };
  }

  function springStep(sp) {
    const t = hexToRgb(sp.targetHex);
    sp.vr += (t.r - sp.r) * 0.12; sp.vr *= 0.76; sp.r += sp.vr;
    sp.vg += (t.g - sp.g) * 0.12; sp.vg *= 0.76; sp.g += sp.vg;
    sp.vb += (t.b - sp.b) * 0.12; sp.vb *= 0.76; sp.b += sp.vb;
  }

  function isSettled(sp) {
    const t = hexToRgb(sp.targetHex);
    return Math.abs(sp.r - t.r) < 0.5 && Math.abs(sp.g - t.g) < 0.5 && Math.abs(sp.b - t.b) < 0.5
        && Math.abs(sp.vr) < 0.3 && Math.abs(sp.vg) < 0.3 && Math.abs(sp.vb) < 0.3;
  }

  // ─── Main ─────────────────────────────────────────────────────────────────
  window.LightingPicker = {

    mount(container, initialLighting, onChange) {
      initialLighting = initialLighting || {};
      // Normalise: accept both old per-zone format and new multi-color format
      let initColors = [];
      if (Array.isArray(initialLighting.colors) && initialLighting.colors.length) {
        initColors = initialLighting.colors.slice(0, MAX_COLORS);
      } else if (initialLighting.uplighting && initialLighting.uplighting.hex) {
        initColors = [initialLighting.uplighting.hex];
      } else {
        initColors = [PRESETS[0].hex];
      }

      // Selected colors (array of hex strings, max 4)
      let selected = [...initColors];

      // One spring per beam (6 beams). Beam i uses selected[i % selected.length]
      const NUM_BEAMS = 6;
      const beamSprings = Array.from({ length: NUM_BEAMS }, (_, i) =>
        makeSpring(selected[i % selected.length])
      );

      let rafId = null;

      // ── Build HTML ──────────────────────────────────────────────────────
      // Colors use the CRM tokens when the page has them and fall back to the same values when it does not
      // (this file is loaded by the provider CRM and the client portal). Every tap target is at least 44x44.
      container.innerHTML = `
        <style>
          .lp-wrap { font-family:'Barlow',system-ui,sans-serif; color:var(--text-1,#f4f6f8); }
          .lp-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--text-3,rgba(255,255,255,.62)); margin-bottom:8px; }
          .lp-chip { display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:0 8px 0 10px; background:var(--surface-2,#151726); border:1px solid var(--border-ui,rgba(255,255,255,.38)); border-radius:8px; color:var(--text-2,rgba(255,255,255,.72)); font:inherit; font-size:12px; cursor:pointer; }
          .lp-chip:hover { border-color:var(--border-strong,rgba(255,255,255,.55)); color:var(--text-1,#f4f6f8); }
          .lp-chip-dot { width:20px; height:20px; border-radius:5px; flex:none; box-shadow:inset 0 0 0 1px rgba(255,255,255,.38); }
          .lp-chip-hex { font-variant-numeric:tabular-nums; }
          .lp-chip svg { flex:none; }
          .lp-sw { position:relative; width:44px; height:44px; padding:0; border:0; background:transparent; border-radius:50%; cursor:pointer; flex:none; display:inline-flex; align-items:center; justify-content:center; }
          .lp-sw-dot { width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:inset 0 0 0 1px rgba(255,255,255,.38); }
          .lp-sw[aria-pressed="true"] .lp-sw-dot { box-shadow:inset 0 0 0 1px rgba(255,255,255,.38), 0 0 0 2px var(--surface-0,#07070d), 0 0 0 4px var(--text-1,#f4f6f8); }
          .lp-custom-row { display:inline-flex; align-items:center; gap:8px; min-height:44px; cursor:pointer; font-size:13px; color:var(--text-2,rgba(255,255,255,.72)); }
          .lp-custom { width:44px; height:44px; padding:4px; margin:0; border:1px solid var(--border-ui,rgba(255,255,255,.38)); border-radius:50%; background:transparent; cursor:pointer; }
          .lp-custom::-webkit-color-swatch-wrapper { padding:0; }
          .lp-custom::-webkit-color-swatch { border:0; border-radius:50%; }
          .lp-custom::-moz-color-swatch { border:0; border-radius:50%; }
          .lp-chip:focus-visible, .lp-sw:focus-visible, .lp-custom:focus-visible { outline:2px solid var(--focus,#4cb8ea); outline-offset:2px; }
          .lp-msg { min-height:18px; margin-top:6px; font-size:12px; color:var(--warn,#f5b53d); }
        </style>
        <div class="lp-wrap">

          <!-- Canvas preview -->
          <canvas class="lp-canvas" width="560" height="250"
            style="width:100%;border-radius:12px;display:block;margin-bottom:16px;background:#080810;"></canvas>

          <!-- Selected palette strip -->
          <div style="margin-bottom:16px;">
            <div class="lp-label">
              Uplight colors <span id="lpSelCount" style="color:var(--cyan,#1FA3E0);">(${selected.length}/${MAX_COLORS})</span>
            </div>
            <div id="lpPalette" style="display:flex;gap:8px;min-height:44px;align-items:center;flex-wrap:wrap;"></div>
            <div id="lpMsg" class="lp-msg" role="status" aria-live="polite"></div>
          </div>

          <!-- Swatch grid -->
          <div style="margin-bottom:12px;">
            <div class="lp-label" style="margin-bottom:6px;">
              Tap to add. Tap again to remove. Up to 4 colors.
            </div>
            <div id="lpSwatches" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
          </div>

          <!-- Custom color -->
          <label class="lp-custom-row">
            <input type="color" id="lpCustomInput" class="lp-custom" value="#ffffff" aria-label="Add custom color">
            Add custom color
          </label>

          <p style="font-size:12px;color:var(--text-3,rgba(255,255,255,.62));margin:12px 0 0;font-style:italic;">
            Pick the colors and we'll make the room feel like it.
          </p>
        </div>
      `;

      const canvas      = container.querySelector('.lp-canvas');
      const ctx         = canvas.getContext('2d');
      const palEl       = container.querySelector('#lpPalette');
      const selCountEl  = container.querySelector('#lpSelCount');
      const swatchesEl  = container.querySelector('#lpSwatches');
      const customInput = container.querySelector('#lpCustomInput');
      const msgEl       = container.querySelector('#lpMsg');
      let msgTimer = null;
      const up = h => String(h).toUpperCase();
      const has = hex => selected.some(c => up(c) === up(hex));
      function say(text) {
        msgEl.textContent = text || '';
        if (msgTimer) clearTimeout(msgTimer);
        if (text) msgTimer = setTimeout(() => { msgEl.textContent = ''; }, 4000);
      }

      // ── Render palette strip ─────────────────────────────────────────────
      const X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      const CHECK_ICON = c => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';

      function renderPalette() {
        palEl.innerHTML = selected.length ? selected.map((hex0, i) => {
          const hex = safeHex(hex0);
          return `
          <button type="button" class="lp-chip" onclick="lpRemoveColor(${i})" title="Remove ${hex.toUpperCase()}" aria-label="Remove color ${hex.toUpperCase()}">
            <span class="lp-chip-dot" style="background:${hex};"></span>
            <span class="lp-chip-hex">${hex.toUpperCase()}</span>
            ${X_ICON}
          </button>`;
        }).join('') : `<span style="font-size:12px;color:var(--text-3,rgba(255,255,255,.62));font-style:italic;">No colors selected yet</span>`;

        selCountEl.textContent = `(${selected.length}/${MAX_COLORS})`;
        selCountEl.style.color = selected.length >= MAX_COLORS ? 'var(--warn,#f5b53d)' : 'var(--cyan,#1FA3E0)';
      }

      // ── Render swatch grid ───────────────────────────────────────────────
      function renderSwatches() {
        swatchesEl.innerHTML = PRESETS.map((p) => {
          const isSelected = has(p.hex);
          return `
            <button type="button" class="lp-sw" onclick="lpToggleSwatch('${p.hex}','${p.name}')"
              title="${p.name}" aria-label="${p.name}" aria-pressed="${isSelected ? 'true' : 'false'}">
              <span class="lp-sw-dot" style="background:${p.hex};${isSelected ? `box-shadow:inset 0 0 0 1px rgba(255,255,255,.38),0 0 0 2px #07070d,0 0 0 4px #f4f6f8,0 0 14px ${p.hex}88;` : ''}">${isSelected ? CHECK_ICON(markColor(p.hex)) : ''}</span>
            </button>
          `;
        }).join('');
      }

      // Expose toggle/remove to global scope for inline onclick
      // One commit = one change notice (one save on the provider side). A fifth color is refused, never swapped in.
      function commit() {
        _notifyChange();
        renderPalette();
        renderSwatches();
        updateBeamTargets();
      }

      window.lpToggleSwatch = function(hex) {
        const idx = selected.findIndex(c => up(c) === up(hex));
        if (idx !== -1) {
          selected.splice(idx, 1);
          say('');
        } else {
          if (selected.length >= MAX_COLORS) { say('Remove a color first. Up to ' + MAX_COLORS + ' colors.'); return; }
          selected.push(hex);
          say('');
        }
        commit();
      };

      window.lpRemoveColor = function(i) {
        selected.splice(i, 1);
        say('');
        commit();
      };

      // The native picker fires "input" on every tick of a drag; only "change" (picker closed or value settled) adds a color.
      customInput.addEventListener('change', function() {
        const hex = this.value;
        if (has(hex)) { say('That color is already in the list.'); return; }
        if (selected.length >= MAX_COLORS) { say('Remove a color first. Up to ' + MAX_COLORS + ' colors.'); return; }
        selected.push(hex);
        say('');
        commit();
      });

      function _notifyChange() {
        if (onChange) onChange({ colors: [...selected] });
      }

      // ── Update spring targets when palette changes ────────────────────────
      function updateBeamTargets() {
        if (!selected.length) return;
        beamSprings.forEach((sp, i) => {
          sp.targetHex = selected[i % selected.length];
          if (REDUCED_MOTION) {
            const rgb = hexToRgb(sp.targetHex);
            Object.assign(sp, { r: rgb.r, g: rgb.g, b: rgb.b });
          }
        });
        kick();
      }

      // ── Canvas draw ──────────────────────────────────────────────────────
      function draw(ts) {
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#070710';
        ctx.fillRect(0, 0, W, H);

        // Floor plane
        const floorY = H * 0.58;
        const avgR = beamSprings.reduce((s, sp) => s + sp.r, 0) / beamSprings.length;
        const avgG = beamSprings.reduce((s, sp) => s + sp.g, 0) / beamSprings.length;
        const avgB = beamSprings.reduce((s, sp) => s + sp.b, 0) / beamSprings.length;
        const floorGrad = ctx.createLinearGradient(0, floorY, 0, H);
        floorGrad.addColorStop(0, `rgba(${avgR|0},${avgG|0},${avgB|0},0.10)`);
        floorGrad.addColorStop(1, `rgba(${avgR|0},${avgG|0},${avgB|0},0.02)`);
        ctx.fillStyle = floorGrad;
        ctx.fillRect(0, floorY, W, H - floorY);

        // 6 uplight beams — each uses its own spring color
        const beamPositions = [0.05, 0.2, 0.35, 0.65, 0.8, 0.95];
        const breath = 1; // steady beams: no ambient pulse

        beamPositions.forEach((xp, bi) => {
          const sp  = beamSprings[bi];
          const bx  = W * xp;
          const bw  = W * 0.065;
          const grad = ctx.createLinearGradient(bx, H, bx, 0);
          grad.addColorStop(0,    `rgba(${sp.r|0},${sp.g|0},${sp.b|0},${0.60 * breath})`);
          grad.addColorStop(0.55, `rgba(${sp.r|0},${sp.g|0},${sp.b|0},${0.20 * breath})`);
          grad.addColorStop(1,    `rgba(${sp.r|0},${sp.g|0},${sp.b|0},0)`);
          ctx.beginPath();
          ctx.moveTo(bx - bw * 0.35, H);
          ctx.lineTo(bx + bw * 0.35, H);
          ctx.lineTo(bx + bw * 1.55, 0);
          ctx.lineTo(bx - bw * 1.55, 0);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
        });

        // Wall ambient glow
        const wallGrad = ctx.createLinearGradient(0, 0, W, H * 0.58);
        wallGrad.addColorStop(0, `rgba(${avgR|0},${avgG|0},${avgB|0},0.07)`);
        wallGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = wallGrad;
        ctx.fillRect(0, 0, W, H * 0.58);

        // Table silhouettes
        ctx.fillStyle = 'rgba(16,16,28,0.8)';
        [[0.25,0.84],[0.5,0.79],[0.75,0.84],[0.38,0.93],[0.62,0.93]].forEach(([xp,yp]) => {
          ctx.beginPath();
          ctx.arc(W * xp, H * yp, W * 0.022, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // ── Animation loop ───────────────────────────────────────────────────
      // Runs only while a color is still moving, and stops when the picker leaves the page.
      function loop(ts) {
        rafId = null;
        if (!container.isConnected) return;
        if (!REDUCED_MOTION) beamSprings.forEach(sp => { if (!isSettled(sp)) springStep(sp); });
        draw(ts);
        if (!REDUCED_MOTION && beamSprings.some(sp => !isSettled(sp))) rafId = requestAnimationFrame(loop);
      }
      function kick() { if (!rafId) rafId = requestAnimationFrame(loop); }
      container._lpCleanup = () => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        if (msgTimer) clearTimeout(msgTimer);
        delete window.lpToggleSwatch;
        delete window.lpRemoveColor;
      };

      // ── Initial render ───────────────────────────────────────────────────
      updateBeamTargets();
      draw(0);
      renderPalette();
      renderSwatches();

      return {
        getColors: () => [...selected],
        setColors: (hexArr) => {
          selected = (hexArr || []).slice(0, MAX_COLORS);
          updateBeamTargets();
          renderPalette();
          renderSwatches();
        }
      };
    }
  };

})();
