/* ============================================================
   Fretboard Trainer — app.js
   Sections:
     1. Music theory data + helpers
     2. Fretboard SVG rendering
     3. Timer engine + note display
     4. UI wiring
     5. Optional self-test (?test)
   Plain script (no ES modules) so index.html opens via file://.
   ============================================================ */
(function () {
  "use strict";

  /* ====================================================
     1. MUSIC THEORY
     ==================================================== */
  const CHROMATIC = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
  const FRET_MIN = 1;
  const FRET_MAX = 17;

  // Strings ordered low (6th) -> high (1st). openIndex = position in CHROMATIC.
  const STRINGS = [
    { id: 6, name: "E", openIndex: 7,  sub: "6th · low",  readout: "Low E string (6th)" },
    { id: 5, name: "A", openIndex: 0,  sub: "5th",        readout: "A string (5th)" },
    { id: 4, name: "D", openIndex: 5,  sub: "4th",        readout: "D string (4th)" },
    { id: 3, name: "G", openIndex: 10, sub: "3rd",        readout: "G string (3rd)" },
    { id: 2, name: "B", openIndex: 2,  sub: "2nd",        readout: "B string (2nd)" },
    { id: 1, name: "E", openIndex: 7,  sub: "1st · high", readout: "High E string (1st)" },
  ];

  function noteAtFret(openIndex, fret) {
    return CHROMATIC[(openIndex + fret) % 12];
  }

  // All frets (1..17) on a string whose note equals `note`.
  function fretsForNote(openIndex, note) {
    const out = [];
    for (let f = FRET_MIN; f <= FRET_MAX; f++) {
      if (noteAtFret(openIndex, f) === note) out.push(f);
    }
    return out;
  }

  // Random chromatic note, avoiding an immediate repeat of `prev`.
  function randomNote(prev) {
    let n;
    do {
      n = CHROMATIC[Math.floor(Math.random() * CHROMATIC.length)];
    } while (n === prev && CHROMATIC.length > 1);
    return n;
  }

  /* ---- Scales & note groups -------------------------------------------- */
  // Semitone offset of each scale degree (1..7) from the root.
  const SCALE_STEPS = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
  };
  // Degrees (1-based, of the parent scale) used by the named "shapes".
  const PENTATONIC_DEGREES = { major: [1, 2, 3, 5, 6], minor: [1, 3, 4, 5, 7] };
  const TRIAD_DEGREES = [1, 3, 5];
  // Distinct, readable colors for the notes within a group (1 per note).
  const GROUP_COLORS = ["#2dd4a7", "#f0b429", "#4aa8ff", "#ff6b9d", "#a78bfa", "#ff8a4c", "#b6e34a"];
  const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

  function randInt(n) { return Math.floor(Math.random() * n); }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Pick `k` distinct values from `pool` (preserving nothing; result shuffled).
  function sampleDistinct(pool, k) {
    return shuffle(pool.slice()).slice(0, k);
  }

  // Chromatic index (0..11) of scale degree `d` for a root + scale type.
  function degreeIndex(rootIndex, type, d) {
    return (rootIndex + SCALE_STEPS[type][d - 1]) % 12;
  }

  // Build a meaningful group of `size` notes (3/5/7) from a random major/minor
  // key. `mode` = "shape" (triad/pentatonic/scale), "degrees" (random scale
  // degrees), or "mix" (randomly one or the other each call).
  function generateGroup(size, mode) {
    const rootIndex = randInt(12);
    const type = Math.random() < 0.5 ? "major" : "minor";
    const useShape = mode === "shape" || (mode === "mix" && Math.random() < 0.5);

    let degrees;
    let shapeName;
    if (size >= 7) {
      degrees = [1, 2, 3, 4, 5, 6, 7];
      shapeName = "scale";
    } else if (useShape && size === 3) {
      degrees = TRIAD_DEGREES.slice();
      shapeName = "triad";
    } else if (useShape && size === 5) {
      degrees = PENTATONIC_DEGREES[type].slice();
      shapeName = "pentatonic";
    } else {
      degrees = sampleDistinct([1, 2, 3, 4, 5, 6, 7], size);
      shapeName = "scale";
    }
    shuffle(degrees); // display order (e.g. 1, 6, 5 -> C, A, G)

    const notes = degrees.map((d, i) => {
      const index = degreeIndex(rootIndex, type, d);
      return { degree: d, index, name: CHROMATIC[index], color: GROUP_COLORS[i % GROUP_COLORS.length] };
    });
    return {
      rootName: CHROMATIC[rootIndex],
      type,
      shapeName,
      label: `${CHROMATIC[rootIndex]} ${type} ${shapeName}`,
      notes,
      key: `${rootIndex}|${type}|${degrees.join(",")}`, // for dedupe
    };
  }

  /* ====================================================
     2. FRETBOARD SVG
     ==================================================== */
  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // Geometry constants (viewBox units).
  const G = {
    padLeft: 52, padRight: 20, padTop: 48, padBottom: 32,
    fretSpacing: 44, stringSpacing: 48, fretCount: FRET_MAX,
    boardPadY: 20, // board/wire overhang above & below the outer strings
  };
  G.nutX = G.padLeft;
  G.boardRight = G.nutX + G.fretCount * G.fretSpacing;
  G.boardTop = G.padTop;
  G.boardBottom = G.padTop + (STRINGS.length - 1) * G.stringSpacing;
  G.width = G.boardRight + G.padRight;
  G.height = G.boardBottom + G.padBottom;

  const SINGLE_INLAYS = [3, 5, 7, 9, 15, 17];
  const DOUBLE_INLAYS = [12];

  // x at the centre of fret space `f` (where a finger / dot sits).
  function fretCenterX(f) { return G.nutX + (f - 0.5) * G.fretSpacing; }
  // x of the fret wire after space `f` (wire 0 == nut).
  function fretWireX(f) { return G.nutX + f * G.fretSpacing; }
  // Student (player) view: looking down at your own guitar, the thick low E
  // string (array index 0) sits on top and the thin high E (index 5) on the
  // bottom. (Flip to `(STRINGS.length - 1) - stringIndex` for tab/audience view.)
  function displayRow(stringIndex) { return stringIndex; }
  function stringY(stringIndex) { return G.boardTop + displayRow(stringIndex) * G.stringSpacing; }

  const fb = {
    svg: null, dotLayer: null, mapLayer: null, selectedRow: null, labels: [],
  };

  function buildFretboard(container) {
    const svg = svgEl("svg", {
      viewBox: `0 0 ${G.width} ${G.height}`,
      role: "img",
      "aria-label": "Guitar fretboard diagram",
    });

    // Gradient def for the board.
    const defs = svgEl("defs");
    const grad = svgEl("linearGradient", { id: "boardGradient", x1: "0", y1: "0", x2: "0", y2: "1" });
    grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": "#2a1d13" }));
    grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "#1a110a" }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Board background.
    svg.appendChild(svgEl("rect", {
      class: "fb-board",
      x: G.nutX, y: G.boardTop - G.boardPadY,
      width: G.boardRight - G.nutX,
      height: (G.boardBottom - G.boardTop) + 2 * G.boardPadY,
      rx: 7,
    }));

    // Selected-string highlight (repositioned on selection).
    const selRow = svgEl("rect", {
      class: "fb-string-row is-selected",
      x: G.nutX, width: G.boardRight - G.nutX,
      height: G.stringSpacing, y: 0,
    });
    svg.appendChild(selRow);
    fb.selectedRow = selRow;

    // Inlay markers.
    const midY = (G.boardTop + G.boardBottom) / 2;
    SINGLE_INLAYS.forEach((f) => {
      svg.appendChild(svgEl("circle", { class: "fb-inlay", cx: fretCenterX(f), cy: midY, r: 8.5 }));
    });
    DOUBLE_INLAYS.forEach((f) => {
      svg.appendChild(svgEl("circle", { class: "fb-inlay", cx: fretCenterX(f), cy: G.boardTop + 1.5 * G.stringSpacing, r: 8.5 }));
      svg.appendChild(svgEl("circle", { class: "fb-inlay", cx: fretCenterX(f), cy: G.boardTop + 3.5 * G.stringSpacing, r: 8.5 }));
    });

    // Above-neck fret-position markers. The on-board inlays get covered by the
    // all-notes labels, so this row (shown via the .show-notes class) keeps a
    // fret reference visible just above the guitar when "Show all notes" is on.
    const markerLayer = svgEl("g", { class: "fb-markerlayer" });
    const markerY = G.boardTop - G.boardPadY - 14;
    SINGLE_INLAYS.forEach((f) => {
      markerLayer.appendChild(svgEl("circle", { class: "fb-marker", cx: fretCenterX(f), cy: markerY, r: 5.5 }));
    });
    DOUBLE_INLAYS.forEach((f) => {
      // octave fret -> double marker (two dots side by side)
      markerLayer.appendChild(svgEl("circle", { class: "fb-marker", cx: fretCenterX(f) - 6.5, cy: markerY, r: 5 }));
      markerLayer.appendChild(svgEl("circle", { class: "fb-marker", cx: fretCenterX(f) + 6.5, cy: markerY, r: 5 }));
    });
    svg.appendChild(markerLayer);

    // Fret wires (1..17).
    for (let f = 1; f <= G.fretCount; f++) {
      svg.appendChild(svgEl("line", {
        class: "fb-fret",
        x1: fretWireX(f), y1: G.boardTop - G.boardPadY,
        x2: fretWireX(f), y2: G.boardBottom + G.boardPadY,
      }));
    }
    // Nut (thicker, at fret 0).
    svg.appendChild(svgEl("line", {
      class: "fb-nut",
      x1: G.nutX, y1: G.boardTop - G.boardPadY, x2: G.nutX, y2: G.boardBottom + G.boardPadY,
    }));

    // Strings (thicker for lower/bass strings).
    STRINGS.forEach((s, i) => {
      const y = stringY(i);
      const isBass = s.id >= 4; // E, A, D rendered a touch thicker
      svg.appendChild(svgEl("line", {
        class: "fb-string",
        x1: G.nutX, y1: y, x2: G.boardRight, y2: y,
        "stroke-width": isBass ? (s.id === 6 ? 3 : s.id === 5 ? 2.6 : 2.2) : (s.id === 1 ? 1.2 : 1.6),
      }));

      // String label at the nut side.
      const label = svgEl("text", { class: "fb-strlabel", x: G.nutX - 12, y: y });
      label.textContent = s.name;
      svg.appendChild(label);
      fb.labels[i] = label;
    });

    // Fret numbers below the board.
    for (let f = 1; f <= G.fretCount; f++) {
      const t = svgEl("text", { class: "fb-fretnum", x: fretCenterX(f), y: G.boardBottom + 20 });
      t.textContent = String(f);
      svg.appendChild(t);
    }

    // All-notes reference map layer (sits below the active drill dots).
    const mapLayer = svgEl("g", { class: "fb-maplayer" });
    svg.appendChild(mapLayer);
    fb.mapLayer = mapLayer;

    // Dot layer (drawn last so the active drill dots sit on top).
    const dotLayer = svgEl("g", { class: "fb-dotlayer" });
    svg.appendChild(dotLayer);
    fb.dotLayer = dotLayer;

    fb.svg = svg;
    container.innerHTML = "";
    container.appendChild(svg);
  }

  function setSelectedString(stringIndex) {
    if (!fb.selectedRow) return;
    fb.selectedRow.setAttribute("y", stringY(stringIndex) - G.stringSpacing / 2);
    fb.labels.forEach((lbl, i) => {
      lbl.classList.toggle("is-selected", i === stringIndex);
    });
  }

  function clearDots() {
    if (fb.dotLayer) fb.dotLayer.textContent = "";
  }

  function showDots(stringIndex, note) {
    clearDots();
    const s = STRINGS[stringIndex];
    const y = stringY(stringIndex);
    fretsForNote(s.openIndex, note).forEach((f) => {
      const g = svgEl("g", { class: "fb-dot-group" });
      g.appendChild(svgEl("circle", { class: "fb-dot", cx: fretCenterX(f), cy: y, r: 19 }));
      const t = svgEl("text", { class: "fb-dot-label", x: fretCenterX(f), y: y });
      t.textContent = note;
      g.appendChild(t);
      fb.dotLayer.appendChild(g);
    });
  }

  function clearMap() {
    if (fb.mapLayer) fb.mapLayer.textContent = "";
  }

  // Label every fret (1..17) on all six strings with its note name.
  function renderAllNotes(on) {
    clearMap();
    if (!on) return;
    STRINGS.forEach((s, i) => {
      const y = stringY(i);
      for (let f = FRET_MIN; f <= FRET_MAX; f++) {
        const g = svgEl("g", { class: "fb-map-group" });
        g.appendChild(svgEl("circle", { class: "fb-map-dot", cx: fretCenterX(f), cy: y, r: 17 }));
        const t = svgEl("text", { class: "fb-map-label", x: fretCenterX(f), y: y });
        t.textContent = noteAtFret(s.openIndex, f);
        g.appendChild(t);
        fb.mapLayer.appendChild(g);
      }
    });
  }

  // Whole-fretboard view of a note group: every group note is dotted at all of
  // its positions on all six strings, colored by the note's group color.
  function showGroupDots(group) {
    clearDots();
    group.notes.forEach((n) => {
      STRINGS.forEach((s, i) => {
        const y = stringY(i);
        for (let f = FRET_MIN; f <= FRET_MAX; f++) {
          if ((s.openIndex + f) % 12 !== n.index) continue;
          const g = svgEl("g", { class: "fb-gdot-group" });
          g.appendChild(svgEl("circle", { class: "fb-gdot", cx: fretCenterX(f), cy: y, r: 13, fill: n.color }));
          const t = svgEl("text", { class: "fb-gdot-label", x: fretCenterX(f), y: y });
          t.textContent = n.name;
          g.appendChild(t);
          fb.dotLayer.appendChild(g);
        }
      });
    });
  }

  /* ====================================================
     3. TIMER ENGINE + DISPLAY
     ==================================================== */
  const CIRC = 2 * Math.PI * 54;

  const state = {
    running: false,
    mode: "guide",        // "guide" | "practice"
    showNotes: false,     // all-notes reference map toggle
    stringIndex: 0,       // low E
    cycleMs: 5000,
    groupSize: 1,         // notes per cycle: 1 (single) | 3 | 5 | 7
    groupMode: "mix",     // group composition: "shape" | "degrees" | "mix"
    prevNote: null,
    currentNote: null,
    currentGroup: null,
    prevGroupKey: null,
    cycleStart: 0,
    rafId: null,
  };

  // The fretboard is on screen in Guide mode, or whenever the all-notes map
  // is toggled on (which reveals the board even in Practice mode).
  function boardVisible() {
    return state.mode === "guide" || state.showNotes;
  }

  // DOM refs (assigned on init).
  const dom = {};

  function popNote() {
    dom.noteText.classList.remove("pop");
    void dom.noteText.offsetWidth; // force reflow to restart animation
    dom.noteText.classList.add("pop");
  }

  // Draw the right thing on the board for the current state (or clear it).
  function refreshBoard() {
    if (!boardVisible()) { clearDots(); return; }
    if (state.groupSize === 1) {
      if (state.currentNote) showDots(state.stringIndex, state.currentNote);
      else clearDots();
    } else {
      if (state.currentGroup) showGroupDots(state.currentGroup);
      else clearDots();
    }
  }

  function renderNote(note) {
    dom.noteText.textContent = note;
    dom.noteText.classList.remove("is-empty");
    popNote();
    refreshBoard();
  }

  function nextNote() {
    const note = randomNote(state.prevNote);
    state.currentNote = note;
    state.prevNote = note;
    renderNote(note);
  }

  // Render a note group: colored chips + a scale annotation line + board dots.
  function renderGroup(group) {
    dom.notesRow.innerHTML = "";
    group.notes.forEach((n) => {
      const chip = document.createElement("span");
      chip.className = "note-chip";
      chip.style.background = n.color;
      chip.textContent = n.name;
      dom.notesRow.appendChild(chip);
    });

    const scale = document.createElement("span");
    scale.className = "ga-scale";
    scale.textContent = group.label;
    dom.groupAnnotation.innerHTML = "";
    dom.groupAnnotation.appendChild(scale);
    dom.groupAnnotation.appendChild(document.createTextNode(" — "));
    group.notes.forEach((n, i) => {
      if (i) dom.groupAnnotation.appendChild(document.createTextNode(" · "));
      const span = document.createElement("span");
      span.className = "ga-note";
      span.style.color = n.color;
      span.textContent = `${ORDINALS[n.degree]} ${n.name}`;
      dom.groupAnnotation.appendChild(span);
    });

    dom.notesRow.classList.remove("pop");
    void dom.notesRow.offsetWidth;
    dom.notesRow.classList.add("pop");
    refreshBoard();
  }

  function nextGroup() {
    let group;
    do {
      group = generateGroup(state.groupSize, state.groupMode);
    } while (group.key === state.prevGroupKey);
    state.currentGroup = group;
    state.prevGroupKey = group.key;
    renderGroup(group);
  }

  // Advance one cycle, dispatching on the selected group size.
  function advance() {
    if (state.groupSize === 1) nextNote();
    else nextGroup();
  }

  function updateCountdown(progress) {
    // progress 0 -> full (ring drawn / bar full), 1 -> empty
    dom.countdownArc.style.strokeDashoffset = (CIRC * progress).toFixed(2);
    dom.countdownBarFill.style.width = ((1 - progress) * 100).toFixed(1) + "%";
  }

  function tick(now) {
    if (!state.running) return;
    const elapsed = now - state.cycleStart;
    let progress = elapsed / state.cycleMs;
    if (progress >= 1) {
      advance();
      state.cycleStart = now;
      progress = 0;
    }
    updateCountdown(progress);
    state.rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (state.running) return;
    state.cycleMs = readCycleMs();
    state.running = true;
    state.prevNote = null;
    state.prevGroupKey = null;
    dom.startStop.textContent = "Stop";
    dom.startStop.classList.add("is-running");
    advance();                      // first note/group immediately
    state.cycleStart = performance.now();
    updateCountdown(0);
    state.rafId = requestAnimationFrame(tick);
  }

  function clearGroupDisplay() {
    dom.notesRow.innerHTML = "";
    dom.groupAnnotation.innerHTML = "";
    state.currentGroup = null;
  }

  function stop() {
    if (!state.running) return;
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    dom.startStop.textContent = "Start";
    dom.startStop.classList.remove("is-running");
    dom.noteText.textContent = "—";
    dom.noteText.classList.add("is-empty");
    state.currentNote = null;
    clearGroupDisplay();
    clearDots();
    updateCountdown(1);             // empty ring / bar
  }

  function toggleRun() { state.running ? stop() : start(); }

  /* ====================================================
     4. UI WIRING
     ==================================================== */
  function readCycleMs() {
    let v = parseInt(dom.cycleInput.value, 10);
    if (isNaN(v)) v = 5;
    v = Math.max(1, Math.min(60, v));
    dom.cycleInput.value = String(v);
    return v * 1000;
  }

  function buildStringSelector() {
    const wrap = dom.stringSelector;
    wrap.innerHTML = "";
    STRINGS.forEach((s, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "seg-btn" + (i === state.stringIndex ? " is-active" : "");
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", i === state.stringIndex ? "true" : "false");
      btn.dataset.string = String(i);
      btn.innerHTML = `<span class="s-main">${s.name}</span><span class="s-sub">${s.sub}</span>`;
      wrap.appendChild(btn);
    });
  }

  function selectString(i) {
    state.stringIndex = i;
    Array.from(dom.stringSelector.children).forEach((btn, idx) => {
      const active = idx === i;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", active ? "true" : "false");
    });
    dom.stringReadout.textContent = STRINGS[i].readout;
    setSelectedString(i);
    refreshBoard(); // re-render live (single-note mode uses the selected string)
  }

  function setMode(mode) {
    state.mode = mode;
    dom.app.classList.toggle("mode-practice", mode === "practice");
    Array.from(dom.modeToggle.children).forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", active ? "true" : "false");
    });
    dom.modeHint.textContent = mode === "guide"
      ? "Guide shows the fretboard with the note's position."
      : "Practice shows only the note name — no diagram.";
    refreshBoard();
  }

  function setShowNotes(on) {
    state.showNotes = on;
    dom.app.classList.toggle("show-notes", on);
    dom.showNotesToggle.classList.toggle("is-on", on);
    dom.showNotesToggle.setAttribute("aria-checked", on ? "true" : "false");
    renderAllNotes(on);
    // Toggling the map can reveal/hide the board (Practice mode); keep the
    // active note/group dots in sync with the board's visibility.
    refreshBoard();
  }

  function setGroupSize(n) {
    state.groupSize = n;
    const multi = n > 1;
    dom.app.classList.toggle("group-multi", multi);
    Array.from(dom.groupSelector.children).forEach((btn) => {
      const active = Number(btn.dataset.group) === n;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", active ? "true" : "false");
    });
    if (state.running) {
      // Show a fresh note/group of the new size and restart the cycle cleanly.
      state.prevNote = null;
      state.prevGroupKey = null;
      advance();
      state.cycleStart = performance.now();
      updateCountdown(0);
    } else {
      // Idle: clear both displays.
      state.currentNote = null;
      clearGroupDisplay();
      dom.noteText.textContent = "—";
      dom.noteText.classList.add("is-empty");
      clearDots();
    }
  }

  function setCyclePreset(seconds) {
    dom.cycleInput.value = String(seconds);
    Array.from(dom.cyclePresets.children).forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.cycle) === seconds);
    });
    if (state.running) {
      state.cycleMs = readCycleMs();
      state.cycleStart = performance.now(); // restart current cycle cleanly
    }
  }

  function init() {
    dom.app = document.querySelector(".app");
    dom.stringSelector = document.getElementById("string-selector");
    dom.cyclePresets = document.getElementById("cycle-presets");
    dom.cycleInput = document.getElementById("cycle-input");
    dom.modeToggle = document.getElementById("mode-toggle");
    dom.modeHint = document.getElementById("mode-hint");
    dom.showNotesToggle = document.getElementById("show-notes-toggle");
    dom.groupSelector = document.getElementById("group-selector");
    dom.startStop = document.getElementById("start-stop");
    dom.noteText = document.getElementById("note-text");
    dom.stringReadout = document.getElementById("string-readout");
    dom.countdownArc = document.getElementById("countdown-arc");
    dom.countdownBarFill = document.getElementById("countdown-bar-fill");
    dom.notesRow = document.getElementById("notes-row");
    dom.groupAnnotation = document.getElementById("group-annotation");

    // Countdown ring setup (idle = empty).
    dom.countdownArc.style.strokeDasharray = CIRC.toFixed(2);
    updateCountdown(1);
    dom.noteText.classList.add("is-empty");

    // Build UI pieces.
    buildFretboard(document.getElementById("fretboard"));
    buildStringSelector();
    selectString(state.stringIndex);
    setMode(state.mode);
    setShowNotes(state.showNotes);
    setGroupSize(state.groupSize);

    // Highlight the matching cycle preset (default 5s).
    Array.from(dom.cyclePresets.children).forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.cycle) === 5);
    });

    // Events.
    dom.stringSelector.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-string]");
      if (btn) selectString(Number(btn.dataset.string));
    });
    dom.modeToggle.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mode]");
      if (btn) setMode(btn.dataset.mode);
    });
    dom.cyclePresets.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-cycle]");
      if (btn) setCyclePreset(Number(btn.dataset.cycle));
    });
    dom.cycleInput.addEventListener("input", () => {
      // Clear preset highlight when typing a custom value.
      Array.from(dom.cyclePresets.children).forEach((btn) =>
        btn.classList.toggle("is-active", Number(btn.dataset.cycle) === Number(dom.cycleInput.value))
      );
      if (state.running) {
        state.cycleMs = readCycleMs();
        state.cycleStart = performance.now();
      }
    });
    dom.showNotesToggle.addEventListener("click", () => setShowNotes(!state.showNotes));
    dom.groupSelector.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-group]");
      if (btn) setGroupSize(Number(btn.dataset.group));
    });
    dom.startStop.addEventListener("click", toggleRun);

    // Spacebar toggles Start/Stop (ignore when a button/input is focused so it
    // doesn't double-fire with that element's own activation).
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !/^(BUTTON|INPUT)$/.test(e.target.tagName)) {
        e.preventDefault();
        toggleRun();
      }
    });
  }

  /* ====================================================
     5. OPTIONAL SELF-TEST  ->  open with ?test
     ==================================================== */
  function runSelfTest() {
    const lowE = STRINGS[0].openIndex;   // 7
    const bStr = STRINGS[4].openIndex;   // 2
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const cases = [
      ["low E · A", fretsForNote(lowE, "A"), [5, 17]],
      ["low E · E", fretsForNote(lowE, "E"), [12]],
      ["low E · G", fretsForNote(lowE, "G"), [3, 15]],
      ["B · C",     fretsForNote(bStr, "C"), [1, 13]],
      ["B · B",     fretsForNote(bStr, "B"), [12]],
      ["B · F#",    fretsForNote(bStr, "F#"), [7]],
    ];
    let pass = 0;
    cases.forEach(([label, got, want]) => {
      const ok = eq(got, want);
      if (ok) pass++;
      console.assert(ok, `FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      console.log(`${ok ? "✓" : "✗"} ${label} -> ${JSON.stringify(got)}`);
    });
    console.log(`Self-test: ${pass}/${cases.length} passed.`);
  }

  document.addEventListener("DOMContentLoaded", () => {
    init();
    if (new URLSearchParams(location.search).has("test")) runSelfTest();
  });
})();
