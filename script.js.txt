const config = {
  sheetWidth: 48,
  sheetHeight: 96,
  efficientDims: [47.875, 48, 96],
  kerf: 0.125
};

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

function calculateSheets(pieces) {
  const sheets = [];
  let remainingPieces = pieces.map(p => ({ 
    ...p, 
    rotations: [false, true] // Try both orientations
  }));

  while (remainingPieces.some(p => p.qty > 0)) {
    let bestSheet = null;
    let bestUtilization = 0;

    // Try different packing strategies
    for (const strategy of ['height', 'width', 'area']) {
      const sheet = tryPackSheet([...remainingPieces], strategy);
      const utilization = sheet.utilization;
      
      if (utilization > bestUtilization) {
        bestSheet = sheet;
        bestUtilization = utilization;
      }
    }

    if (bestSheet) {
      sheets.push(bestSheet);
      // Update remaining quantities
      bestSheet.pieces.forEach(({ piece, count }) => {
        const original = remainingPieces.find(p => 
          p.originalWidth === piece.originalWidth &&
          p.originalHeight === piece.originalHeight
        );
        if (original) original.qty -= count;
      });
      remainingPieces = remainingPieces.filter(p => p.qty > 0);
    }
  }

  return sheets;
}

function tryPackSheet(pieces, strategy) {
  const sheet = {
    pieces: [],
    usedArea: 0,
    utilization: 0,
    cuts: 0,
    edges: 0
  };

  // Sort based on strategy
  const sorted = [...pieces].sort((a, b) => {
    const aSize = strategy === 'height' ? a.height :
                 strategy === 'width' ? a.width :
                 a.width * a.height;
    const bSize = strategy === 'height' ? b.height :
                 strategy === 'width' ? b.width :
                 b.width * b.height;
    return bSize - aSize;
  });

  let remainingWidth = config.sheetWidth;
  let remainingHeight = config.sheetHeight;
  let currentY = 0;

  for (const piece of sorted) {
    if (piece.qty <= 0) continue;

    // Try all possible rotations
    for (const rotation of piece.rotations) {
      const pw = rotation ? piece.height + config.kerf : piece.width + config.kerf;
      const ph = rotation ? piece.width + config.kerf : piece.height + config.kerf;

      if (pw <= remainingWidth && ph <= remainingHeight) {
        const maxFitX = Math.floor(remainingWidth / pw);
        const maxFitY = Math.floor(remainingHeight / ph);
        const maxFit = Math.min(maxFitX * maxFitY, piece.qty);

        if (maxFit > 0) {
          const placed = Math.min(maxFit, maxFitX);
          sheet.pieces.push({
            piece,
            count: placed,
            rotated: rotation,
            width: pw,
            height: ph
          });
          sheet.usedArea += (piece.width * piece.height) * placed;
          sheet.cuts += isEfficient(piece) ? placed : placed * 2;
          sheet.edges += piece.edges * placed;
          
          // Update remaining space
          remainingWidth -= pw * placed;
          if (remainingWidth <= 0) {
            remainingWidth = config.sheetWidth;
            currentY += ph;
            remainingHeight = config.sheetHeight - currentY;
          }
          break;
        }
      }
    }
  }

  sheet.utilization = sheet.usedArea / (config.sheetWidth * config.sheetHeight);
  return sheet;
}

function displayResults(sheets, errors) {
  const resultsDiv = document.getElementById('results');
  const errorsDiv = document.getElementById('errors');
  const detailsDiv = document.getElementById('cutDetails');

  resultsDiv.innerHTML = `
    <div class="result-item">Total Sheets Needed: <strong>${sheets.length}</strong></div>
    <div class="result-item">Total Cuts: <strong>${sheets.reduce((a, s) => a + s.cuts, 0)}</strong></div>
    <div class="result-item">Total Edges: <strong>${sheets.reduce((a, s) => a + s.edges, 0)}</strong></div>
  `;

  if (errors.length > 0) {
    errorsDiv.innerHTML = `
      <div class="error">⚠️ Invalid Pieces (too large):
        <ul>${errors.map(p => `<li>${p}</li>`).join('')}</ul>
      </div>
    `;
  }

  let tableHTML = `
    <table class="cut-table">
      <tr>
        <th>Sheet</th>
        <th>Layout</th>
        <th>Cuts</th>
        <th>Edges</th>
        <th>Utilization</th>
      </tr>
  `;

  sheets.forEach((sheet, index) => {
    tableHTML += `
      <tr>
        <td>Sheet ${index + 1}</td>
        <td>
          ${sheet.pieces.map(p => `
            ${p.count}× ${p.rotated ? `${p.piece.originalHeight}"×${p.piece.originalWidth}"` : `${p.piece.originalWidth}"×${p.piece.originalHeight}"`} 
            <span class="${isEfficient(p.piece) ? 'efficient' : 'inefficient'}">(${isEfficient(p.piece) ? '1-cut' : '2-cut'})</span>
          `).join('<br>')}
        </td>
        <td>${sheet.cuts}</td>
        <td>${sheet.edges}</td>
        <td>${Math.round(sheet.utilization * 100)}%</td>
      </tr>
    `;
  });

  tableHTML += '</table>';
  detailsDiv.innerHTML = `<h3>Cutting Details</h3>${tableHTML}`;
}

function processInput() {
  const input = document.getElementById('bulkInput').value;
  const pieces = parseInput(input);
  const { sheets, errors } = calculateSheets(pieces);
  displayResults(sheets, errors);
}

function clearAll() {
  document.getElementById('bulkInput').value = '';
  document.getElementById('results').innerHTML = '';
  document.getElementById('errors').innerHTML = '';
  document.getElementById('cutDetails').innerHTML = '';
}