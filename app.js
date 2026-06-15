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
    padLeft: 48, padRight: 18, padTop: 26, padBottom: 28,
    fretSpacing: 40, stringSpacing: 26, fretCount: FRET_MAX,
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
    svg: null, dotLayer: null, selectedRow: null, labels: [],
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
      x: G.nutX, y: G.boardTop - 11,
      width: G.boardRight - G.nutX,
      height: (G.boardBottom - G.boardTop) + 22,
      rx: 6,
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
      svg.appendChild(svgEl("circle", { class: "fb-inlay", cx: fretCenterX(f), cy: midY, r: 5 }));
    });
    DOUBLE_INLAYS.forEach((f) => {
      svg.appendChild(svgEl("circle", { class: "fb-inlay", cx: fretCenterX(f), cy: G.boardTop + 1.5 * G.stringSpacing, r: 5 }));
      svg.appendChild(svgEl("circle", { class: "fb-inlay", cx: fretCenterX(f), cy: G.boardTop + 3.5 * G.stringSpacing, r: 5 }));
    });

    // Fret wires (1..17).
    for (let f = 1; f <= G.fretCount; f++) {
      svg.appendChild(svgEl("line", {
        class: "fb-fret",
        x1: fretWireX(f), y1: G.boardTop - 11,
        x2: fretWireX(f), y2: G.boardBottom + 11,
      }));
    }
    // Nut (thicker, at fret 0).
    svg.appendChild(svgEl("line", {
      class: "fb-nut",
      x1: G.nutX, y1: G.boardTop - 11, x2: G.nutX, y2: G.boardBottom + 11,
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

    // Dot layer (drawn last so dots sit on top).
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
      g.appendChild(svgEl("circle", { class: "fb-dot", cx: fretCenterX(f), cy: y, r: 11 }));
      const t = svgEl("text", { class: "fb-dot-label", x: fretCenterX(f), y: y });
      t.textContent = note;
      g.appendChild(t);
      fb.dotLayer.appendChild(g);
    });
  }

  /* ====================================================
     3. TIMER ENGINE + DISPLAY
     ==================================================== */
  const CIRC = 2 * Math.PI * 54;

  const state = {
    running: false,
    mode: "guide",        // "guide" | "practice"
    stringIndex: 0,       // low E
    cycleMs: 5000,
    prevNote: null,
    currentNote: null,
    cycleStart: 0,
    rafId: null,
  };

  // DOM refs (assigned on init).
  const dom = {};

  function popNote() {
    dom.noteText.classList.remove("pop");
    void dom.noteText.offsetWidth; // force reflow to restart animation
    dom.noteText.classList.add("pop");
  }

  function renderNote(note) {
    dom.noteText.textContent = note;
    dom.noteText.classList.remove("is-empty");
    popNote();
    if (state.mode === "guide") showDots(state.stringIndex, note);
    else clearDots();
  }

  function nextNote() {
    const note = randomNote(state.prevNote);
    state.currentNote = note;
    state.prevNote = note;
    renderNote(note);
  }

  function updateCountdown(progress) {
    // progress 0 -> full ring, 1 -> empty
    dom.countdownArc.style.strokeDashoffset = (CIRC * progress).toFixed(2);
  }

  function tick(now) {
    if (!state.running) return;
    const elapsed = now - state.cycleStart;
    let progress = elapsed / state.cycleMs;
    if (progress >= 1) {
      nextNote();
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
    dom.startStop.textContent = "Stop";
    dom.startStop.classList.add("is-running");
    nextNote();                     // first note immediately
    state.cycleStart = performance.now();
    updateCountdown(0);
    state.rafId = requestAnimationFrame(tick);
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
    clearDots();
    updateCountdown(1);             // empty ring
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
    // Re-render dots live if a note is on screen in guide mode.
    if (state.mode === "guide" && state.currentNote) showDots(i, state.currentNote);
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
    if (mode === "guide" && state.currentNote) showDots(state.stringIndex, state.currentNote);
    else clearDots();
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
    dom.startStop = document.getElementById("start-stop");
    dom.noteText = document.getElementById("note-text");
    dom.stringReadout = document.getElementById("string-readout");
    dom.countdownArc = document.getElementById("countdown-arc");

    // Countdown ring setup (idle = empty).
    dom.countdownArc.style.strokeDasharray = CIRC.toFixed(2);
    updateCountdown(1);
    dom.noteText.classList.add("is-empty");

    // Build UI pieces.
    buildFretboard(document.getElementById("fretboard"));
    buildStringSelector();
    selectString(state.stringIndex);
    setMode(state.mode);

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
