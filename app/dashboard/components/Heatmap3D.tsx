'use client';

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════

export interface SuspiciousRegion {
  cx: number;
  cy: number;
  intensity: number;
  area_px: number;
}

export type ViewMode = 'surface' | 'volume' | 'mpr';

export interface Heatmap3DProps {
  /** Array of [x, y, z] points where z = heatmap intensity (normalized 0-1). */
  elevation_map: [number, number, number][];
  /** Regions flagged as suspicious, rendered as pulsing markers. */
  suspicious_regions: SuspiciousRegion[];
  /** Optional base64 heatmap image (used as texture in 2D fallback). */
  heatmapBase64?: string;
  /** CSS class name applied to the container div. */
  className?: string;
  /** Width in CSS px (default: fills container). */
  width?: number;
  /** Height in CSS px (default: fills container). */
  height?: number;
  /** View mode: 'surface' | 'volume' | 'mpr' (default 'surface'). */
  viewMode?: ViewMode;
}

// ═══════════════════════════════════════════════════════════════
//  Color Scheme — skyblue / cyan matching the app theme
// ═══════════════════════════════════════════════════════════════

const GB0: [number, number, number] = [8, 20, 48];    // deep skyblue navy (z=0)
const GB1: [number, number, number] = [15, 55, 120];   // dark skyblue
const GB2: [number, number, number] = [40, 120, 200];  // mid skyblue
const GB3: [number, number, number] = [80, 185, 235];  // cyan-sky
const GB4: [number, number, number] = [160, 225, 250]; // bright skyblue (z=1)

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function zToRGB(t: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, t));
  if (v < 0.25) return lerpColor(GB0, GB1, v / 0.25);
  if (v < 0.50) return lerpColor(GB1, GB2, (v - 0.25) / 0.25);
  if (v < 0.75) return lerpColor(GB2, GB3, (v - 0.50) / 0.25);
  return lerpColor(GB3, GB4, (v - 0.75) / 0.25);
}

function toCSS(t: number, alpha = 1): string {
  const [r, g, b] = zToRGB(t);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}

/** Darker shade for side/bottom faces. */
function zToDarkCSS(t: number, alpha = 1): string {
  const [r, g, b] = zToRGB(t);
  const f = 0.45;
  return `rgba(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)},${alpha})`;
}

// ═══════════════════════════════════════════════════════════════
//  Grid Helpers
// ═══════════════════════════════════════════════════════════════

interface ParsedGrid {
  xs: number[];
  ys: number[];
  zMap: Map<string, number>;
  xMin: number;
  xMax: number;
  xRange: number;
  yMin: number;
  yMax: number;
  yRange: number;
}

function parseGrid(points: [number, number, number][]): ParsedGrid | null {
  if (!points || points.length < 4) return null;
  const xs = [...new Set(points.map(([x]) => x))].sort((a, b) => a - b);
  const ys = [...new Set(points.map(([, y]) => y))].sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2) return null;
  const zMap = new Map<string, number>();
  for (const [x, y, z] of points) zMap.set(`${x},${y}`, z);
  const xMin = xs[0], xMax = xs[xs.length - 1], xRange = xMax - xMin || 1;
  const yMin = ys[0], yMax = ys[ys.length - 1], yRange = yMax - yMin || 1;
  return { xs, ys, zMap, xMin, xMax, xRange, yMin, yMax, yRange };
}

function normalizeX(g: ParsedGrid, x: number): number {
  return ((x - g.xMin) / g.xRange) * 2 - 1;
}

function normalizeY(g: ParsedGrid, y: number): number {
  return ((y - g.yMin) / g.yRange) * 2 - 1;
}

// ═══════════════════════════════════════════════════════════════
//  3D → 2D Projection (Y-axis rotation + isometric tilt)
// ═══════════════════════════════════════════════════════════════

interface ScreenPt {
  sx: number;   // screen X
  sy: number;   // screen Y
  depth: number; // for painters-algorithm sorting
}

function project(
  nx: number,  // normalized X [-1,1]
  ny: number,  // height (z * 0.8)
  nz: number,  // normalized Y [-1,1] -> depth axis
  rot: number, // Y-axis rotation radians
): ScreenPt {
  const c = Math.cos(rot), s = Math.sin(rot);
  const rx = nx * c - nz * s;
  const rz = nx * s + nz * c;
  const TILT = 0.45;
  const sx = rx - rz * TILT;
  const sy = -ny + (rx + rz) * TILT * 0.55;
  return { sx, sy, depth: rx + rz };
}

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

export function Heatmap3D({
  elevation_map,
  suspicious_regions,
  heatmapBase64,
  className,
  width: propWidth,
  height: propHeight,
  viewMode: propViewMode = 'surface',
}: Heatmap3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(propViewMode);
  const rotationRef = useRef(0.45); // initial rotation
  const isDragging = useRef(false);
  const lastX = useRef(0);
  const rafRef = useRef(0);

  // Sync prop → state
  useEffect(() => { setViewMode(propViewMode); }, [propViewMode]);

  const grid = useMemo(() => parseGrid(elevation_map), [elevation_map]);
  const hasSurface = grid !== null;

  // Find peak for MPR mode
  const peakPoint = useMemo(() => {
    if (!grid || elevation_map.length === 0) return { nx: 0, nz: 0, ny: 0 };
    let best = { val: -Infinity, x: 0, y: 0 };
    for (const [px, py, pz] of elevation_map) {
      if (pz > best.val) best = { val: pz, x: px, y: py };
    }
    return {
      nx: normalizeX(grid, best.x),
      nz: normalizeY(grid, best.y),
      ny: best.val * 0.8,
    };
  }, [grid, elevation_map]);

  // ── Canvas render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const _canvas = canvas;
    const _container = container;
    const ctx = _canvas.getContext('2d')!;

    let animTime = 0;
    const animStart = performance.now();
    let rot = rotationRef.current;

    function resize() {
      const rect = _container.getBoundingClientRect();
      const w = propWidth ?? rect.width;
      const h = propHeight ?? rect.height;
      const dpr = window.devicePixelRatio || 1;
      _canvas.width = Math.round(w * dpr);
      _canvas.height = Math.round(h * dpr);
      _canvas.style.width = `${w}px`;
      _canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    }

    const dims = resize();
    let { w, h } = dims;

    // ── Mouse / touch handlers ──

    function onPointerDown(clientX: number) {
      isDragging.current = true;
      lastX.current = clientX;
      _canvas.style.cursor = 'grabbing';
    }

    function onPointerMove(clientX: number) {
      if (!isDragging.current) return;
      const dx = clientX - lastX.current;
      lastX.current = clientX;
      rot = (rot + dx * 0.008) % (Math.PI * 2);
      rotationRef.current = rot;
    }

    function onPointerUp() {
      isDragging.current = false;
      _canvas.style.cursor = 'grab';
    }

    const onMouseDown = (e: MouseEvent) => onPointerDown(e.clientX);
    const onMouseMove = (e: MouseEvent) => onPointerMove(e.clientX);
    const onMouseUp = () => onPointerUp();
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) onPointerDown(e.touches[0].clientX);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) onPointerMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => onPointerUp();

    _canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    _canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    const resizeObserver = new ResizeObserver(() => {
      const d = resize();
      w = d.w;
      h = d.h;
    });
    resizeObserver.observe(_container);

    // ═══════════════════════════════════════════════
    //  Render functions
    // ═══════════════════════════════════════════════

    function drawBackground() {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
      grad.addColorStop(0, '#0a1628');
      grad.addColorStop(1, '#060b14');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    /** Draw the 3D isometric surface (surface mode). */
    function drawSurface3D(rotRad: number, time: number) {
      if (!grid) return;
      const { xs, ys, zMap } = grid;
      const cx = w / 2, cy = h / 2;
      const scale = Math.min(w, h) * 0.38;

      // Build all cell top-faces
      interface CellFace {
        pts: { sx: number; sy: number }[];
        avgZ: number;
        depth: number;
      }
      const cells: CellFace[] = [];

      for (let iy = 0; iy < ys.length - 1; iy++) {
        for (let ix = 0; ix < xs.length - 1; ix++) {
          const corners = [
            { x: xs[ix], y: ys[iy] },
            { x: xs[ix + 1], y: ys[iy] },
            { x: xs[ix + 1], y: ys[iy + 1] },
            { x: xs[ix], y: ys[iy + 1] },
          ];
          const zVals = corners.map((c) => zMap.get(`${c.x},${c.y}`) ?? 0);
          const avgZ = (zVals[0] + zVals[1] + zVals[2] + zVals[3]) / 4;

          const pts = corners.map((c, i) => {
            const p = project(normalizeX(grid, c.x), zVals[i] * 0.8, normalizeY(grid, c.y), rotRad);
            return { sx: p.sx * scale + cx, sy: p.sy * scale + cy, depth: p.depth, z: zVals[i] };
          });

          const avgDepth = (pts[0].depth + pts[1].depth + pts[2].depth + pts[3].depth) / 4;
          cells.push({
            pts: pts.map((p) => ({ sx: p.sx, sy: p.sy })),
            avgZ,
            depth: avgDepth,
          });
        }
      }

      // Sort back-to-front
      cells.sort((a, b) => a.depth - b.depth);

      // Draw each cell as a quad
      for (const cell of cells) {
        ctx.beginPath();
        ctx.moveTo(cell.pts[0].sx, cell.pts[0].sy);
        for (let i = 1; i < cell.pts.length; i++) {
          ctx.lineTo(cell.pts[i].sx, cell.pts[i].sy);
        }
        ctx.closePath();
        ctx.fillStyle = toCSS(cell.avgZ, 0.92);
        ctx.fill();
        ctx.strokeStyle = `rgba(100, 200, 255, ${0.08 + cell.avgZ * 0.20})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Draw suspicious region markers
      drawSuspiciousMarkers(ctx, cx, cy, scale, rotRad, time);

      // Axis labels
      drawAxisLabels(ctx, cx, cy, scale, rotRad);
    }

    /** Draw 3D bars (volume mode — each cell as a vertical bar with sides). */
    function drawVolumeBars(rotRad: number, time: number) {
      if (!grid) return;
      const { xs, ys, zMap } = grid;
      const cx = w / 2, cy = h / 2;
      const scale = Math.min(w, h) * 0.38;

      interface BarFace {
        pts: { sx: number; sy: number }[];
        color: string;
        depth: number;
      }
      const faces: BarFace[] = [];

      for (let iy = 0; iy < ys.length - 1; iy++) {
        for (let ix = 0; ix < xs.length - 1; ix++) {
          const corners = [
            { x: xs[ix], y: ys[iy] },
            { x: xs[ix + 1], y: ys[iy] },
            { x: xs[ix + 1], y: ys[iy + 1] },
            { x: xs[ix], y: ys[iy + 1] },
          ];
          const zVals = corners.map((c) => zMap.get(`${c.x},${c.y}`) ?? 0);
          const avgZ = (zVals[0] + zVals[1] + zVals[2] + zVals[3]) / 4;

          // Project top corners and bottom corners (y = 0)
          const topPts = corners.map((c, i) =>
            project(normalizeX(grid, c.x), zVals[i] * 0.8, normalizeY(grid, c.y), rotRad),
          );
          const botPts = corners.map((c) =>
            project(normalizeX(grid, c.x), 0, normalizeY(grid, c.y), rotRad),
          );

          // Add bar height = at least 1px visual
          const hasHeight = avgZ > 0.01;

          // Top face
          const avgDepth = (topPts[0].depth + topPts[1].depth + topPts[2].depth + topPts[3].depth) / 4;
          faces.push({
            pts: topPts.map((p) => ({ sx: p.sx * scale + cx, sy: p.sy * scale + cy })),
            color: toCSS(avgZ, 0.9),
            depth: avgDepth,
          });

          if (hasHeight) {
            // Side faces: for each edge, draw a vertical quad
            const edges = [
              [0, 1], [1, 2], [2, 3], [3, 0],
            ];
            for (const [a, b] of edges) {
              const sideDepth = (topPts[a].depth + topPts[b].depth + botPts[a].depth + botPts[b].depth) / 4;
              const zVal = (zVals[a] + zVals[b]) / 2;
              faces.push({
                pts: [
                  { sx: topPts[a].sx * scale + cx, sy: topPts[a].sy * scale + cy },
                  { sx: topPts[b].sx * scale + cx, sy: topPts[b].sy * scale + cy },
                  { sx: botPts[b].sx * scale + cx, sy: botPts[b].sy * scale + cy },
                  { sx: botPts[a].sx * scale + cx, sy: botPts[a].sy * scale + cy },
                ],
                color: zToDarkCSS(zVal, 0.7),
                depth: sideDepth,
              });
            }

            // Bottom face
            const botDepth = (botPts[0].depth + botPts[1].depth + botPts[2].depth + botPts[3].depth) / 4;
            // Only draw bottom if it would be visible (usually not from above)
            // Skip bottom for performance — it's almost never visible
          }
        }
      }

      // Sort back-to-front
      faces.sort((a, b) => a.depth - b.depth);

      for (const face of faces) {
        ctx.beginPath();
        ctx.moveTo(face.pts[0].sx, face.pts[0].sy);
        for (let i = 1; i < face.pts.length; i++) {
          ctx.lineTo(face.pts[i].sx, face.pts[i].sy);
        }
        ctx.closePath();
        ctx.fillStyle = face.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.20)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      drawSuspiciousMarkers(ctx, cx, cy, scale, rotRad, time);
      drawAxisLabels(ctx, cx, cy, scale, rotRad);
    }

    /** Draw 2D top-down MPR view. */
    function drawMPRView(time: number) {
      if (!grid) {
        drawFallbackHeatmap(time);
        return;
      }
      const { xs, ys, zMap } = grid;
      const cx = w / 2, cy = h / 2;
      const size = Math.min(w, h) * 0.65;
      const offX = cx - size / 2;
      const offY = cy - size / 2;
      const cellW = size / (xs.length - 1);
      const cellH = size / (ys.length - 1);

      // Draw heatmap cells
      for (let iy = 0; iy < ys.length - 1; iy++) {
        for (let ix = 0; ix < xs.length - 1; ix++) {
          const corners = [
            { x: xs[ix], y: ys[iy] },
            { x: xs[ix + 1], y: ys[iy] },
            { x: xs[ix + 1], y: ys[iy + 1] },
            { x: xs[ix], y: ys[iy + 1] },
          ];
          const zVals = corners.map((c) => zMap.get(`${c.x},${c.y}`) ?? 0);
          const avgZ = (zVals[0] + zVals[1] + zVals[2] + zVals[3]) / 4;
          ctx.fillStyle = toCSS(avgZ, 0.9);
          ctx.fillRect(offX + ix * cellW, offY + iy * cellH, cellW + 0.5, cellH + 0.5);
        }
      }

      // Crosshair at peak point
      const peakNX = peakPoint.nx;
      const peakNZ = peakPoint.nz;
      const px = offX + ((peakNX + 1) / 2) * size;
      const py = offY + ((peakNZ + 1) / 2) * size;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px, offY);
      ctx.lineTo(px, offY + size);
      ctx.moveTo(offX, py);
      ctx.lineTo(offX + size, py);
      ctx.stroke();
      ctx.setLineDash([]);

      // Center dot
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4488';
      ctx.fill();

      // Suspicious markers in 2D
      ctx.setLineDash([]);
      for (const region of suspicious_regions) {
        const rx = offX + ((normalizeX(grid, region.cx) + 1) / 2) * size;
        const ry = offY + ((normalizeY(grid, region.cy) + 1) / 2) * size;
        const radius = Math.max(4, Math.min(12, Math.sqrt(region.area_px) * 0.5));
        const pulse = 0.6 + 0.4 * Math.sin(time * 3 + region.intensity * 10);
        ctx.beginPath();
        ctx.arc(rx, ry, radius * pulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 50, 80, ${0.4 + 0.4 * pulse})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 100, 130, ${0.5 + 0.3 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Labels
      ctx.fillStyle = 'rgba(125, 220, 255, 0.3)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('MULTI-PLANAR RECONSTRUCTION', cx, offY - 12);
      ctx.textAlign = 'right';
      ctx.fillText('X', offX - 6, cy + 3);
      ctx.textAlign = 'center';
      ctx.fillText('Z', cx, offY + size + 14);
    }

    /** Fallback 2D heatmap when no elevation data. */
    function drawFallbackHeatmap(time: number) {
      const cx = w / 2, cy = h / 2;
      const size = Math.min(w, h) * 0.55;
      const offX = cx - size / 2;
      const offY = cy - size / 2;
      const cells = 20;
      const cellSize = size / cells;

      for (let iy = 0; iy < cells; iy++) {
        for (let ix = 0; ix < cells; ix++) {
          const nx = (ix + 0.5) / cells;
          const ny = (iy + 0.5) / cells;
          // Procedural heat pattern
          const dx = nx - 0.5, dy = ny - 0.5;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const wave = Math.sin(nx * 10 + time * 0.3) * Math.cos(ny * 8 + time * 0.2);
          const z = Math.max(0, 1 - dist * 1.6) * (0.5 + 0.5 * wave);
          ctx.fillStyle = toCSS(z, 0.85);
          ctx.fillRect(offX + ix * cellSize, offY + iy * cellSize, cellSize + 0.5, cellSize + 0.5);
        }
      }

      ctx.fillStyle = 'rgba(125, 220, 255, 0.35)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No elevation data', cx, offY - 12);
      ctx.fillStyle = 'rgba(125, 220, 255, 0.2)';
      ctx.font = '10px monospace';
      ctx.fillText('showing simulated heatmap', cx, offY + size + 16);

      // Draw suspicious markers on fallback
      for (const region of suspicious_regions) {
        const rx = offX + (region.cx / 10) * size; // heuristic positioning
        const ry = offY + (region.cy / 10) * size;
        const radius = Math.max(4, Math.min(10, Math.sqrt(region.area_px) * 0.5));
        const pulse = 0.6 + 0.4 * Math.sin(time * 3 + region.intensity * 10);
        ctx.beginPath();
        ctx.arc(rx, ry, radius * pulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 50, 80, ${0.4 + 0.4 * pulse})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 100, 130, ${0.5 + 0.3 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    /** Draw suspicious markers on the 3D surface. */
    function drawSuspiciousMarkers(
      ctx: CanvasRenderingContext2D,
      cx: number, cy: number,
      scale: number, rotRad: number, time: number,
    ) {
      if (!grid || suspicious_regions.length === 0) return;
      // Filter: only draw markers that are "in front" enough
      const markers: { sx: number; sy: number; radius: number; pulse: number; depth: number }[] = [];

      for (const region of suspicious_regions) {
        const nx = normalizeX(grid, region.cx);
        const nz = normalizeY(grid, region.cy);

        // Find z at this point
        let closestZ = 0;
        let bestDist = Infinity;
        for (const [px, py, pz] of elevation_map) {
          const dx = px - region.cx;
          const dy = py - region.cy;
          const d = dx * dx + dy * dy;
          if (d < bestDist) {
            bestDist = d;
            closestZ = pz;
          }
        }

        const ny = closestZ * 0.8 + 0.02;
        const p = project(nx, ny, nz, rotRad);
        const sx = p.sx * scale + cx;
        const sy = p.sy * scale + cy;
        const radius = Math.max(3, Math.min(10, Math.sqrt(region.area_px) * 0.5));
        const pulse = 0.6 + 0.4 * Math.sin(time * 3.0 + region.intensity * 10);

        markers.push({ sx, sy, radius, pulse, depth: p.depth });
      }

      // Draw front-to-back (reverse of surface) so markers on front cells appear on top
      markers.sort((a, b) => b.depth - a.depth);

      for (const m of markers) {
        // Glow
        const grad = ctx.createRadialGradient(m.sx, m.sy, 0, m.sx, m.sy, m.radius * 2.5);
        grad.addColorStop(0, `rgba(255, 60, 90, ${0.3 * m.pulse})`);
        grad.addColorStop(1, 'rgba(255, 60, 90, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(m.sx, m.sy, m.radius * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(m.sx, m.sy, m.radius * (0.6 + 0.4 * m.pulse), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 50, 80, ${0.6 + 0.4 * m.pulse})`;
        ctx.fill();

        // Ring
        ctx.strokeStyle = `rgba(255, 120, 150, ${0.4 + 0.3 * m.pulse})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    /** Small axis labels. */
    function drawAxisLabels(
      ctx: CanvasRenderingContext2D,
      cx: number, cy: number,
      scale: number, rotRad: number,
    ) {
      if (!grid) return;
      const labelDist = 1.15;
      const labels = [
        { nx: 1, ny: 0, nz: 0, text: 'X', color: 'rgba(255,100,100,0.5)' },
        { nx: 0, ny: 0.9, nz: 0, text: 'Z', color: 'rgba(100,180,255,0.5)' },
        { nx: 0, ny: 0, nz: 1, text: 'Y', color: 'rgba(100,255,100,0.5)' },
      ];
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of labels) {
        const p = project(l.nx * labelDist, l.ny * labelDist, l.nz * labelDist, rotRad);
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, p.sx * scale + cx, p.sy * scale + cy);
      }
    }

    // ── Main animation loop ──
    function animate() {
      animTime = (performance.now() - animStart) / 1000;
      rot = rotationRef.current;
      drawBackground();

      if (viewMode === 'mpr') {
        drawMPRView(animTime);
      } else if (viewMode === 'volume') {
        if (hasSurface && grid && elevation_map.length >= 4) {
          drawVolumeBars(rot, animTime);
        } else {
          drawFallbackHeatmap(animTime);
        }
      } else {
        // 'surface' (default)
        if (hasSurface && grid && elevation_map.length >= 4) {
          drawSurface3D(rot, animTime);
        } else {
          drawFallbackHeatmap(animTime);
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    }

    animate();

    // ── Cleanup ──
    return () => {
      cancelAnimationFrame(rafRef.current);
      _canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      _canvas.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    propWidth,
    propHeight,
    grid,
    elevation_map,
    suspicious_regions,
    viewMode,
    peakPoint,
  ]);

  // ── Render ──
  return (
    <div
      ref={containerRef}
      className={className || ''}
      style={{
        width: propWidth ?? '100%',
        height: propHeight ?? '100%',
        minHeight: 250,
        borderRadius: '12px',
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: '#0a1628',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: 'grab',
        }}
      />

      {/* ── Bottom-right overlay controls ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 6,
          zIndex: 10,
        }}
      >
        {(['surface', 'volume', 'mpr'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            title={`Switch to ${mode} view`}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: viewMode === mode ? 700 : 400,
              background:
                viewMode === mode
                  ? 'rgba(68, 136, 255, 0.7)'
                  : 'rgba(20, 20, 40, 0.7)',
              color: viewMode === mode ? '#fff' : '#8899bb',
              border:
                viewMode === mode
                  ? '1px solid rgba(68, 136, 255, 0.9)'
                  : '1px solid rgba(68, 68, 120, 0.5)',
              borderRadius: 4,
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              textTransform: 'capitalize',
              letterSpacing: 0.5,
              transition: 'all 0.15s ease',
              userSelect: 'none',
            }}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* ── View mode indicator (top-left) ── */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 10,
          fontSize: 10,
          fontFamily: 'monospace',
          color: 'rgba(150, 170, 220, 0.5)',
          letterSpacing: 1,
          textTransform: 'uppercase',
          zIndex: 10,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {viewMode} view
      </div>
    </div>
  );
}

export default Heatmap3D;
