const config = {
  sheetWidth: 48,
  sheetHeight: 96,
  efficientDims: [47.875, 48, 96]
};

function processInput() {
  try {
    const input = document.getElementById('bulkInput').value;
    const pieces = parseInput(input);

    const errors = pieces
      .filter(p => (p.width > config.sheetWidth && p.height > config.sheetHeight &&
                    p.width > config.sheetHeight && p.height > config.sheetWidth))
      .map(p => `${p.originalWidth}" x ${p.originalHeight}" (${p.qty} PCS)`);

    const validPieces = pieces.filter(p => !errors.includes(`${p.originalWidth}" x ${p.originalHeight}" (${p.qty} PCS)`));
    const { sheets, warnings } = packSheets(validPieces);
    displayResults(sheets, [...errors, ...warnings]);

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

function packSheets(pieces) {
  const sheets = [];
  const warnings = [];
  let safety = 1000;
  const remaining = JSON.parse(JSON.stringify(pieces)).filter(p => p.qty > 0);

  while (remaining.some(p => p.qty > 0) && safety-- > 0) {
    const sheet = {
      pieces: [],
      cuts: 0,
      edges: 0
    };

    let y = 0;

    while (y < config.sheetHeight) {
      let x = 0;
      let rowHeight = 0;
      let fittedThisRow = false;

      for (let i = 0; i < remaining.length; i++) {
        const p = remaining[i];
        if (p.qty <= 0) continue;

        for (const rotated of [false, true]) {
          const pw = rotated ? p.height + config.kerf : p.width + config.kerf;
          const ph = rotated ? p.width + config.kerf : p.height + config.kerf;

          if (x + pw <= config.sheetWidth && y + ph <= config.sheetHeight) {
            const fitCount = Math.min(Math.floor((config.sheetWidth - x) / pw), p.qty);

            if (fitCount > 0) {
              sheet.pieces.push({
                piece: p,
                count: fitCount,
                rotated,
              });

              sheet.cuts += isEfficient(p) ? fitCount : fitCount * 2;
              sheet.edges += p.edges * fitCount;
              p.qty -= fitCount;
              x += pw * fitCount;
              rowHeight = Math.max(rowHeight, ph);
              fittedThisRow = true;
              break;
            }
          }
        }
      }

      if (!fittedThisRow) break;
      y += rowHeight;
    }

    if (sheet.pieces.length > 0) {
      sheets.push(sheet);
    } else {
      warnings.push("⚠️ Some pieces could not be placed. Check for tight tolerances or odd sizes.");
      break;
    }
  }

  if (safety <= 0) {
    warnings.push("⚠️ Loop safety limit reached — input too complex or unplaceable.");
  }

  return { sheets, warnings };
}

function displayResults(sheets, errors) {
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
}

function clearAll() {
  document.getElementById('bulkInput').value = '';
  document.getElementById('results').innerHTML = '';
  document.getElementById('errors').innerHTML = '';
  document.getElementById('cutDetails').innerHTML = '';
}
