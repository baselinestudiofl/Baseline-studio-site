/**
 * lighting-preview.js?v=2
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
      let breathT = 0;

      // ── Build HTML ──────────────────────────────────────────────────────
      container.innerHTML = `
        <div class="lp-wrap" style="font-family:'Barlow',system-ui,sans-serif;color:#fff;">

          <!-- Canvas preview -->
          <canvas class="lp-canvas" width="560" height="250"
            style="width:100%;border-radius:12px;display:block;margin-bottom:16px;background:#080810;"></canvas>

          <!-- Selected palette strip -->
          <div style="margin-bottom:16px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:rgba(255,255,255,0.3);margin-bottom:8px;">
              Uplight colors <span id="lpSelCount" style="color:rgba(31,163,224,0.7);">(${selected.length}/${MAX_COLORS})</span>
            </div>
            <div id="lpPalette" style="display:flex;gap:8px;min-height:36px;align-items:center;flex-wrap:wrap;"></div>
          </div>

          <!-- Swatch grid -->
          <div style="margin-bottom:12px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:rgba(255,255,255,0.3);margin-bottom:10px;">
              Tap to add · tap again to remove · up to 4 colors
            </div>
            <div id="lpSwatches" style="display:flex;flex-wrap:wrap;gap:9px;"></div>
          </div>

          <!-- Custom color -->
          <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px;">
            <input type="color" id="lpCustomInput" value="#ffffff"
              style="width:32px;height:32px;border:none;background:none;cursor:pointer;border-radius:50%;padding:0;margin-bottom:0;">
            Add custom color
          </label>

          <p style="font-size:12px;color:rgba(255,255,255,0.28);margin:14px 0 0;font-style:italic;">
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

      // ── Render palette strip ─────────────────────────────────────────────
      function renderPalette() {
        palEl.innerHTML = selected.length ? selected.map((hex, i) => `
          <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:4px 10px 4px 6px;cursor:pointer;" onclick="lpRemoveColor(${i})" title="Remove">
            <div style="width:18px;height:18px;border-radius:4px;background:${hex};flex-shrink:0;box-shadow:0 0 6px ${hex}66;"></div>
            <span style="font-size:11px;color:rgba(255,255,255,0.55);font-variant-numeric:tabular-nums;">${hex.toUpperCase()}</span>
            <span style="font-size:14px;color:rgba(255,255,255,0.25);margin-left:2px;line-height:1;">×</span>
          </div>
        `).join('') : `<span style="font-size:12px;color:rgba(255,255,255,0.2);font-style:italic;">No colors selected yet</span>`;

        selCountEl.textContent = `(${selected.length}/${MAX_COLORS})`;
        selCountEl.style.color = selected.length >= MAX_COLORS ? 'rgba(255,179,71,0.8)' : 'rgba(31,163,224,0.7)';
      }

      // ── Render swatch grid ───────────────────────────────────────────────
      function renderSwatches() {
        swatchesEl.innerHTML = PRESETS.map((p) => {
          const isSelected = selected.includes(p.hex);
          return `
            <button onclick="lpToggleSwatch('${p.hex}','${p.name}')"
              title="${p.name}"
              style="width:38px;height:38px;border-radius:50%;background:${p.hex};border:2px solid ${isSelected ? '#fff' : 'transparent'};cursor:pointer;position:relative;transition:transform 0.15s,box-shadow 0.15s;flex-shrink:0;box-shadow:${isSelected ? `0 0 0 3px #0a0a14,0 0 0 5px ${p.hex},0 0 14px ${p.hex}88` : `0 2px 8px rgba(0,0,0,0.4)`};transform:${isSelected ? 'scale(1.12)' : 'scale(1)'};">
              ${isSelected ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,0.7);">✓</span>` : ''}
            </button>
          `;
        }).join('');
      }

      // Expose toggle/remove to global scope for inline onclick
      window.lpToggleSwatch = function(hex) {
        const idx = selected.indexOf(hex);
        if (idx !== -1) {
          selected.splice(idx, 1);
        } else {
          if (selected.length >= MAX_COLORS) selected.pop();
          selected.push(hex);
        }
        _notifyChange();
        renderPalette();
        renderSwatches();
        updateBeamTargets();
      };

      window.lpRemoveColor = function(i) {
        selected.splice(i, 1);
        _notifyChange();
        renderPalette();
        renderSwatches();
        updateBeamTargets();
      };

      customInput.addEventListener('input', function() {
        const hex = this.value;
        if (selected.length >= MAX_COLORS) selected.pop();
        selected.push(hex);
        _notifyChange();
        renderPalette();
        renderSwatches();
        updateBeamTargets();
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
      }

      // ── Canvas draw ──────────────────────────────────────────────────────
      function draw(ts) {
        breathT = (ts || 0) * 0.001;
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
        const breath = REDUCED_MOTION ? 1 : 0.82 + 0.18 * Math.sin(breathT * (Math.PI * 2 / 4.2));

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
      function loop(ts) {
        if (!REDUCED_MOTION) beamSprings.forEach(sp => { if (!isSettled(sp)) springStep(sp); });
        draw(ts);
        rafId = requestAnimationFrame(loop);
      }

      rafId = requestAnimationFrame(loop);
      container._lpCleanup = () => {
        if (rafId) cancelAnimationFrame(rafId);
        delete window.lpToggleSwatch;
        delete window.lpRemoveColor;
      };

      // ── Initial render ───────────────────────────────────────────────────
      updateBeamTargets();
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
