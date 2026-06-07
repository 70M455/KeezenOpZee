/* ============================================================
   BOARD — SVG rendering with rounded corners and boat-shaped pieces
   ============================================================ */

const Board = (() => {
  const SIZE = 760;
  const CENTER = SIZE / 2;
  const TRACK_PADDING = 70;
  const CELL_R = 18;
  const CORNER_R = 60;   // rounded corner radius for the track loop

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

  /* Rotation in degrees so the boat sail points "outward" away from center */
  const BOAT_ROTATION = [180, 270, 0, 90];

  /* ============================================================
     SVG BUILDER
     ============================================================ */
  function buildBoard(containerEl) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `${-40} ${-40} ${SIZE + 80} ${SIZE + 80}`);
    svg.setAttribute('class', 'board-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    /* Defs: gradients for sails (player colors) and reusable shapes */
    const defs = document.createElementNS(svgNS, 'defs');
    const colors = [
      { id: 'p0', light: '#ffe770', mid: '#e8c547', dark: '#a8841d' },
      { id: 'p1', light: '#f1574a', mid: '#c0392b', dark: '#7a1f15' },
      { id: 'p2', light: '#4ec182', mid: '#2e8b57', dark: '#1a5535' },
      { id: 'p3', light: '#5aa7df', mid: '#2b6cb0', dark: '#173d66' },
    ];
    colors.forEach(c => {
      const grad = document.createElementNS(svgNS, 'linearGradient');
      grad.setAttribute('id', `sail-${c.id}`);
      grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
      grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
      const s1 = document.createElementNS(svgNS, 'stop');
      s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', c.light);
      const s2 = document.createElementNS(svgNS, 'stop');
      s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', c.mid);
      grad.appendChild(s1); grad.appendChild(s2);
      defs.appendChild(grad);
    });

    // Hull gradient — warm wood for all boats
    const hullGrad = document.createElementNS(svgNS, 'linearGradient');
    hullGrad.setAttribute('id', 'hull-grad');
    hullGrad.setAttribute('x1', '0'); hullGrad.setAttribute('y1', '0');
    hullGrad.setAttribute('x2', '0'); hullGrad.setAttribute('y2', '1');
    const h1 = document.createElementNS(svgNS, 'stop');
    h1.setAttribute('offset', '0%'); h1.setAttribute('stop-color', '#a87a4a');
    const h2 = document.createElementNS(svgNS, 'stop');
    h2.setAttribute('offset', '100%'); h2.setAttribute('stop-color', '#5a3a20');
    hullGrad.appendChild(h1); hullGrad.appendChild(h2);
    defs.appendChild(hullGrad);

    svg.appendChild(defs);

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
    svg.appendChild(loop);

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
    svg.appendChild(rose);

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
        svg.appendChild(cell);
        // Star marker for start
        const star = document.createElementNS(svgNS, 'text');
        star.setAttribute('x', x); star.setAttribute('y', y + 6);
        star.setAttribute('text-anchor', 'middle');
        star.setAttribute('font-size', '17');
        star.setAttribute('fill', 'rgba(0,0,0,0.45)');
        star.setAttribute('pointer-events', 'none');
        star.textContent = '★';
        svg.appendChild(star);
      } else {
        svg.appendChild(cell);
      }
    }

    /* Home cells */
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
        svg.appendChild(cell);
        if (s === 3) {
          // Anchor at the deepest home cell
          const house = document.createElementNS(svgNS, 'text');
          house.setAttribute('x', x);
          house.setAttribute('y', y + 5);
          house.setAttribute('text-anchor', 'middle');
          house.setAttribute('font-size', '14');
          house.setAttribute('fill', 'rgba(0,0,0,0.5)');
          house.setAttribute('pointer-events', 'none');
          house.textContent = '⚓';
          svg.appendChild(house);
        }
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
        svg.appendChild(cell);
      }
    }

    /* Boats (one group per piece) */
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 4; i++) {
        const boat = buildBoat(p);
        boat.setAttribute('id', `piece-${p}-${i}`);
        boat.setAttribute('data-piece-player', p);
        boat.setAttribute('data-piece-index', i);
        const { x, y } = kennelXY(p, i);
        boat.setAttribute('transform', `translate(${x}, ${y}) rotate(${BOAT_ROTATION[p]})`);
        svg.appendChild(boat);
      }
    }

    containerEl.innerHTML = '';
    containerEl.appendChild(svg);
    return svg;
  }

  /* Build a boat-shaped piece for player p */
  function buildBoat(p) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', `piece piece-p${p}`);

    // Hull — a small ship hull (curve at bottom)
    const hull = document.createElementNS(svgNS, 'path');
    hull.setAttribute('d', 'M -13 1 Q -14 7 -8 9 L 8 9 Q 14 7 13 1 Z');
    hull.setAttribute('fill', 'url(#hull-grad)');
    hull.setAttribute('stroke', '#3a2410');
    hull.setAttribute('stroke-width', '1.2');
    g.appendChild(hull);

    // Deck line
    const deck = document.createElementNS(svgNS, 'line');
    deck.setAttribute('x1', -12); deck.setAttribute('y1', 1);
    deck.setAttribute('x2', 12);  deck.setAttribute('y2', 1);
    deck.setAttribute('stroke', '#3a2410');
    deck.setAttribute('stroke-width', '1');
    g.appendChild(deck);

    // Mast
    const mast = document.createElementNS(svgNS, 'line');
    mast.setAttribute('x1', 0); mast.setAttribute('y1', 1);
    mast.setAttribute('x2', 0); mast.setAttribute('y2', -14);
    mast.setAttribute('stroke', '#3a2410');
    mast.setAttribute('stroke-width', '1.4');
    g.appendChild(mast);

    // Sail — colored triangle with player color
    const sail = document.createElementNS(svgNS, 'path');
    sail.setAttribute('d', 'M 0 -14 L 9 -3 L 0 -2 Z');
    sail.setAttribute('fill', `url(#sail-p${p})`);
    sail.setAttribute('stroke', '#3a2410');
    sail.setAttribute('stroke-width', '1');
    g.appendChild(sail);

    // Tiny pennant flag on top
    const flag = document.createElementNS(svgNS, 'path');
    flag.setAttribute('d', 'M 0 -14 L 4 -16 L 0 -17 Z');
    flag.setAttribute('fill', `url(#sail-p${p})`);
    flag.setAttribute('stroke', '#3a2410');
    flag.setAttribute('stroke-width', '0.6');
    g.appendChild(flag);

    return g;
  }

  /* Update piece positions based on game state */
  function updatePieces(svg, players) {
    players.forEach((player, pIdx) => {
      player.pieces.forEach((piece, idx) => {
        const el = svg.querySelector(`#piece-${pIdx}-${idx}`);
        if (!el) return;
        const { x, y } = pieceXY(piece.location, pIdx);
        el.setAttribute('transform', `translate(${x}, ${y}) rotate(${BOAT_ROTATION[pIdx]})`);
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

  return {
    SIZE, CENTER, START_POS, TRACK_LEN,
    buildBoard,
    updatePieces,
    clearHighlights,
    markSelectablePieces,
    markSelectedPiece,
    markTargetCells,
    trackXY, homeXY, kennelXY, pieceXY,
  };
})();
