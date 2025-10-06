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
  try {
    const json = safeStringify(data, 2);
    const blob = new Blob([json], {type: "application/json"});
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = 'plan.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // revoke after a short delay to ensure the download has started
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  } catch (err) {
    console.error('Export JSON failed:', err);
    alert('Failed to export JSON: ' + (err && err.message ? err.message : err));
  }
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
      let data = JSON.parse(e.target.result);
      // Support nested shapes like { plan: { WALLS:..., OBJDATA:..., ROOM:... } }
      if (data && data.plan) data = data.plan;

      // Support lowercase or alternative keys
      let walls = data.WALLS || data.walls || data.Wall || data.wall;
      let objdata = data.OBJDATA || data.objdata || data.OBJ || data.objects;
      let room = data.ROOM || data.room || data.ROOMS || data.rooms;
      let history = data.HISTORY || data.history;

      // Heuristic fallback: try to detect arrays by shape if keys missing
      const isArrayOf = (arr, predicate) => Array.isArray(arr) && arr.length && arr.every(predicate);
      const looksLikeWall = (w) => w && (('start' in w && 'end' in w) || ('x1' in w && 'y1' in w && 'x2' in w && 'y2' in w) || ('p1' in w && 'p2' in w));
      const looksLikeObj = (o) => o && (o.class || o.type || o.name || o.id);
      const looksLikeRoom = (r) => r && (('area' in r) || ('name' in r) || ('surface' in r));

      // If none of the expected keys are arrays, scan top-level arrays to guess
      if (!Array.isArray(walls) || !Array.isArray(objdata) || !Array.isArray(room)) {
        for (const k in data) {
          if (!Array.isArray(data[k])) continue;
          const arr = data[k];
          if (!walls && isArrayOf(arr, looksLikeWall)) { walls = arr; continue; }
          if (!objdata && isArrayOf(arr, looksLikeObj)) { objdata = arr; continue; }
          if (!room && isArrayOf(arr, looksLikeRoom)) { room = arr; continue; }
        }
      }

      // Final defaults
      walls = Array.isArray(walls) ? walls : [];
      objdata = Array.isArray(objdata) ? objdata : [];
      room = Array.isArray(room) ? room : [];
      history = Array.isArray(history) ? history : [];

      // Basic validation after heuristics
      if (!walls.length && !objdata.length && !room.length) {
        console.warn('Imported JSON could not be mapped to WALLS/OBJDATA/ROOM:', Object.keys(data));
        alert('Invalid plan file: could not detect walls/objects/rooms in the JSON.');
        return;
      }

      // If HISTORY looks like an array of snapshot strings (saved by this app), prefer to restore via load()
      if (Array.isArray(history) && history.length > 0 && typeof history[0] === 'string' && history[0].indexOf('wallData') !== -1) {
        try {
          // store imported history into localStorage then call load to replay last snapshot
          localStorage.setItem('history', JSON.stringify(history));
          HISTORY = history;
          HISTORY.index = HISTORY.length - 1;
          if (typeof load === 'function') {
            try { load(HISTORY.index); } catch (ie) { console.warn('load() failed after importing HISTORY:', ie); }
          }
          alert('Plan imported successfully (from HISTORY snapshot).');
          return;
        } catch (ie) {
          console.warn('Failed to restore from imported HISTORY array:', ie);
        }
      }

      // Clear existing objects from the UI
      try {
        for (let k in OBJDATA) {
          try { if (OBJDATA[k] && OBJDATA[k].graph) OBJDATA[k].graph.remove(); } catch (e) {}
        }
      } catch (e) {}

      // Reconstruct OBJDATA as live editor.obj2D instances where possible
      const reconstructedObjects = [];
      if (typeof editor !== 'undefined' && typeof editor.obj2D === 'function') {
        for (let k in objdata) {
          try {
            const OO = objdata[k] || {};
            const obj = new editor.obj2D(OO.family, OO.class, OO.type, {
              x: OO.x,
              y: OO.y
            }, OO.angle, OO.angleSign, OO.size, OO.hinge || 'normal', OO.thick, OO.value);
            obj.limit = OO.limit;
            reconstructedObjects.push(obj);
          } catch (ie) {
            console.warn('Failed to reconstruct object', objdata[k], ie);
          }
        }
      } else {
        // Fallback: keep raw data
        for (let k in objdata) reconstructedObjects.push(objdata[k]);
      }

      // Restore state for walls/rooms/history
      WALLS = walls;
      ROOM = room;
      HISTORY = history;

      // Rebuild UI / editor
      if (typeof editor !== 'undefined' && typeof editor.architect === 'function') {
        try {
          // Normalize wall coordinates to expected shape {start:{x,y}, end:{x,y}, thick, type}
          const normalizePoint = (p) => {
            if (!p) return { x: 0, y: 0 };
            if (Array.isArray(p) && p.length >= 2) return { x: Number(p[0]) || 0, y: Number(p[1]) || 0 };
            if (typeof p === 'object') {
              const x = ('x' in p) ? p.x : (('X' in p) ? p.X : (p[0] || 0));
              const y = ('y' in p) ? p.y : (('Y' in p) ? p.Y : (p[1] || 0));
              return { x: Number(x) || 0, y: Number(y) || 0 };
            }
            // fallback parse string like "100,200"
            if (typeof p === 'string' && p.indexOf(',') !== -1) {
              const parts = p.split(',');
              return { x: Number(parts[0]) || 0, y: Number(parts[1]) || 0 };
            }
            return { x: 0, y: 0 };
          };

          const normalizeWall = (w) => {
            const nw = {};
            nw.start = normalizePoint(w.start || w.p1 || w.from || w.a || (w.coords && w.coords[0]) || w[0]);
            nw.end = normalizePoint(w.end || w.p2 || w.to || w.b || (w.coords && w.coords[1]) || w[1]);
            nw.thick = Number(w.thick || w.width || w.th || 20) || 20;
            nw.type = w.type || w.t || 'normal';
            nw.parent = null;
            nw.child = null;
            nw.backUp = w.backUp || false;
            return nw;
          };

          WALLS = WALLS.map(normalizeWall);
          // Ensure ROOM entries have numeric area
          ROOM = ROOM.map(r => ({ ...r, area: Number(r.area) || Number(r.surface) || 0 }));

          editor.architect(WALLS);
        } catch (ie) { console.warn('editor.architect failed:', ie); }
      }
      if (typeof rib === 'function') {
        try { rib(); } catch (ie) { console.warn('rib() failed after import:', ie); }
      }

      // Only call load if we have a valid HISTORY array with entries
      if (typeof load === 'function' && Array.isArray(HISTORY) && HISTORY.length > 0) {
        try { load(HISTORY.length - 1); } catch (ie) { console.warn('load() failed after import:', ie); }
      }

      // Attach reconstructed objects to the UI (append graphs and update them)
      try {
        OBJDATA = [];
        // Clear carpentry/text boxes
        try { $('#boxcarpentry').empty(); } catch (e) {}
        try { $('#boxText').empty(); } catch (e) {}
        for (let i = 0; i < reconstructedObjects.length; i++) {
          const obj = reconstructedObjects[i];
          OBJDATA.push(obj);
          try { $('#boxcarpentry').append(OBJDATA[OBJDATA.length - 1].graph); } catch (e) {}
          try { OBJDATA[OBJDATA.length - 1].update(); } catch (e) {}
        }
      } catch (e) { console.warn('Failed to attach reconstructed objects:', e); }

      if (typeof save === 'function') {
        try { save(); } catch (ie) { console.warn('save() failed after import:', ie); }
      }

      alert('Plan imported successfully!');
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
    addLine('rakib');
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

// Safe JSON stringify to avoid circular references and functions
function safeStringify(obj, space) {
  const seen = new WeakSet();
  return JSON.stringify(obj, function(key, value) {
    if (typeof value === 'function') return undefined;
    // DOM nodes
    if (value && typeof value === 'object' && value.nodeType) return undefined;
    if (value && typeof value === 'object') {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  }, space);
}

function initExporterUI() {
  // guard against being initialized more than once (scripts may run at end of body
  // and DOMContentLoaded listener may also call this). Without this, listeners
  // are attached twice which can make the import flow run two times.
  if (window.__hre_exporterUIInitialized) return;
  window.__hre_exporterUIInitialized = true;
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
    // ensure the click opener always resets the input so selecting the same file again
    // will fire the change event
    btnImportJSON.addEventListener('click', function() { try { fileImportJSON.value = ''; } catch (e) {} fileImportJSON.click(); });

    // attach the change handler only once even if initExporterUI is called twice
    if (!fileImportJSON.__hreChangeHandlerAdded) {
      fileImportJSON.addEventListener('change', function(e) {
        if (e.target.files && e.target.files[0]) {
          importJSONFile(e.target.files[0]);
          // clear value so selecting same file later will still fire change
          try { e.target.value = ''; } catch (err) {}
        }
      });
      fileImportJSON.__hreChangeHandlerAdded = true;
    }
  }
  if (btnGeneratePDF) btnGeneratePDF.addEventListener('click', function() { generatePDF(); });
}

// Try to initialize immediately; if DOM not ready, also listen for DOMContentLoaded
try { initExporterUI(); } catch (e) { /* ignore */ }
window.addEventListener && window.addEventListener('DOMContentLoaded', initExporterUI);
