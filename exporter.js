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

// Compute a comprehensive project summary for report/PDF
function calculateProjectSummary() {
  const safe = (v, d=0) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const rooms = Array.isArray(ROOM) ? ROOM : [];
  const walls = Array.isArray(WALLS) ? WALLS : [];
  const objs = Array.isArray(OBJDATA) ? OBJDATA : [];

  // Total area in m^2
  const totalArea = rooms.reduce((sum, r) => sum + safe(r.area, 0), 0) / 3600;

  // Wall total length (m)
  let totalWallLength = 0;
  try {
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w && w.start && w.end && typeof qSVG !== 'undefined') {
        totalWallLength += qSVG.measure(w.start, w.end) / (typeof meter !== 'undefined' ? meter : 60);
      }
    }
  } catch (_) {}

  // Doors/Windows detection from doorWindow class and type
  const isDoorType = t => ['simple','double','pocket','aperture'].includes(t);
  const isWindowType = t => ['fix','flap','twin','bay'].includes(t);
  const doors = objs.filter(o => o && o.class === 'doorWindow' && isDoorType(o.type));
  const windows = objs.filter(o => o && o.class === 'doorWindow' && isWindowType(o.type));

  // Energy counts
  const energies = objs.filter(o => o && o.class === 'energy');
  const energyCounts = {
    switches: energies.filter(o => ['switch','doubleSwitch','dimmer'].includes(o.type)).length,
    outlets: energies.filter(o => ['plug','plug20','plug32'].includes(o.type)).length,
    lights: energies.filter(o => ['wallLight','roofLight'].includes(o.type)).length,
  };

  // Per room energy distribution
  const roomEnergy = [];
  for (let k = 0; k < rooms.length; k++) {
    const room = rooms[k];
    let switchNumber = 0, plugNumber = 0, plug20 = 0, plug32 = 0, lampNumber = 0;
    for (let i = 0; i < energies.length; i++) {
      const e = energies[i];
      try {
        if (typeof editor !== 'undefined' && typeof editor.rayCastingRoom === 'function') {
          const target = editor.rayCastingRoom(e);
          if (target && isObjectsEquals && isObjectsEquals(room, target)) {
            if (['switch','doubleSwitch','dimmer'].includes(e.type)) switchNumber++;
            if (['plug','plug20','plug32'].includes(e.type)) {
              plugNumber++;
              if (e.type === 'plug20') plug20++;
              if (e.type === 'plug32') plug32++;
            }
            if (['wallLight','roofLight'].includes(e.type)) lampNumber++;
          }
        }
      } catch (_) {}
    }
    roomEnergy.push({
      name: room.name || `Room ${k+1}`,
      switch: switchNumber,
      plug: plugNumber,
      plug20,
      plug32,
      light: lampNumber,
    });
  }

  return {
    totalArea: safe(totalArea, 0),
    roomCount: rooms.length,
    wallCount: walls.length,
    totalWallLength: safe(totalWallLength, 0),
    doors: { total: doors.length },
    windows: { total: windows.length },
    energy: energyCounts,
    rooms: rooms.map(r => ({ name: r.name || '', area: safe(r.area, 0) / 3600 })),
    roomEnergy,
  };
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

// Generate PDF (jsPDF) - accepts optional precomputed summary
function generatePDF(summary) {
  try {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      alert('PDF library not loaded.');
      return;
    }
    // Compute summary if not provided
    let data = summary;
    if (!data && typeof calculateProjectSummary === 'function') {
      data = calculateProjectSummary();
    }
    const doc = new jsPDF('l', 'pt', 'a4');
    const page = { w: doc.internal.pageSize.getWidth(), h: doc.internal.pageSize.getHeight() };
    const margin = { l: 40, t: 40, r: 40, b: 40 };
    let cursorY = margin.t;
    const addLine = (text) => {
      if (cursorY > page.h - margin.b) { doc.addPage(); cursorY = margin.t; }
      doc.text(String(text), margin.l, cursorY);
      cursorY += 16;
    };

    doc.setFontSize(18);
    addLine('Home Rough Editor Report');
    doc.setFontSize(12);
    addLine('Date: ' + new Date().toLocaleDateString());

    // Export SVG as PNG for embedding
    const svg = document.getElementById('lin');
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d');
    const img = new window.Image();
    img.onload = function() {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const pngData = canvas.toDataURL('image/png');
      // Maintain aspect ratio within page
      const maxW = page.w - margin.l - margin.r;
      const maxH = 350;
      const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
      const drawW = canvas.width * ratio;
      const drawH = canvas.height * ratio;
      doc.addImage(pngData, 'PNG', margin.l, cursorY + 10, drawW, drawH);
      cursorY += drawH + 30;

      // Summary block
      if (data) {
        doc.setFont(undefined, 'bold');
        addLine('Summary');
        doc.setFont(undefined, 'normal');
        addLine(`Total area: ${data.totalArea.toFixed(2)} m\u00b2`);
        addLine(`Rooms: ${data.roomCount}`);
        addLine(`Walls: ${data.wallCount} (total length: ${data.totalWallLength.toFixed(2)} m)`);
        addLine(`Doors: ${data.doors.total} | Windows: ${data.windows.total}`);
        addLine(`Energy points - Switches: ${data.energy.switches}, Outlets: ${data.energy.outlets}, Lights: ${data.energy.lights}`);
      }

      // Rooms table
      if (data && data.rooms && data.rooms.length) {
        doc.setFont(undefined, 'bold');
        addLine('Rooms');
        doc.setFont(undefined, 'normal');
        data.rooms.forEach((r, idx) => {
          addLine(`${idx + 1}. ${r.name || 'Room'} — ${r.area.toFixed(2)} m\u00b2`);
        });
      }

      // Energy per room (if any)
      if (data && data.roomEnergy && data.roomEnergy.length) {
        doc.setFont(undefined, 'bold');
        addLine('Energy distribution per room');
        doc.setFont(undefined, 'normal');
        data.roomEnergy.forEach((e) => {
          addLine(`${e.name || 'Room'} — Swi: ${e.switch} | Outlets: ${e.plug} (20A:${e.plug20}, 32A:${e.plug32}) | Lights: ${e.light}`);
        });
      }

      doc.save('plan_report.pdf');
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
  } catch (err) {
    console.error('PDF generation failed:', err);
    alert('Failed to generate PDF: ' + err.message);
  }
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
