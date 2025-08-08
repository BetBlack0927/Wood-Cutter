// Optimized packing using MaxRects (Best Short Side Fit) with rotation support
// Drop-in replacement for the old guillotine-based packer. Keeps the same public API
// - processInput()
// - parseInput()
// - displayResults()
// - addPrintButton()
// and exports packSheetsGuillotine() (now a shim to the new MaxRects packer).

const config = {
  sheetWidth: 48,
  sheetHeight: 96,
  efficientDims: [47.875, 48, 96],
  kerf: 0 // saw blade thickness in inches (0 keeps legacy behavior)
};

function processInput() {
  const conservative = document.getElementById('conservativeToggle')?.checked;
  try {
    const input = document.getElementById('bulkInput').value;
    const pieces = parseInput(input);

    const tooBig = pieces
      .filter(p =>
        (p.width > config.sheetWidth && p.height > config.sheetHeight &&
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

function parseInput(text) {
  return text.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const [left, right] = line.split('=').map(s => s.trim());
      const dimPart = left.replace(/["']/g, '').toLowerCase();
      const [widthStr, heightStr] = dimPart.split(/x/);

      return {
        originalWidth: widthStr.trim(),
        originalHeight: heightStr.trim(),
        width: parseFraction(widthStr),
        height: parseFraction(heightStr),
        qty: parseInt((right?.match(/(\d+)PCS/i) || [])[1] || 0),
        edges: (right?.match(/(\d+)(L|S)/gi) || []).reduce((a, m) => a + parseInt(m), 0)
      };
    });
}

function parseFraction(str) {
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

// -------------------- MaxRects core --------------------
class MaxRectsBin {
  constructor(width, height, kerf = 0) {
    this.binWidth = width;
    this.binHeight = height;
    this.kerf = kerf;
    this.freeRects = [{ x: 0, y: 0, width, height }];
    this.usedRects = [];
  }

  _fits(w, h, rect) {
    return w <= rect.width && h <= rect.height;
  }

  insert(width, height, allowRotate = true) {
    // Best Short Side Fit
    let bestNode = null;
    let bestShortSide = Infinity;
    let bestLongSide = Infinity;
    let rotated = false;

    for (const rect of this.freeRects) {
      // try without rotation
      if (this._fits(width + this.kerf, height + this.kerf, rect)) {
        const leftoverHoriz = Math.abs(rect.width - (width + this.kerf));
        const leftoverVert = Math.abs(rect.height - (height + this.kerf));
        const shortSide = Math.min(leftoverHoriz, leftoverVert);
        const longSide = Math.max(leftoverHoriz, leftoverVert);
        if (shortSide < bestShortSide || (shortSide === bestShortSide && longSide < bestLongSide)) {
          bestNode = { x: rect.x, y: rect.y, width, height };
          bestShortSide = shortSide;
          bestLongSide = longSide;
          rotated = false;
        }
      }
      // try rotation
      if (allowRotate && this._fits(height + this.kerf, width + this.kerf, rect)) {
        const leftoverHoriz = Math.abs(rect.width - (height + this.kerf));
        const leftoverVert = Math.abs(rect.height - (width + this.kerf));
        const shortSide = Math.min(leftoverHoriz, leftoverVert);
        const longSide = Math.max(leftoverHoriz, leftoverVert);
        if (shortSide < bestShortSide || (shortSide === bestShortSide && longSide < bestLongSide)) {
          bestNode = { x: rect.x, y: rect.y, width: height, height: width };
          bestShortSide = shortSide;
          bestLongSide = longSide;
          rotated = true;
        }
      }
    }

    if (!bestNode) return null;

    this._place(bestNode);
    return { ...bestNode, rotated };
  }

  _place(node) {
    const newUsed = { ...node };
    // grow by kerf in free space consumption, not in stored used rect
    const consume = { x: node.x, y: node.y, width: node.width + this.kerf, height: node.height + this.kerf };

    const newFree = [];
    for (const rect of this.freeRects) {
      if (!this._overlaps(consume, rect)) {
        newFree.push(rect);
        continue;
      }
      // split rect into up to 4 sub-rectangles around the placed node
      this._splitFreeNode(rect, consume, newFree);
    }
    this.freeRects = newFree;
    this._pruneFreeList();

    this.usedRects.push(newUsed);
  }

  _overlaps(a, b) {
    return !(a.x + a.width <= b.x || a.x >= b.x + b.width || a.y + a.height <= b.y || a.y >= b.y + b.height);
  }

  _splitFreeNode(free, used, out) {
    // Above
    if (used.y > free.y && used.y < free.y + free.height) {
      out.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
    }
    // Below
    if (used.y + used.height < free.y + free.height) {
      out.push({ x: free.x, y: used.y + used.height, width: free.width, height: (free.y + free.height) - (used.y + used.height) });
    }
    // Left
    if (used.x > free.x && used.x < free.x + free.width) {
      out.push({ x: free.x, y: Math.max(free.y, used.y), width: used.x - free.x, height: Math.min(free.y + free.height, used.y + used.height) - Math.max(free.y, used.y) });
    }
    // Right
    if (used.x + used.width < free.x + free.width) {
      out.push({ x: used.x + used.width, y: Math.max(free.y, used.y), width: (free.x + free.width) - (used.x + used.width), height: Math.min(free.y + free.height, used.y + used.height) - Math.max(free.y, used.y) });
    }
  }

  _pruneFreeList() {
    // Remove contained rectangles
    for (let i = 0; i < this.freeRects.length; i++) {
      for (let j = i + 1; j < this.freeRects.length; j++) {
        const a = this.freeRects[i];
        const b = this.freeRects[j];
        if (this._containedIn(a, b)) { this.freeRects.splice(i, 1); i--; break; }
        if (this._containedIn(b, a)) { this.freeRects.splice(j, 1); j--; }
      }
    }
  }

  _containedIn(a, b) {
    return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  }
}

// -------------------- Packing orchestrator --------------------
function packSheetsGuillotine(pieces, conservativeMode = true) {
  // New strategy: MaxRects + Best Short Side Fit + rotation; we keep name for backward compatibility
  const warnings = [];
  const visuals = [];
  const sheets = [];

  // Deep copy and explode quantities to individual items for tighter packing order
  const items = [];
  pieces.forEach(p => {
    for (let i = 0; i < p.qty; i++) {
      items.push({ ...p });
    }
  });

  // Sort by max dimension, then area (descending); helps narrow tall strips first
  items.sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || (b.width * b.height) - (a.width * a.height));

  let idx = 0;
  while (idx < items.length) {
    const bin = new MaxRectsBin(config.sheetWidth, config.sheetHeight, config.kerf);
    const placed = []; // {x,y,width,height,label,colorKey,piece,rotated}

    // Simple conservative limiter: cap unique dims or total pieces per sheet if toggle is on
    const distinctDims = new Set();

    for (let j = idx; j < items.length; j++) {
      const p = items[j];

      // Optional: enforce conservative limits
      if (conservativeMode) {
        const key1 = `${p.originalWidth}×${p.originalHeight}`;
        const key2 = `${p.originalHeight}×${p.originalWidth}`;
        if (distinctDims.size >= 6 && !distinctDims.has(key1) && !distinctDims.has(key2)) continue; // don't introduce too many unique cuts per sheet
      }

      const node = bin.insert(p.width, p.height, true);
      if (node) {
        placed.push({
          x: node.x, y: node.y, width: node.width, height: node.height,
          label: `1PCS ${node.width.toFixed(3).replace(/\.000$/, '')}×${node.height.toFixed(3).replace(/\.000$/, '')}`,
          colorKey: `${p.originalWidth}x${p.originalHeight}`,
          piece: p,
          rotated: !(Math.abs(node.width - p.width) < 1e-4 && Math.abs(node.height - p.height) < 1e-4)
        });
        distinctDims.add(`${p.originalWidth}×${p.originalHeight}`);
        // mark consumed by swapping with idx and advancing idx (in-place remove)
        [items[j], items[idx]] = [items[idx], items[j]];
        idx++;
      }
    }

    if (placed.length === 0) {
      warnings.push("⚠️ Some pieces could not be placed. Check for tight tolerances or odd sizes.");
      break;
    }

    // Aggregate per-sheet metrics
    const pieceMap = new Map();
    placed.forEach(pl => {
      const key = `${pl.piece.originalWidth}×${pl.piece.originalHeight}×${pl.rotated ? 'R' : 'N'}`;
      const rec = pieceMap.get(key) || { piece: pl.piece, rotated: pl.rotated, count: 0 };
      rec.count += 1;
      pieceMap.set(key, rec);
    });

    const sheetPieces = Array.from(pieceMap.values());

    const cuts = sheetPieces.reduce((acc, rec) => acc + (isEfficient(rec.piece) ? rec.count : rec.count * 2), 0);
    const edges = sheetPieces.reduce((acc, rec) => acc + (rec.piece.edges || 0) * rec.count, 0);

    sheets.push({ pieces: sheetPieces, cuts, edges });

    // Build visuals compatible with the old renderer
    const vis = placed.map(pl => ({
      x: pl.x, y: pl.y, width: pl.width, height: pl.height,
      label: `1PCS ${pl.piece.originalWidth}×${pl.piece.originalHeight}`,
      colorKey: `${pl.piece.originalWidth}x${pl.piece.originalHeight}`
    }));
    visuals.push(vis);

    // Stop infinite loops if something weird happens
    if (sheets.length > 200) { warnings.push('⚠️ Aborting: too many sheets generated.'); break; }
  }

  return { sheets, warnings, visuals };
}

// -------------------- UI rendering (unchanged) --------------------
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
              <span class="${isEfficient(p.piece) ? 'efficient' : 'inefficient'}">
                (${isEfficient(p.piece) ? '1-cut' : '2-cut'})
              </span>`;
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
    canvas.width = 300;
    canvas.height = 600;
    canvas.style.border = '1px solid #ccc';
    canvas.style.marginBottom = '10px';
    canvas.title = 'Hover over pieces to see their size';
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const colorMap = {};
    const colorPalette = [
      '#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c',
      '#34495e', '#e67e22', '#7f8c8d', '#d35400', '#16a085', '#2980b9'
    ];
    let colorIndex = 0;

    vis.forEach(box => {
      const scaleX = canvas.width / config.sheetWidth;
      const scaleY = canvas.height / config.sheetHeight;
      const x = box.x * scaleX;
      const y = box.y * scaleY;
      const w = box.width * scaleX;
      const h = box.height * scaleY;

      if (!colorMap[box.colorKey]) {
        colorMap[box.colorKey] = colorPalette[colorIndex % colorPalette.length];
        colorIndex++;
      }

      ctx.fillStyle = colorMap[box.colorKey];
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = '#000';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(box.label, x + 4, y + 12);

      canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const hover = vis.find(b => {
          const sx = b.x * scaleX;
          const sy = b.y * scaleY;
          const sw = b.width * scaleX;
          const sh = b.height * scaleY;
          return mx >= sx && mx <= sx + sw && my >= sy && my <= sy + sh;
        });
        canvas.title = hover ? hover.label + ` (${hover.width}\" × ${hover.height}\")` : 'Hover over pieces to see their size';
      });
    });

    const container = document.createElement('div');
    container.style.flex = '1 1 45%';
    container.style.minWidth = '300px';
    container.innerHTML = `<h4>Sheet ${index + 1} Layout:</h4>`;
    container.appendChild(canvas);
    visualWrapper.appendChild(container);
  });

  detailsDiv.appendChild(document.createElement('hr'));
  detailsDiv.appendChild(visualWrapper);
}

function addPrintButton(visuals) {
  const existing = document.getElementById('printBtn');
  if (existing) existing.remove();
  const btn = document.createElement('button');
  btn.id = 'printBtn';
  btn.textContent = 'Print Layout';
  btn.style.margin = '10px 0';
  btn.onclick = () => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write('<html><head><title>Print Layout</title></head><body style="font-family:sans-serif;">');
    printWindow.document.write('<h2>Wood Cut Sheet Layout</h2>');
    const table = document.querySelector('.cut-table');
    let tableHTML = '';
    if (table) {
      tableHTML = '<table style="border-collapse: collapse; width: 100%; font-family: sans-serif;">' +
        table.innerHTML.replace(/<th>/g, '<th style="background:#f2f2f2; padding: 8px; border: 1px solid #ccc; text-align: left;">')
                        .replace(/<td>/g, '<td style="padding: 6px; border: 1px solid #ddd; vertical-align: top;">') +
        '</table>';
    }
    if (tableHTML) {
      printWindow.document.write('<div style="margin-bottom:20px;">' + tableHTML + '</div>');
    }
    visuals.forEach((vis, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = 350;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scaleX = canvas.width / config.sheetWidth;
      const scaleY = canvas.height / config.sheetHeight;
      const colorMap = {};
      const colorPalette = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#34495e','#e67e22'];
      let colorIndex = 0;
      vis.forEach(box => {
        if (!colorMap[box.colorKey]) {
          colorMap[box.colorKey] = colorPalette[colorIndex % colorPalette.length];
          colorIndex++;
        }
        const x = box.x * scaleX;
        const y = box.y * scaleY;
        const w = box.width * scaleX;
        const h = box.height * scaleY;
        ctx.fillStyle = colorMap[box.colorKey];
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = '#000';
        ctx.font = '9px sans-serif';
        ctx.fillText(box.label, x + 2, y + 10);
      });
      const imgURL = canvas.toDataURL();
      printWindow.document.write(`<div style="display:inline-block; width:48%; margin:5px; border:1px solid #999; padding:10px;"><h4>Sheet ${i + 1}</h4><img src="${imgURL}" style="width:100%; border:1px solid #ccc;"></div>`);
    });
    printWindow.document.write('<hr style="margin:20px 0; border-top: 2px dashed #ccc;">');
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
  };
  document.getElementById('cutDetails').prepend(btn);
}
