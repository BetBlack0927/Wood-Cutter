// Guillotine-based wood cut calculator (Accurate full-length cuts, smart fit)
const config = {
  sheetWidth: 48,
  sheetHeight: 96,
  efficientDims: [47.875, 48, 96]
};

function clearAll(){
  const input = document.getElementById('bulkInput').value;
  input.value = "";
}
  

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
    const { sheets, warnings, visuals } = packSheetsGuillotine(validPieces, conservative);
    displayResults(sheets, [...errors, ...warnings], visuals);
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
      const dimPart = left.replace(/['\"]/g, '').toLowerCase(); // Treat ' and " as inches
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

function packSheetsGuillotine(pieces, conservativeMode = true) {
  const sheets = [];
  const visuals = [];
  const warnings = [];
  const remaining = JSON.parse(JSON.stringify(pieces)).filter(p => p.qty > 0);

  remaining.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  while (remaining.some(p => p.qty > 0)) {
    const sheet = { pieces: [], cuts: 0, edges: 0 };
    const visual = [];
    const sheetRects = [{ x: 0, y: 0, width: config.sheetWidth, height: config.sheetHeight }];

    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      if (p.qty <= 0) continue;

      let placed = false;
      for (const rotated of [false, true]) {
        const pw = rotated ? p.height : p.width;
        const ph = rotated ? p.width : p.height;

        let bestFitIndex = -1;
        let minWaste = Infinity;

        for (let r = 0; r < sheetRects.length; r++) {
          const rect = sheetRects[r];
          if (pw <= rect.width && ph <= rect.height) {
            const waste = (rect.width * rect.height) - (pw * ph);
            if (waste < minWaste) {
              minWaste = waste;
              bestFitIndex = r;
            }
          }
        }

        if (bestFitIndex >= 0) {
          const rect = sheetRects[bestFitIndex];
          const pos = { x: rect.x, y: rect.y };

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

          sheetRects.splice(bestFitIndex, 1);
          sheetRects.push({ x: pos.x + pw, y: pos.y, width: rect.width - pw, height: ph });
          sheetRects.push({ x: pos.x, y: pos.y + ph, width: rect.width, height: rect.height - ph });

          placed = true;

          // Conservative mode: limit complexity
          if (conservativeMode) {
            const distinctCuts = new Set(sheet.pieces.map(p => 
              (p.rotated ? p.piece.originalHeight + 'x' + p.piece.originalWidth
                         : p.piece.originalWidth + 'x' + p.piece.originalHeight)
            ));
            const totalPiecesOnSheet = sheet.pieces.reduce((sum, p) => sum + p.count, 0);

            if (distinctCuts.size >= 3 && totalPiecesOnSheet >= 8) {
              i = remaining.length; // Force break outer for loop to finish sheet
              break;
            }
          }

          break;
        }
      }
      if (placed) i = -1; // Restart after placement
    }

    if (sheet.pieces.length > 0) {
      sheets.push(sheet);
      visuals.push(visual);
    } else {
      warnings.push("⚠️ Some pieces could not be placed. Check for tight tolerances or odd sizes.");
      break;
    }
  }

  return { sheets, warnings, visuals };
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
        canvas.title = hover ? hover.label + ` (${hover.width}" × ${hover.height}")` : 'Hover over pieces to see their size';
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
