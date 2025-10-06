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

  // Helper to normalize room name labels to categories used by rules
  const normalizeRoom = (name) => {
    if (!name) return '';
    const n = String(name).toLowerCase();
    if (n.startsWith('bedroom')) return 'bedroom';
    if (n.includes('lounge') || n.includes('living')) return 'lounge';
    if (n.includes('lunchroom') || n.includes('dining')) return 'dining';
    if (n.includes('kitchen')) return 'kitchen';
    if (n.includes('bath')) return 'bathroom';
    if (n.includes('toilet') || n.includes('wc')) return 'toilet';
    if (n.includes('hall') || n.includes('corridor')) return 'corridor';
    return n; // fallback to raw label
  };

  // Per room energy distribution (+ wattMax)
  const roomEnergy = [];
  for (let k = 0; k < rooms.length; k++) {
    const room = rooms[k];
    let switchNumber = 0, plugNumber = 0, plug20 = 0, plug32 = 0, lampNumber = 0, wattMax = 0;
    let plugBaselineAdded = false; // For first 'plug' type = 3520W once
    for (let i = 0; i < energies.length; i++) {
      const e = energies[i];
      try {
        if (typeof editor !== 'undefined' && typeof editor.rayCastingRoom === 'function') {
          const target = editor.rayCastingRoom(e);
          if (target && isObjectsEquals && isObjectsEquals(room, target)) {
            if (['switch','doubleSwitch','dimmer'].includes(e.type)) switchNumber++;
            if (['plug','plug20','plug32'].includes(e.type)) {
              plugNumber++;
              if (e.type === 'plug') {
                if (!plugBaselineAdded) { wattMax += 3520; plugBaselineAdded = true; }
              }
              if (e.type === 'plug20') { plug20++; wattMax += 4400; }
              if (e.type === 'plug32') { plug32++; wattMax += 7040; }
            }
            if (['wallLight','roofLight'].includes(e.type)) { lampNumber++; wattMax += 100; }
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
      wattMax,
      normName: normalizeRoom(room.name || '')
    });
  }

  // Compliance checks similar to UI logic (adapted to English labels)
  const complianceIssues = [];
  const findEnergyForRoom = (roomName) => roomEnergy.find(r => r.name === roomName) || null;
  // For lounge + dining: combine stats
  const loungeIdxs = roomEnergy
    .map((r, idx) => ({r, idx}))
    .filter(x => x.r.normName === 'lounge')
    .map(x => x.idx);
  const diningIdxs = roomEnergy
    .map((r, idx) => ({r, idx}))
    .filter(x => x.r.normName === 'dining')
    .map(x => x.idx);
  // Create a copy structure for aggregated checks
  const perRoomForCheck = roomEnergy.map(r => ({...r}));
  if (loungeIdxs.length && diningIdxs.length) {
    // add dining stats to each lounge for check parity (closest to original logic)
    const diningAgg = diningIdxs.reduce((acc, idx) => ({
      light: acc.light + perRoomForCheck[idx].light,
      plug: acc.plug + perRoomForCheck[idx].plug,
      switch: acc.switch + perRoomForCheck[idx].switch,
    }), {light:0, plug:0, switch:0});
    loungeIdxs.forEach(idx => {
      perRoomForCheck[idx].light += diningAgg.light;
      perRoomForCheck[idx].plug += diningAgg.plug;
      perRoomForCheck[idx].switch += diningAgg.switch;
    });
  }
  // Build issues list
  perRoomForCheck.forEach((r) => {
    const issues = [];
    if (!r.name) issues.push('Room has no label');
    switch (r.normName) {
      case 'lounge':
        if (r.light === 0) issues.push('At least 1 controlled light point required');
        if (r.plug < 5) issues.push('At least 5 power outlets required');
        break;
      case 'bedroom':
        if (r.light === 0) issues.push('At least 1 controlled light point required');
        if (r.plug < 3) issues.push('At least 3 power outlets required');
        break;
      case 'bathroom':
        if (r.light === 0) issues.push('At least 1 light point required');
        if (r.plug < 2) issues.push('At least 2 power outlets required');
        if (r.switch === 0) issues.push('At least 1 switch required');
        break;
      case 'corridor':
        if (r.light === 0) issues.push('At least 1 controlled light point required');
        if (r.plug < 1) issues.push('At least 1 power outlet required');
        break;
      case 'toilet':
        if (r.light === 0) issues.push('At least 1 light point required');
        break;
      case 'kitchen':
        if (r.light === 0) issues.push('At least 1 controlled light point required');
        if (r.plug < 6) issues.push('At least 6 power outlets required');
        if (r.plug32 === 0) issues.push('At least one 32A power outlet required');
        if (r.plug20 < 2) issues.push('At least two 20A power outlets required');
        break;
      default:
        // no standard constraints known
        break;
    }
    if (issues.length) complianceIssues.push({ room: r.name || 'Room', issues });
  });

  // Data gaps
  const gaps = { roomsWithoutName: [], roomsWithoutUserSurface: [], emptyProject: false };
  if (!rooms.length && !walls.length && !objs.length) gaps.emptyProject = true;
  rooms.forEach((r, i) => {
    if (!r.name) gaps.roomsWithoutName.push(`Room ${i+1}`);
    if (!r.surface) gaps.roomsWithoutUserSurface.push(r.name || `Room ${i+1}`);
  });

  return {
    totalArea: safe(totalArea, 0),
    roomCount: rooms.length,
    wallCount: walls.length,
    totalWallLength: safe(totalWallLength, 0),
    doors: { total: doors.length },
    windows: { total: windows.length },
    energy: energyCounts,
    rooms: rooms.map(r => ({ name: r.name || '', area: safe(r.area, 0) / 3600, userSurface: r.surface || '', action: r.action || '', showSurface: !!r.showSurface })),
    roomEnergy,
    complianceIssues,
    gaps,
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
        addLine(`Energy points — Switches: ${data.energy.switches}, Outlets: ${data.energy.outlets}, Lights: ${data.energy.lights}`);
      }

      // Rooms table with columns
      if (data && data.rooms && data.rooms.length) {
        doc.setFont(undefined, 'bold');
        addLine('Rooms');
        doc.setFont(undefined, 'normal');
        // Table header
        const xCols = { name: margin.l, area: margin.l + 250, user: margin.l + 360, action: margin.l + 470, show: margin.l + 540 };
        doc.text('Name', xCols.name, cursorY);
        doc.text('Area (m²)', xCols.area, cursorY);
        doc.text('User Surface', xCols.user, cursorY);
        doc.text('Action', xCols.action, cursorY);
        doc.text('Show', xCols.show, cursorY);
        cursorY += 14;
        data.rooms.forEach((r, idx) => {
          addLine(`${idx + 1}. ${r.name || 'Room'}`);
          // Align columns by drawing text at specific x positions on same row
          const yRow = cursorY - 16; // row just added by addLine
          doc.text(r.area.toFixed(2), xCols.area, yRow);
          doc.text(r.userSurface ? String(r.userSurface) : '-', xCols.user, yRow);
          doc.text(r.action || '-', xCols.action, yRow);
          doc.text(r.showSurface ? 'Yes' : 'No', xCols.show, yRow);
        });
      }

      // Energy per room (table)
      if (data && data.roomEnergy && data.roomEnergy.length) {
        doc.setFont(undefined, 'bold');
        addLine('Energy distribution per room');
        doc.setFont(undefined, 'normal');
        const xColsE = { name: margin.l, swi: margin.l + 250, out: margin.l + 320, a20: margin.l + 400, a32: margin.l + 460, lig: margin.l + 520, watt: margin.l + 580 };
        doc.text('Name', xColsE.name, cursorY);
        doc.text('Swi', xColsE.swi, cursorY);
        doc.text('Out', xColsE.out, cursorY);
        doc.text('20A', xColsE.a20, cursorY);
        doc.text('32A', xColsE.a32, cursorY);
        doc.text('Lig', xColsE.lig, cursorY);
        doc.text('WattMax', xColsE.watt, cursorY);
        cursorY += 14;
        data.roomEnergy.forEach((e) => {
          addLine(`${e.name || 'Room'}`);
          const yRow = cursorY - 16;
          doc.text(String(e.switch), xColsE.swi, yRow);
          doc.text(String(e.plug), xColsE.out, yRow);
          doc.text(String(e.plug20), xColsE.a20, yRow);
          doc.text(String(e.plug32), xColsE.a32, yRow);
          doc.text(String(e.light), xColsE.lig, yRow);
          doc.text(String(e.wattMax), xColsE.watt, yRow);
        });
      }

      // Compliance issues
      if (data && data.complianceIssues && data.complianceIssues.length) {
        doc.setFont(undefined, 'bold');
        addLine('Standard checks (NF C 15-100 inspired)');
        doc.setFont(undefined, 'normal');
        data.complianceIssues.forEach(ci => {
          addLine(`${ci.room}:`);
          ci.issues.forEach(msg => addLine(` - ${msg}`));
        });
      }

      // Data gaps section
      if (data && data.gaps) {
        doc.setFont(undefined, 'bold');
        addLine('Data completeness and gaps');
        doc.setFont(undefined, 'normal');
        if (data.gaps.emptyProject) addLine('No rooms, walls, or objects found.');
        if (data.gaps.roomsWithoutName && data.gaps.roomsWithoutName.length) {
          addLine('Rooms without a name: ' + data.gaps.roomsWithoutName.join(', '));
        }
        if (data.gaps.roomsWithoutUserSurface && data.gaps.roomsWithoutUserSurface.length) {
          addLine('Rooms without user-provided surface: ' + data.gaps.roomsWithoutUserSurface.join(', '));
        }
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
