// exporter.js - Export/Import/PDF logic for homeRoughEditor

// Export SVG
function exportSVG() {
  const svg = document.getElementById('lin');
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svg);
  source = '<?xml version="1.0" standalone="no"?>\r\n' + source;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'plan.svg';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Export PNG
function exportPNG() {
  const svg = document.getElementById('lin');
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svg);
  const canvas = document.createElement('canvas');
  canvas.width = svg.viewBox.baseVal.width || svg.width.baseVal.value || 1100;
  canvas.height = svg.viewBox.baseVal.height || svg.height.baseVal.value || 700;
  const ctx = canvas.getContext('2d');
  const img = new window.Image();
  img.onload = function() {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = png;
    link.download = 'plan.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
}

// Export JSON
function exportJSON() {
  const data = {
    WALLS: typeof WALLS !== 'undefined' ? WALLS : [],
    OBJDATA: typeof OBJDATA !== 'undefined' ? OBJDATA : [],
    ROOM: typeof ROOM !== 'undefined' ? ROOM : [],
    HISTORY: typeof HISTORY !== 'undefined' ? HISTORY : []
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], {type: "application/json"});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'plan.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Import JSON
function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data.WALLS && data.OBJDATA && data.ROOM) {
        // Restore state
        WALLS = data.WALLS;
        OBJDATA = data.OBJDATA;
        ROOM = data.ROOM;
        HISTORY = data.HISTORY || [];
        if (typeof editor !== 'undefined' && editor.architect) {
          editor.architect(WALLS);
        }
        if (typeof rib === 'function') rib();
        if (typeof save === 'function') save();
        if (typeof load === 'function') load(HISTORY.length-1);
        alert('Plan imported successfully!');
      } else {
        alert('Invalid plan file.');
      }
    } catch (err) {
      alert('Error importing plan: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// Generate PDF (jsPDF)
function generatePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l', 'pt', 'a4');
  doc.setFontSize(18);
  doc.text('Home Rough Editor Report', 40, 40);
  doc.setFontSize(12);
  doc.text('Date: ' + new Date().toLocaleDateString(), 40, 60);

  // Export SVG as PNG for embedding
  const svg = document.getElementById('lin');
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svg);
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = 600;
  const ctx = canvas.getContext('2d');
  const img = new window.Image();
  img.onload = function() {
    ctx.drawImage(img, 0, 0, 800, 600);
    const pngData = canvas.toDataURL('image/png');
    doc.addImage(pngData, 'PNG', 40, 80, 500, 350);

    // Add room details, wall/door/window counts, total area, etc.
    let y = 450;
    doc.text('Room Details:', 40, y);
    y += 20;
    if (typeof ROOM !== 'undefined' && ROOM.length > 0) {
      ROOM.forEach((room, i) => {
        doc.text(`${i+1}. ${room.name || 'Room'} - Area: ${room.area ? (room.area/3600).toFixed(2) : '?'} m²`, 60, y);
        y += 16;
      });
    }
    y += 10;
    doc.text(`Walls: ${typeof WALLS !== 'undefined' ? WALLS.length : 0}` , 40, y);
    const doorCount = typeof OBJDATA !== 'undefined' ? OBJDATA.filter(o => o.class === 'door').length : 0;
    const windowCount = typeof OBJDATA !== 'undefined' ? OBJDATA.filter(o => o.class === 'window').length : 0;
    doc.text(`Doors: ${doorCount}`, 200, y);
    doc.text(`Windows: ${windowCount}`, 300, y);
    y += 20;
    const totalArea = (typeof ROOM !== 'undefined') ? ROOM.reduce((sum, r) => sum + (r.area||0), 0)/3600 : 0;
    doc.text(`Total Area: ${totalArea.toFixed(2)} m²`, 40, y);
    // Add more metadata if available
    doc.save('plan_report.pdf');
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
}

// Event listeners for UI buttons
window.addEventListener('DOMContentLoaded', function() {
  const btnExportSVG = document.getElementById('exportSVG');
  const btnExportPNG = document.getElementById('exportPNG');
  const btnExportJSON = document.getElementById('exportJSON');
  const btnImportJSON = document.getElementById('importJSON');
  const fileImportJSON = document.getElementById('importJSONFile');
  const btnGeneratePDF = document.getElementById('generatePDF');

  if (btnExportSVG) btnExportSVG.addEventListener('click', exportSVG);
  if (btnExportPNG) btnExportPNG.addEventListener('click', exportPNG);
  if (btnExportJSON) btnExportJSON.addEventListener('click', exportJSON);
  if (btnImportJSON && fileImportJSON) {
    btnImportJSON.addEventListener('click', function() { fileImportJSON.click(); });
    fileImportJSON.addEventListener('change', function(e) {
      if (e.target.files && e.target.files[0]) {
        importJSONFile(e.target.files[0]);
      }
    });
  }
  if (btnGeneratePDF) btnGeneratePDF.addEventListener('click', generatePDF);
});
