const config = {
  sheetWidth: 48,
  sheetHeight: 96,
  efficientDims: [47.875, 48, 96]
};

function processInput() {
  const conservative = document.getElementById('conservativeToggle')?.checked;
  try {
    const input = document.getElementById('bulkInput').value;
    const pieces = parseInput(input);

    const errors = pieces
      .filter(p => (p.width > config.sheetWidth && p.height > config.sheetHeight &&
                    p.width > config.sheetHeight && p.height > config.sheetWidth))
      .map(p => `${p.originalWidth}" x ${p.originalHeight}" (${p.qty} PCS)`);

    const validPieces = pieces.filter(p => !errors.includes(`${p.originalWidth}" x ${p.originalHeight}" (${p.qty} PCS)`));
    const { sheets, warnings, visuals } = packSheets(validPieces, conservative);
    displayResults(sheets, [...errors, ...warnings], visuals);

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
      const dimPart = left.replace(/"/g, '').toLowerCase();
      const [widthStr, heightStr] = dimPart.split(/x/);

      return {
        originalWidth: widthStr.trim(),
        originalHeight: heightStr.trim(),
        width: parseFraction(widthStr),
        height: parseFraction(heightStr),
        qty: parseInt((right.match(/(\d+)PCS/i) || [])[1] || 0),
        edges: (right.match(/(\d+)(L|S)/gi) || []).reduce((a, m) => a + parseInt(m), 0)
      };
    });
}

function parseFraction(str) {
  return str.split(/[- ]/).reduce((total, part) => {
    if (part.includes('/')) {
      const [n, d] = part.split('/');
      return total + (parseFloat(n) / parseFloat(d));
    }
    return total + (parseFloat(part) || 0);
  }, 0);
}

function isEfficient(piece) {
  return config.efficientDims.some(dim =>
    Math.abs(piece.width - dim) < 0.01 ||
    Math.abs(piece.height - dim) < 0.01
  );
}

function packSheets(pieces, conservativeMode = true) {
  const sheets = [];
  const visuals = [];
  const warnings = [];
  const remaining = JSON.parse(JSON.stringify(pieces)).filter(p => p.qty > 0);

  while (remaining.some(p => p.qty > 0)) {
    const sheet = {
      pieces: [],
      cuts: 0,
      edges: 0
    };
    const visual = [];
    const placedRects = [];

    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      if (p.qty <= 0) continue;

      for (const rotated of [false, true]) {
        const pw = rotated ? p.height : p.width;
        const ph = rotated ? p.width : p.height;

        while (p.qty > 0) {
          const pos = findFreeSpot(placedRects, pw, ph);
          if (!pos) break;

          placedRects.push({ x: pos.x, y: pos.y, width: pw, height: ph });

          visual.push({
            x: pos.x,
            y: pos.y,
            width: pw,
            height: ph,
            label: `1PCS ${rotated ? p.originalHeight + '×' + p.originalWidth : p.originalWidth + '×' + p.originalHeight}`,
            colorKey: `${p.originalWidth}x${p.originalHeight}`
          });

          sheet.pieces.push({ piece: p, count: 1, rotated });
          sheet.cuts += isEfficient(p) ? 1 : 2;
          sheet.edges += p.edges;
          p.qty--;
        }
        if (p.qty === 0) break;
      }
    }

    if (sheet.pieces.length > 0) {
      sheets.push(sheet);
      visuals.push(visual);
    } else {
      warnings.push("⚠️ Some pieces could not be placed. Check for tight tolerances or odd sizes.");
      break;
    }
  }

  if (conservativeMode && sheets.length > 0) {
    const lastSheet = sheets[sheets.length - 1];
    const hasShortPiece = lastSheet.pieces.some(p => {
      const height = p.rotated ? p.piece.width : p.piece.height;
      return height < config.sheetHeight;
    });
    if (lastSheet.pieces.length <= 2 && hasShortPiece) {
      warnings.push("⚠️ Conservative Mode: 1 extra sheet may be used for easier workflow.");
      sheets.push({ pieces: [], cuts: 0, edges: 0 });
      visuals.push([]);
    }
  }
  return { sheets, warnings, visuals };
}

function findFreeSpot(placed, pw, ph) {
  for (let y = 0; y <= config.sheetHeight - ph; y++) {
    for (let x = 0; x <= config.sheetWidth - pw; x++) {
      const overlap = placed.some(rect =>
        !(x + pw <= rect.x || x >= rect.x + rect.width ||
          y + ph <= rect.y || y >= rect.y + rect.height)
      );
      if (!overlap) return { x, y };
    }
  }
  return null;
}

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
              ? `${p.piece.originalHeight}"×${p.piece.originalWidth}"`
              : `${p.piece.originalWidth}"×${p.piece.originalHeight}"`;
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

      ctx.fillStyle = '#ffffff';
      ctx.font = '10px Arial';
      ctx.fillStyle = '#000';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(box.label, x + 4, y + 12);

      // Tooltip on hover
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
        canvas.title = hover ? hover.label + ` (${hover.width}" × ${hover.height}")` : 'Hover over pieces to see their size';
      });
    });

    detailsDiv.appendChild(document.createElement('hr'));
    const label = document.createElement('h4');
    label.textContent = `Sheet ${index + 1} Layout:`;
    detailsDiv.appendChild(label);
    detailsDiv.appendChild(canvas);
  });
}

function clearAll() {
  document.getElementById('bulkInput').value = '';
  document.getElementById('results').innerHTML = '';
  document.getElementById('errors').innerHTML = '';
  document.getElementById('cutDetails').innerHTML = '';
}
