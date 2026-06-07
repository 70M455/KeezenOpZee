/* ============================================================
   BOARD — SVG rendering with rounded corners and boat-shaped pieces
   ============================================================ */

const Board = (() => {
  const SIZE = 820;
  const CENTER = SIZE / 2;
  const TRACK_PADDING = 80;
  const CELL_R = 22;
  const CORNER_R = 70;   // rounded corner radius for the track loop

  const TRACK_LEN = 64;
  const CELLS_PER_SIDE = 16;

  // Player start positions — middle of each side
  // P0 = top, P1 = right, P2 = bottom, P3 = left
  const START_POS = [8, 24, 40, 56];

  /* Inward direction for each player (toward center) */
  const INWARD = [
    { x: 0, y: 1 },   // P0 top → down
    { x: -1, y: 0 },  // P1 right → left
    { x: 0, y: -1 },  // P2 bottom → up
    { x: 1, y: 0 },   // P3 left → right
  ];

  /* Length of straight section per side, length of arc per corner */
  const innerSize = SIZE - 2 * TRACK_PADDING;
  const straightLen = innerSize - 2 * CORNER_R;
  const arcLen = 0.5 * Math.PI * CORNER_R;
  const sideLen = straightLen + arcLen;
  const cellSpacing = sideLen / CELLS_PER_SIDE;

  /* ============================================================
     Compute (x, y) for absolute track position 0..63
     Track is a rounded square; positions are evenly distributed
     ============================================================ */
  function trackXY(pos) {
    const side = Math.floor(pos / CELLS_PER_SIDE);   // 0=top, 1=right, 2=bottom, 3=left
    const offset = pos % CELLS_PER_SIDE;
    const distance = (offset + 0.5) * cellSpacing;

    const m = TRACK_PADDING;
    if (distance <= straightLen) {
      // On straight portion
      if (side === 0) return { x: m + CORNER_R + distance,             y: m };
      if (side === 1) return { x: SIZE - m,                            y: m + CORNER_R + distance };
      if (side === 2) return { x: SIZE - m - CORNER_R - distance,      y: SIZE - m };
      return                  { x: m,                                  y: SIZE - m - CORNER_R - distance };
    }
    // On corner arc (trailing this side's straight)
    const arcD = distance - straightLen;
    const arcT = arcD / CORNER_R; // 0..PI/2
    if (side === 0) {
      // Top-right corner
      return {
        x: (SIZE - m - CORNER_R) + CORNER_R * Math.sin(arcT),
        y: (m + CORNER_R) - CORNER_R * Math.cos(arcT),
      };
    }
    if (side === 1) {
      // Bottom-right corner
      return {
        x: (SIZE - m - CORNER_R) + CORNER_R * Math.cos(arcT),
        y: (SIZE - m - CORNER_R) + CORNER_R * Math.sin(arcT),
      };
    }
    if (side === 2) {
      // Bottom-left corner
      return {
        x: (m + CORNER_R) - CORNER_R * Math.sin(arcT),
        y: (SIZE - m - CORNER_R) + CORNER_R * Math.cos(arcT),
      };
    }
    // Top-left corner
    return {
      x: (m + CORNER_R) - CORNER_R * Math.cos(arcT),
      y: (m + CORNER_R) - CORNER_R * Math.sin(arcT),
    };
  }

  /* Home cell coordinates (going inward from start) */
  function homeXY(playerIdx, slot) {
    const start = trackXY(START_POS[playerIdx]);
    const dir = INWARD[playerIdx];
    const stepIn = 44;
    return {
      x: start.x + dir.x * (slot + 1) * stepIn,
      y: start.y + dir.y * (slot + 1) * stepIn,
    };
  }

  /* Kennel coordinates: outside the track, parallel to side, centered on start */
  function kennelXY(playerIdx, slot) {
    const start = trackXY(START_POS[playerIdx]);
    const spacing = 42;
    const outward = 40;
    const spread = (slot - 1.5) * spacing;

    if (playerIdx === 0) return { x: start.x + spread, y: start.y - outward };
    if (playerIdx === 1) return { x: start.x + outward, y: start.y + spread };
    if (playerIdx === 2) return { x: start.x - spread, y: start.y + outward };
    return                       { x: start.x - outward, y: start.y - spread };
  }

  function pieceXY(location, playerIdx) {
    if (location.type === 'kennel') return kennelXY(playerIdx, location.slot);
    if (location.type === 'track')  return trackXY(location.pos);
    if (location.type === 'home')   return homeXY(playerIdx, location.slot);
    return { x: 0, y: 0 };
  }

  /* Dynamic rotation so the mast always points to the board center */
  function rotationFor(location, playerIdx) {
    const { x, y } = pieceXY(location, playerIdx);
    const dx = CENTER - x;
    const dy = CENTER - y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return 0;
    // Default mast direction is (0, -1) (up). Rotate so mast points to (dx, dy).
    return Math.atan2(dx, -dy) * 180 / Math.PI;
  }

  /* ============================================================
     SVG BUILDER
     ============================================================ */
  function buildBoard(containerEl) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `${-40} ${-40} ${SIZE + 80} ${SIZE + 80}`);
    svg.setAttribute('class', 'board-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    /* Defs: solid colour swatches for each player's hull (kept simple for clarity) */
    const defs = document.createElementNS(svgNS, 'defs');
    svg.appendChild(defs);

    /* Wrapper group used to rotate the whole board so the viewing seat is at the bottom */
    const root = document.createElementNS(svgNS, 'g');
    root.setAttribute('id', 'board-root');
    svg.appendChild(root);

    /* Track loop background (rounded rectangle behind cells) */
    const loop = document.createElementNS(svgNS, 'path');
    const m = TRACK_PADDING;
    const r = CORNER_R;
    loop.setAttribute('d',
      `M ${m + r} ${m} ` +
      `H ${SIZE - m - r} A ${r} ${r} 0 0 1 ${SIZE - m} ${m + r} ` +
      `V ${SIZE - m - r} A ${r} ${r} 0 0 1 ${SIZE - m - r} ${SIZE - m} ` +
      `H ${m + r} A ${r} ${r} 0 0 1 ${m} ${SIZE - m - r} ` +
      `V ${m + r} A ${r} ${r} 0 0 1 ${m + r} ${m} Z`
    );
    loop.setAttribute('fill', 'none');
    loop.setAttribute('stroke', 'rgba(90, 64, 35, 0.25)');
    loop.setAttribute('stroke-width', '36');
    loop.setAttribute('stroke-linejoin', 'round');
    root.appendChild(loop);

    /* Compass rose center */
    const rose = document.createElementNS(svgNS, 'g');
    rose.setAttribute('class', 'compass-rose');
    rose.setAttribute('transform', `translate(${CENTER}, ${CENTER})`);
    const roseR = 78;
    const points = [];
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const long = (i % 2 === 0);
      const rr = long ? roseR : roseR * 0.42;
      points.push(`${Math.cos(ang) * rr},${Math.sin(ang) * rr}`);
    }
    const star = document.createElementNS(svgNS, 'polygon');
    star.setAttribute('points', points.join(' '));
    star.setAttribute('fill', '#8b6f47');
    star.setAttribute('stroke', '#5a4023');
    star.setAttribute('stroke-width', '2');
    rose.appendChild(star);
    const cr = document.createElementNS(svgNS, 'circle');
    cr.setAttribute('r', 18); cr.setAttribute('fill', '#c9a96e'); cr.setAttribute('stroke', '#5a4023'); cr.setAttribute('stroke-width', '2');
    rose.appendChild(cr);
    const letterN = document.createElementNS(svgNS, 'text');
    letterN.setAttribute('text-anchor', 'middle');
    letterN.setAttribute('y', -roseR + 4);
    letterN.setAttribute('fill', '#5a4023');
    letterN.setAttribute('font-family', 'Pirata One, serif');
    letterN.setAttribute('font-size', '20');
    letterN.textContent = 'N';
    rose.appendChild(letterN);
    root.appendChild(rose);

    /* Track cells */
    for (let i = 0; i < TRACK_LEN; i++) {
      const { x, y } = trackXY(i);
      const cell = document.createElementNS(svgNS, 'circle');
      cell.setAttribute('cx', x);
      cell.setAttribute('cy', y);
      cell.setAttribute('r', CELL_R);
      cell.setAttribute('class', 'cell-bg');
      cell.setAttribute('data-cell-type', 'track');
      cell.setAttribute('data-cell-pos', i);
      cell.setAttribute('id', `cell-track-${i}`);

      const startIdx = START_POS.indexOf(i);
      if (startIdx >= 0) {
        cell.classList.add(`cell-start-p${startIdx}`);
        cell.setAttribute('r', CELL_R + 3);
        root.appendChild(cell);
        // Star marker for start
        const star = document.createElementNS(svgNS, 'text');
        star.setAttribute('x', x); star.setAttribute('y', y + 6);
        star.setAttribute('text-anchor', 'middle');
        star.setAttribute('font-size', '17');
        star.setAttribute('fill', 'rgba(0,0,0,0.45)');
        star.setAttribute('pointer-events', 'none');
        star.textContent = '★';
        root.appendChild(star);
      } else {
        root.appendChild(cell);
      }
    }

    /* Home cells — anchor symbol on every home slot */
    for (let p = 0; p < 4; p++) {
      for (let s = 0; s < 4; s++) {
        const { x, y } = homeXY(p, s);
        const cell = document.createElementNS(svgNS, 'circle');
        cell.setAttribute('cx', x);
        cell.setAttribute('cy', y);
        cell.setAttribute('r', CELL_R);
        cell.setAttribute('class', `cell-bg cell-home-p${p}`);
        cell.setAttribute('data-cell-type', 'home');
        cell.setAttribute('data-cell-player', p);
        cell.setAttribute('data-cell-slot', s);
        cell.setAttribute('id', `cell-home-${p}-${s}`);
        root.appendChild(cell);

        const anchor = document.createElementNS(svgNS, 'text');
        anchor.setAttribute('x', x);
        anchor.setAttribute('y', y + 6);
        anchor.setAttribute('text-anchor', 'middle');
        anchor.setAttribute('font-size', '16');
        anchor.setAttribute('fill', 'rgba(20,10,5,0.55)');
        anchor.setAttribute('pointer-events', 'none');
        anchor.textContent = '⚓';
        root.appendChild(anchor);
      }
    }

    /* Kennel cells */
    for (let p = 0; p < 4; p++) {
      for (let s = 0; s < 4; s++) {
        const { x, y } = kennelXY(p, s);
        const cell = document.createElementNS(svgNS, 'circle');
        cell.setAttribute('cx', x);
        cell.setAttribute('cy', y);
        cell.setAttribute('r', CELL_R);
        cell.setAttribute('class', `cell-bg cell-kennel-p${p}`);
        cell.setAttribute('data-cell-type', 'kennel');
        cell.setAttribute('data-cell-player', p);
        cell.setAttribute('data-cell-slot', s);
        cell.setAttribute('id', `cell-kennel-${p}-${s}`);
        root.appendChild(cell);
      }
    }

    /* Boats (one group per piece) */
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 4; i++) {
        const boat = buildBoat(p);
        boat.setAttribute('id', `piece-${p}-${i}`);
        boat.setAttribute('data-piece-player', p);
        boat.setAttribute('data-piece-index', i);
        const loc = { type: 'kennel', slot: i };
        const { x, y } = kennelXY(p, i);
        const rot = rotationFor(loc, p);
        boat.setAttribute('transform', `translate(${x}, ${y}) rotate(${rot})`);
        root.appendChild(boat);
      }
    }

    containerEl.innerHTML = '';
    containerEl.appendChild(svg);
    return svg;
  }

  /* Build a boat-shaped piece for player p — solid colours, thick dark outline */
  function buildBoat(p) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const COLORS = [
      { hull: '#f1cf3f', dark: '#7a5e10' }, // P0 sun yellow
      { hull: '#d8392a', dark: '#5d130a' }, // P1 red lighthouse
      { hull: '#2aa367', dark: '#0e3d23' }, // P2 deep sea green
      { hull: '#2c7fc9', dark: '#0e2f55' }, // P3 ocean blue
    ];
    const c = COLORS[p];

    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', `piece piece-p${p}`);

    // Hull — solid player colour, thick dark outline so it stands out on any background
    const hull = document.createElementNS(svgNS, 'path');
    hull.setAttribute('d', 'M -17 0 Q -19 10 -12 13 L 12 13 Q 19 10 17 0 Z');
    hull.setAttribute('fill', c.hull);
    hull.setAttribute('stroke', '#15080c');
    hull.setAttribute('stroke-width', '2.2');
    hull.setAttribute('stroke-linejoin', 'round');
    g.appendChild(hull);

    // Deck line (gunwale stripe)
    const deck = document.createElementNS(svgNS, 'path');
    deck.setAttribute('d', 'M -15 1 L 15 1');
    deck.setAttribute('stroke', '#15080c');
    deck.setAttribute('stroke-width', '1.6');
    g.appendChild(deck);

    // Mast — thick dark wooden mast pointing toward center
    const mast = document.createElementNS(svgNS, 'line');
    mast.setAttribute('x1', 0); mast.setAttribute('y1', 1);
    mast.setAttribute('x2', 0); mast.setAttribute('y2', -20);
    mast.setAttribute('stroke', '#15080c');
    mast.setAttribute('stroke-width', '2.2');
    mast.setAttribute('stroke-linecap', 'round');
    g.appendChild(mast);

    // Sail — bright white triangular sail with strong outline
    const sail = document.createElementNS(svgNS, 'path');
    sail.setAttribute('d', 'M 1 -19 L 13 -3 L 1 -3 Z');
    sail.setAttribute('fill', '#fdf8e8');
    sail.setAttribute('stroke', '#15080c');
    sail.setAttribute('stroke-width', '1.6');
    sail.setAttribute('stroke-linejoin', 'round');
    g.appendChild(sail);

    // Pennant flag in player colour at top of mast
    const flag = document.createElementNS(svgNS, 'path');
    flag.setAttribute('d', 'M 0 -20 L 8 -23 L 0 -25 Z');
    flag.setAttribute('fill', c.hull);
    flag.setAttribute('stroke', '#15080c');
    flag.setAttribute('stroke-width', '1.1');
    flag.setAttribute('stroke-linejoin', 'round');
    g.appendChild(flag);

    return g;
  }

  /* Rotate the board so the given seat (0..3) appears at the bottom of the screen */
  function setViewRotation(svg, viewingSeat) {
    const root = svg && svg.querySelector('#board-root');
    if (!root) return;
    const angle = (((2 - viewingSeat) % 4) + 4) % 4 * 90;
    root.setAttribute('transform', `rotate(${angle} ${CENTER} ${CENTER})`);
  }

  /* Update piece positions based on game state — mast always points to centre */
  function updatePieces(svg, players) {
    players.forEach((player, pIdx) => {
      player.pieces.forEach((piece, idx) => {
        const el = svg.querySelector(`#piece-${pIdx}-${idx}`);
        if (!el) return;
        const { x, y } = pieceXY(piece.location, pIdx);
        const rot = rotationFor(piece.location, pIdx);
        el.setAttribute('transform', `translate(${x}, ${y}) rotate(${rot})`);
      });
    });
  }

  function clearHighlights(svg) {
    svg.querySelectorAll('.cell-target, .cell-selectable').forEach(el => {
      el.classList.remove('cell-target', 'cell-selectable');
    });
    svg.querySelectorAll('.piece.selectable, .piece.selected').forEach(el => {
      el.classList.remove('selectable', 'selected');
    });
  }

  function markSelectablePieces(svg, pieceIds) {
    pieceIds.forEach(id => {
      const el = svg.querySelector(`#${id}`);
      if (el) el.classList.add('selectable');
    });
  }

  function markSelectedPiece(svg, pieceId) {
    svg.querySelectorAll('.piece.selected').forEach(p => p.classList.remove('selected'));
    if (pieceId) {
      const el = svg.querySelector(`#${pieceId}`);
      if (el) el.classList.add('selected');
    }
  }

  function markTargetCells(svg, cellIds) {
    cellIds.forEach(id => {
      const el = svg.querySelector(`#${id}`);
      if (el) el.classList.add('cell-target');
    });
  }

  /* Show a sequence of step numbers (1, 2, 3, ...) on cells of a path */
  function drawPathNumbers(svg, playerIdx, path) {
    clearPathNumbers(svg);
    if (!path || path.length === 0) return;
    const root = svg.querySelector('#board-root') || svg;
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('id', 'path-numbers');
    for (let i = 0; i < path.length; i++) {
      const loc = path[i];
      const xy = pieceXY(loc, playerIdx);
      // Bubble
      const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circ.setAttribute('cx', xy.x);
      circ.setAttribute('cy', xy.y);
      circ.setAttribute('r', 10);
      circ.setAttribute('fill', '#fff4a0');
      circ.setAttribute('stroke', '#5a4023');
      circ.setAttribute('stroke-width', '1.5');
      circ.setAttribute('opacity', '0.9');
      layer.appendChild(circ);
      // Number
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', xy.x);
      text.setAttribute('y', xy.y + 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-family', 'Cinzel, serif');
      text.setAttribute('font-size', '13');
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', '#2a1810');
      text.textContent = (i + 1);
      layer.appendChild(text);
    }
    root.appendChild(layer);
  }

  function clearPathNumbers(svg) {
    const el = svg && svg.querySelector('#path-numbers');
    if (el) el.remove();
  }

  return {
    SIZE, CENTER, START_POS, TRACK_LEN,
    buildBoard,
    updatePieces,
    clearHighlights,
    markSelectablePieces,
    markSelectedPiece,
    markTargetCells,
    trackXY, homeXY, kennelXY, pieceXY,
    rotationFor,
    setViewRotation,
    drawPathNumbers,
    clearPathNumbers,
  };
})();
