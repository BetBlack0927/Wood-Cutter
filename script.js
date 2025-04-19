const config = {
  sheetWidth: 48,
  sheetHeight: 96,
  efficientDims: [47.875, 48, 96],
  kerf: 0.125
};

// Main function triggered by Calculate button
function processInput() {
  try {
    const input = document.getElementById('bulkInput').value;
    const pieces = parseInput(input);

    // Filter and report oversized pieces
    const errors = pieces
      .filter(p => (p.width > config.sheetWidth && p.height > config.sheetWidth) || 
                   (p.width > config.sheetHeight && p.height > config.sheetHeight))
      .map(p => `${p.originalWidth}" x ${p.originalHeight}" (${p.qty} PCS)`);

    const validPieces = pieces.filter(p => !errors.includes(`${p.originalWidth}" x ${p.originalHeight}" (${p.qty} PCS)`));

    const { sheets, warnings } = calculateSheets(validPieces);

    displayResults(sheets, [...errors, ...warnings]);

  } catch (error) {
    console.error("Calculation error:", error);
    document.getElementById('errors').innerHTML = 
      `<div class="error">⚠️ Calculation failed: ${error.message}</div>`;
  }
}

// Parses user input into usable piece data
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

// Converts fractional input like 23-7/8 to decimal
function parseFraction(str) {
  return str.split(/[- ]/).reduce((total, part) => {
    if (part.includes('/')) {
      const [n, d] = part.split('/');
      return total + (parseFloat(n) / parseFloat(d));
    }
    return total + (parseFloat(part) || 0);
  }, 0);
}

// Checks if a piece qualifies as efficient
function isEfficient(piece) {
  return config.efficientDims.some(dim => 
    Math.abs(piece.width - dim) < 0.01 || 
    Math.abs(piece.height - dim) < 0.01
  );
}

// Main packing algorithm
function calculateSheets(pieces) {
  const sheets = [];
  const warnings = [];
  let remainingPieces = JSON.parse(JSON.stringify(pieces)); // Deep clone
  let safety = 1000; // Safety limiter

  // Remove any pieces too large even with rotation
  remainingPieces = remainingPieces.filter(p => {
    const fitsNormal = p.width <= config.sheetWidth && p.height <= config.sheetHeight;
    const fitsRotated = p.height <= config.sheetWidth && p.width <= config.sheetHeight;
    
    return fitsNormal || fitsRotated;
  });

  // Sort pieces largest area first
  remainingPieces.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  while (remainingPieces.some(p => p.qty > 0) && safety-- > 0) {
    const sheet = {
      pieces: [],
      usedWidth: 0,
      cuts: 0,
      edges: 0
    };

    for (let i = 0; i < remainingPieces.length; i++) {
      const piece = remainingPieces[i];
      if (piece.qty <= 0) continue;

      let placed = false;

      for (let rotated = 0; rotated <= 1; rotated++) {
        const pw = rotated ? piece.height + config.kerf : piece.width + config.kerf;
        const ph = rotated ? piece.width + config.kerf : piece.height + config.kerf;

        if (sheet.usedWidth + pw <= config.sheetWidth && ph <= config.sheetHeight) {
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
            placed = true;
            break;
          }
        }
      }

      // If not placed in this sheet, try next piece
    }

    if (sheet.pieces.length > 0) {
      sheets.push(sheet);
    } else {
      // No pieces fit — prevent infinite loop
      warnings.push("⚠️ Some pieces could not be placed. Check for tight tolerances or odd sizes.");
      break;
    }

    remainingPieces = remainingPieces.filter(p => p.qty > 0);
  }

  if (safety <= 0) {
    warnings.push("⚠️ Loop safety limit reached — input too complex or unplaceable.");
  }

  return { sheets, warnings };
}

// Renders results and errors on the page
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
      <div class="error">⚠️ Issues Found:
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

// Clear all fields
function clearAll() {
  document.getElementById('bulkInput').value = '';
  document.getElementById('results').innerHTML = '';
  document.getElementById('errors').innerHTML = '';
  document.getElementById('cutDetails').innerHTML = '';
}
