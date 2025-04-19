const config = {
  sheetWidth: 48,
  sheetHeight: 96,
  efficientDims: [47.875, 48, 96],
  kerf: 0.125
};

// Main function called when clicking Calculate
function processInput() {
  try {
    const input = document.getElementById('bulkInput').value;
    const pieces = parseInput(input);

    const errors = pieces
      .filter(p => (p.width > config.sheetWidth && p.height > config.sheetWidth) || 
                   (p.width > config.sheetHeight && p.height > config.sheetHeight))
      .map(p => `${p.originalWidth}" x ${p.originalHeight}" (${p.qty} PCS)`);

    const validPieces = pieces.filter(p => !errors.includes(`${p.originalWidth}" x ${p.originalHeight}" (${p.qty} PCS)`));

    const { sheets } = calculateSheets(validPieces);
    displayResults(sheets, errors);

  } catch (error) {
    console.error("Calculation error:", error);
    document.getElementById('errors').innerHTML = 
      `<div class="error">⚠️ Calculation failed: ${error.message}</div>`;
  }
}

// Parse the input text into piece objects
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

// Helper to convert fractional inches to decimal
function parseFraction(str) {
  return str.split(/[- ]/).reduce((total, part) => {
    if (part.includes('/')) {
      const [n, d] = part.split('/');
      return total + (parseFloat(n) / parseFloat(d));
    }
    return total + (parseFloat(part) || 0);
  }, 0);
}

// Check if piece qualifies for 1-cut
function isEfficient(piece) {
  return config.efficientDims.some(dim => 
    Math.abs(piece.width - dim) < 0.01 || 
    Math.abs(piece.height - dim) < 0.01
  );
}

// Main calculation function
function calculateSheets(pieces) {
  const sheets = [];
  const errors = [];
  let remainingPieces = JSON.parse(JSON.stringify(pieces)); // Deep copy

  // Remove oversized pieces
  remainingPieces = remainingPieces.filter(p => {
    const fitsNormal = p.width <= config.sheetWidth && p.height <= config.sheetHeight;
    const fitsRotated = p.height <= config.sheetWidth && p.width <= config.sheetHeight;
    
    if (!fitsNormal && !fitsRotated) {
      errors.push(`${p.originalWidth}" × ${p.originalHeight}"`);
      return false;
    }
    return true;
  });

  // Sort by area descending
  remainingPieces.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  while (remainingPieces.some(p => p.qty > 0)) {
    const sheet = {
      pieces: [],
      usedWidth: 0,
      usedHeight: 0,
      cuts: 0,
      edges: 0
    };

    for (let i = 0; i < remainingPieces.length; i++) {
      const piece = remainingPieces[i];
      if (piece.qty <= 0) continue;

      for (let rotated = 0; rotated <= 1; rotated++) {
        const pw = rotated ? piece.height + config.kerf : piece.width + config.kerf;
        const ph = rotated ? piece.width + config.kerf : piece.height + config.kerf;

        if (sheet.usedWidth + pw <= config.sheetWidth && 
            ph <= config.sheetHeight) {
          const maxFit = Math.min(
            Math.floor((config.sheetWidth - sheet.usedWidth) / pw),
            piece.qty
          );

          if (maxFit > 0) {
            sheet.pieces.push({
              piece,
              count: maxFit,
              rotated: rotated === 1
            });
            sheet.usedWidth += pw * maxFit;
            sheet.cuts += isEfficient(piece) ? maxFit : maxFit * 2;
            sheet.edges += piece.edges * maxFit;
            piece.qty -= maxFit;
          }
        }
      }
    }

    if (sheet.pieces.length > 0) {
      sheets.push(sheet);
    }

    remainingPieces = remainingPieces.filter(p => p.qty > 0);
  }

  return { sheets, errors };
}

// Display results in the page
function displayResults(sheets, errors) {
  const resultsDiv = document.getElementById('results');
  const errorsDiv = document.getElementById('errors');
  const detailsDiv = document.getElementById('cutDetails');

  // Clear previous results
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
      <div class="error">⚠️ Pieces too large for standard sheets:
        <ul>${errors.map(p => `<li>${p}</li>`).join('')}</ul>
      </div>
    `;
  }

  let tableHTML = `
    <table class="cut-table">
      <tr>
        <th>Sheet</th>
        <th>Pieces</th>
        <th>Cuts</th>
        <th>Edges</th>
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
      </tr>
    `;
  });

  tableHTML += '</table>';
  detailsDiv.innerHTML = `<h3>Cutting Plan</h3>${tableHTML}`;
}

function clearAll() {
  document.getElementById('bulkInput').value = '';
  document.getElementById('results').innerHTML = '';
  document.getElementById('errors').innerHTML = '';
  document.getElementById('cutDetails').innerHTML = '';
}
