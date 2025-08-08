// Optimized packing with MaxRects + Auto Strip Mode for uniform-width parts
// Drop-in replacement for your old script.js

const config = {
  sheetWidth: 48,
  sheetHeight: 96,
  efficientDims: [47.875, 48, 96],
  kerf: 0,                 // saw blade thickness in inches
  stripModeAuto: true,     // auto-detect uniform-width jobs and pack as columns
  stripWidthTolerance: 1/32 // treat widths within this tolerance as equal
};

// -------------------- App entry --------------------
function processInput() {
  const conservative = document.getElementById('conservativeToggle')?.checked;
  try {
    const input = document.getElementById('bulkInput').value;
    const pieces = parseInput(input);

    const tooBig = pieces
      .filter(p => (p.width > config.sheetWidth && p.height > config.sheetHeight &&
                    p.width > config.sheetHeight && p.height > config.sheetWidth))
      .map(p => `${p.originalWidth}" x ${p.originalHeight}" (${p.qty} PCS)`);

    const validPieces = pieces.filter(p => !tooBig.includes(`${p.originalWidth}" x ${p.originalHeight}" (${p.qty} PCS)`));

    const { sheets, warnings, visuals } = packSheetsGuillotine(validPieces, conservative);
    displayResults(sheets, [...tooBig, ...warnings], visuals);
    addPrintButton(visuals);

  } catch (error) {
    console.error("Calculation error:", error);
    document.getElementById('errors').innerHTML =
      `<div class="error">⚠️ Calculation failed: ${error.message}</div>`;
  }
}

// -------------------- Parsing --------------------
function parseInput(text) {
  return text.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const [left, right] = line.split('=');
      if (!right) return { originalWidth: '0', originalHeight: '0', width: 0, height: 0, qty: 0, edges: 0 };
      const dimPart = left.replace(/["']/g, '').toLowerCase();
      const [widthStr, heightStr] = dimPart.split(/x/);

      return {
        originalWidth: widthStr?.trim() ?? '0',
        originalHeight: heightStr?.trim() ?? '0',
        width: parseFraction(widthStr ?? '0'),
        height: parseFraction(heightStr ?? '0'),
        qty: parseInt((right.match(/(\d+)\s*PCS/i) || [])[1] || 0),
        edges: (right.match(/(\d+)\s*(L|S)/gi) || []).reduce((a, m) => a + parseInt(m), 0)
      };
    });
}

function parseFraction(str) {
  if (!str) return 0;
  return str.split(/[- ]/).reduce((total, part) => {
    if (part.includes('/')) {
      const [n, d] = part.split('/');
      const num = parseFloat(n);
      const den = parseFloat(d);
      if (!isNaN(num) && !isNaN(den) && den !== 0) return total + (num / den);
      return total;
    }
    const val = parseFloat(part);
    return total + (isNaN(val) ? 0 : val);
  }, 0);
}

function isEfficient(piece) {
  return config.efficientDims.some(dim =>
    Math.abs(piece.width - dim) < 0.01 ||
    Math.abs(piece.height - dim) < 0.01
  );
}

// -------------------- Strip mode (uniform width) --------------------
function detectCommonWidth(pieces) {
  // Flatten quantities and compute most common width within tolerance
  const counts = new Map();
  let totalQty = 0;
  for (const p of pieces) {
    totalQty += p.qty;
    const rounded = Math.round(p.width / config.stripWidthTolerance) * config.stripWidthTolerance;
    const key = rounded.toFixed(4);
    counts.set(key, (counts.get(key) || 0) + p.qty);
  }
  let bestKey = null, bestCount = 0;
  for (const [k, c] of counts) { if (c > bestCount) { bestKey = k; bestCount = c; } }
  const ratio = totalQty === 0 ? 0 : bestCount / totalQty;
  const commonWidth = bestKey ? parseFloat(bestKey) : null;
  return { commonWidth, ratio };
}

function packSheetsStripMode(pieces, conservativeMode = true) {
  // Only pack items whose width ~ commonWidth; others returned for fallback
  const { commonWidth, ratio } = detectCommonWidth(pieces);
  if (!commonWidth) return null;
  const tol = config.stripWidthTolerance + 1e-6;

  const stripItems = [];
  const otherItems = [];
  for (const p of pieces) {
    const isStrip = Math.abs(p.width - commonWidth) <= tol;
    if (isStrip) {
      for (let i = 0; i < p.qty; i++) stripItems.push({ ...p });
    } else {
      otherItems.push({ ...p });
    }
  }

  // Only trigger strip mode if it will materially help
  if (!config.stripModeAuto || stripItems.length === 0 || ratio < 0.7) return null;

  // How many columns per sheet can we fit?
  const perCol = commonWidth + (config.kerf || 0);
  let columnsPerSheet = Math.max(1, Math.floor((config.sheetWidth + (config.kerf || 0)) / perCol));
  // Safety for tiny floating errors
  while (columnsPerSheet * commonWidth > config.sheetWidth + 1e-6 && columnsPerSheet > 1) columnsPerSheet--;

  // Sort by height descending (treat as strips)
  stripItems.sort((a, b) => b.height - a.height);

  const sheets = [];
  const visuals = [];
  let i = 0;

  while (i < stripItems.length) {
    // Build columns for this sheet
    const columns = Array.from({ length: columnsPerSheet }, () => ({ used: 0, parts: [] }));

    // First-fit decreasing per column
    for (let j = i; j < stripItems.length; j++) {
      const item = stripItems[j];
      let placed = false;
      for (const col of columns) {
        if (col.used + item.height + (col.parts.length ? (config.kerf || 0) : 0) <= config.sheetHeight + 1e-6) {
          const y = col.used + (col.parts.length ? (config.kerf || 0) : 0);
          col.parts.push({ item, x: 0, y, width: commonWidth, height: item.height });
          col.used = y + item.height;
          // consume this element
          [stripItems[j], stripItems[i]] = [stripItems[i], stripItems[j]];
          i++;
          placed = true;
          break;
        }
      }
      if (i >= stripItems.length) break;
      // if not placed, continue to next j (may fit in later columns in same pass)
    }

    // If nothing placed (very tall single piece), bail to avoid infinite loop
    const placedCount = columns.reduce((a, c) => a + c.parts.length, 0);
    if (placedCount === 0) break;

    // Compute per-sheet aggregates and visuals
    const sheetPiecesMap = new Map();
    const vis = [];
    columns.forEach((col, colIdx) => {
      const xOffset = colIdx * commonWidth; // kerf isn't drawn; it's consumed in spacing
      col.parts.forEach(p => {
        vis.push({ x: xOffset, y: p.y, width: p.width, height: p.height, label: `1PCS ${p.item.originalWidth}×${p.item.originalHeight}`, colorKey: `${p.item.originalWidth}x${p.item.originalHeight}` });
        const key = `${p.item.originalWidth}×${p.item.originalHeight}`;
        const rec = sheetPiecesMap.get(key) || { piece: p.item, rotated: false, count: 0 };
        rec.count += 1;
        sheetPiecesMap.set(key, rec);
      });
    });

    const sheetPieces = Array.from(sheetPiecesMap.values());
    const cuts = sheetPieces.reduce((acc, rec) => acc + (isEfficient(rec.piece) ? rec.count : rec.count * 2), 0);
    const edges = sheetPieces.reduce((acc, rec) => acc + (rec.piece.edges || 0) * rec.count, 0);
    sheets.push({ pieces: sheetPieces, cuts, edges });
    visuals.push(vis);
  }

  // Return whatever wasn't packed so MaxRects can try
  const remaining = [];
  // Add leftover stripItems (if loop broke early)
  for (let k = i; k < stripItems.length; k++) { remaining.push(stripItems[k]); }
  // Add otherItems
  remaining.push(...otherItems);

  return { sheets, visuals, remaining };
}

// -------------------- MaxRects core --------------------
class MaxRectsBin {
  constructor(width, height, kerf = 0) {
    this.binWidth = width;
    this.binHeight = height;
    this.kerf = kerf;
    this.freeRects = [{ x: 0, y: 0, width, height }];
    this.usedRects = [];
  }
  _fits(w, h, rect) { return w <= rect.width && h <= rect.height; }
  insert(width, height, allowRotate = true) {
    let bestNode = null; let bestShortSide = Infinity; let bestLongSide = Infinity; let rotated = false;
    for (const rect of this.freeRects) {
      if (this._fits(width + this.kerf, height + this.kerf, rect)) {
        const leftoverHoriz = Math.abs(rect.width - (width + this.kerf));
        const leftoverVert = Math.abs(rect.height - (height + this.kerf));
        const shortSide = Math.min(leftoverHoriz, leftoverVert);
        const longSide = Math.max(leftoverHoriz, leftoverVert);
        if (shortSide < bestShortSide || (shortSide === bestShortSide && longSide < bestLongSide)) {
          bestNode = { x: rect.x, y: rect.y, width, height }; rotated = false; bestShortSide = shortSide; bestLongSide = longSide;
        }
      }
      if (allowRotate && this._fits(height + this.kerf, width + this.kerf, rect)) {
        const leftoverHoriz = Math.abs(rect.width - (height + this.kerf));
        const leftoverVert = Math.abs(rect.height - (width + this.kerf));
        const shortSide = Math.min(leftoverHoriz, leftoverVert);
        const longSide = Math.max(leftoverHoriz, leftoverVert);
        if (shortSide < bestShortSide || (shortSide === bestShortSide && longSide < bestLongSide)) {
          bestNode = { x: rect.x, y: rect.y, width: height, height: width }; rotated = true; bestShortSide = shortSide; bestLongSide = longSide;
        }
      }
    }
    if (!bestNode) return null;
    this._place(bestNode);
    return { ...bestNode, rotated };
  }
  _place(node) {
    const consume = { x: node.x, y: node.y, width: node.width + this.kerf, height: node.height + this.kerf };
    const newFree = [];
    for (const rect of this.freeRects) {
      if (!this._overlaps(consume, rect)) { newFree.push(rect); continue; }
      this._splitFreeNode(rect, consume, newFree);
    }
    this.freeRects = newFree; this._pruneFreeList(); this.usedRects.push({ ...node });
  }
  _overlaps(a, b) { return !(a.x + a.width <= b.x || a.x >= b.x + b.width || a.y + a.height <= b.y || a.y >= b.y + b.height); }
  _splitFreeNode(free, used, out) {
    if (used.y > free.y && used.y < free.y + free.height) out.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
    if (used.y + used.height < free.y + free.height) out.push({ x: free.x, y: used.y + used.height, width: free.width, height: (free.y + free.height) - (used.y + used.height) });
    if (used.x > free.x && used.x < free.x + free.width) out.push({ x: free.x, y: Math.max(free.y, used.y), width: used.x - free.x, height: Math.min(free.y + free.height, used.y + used.height) - Math.max(free.y, used.y) });
    if (used.x + used.width < free.x + free.width) out.push({ x: used.x + used.width, y: Math.max(free.y, used.y), width: (free.x + free.width) - (used.x + used.width), height: Math.min(free.y + free.height, used.y + used.height) - Math.max(free.y, used.y) });
  }
  _pruneFreeList() {
    for (let i = 0; i < this.freeRects.length; i++) {
      for (let j = i + 1; j < this.freeRects.length; j++) {
        const a = this.freeRects[i], b = this.freeRects[j];
        if (this._containedIn(a, b)) { this.freeRects.splice(i, 1); i--; break; }
        if (this._containedIn(b, a)) { this.freeRects.splice(j, 1); j--; }
      }
    }
  }
  _containedIn(a, b) { return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height; }
}

// -------------------- Orchestrator --------------------
function packSheetsGuillotine(pieces, conservativeMode = true) {
  const warnings = [];
  const visuals = [];
  const sheets = [];

  // Try strip mode first if applicable
  const stripResult = packSheetsStripMode(pieces, conservativeMode);
  let remaining = [];
  if (stripResult) {
    if (stripResult.sheets.length) {
      sheets.push(...stripResult.sheets);
      visuals.push(...stripResult.visuals);
    }
    remaining = stripResult.remaining;
  } else {
    // explode quantities if strip mode not used at all
    remaining = [];
    pieces.forEach(p => { for (let i = 0; i < p.qty; i++) remaining.push({ ...p }); });
  }

  // MaxRects on the rest
  if (remaining.length) {
    // Sort by max dimension, then area (descending)
    remaining.sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || (b.width * b.height) - (a.width * a.height));

    let idx = 0;
    while (idx < remaining.length) {
      const bin = new MaxRectsBin(config.sheetWidth, config.sheetHeight, config.kerf);
      const placed = [];
      const distinctDims = new Set();

      for (let j = idx; j < remaining.length; j++) {
        const p = remaining[j];
        if (conservativeMode) {
          const key1 = `${p.originalWidth}×${p.originalHeight}`;
          const key2 = `${p.originalHeight}×${p.originalWidth}`;
          if (distinctDims.size >= 6 && !distinctDims.has(key1) && !distinctDims.has(key2)) continue;
        }
        const node = bin.insert(p.width, p.height, true);
        if (node) {
          placed.push({ x: node.x, y: node.y, width: node.width, height: node.height, label: `1PCS ${p.originalWidth}×${p.originalHeight}`, colorKey: `${p.originalWidth}x${p.originalHeight}`, piece: p, rotated: !(Math.abs(node.width - p.width) < 1e-4 && Math.abs(node.height - p.height) < 1e-4) });
          distinctDims.add(`${p.originalWidth}×${p.originalHeight}`);
          [remaining[j], remaining[idx]] = [remaining[idx], remaining[j]];
          idx++;
        }
      }

      if (placed.length === 0) { warnings.push("⚠️ Some pieces could not be placed. Check for tight tolerances or odd sizes."); break; }

      const pieceMap = new Map();
      placed.forEach(pl => {
        const key = `${pl.piece.originalWidth}×${pl.piece.originalHeight}×${pl.rotated ? 'R' : 'N'}`;
        const rec = pieceMap.get(key) || { piece: pl.piece, rotated: pl.rotated, count: 0 };
        rec.count += 1; pieceMap.set(key, rec);
      });
      const sheetPieces = Array.from(pieceMap.values());
      const cuts = sheetPieces.reduce((acc, rec) => acc + (isEfficient(rec.piece) ? rec.count : rec.count * 2), 0);
      const edges = sheetPieces.reduce((acc, rec) => acc + (rec.piece.edges || 0) * rec.count, 0);
      sheets.push({ pieces: sheetPieces, cuts, edges });
      const vis = placed.map(pl => ({ x: pl.x, y: pl.y, width: pl.width, height: pl.height, label: `1PCS ${pl.piece.originalWidth}×${pl.piece.originalHeight}`, colorKey: `${pl.piece.originalWidth}x${pl.piece.originalHeight}` }));
      visuals.push(vis);

      if (sheets.length > 200) { warnings.push('⚠️ Aborting: too many sheets generated.'); break; }
    }
  }

  return { sheets, warnings, visuals };
}

// -------------------- Rendering (unchanged) --------------------
function displayResults(sheets, errors, visuals) {
  const resultsDiv = document.getElementById('results');
  const errorsDiv = document.getElementById('errors');
  const detailsDiv = document.getElementById('cutDetails');

  resultsDiv.innerHTML = '';
  errorsDiv.innerHTML = '';
  detailsDiv.innerHTML = '';

  resultsDiv.innerHTML = `
    <div class="result-item">Total Sheets Needed: <strong>${sheets.length}</strong></div>
    <div class="result-item">Total Cuts: <strong>${sheets.reduce((a, s) => a + s.cuts, 0)}</strong></div>
    <div class="result-item">Total Edges: <strong>${sheets.reduce((a, s) => a + s.edges, 0)}</strong></div>
  `;

  if (errors.length > 0) {
    errorsDiv.innerHTML = `
      <div class="error">⚠️ Issues Found:
        <ul>${errors.map(p => `<li>${p}</li>`).join('')}</ul>
      </div>
    `;
  }

  let tableHTML = `
    <table class="cut-table" style="border-collapse: collapse; width: 100%; font-family: sans-serif;">
      <tr>
        <th style="background:#f2f2f2; padding: 8px; border: 1px solid #ccc; text-align: left;">Sheet</th>
        <th>Pieces</th>
        <th>Cuts</th>
        <th>Edges</th>
      </tr>
  `;

  sheets.forEach((sheet, index) => {
    tableHTML += `
      <tr>
        <td style="padding: 6px; border: 1px solid #ddd; vertical-align: top;">Sheet ${index + 1}</td>
        <td>
          ${sheet.pieces.map(p => {
            const dims = p.rotated
              ? `${p.piece.originalHeight}\"×${p.piece.originalWidth}\"`
              : `${p.piece.originalWidth}\"×${p.piece.originalHeight}\"`;
            const edgeStr = p.piece.edges > 0 ? ` ${p.piece.edges} EDGE` : '';
            return `${p.count}PCS ${dims}${edgeStr}
              <span class="${isEfficient(p.piece) ? 'efficient' : 'inefficient'}">(${isEfficient(p.piece) ? '1-cut' : '2-cut'})</span>`;
          }).join('<br>')}
        </td>
        <td>${sheet.cuts}</td>
        <td>${sheet.edges}</td>
      </tr>
    `;
  });
  tableHTML += '</table>';
  detailsDiv.innerHTML = `<h3>Cutting Plan</h3>${tableHTML}`;

  const visualWrapper = document.createElement('div');
  visualWrapper.style.display = 'flex';
  visualWrapper.style.flexWrap = 'wrap';
  visualWrapper.style.gap = '16px';

  visuals.forEach((vis, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 600;
    canvas.style.border = '1px solid #ccc';
    canvas.style.marginBottom = '10px';
    canvas.title = 'Hover over pieces to see their size';
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const colorMap = {}; const colorPalette = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#34495e','#e67e22','#7f8c8d','#d35400','#16a085','#2980b9'];
    let colorIndex = 0;

    vis.forEach(box => {
      const scaleX = canvas.width / config.sheetWidth;
      const scaleY = canvas.height / config.sheetHeight;
      const x = box.x * scaleX; const y = box.y * scaleY; const w = box.width * scaleX; const h = box.height * scaleY;
      if (!colorMap[box.colorKey]) { colorMap[box.colorKey] = colorPalette[colorIndex % colorPalette.length]; colorIndex++; }
      ctx.fillStyle = colorMap[box.colorKey]; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#000'; ctx.font = 'bold 9px sans-serif'; ctx.fillText(box.label, x + 4, y + 12);
      canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
        const hover = vis.find(b => { const sx = b.x * scaleX; const sy = b.y * scaleY; const sw = b.width * scaleX; const sh = b.height * scaleY; return mx >= sx && mx <= sx + sw && my >= sy && my <= sy + sh; });
        canvas.title = hover ? hover.label + ` (${hover.width}\" × ${hover.height}\")` : 'Hover over pieces to see their size';
      });
    });

    const container = document.createElement('div');
    container.style.flex = '1 1 45%';
    container.style.minWidth = '300px';
    container.className = 'canvas-card';
    container.innerHTML = `<h4>Sheet ${index + 1} Layout:</h4>`;
    container.appendChild(canvas);
    visualWrapper.appendChild(container);
  });

  detailsDiv.appendChild(document.createElement('hr'));
  detailsDiv.appendChild(visualWrapper);
}

function addPrintButton(visuals) {
  const existing = document.getElementById('printBtn'); if (existing) existing.remove();
  const btn = document.createElement('button');
  btn.id = 'printBtn'; btn.textContent = 'Print Layout'; btn.style.margin = '10px 0';
  btn.onclick = () => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write('<html><head><title>Print Layout</title></head><body style="font-family:sans-serif;">');
    printWindow.document.write('<h2>Wood Cut Sheet Layout</h2>');
    const table = document.querySelector('.cut-table'); let tableHTML = '';
    if (table) {
      tableHTML = '<table style="border-collapse: collapse; width: 100%; font-family: sans-serif;">' +
        table.innerHTML.replace(/<th>/g, '<th style="background:#f2f2f2; padding: 8px; border: 1px solid #ccc; text-align: left;">').replace(/<td>/g, '<td style="padding: 6px; border: 1px solid #ddd; vertical-align: top;">') + '</table>';
    }
    if (tableHTML) printWindow.document.write('<div style="margin-bottom:20px;">' + tableHTML + '</div>');
    visuals.forEach((vis, i) => {
      const canvas = document.createElement('canvas'); canvas.width = 350; canvas.height = 480; const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scaleX = canvas.width / config.sheetWidth; const scaleY = canvas.height / config.sheetHeight; const colorMap = {}; const colorPalette = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#34495e','#e67e22']; let colorIndex = 0;
      vis.forEach(box => { if (!colorMap[box.colorKey]) { colorMap[box.colorKey] = colorPalette[colorIndex % colorPalette.length]; colorIndex++; }
        const x = box.x * scaleX; const y = box.y * scaleY; const w = box.width * scaleX; const h = box.height * scaleY; ctx.fillStyle = colorMap[box.colorKey]; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h); ctx.fillStyle = '#000'; ctx.font = '9px sans-serif'; ctx.fillText(box.label, x + 2, y + 10); });
      const imgURL = canvas.toDataURL();
      printWindow.document.write(`<div style="display:inline-block; width:48%; margin:5px; border:1px solid #999; padding:10px;"><h4>Sheet ${i + 1}</h4><img src="${imgURL}" style="width:100%; border:1px solid #ccc;"></div>`);
    });
    printWindow.document.write('<hr style="margin:20px 0; border-top: 2px dashed #ccc;">');
    printWindow.document.write('</body></html>');
    printWindow.document.close(); printWindow.focus(); setTimeout(() => printWindow.print(), 500);
  };
  document.getElementById('cutDetails').prepend(btn);
}

// -------------------- Live input validation (from earlier step) --------------------
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("bulkInput");
  input?.addEventListener("input", validateLiveInput);
});

function validateLiveInput() {
  const text = document.getElementById("bulkInput").value;
  const lines = text.split("\n");
  const warnings = [];

  lines.forEach((line, idx) => {
    const lineNum = idx + 1; const trimmed = line.trim(); if (!trimmed) return;
    const parts = trimmed.split("="); if (parts.length < 2) { warnings.push(`Line ${lineNum}: missing '=' sign`); return; }
    const [dim, rest] = parts;
    if (!/\d.*x.*\d/i.test(dim)) warnings.push(`Line ${lineNum}: invalid dimension format`);
    if (!/\d+\s*pcs/i.test(rest)) warnings.push(`Line ${lineNum}: missing PCS (quantity)`);
    const badEdge = rest.match(/(\d+)\s*(edge|edges)/i); if (badEdge) warnings.push(`Line ${lineNum}: malformed edge — use '1L EDGE' or '2S EDGE' instead of '${badEdge[0]}'`);
  });

  const errBox = document.getElementById("liveErrors") || (() => { const box = document.createElement("div"); box.id = "liveErrors"; document.getElementById("bulkInput").insertAdjacentElement("afterend", box); return box; })();
  errBox.innerHTML = warnings.length ? `<ul>${warnings.map(w => `<li>❌ ${w}</li>`).join("")}</ul>` : "";
}
