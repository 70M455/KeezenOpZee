/* ============================================================
   GAME — State + rules engine for Keezen
   ============================================================ */

const Game = (() => {
  const TRACK_LEN = 64;
  const START_POS = [8, 24, 40, 56];
  const HOME_LEN = 4;
  const NUM_PIECES = 4;

  // Cards per round (for 4 players, 13 cards per player per deal)
  // Round 1: 5, Round 2: 4, Round 3: 4 = 13 total. Across 4 players = 52 (full deck).
  const ROUND_CARD_COUNT = [5, 4, 4];

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  /* ------------------------------------------------------------
     Deck
     ------------------------------------------------------------ */
  function makeDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit, id: `${rank}${suit}` });
      }
    }
    return deck;
  }

  function shuffle(arr, rngFn) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rngFn() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Simple seeded RNG (mulberry32)
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------
     Initial state
     ------------------------------------------------------------ */
  function newGame(playerInfos /* [{id, name, isBot}] */, seed) {
    const players = playerInfos.slice(0, 4).map((info, idx) => ({
      idx,
      id: info.id,
      name: info.name,
      isBot: !!info.isBot,
      team: idx % 2,                 // P0+P2 vs P1+P3
      hand: [],
      pieces: Array.from({ length: NUM_PIECES }, (_, i) => ({
        index: i,
        location: { type: 'kennel', slot: i },
        hasLeftStart: false,
      })),
      passed: false,                  // passed this round (cards discarded)
    }));

    // Fill missing seats with bots
    while (players.length < 4) {
      const idx = players.length;
      players.push({
        idx,
        id: `bot-${idx}`,
        name: ['Kapitein Bot', 'Stuurman Bot', 'Bootsman Bot', 'Matroos Bot'][idx],
        isBot: true,
        team: idx % 2,
        hand: [],
        pieces: Array.from({ length: NUM_PIECES }, (_, i) => ({
          index: i,
          location: { type: 'kennel', slot: i },
          hasLeftStart: false,
        })),
        passed: false,
      });
    }

    const state = {
      players,
      currentPlayerIdx: 0,
      dealerIdx: 0,
      roundNumber: 1,            // 1, 2, 3 (then redeal)
      deck: [],
      discard: [],
      seed: seed || Math.floor(Math.random() * 1e9),
      phase: 'playing',          // 'playing' | 'finished'
      winnerTeam: null,
      log: [],
    };

    dealRound(state, 1);
    return state;
  }

  /* ------------------------------------------------------------
     Dealing
     ------------------------------------------------------------ */
  function dealRound(state, roundNumber) {
    const cardCount = ROUND_CARD_COUNT[roundNumber - 1];
    // For round 1, create a new deck and shuffle
    if (roundNumber === 1) {
      state.deck = shuffle(makeDeck(), makeRng(state.seed + state.dealerIdx * 1000));
      state.discard = [];
    }
    for (const p of state.players) {
      p.hand = [];
      p.passed = false;
    }
    // Deal starting from dealer + 1
    for (let i = 0; i < cardCount; i++) {
      for (let j = 0; j < 4; j++) {
        const pIdx = (state.dealerIdx + 1 + j) % 4;
        if (state.deck.length > 0) {
          state.players[pIdx].hand.push(state.deck.pop());
        }
      }
    }
    state.roundNumber = roundNumber;
    state.currentPlayerIdx = (state.dealerIdx + 1) % 4;
    state.log.push(`📜 Ronde ${roundNumber} — kaarten gedeeld`);
  }

  /* ------------------------------------------------------------
     Movement helpers
     ------------------------------------------------------------ */

  function pieceAt(state, location) {
    // Find which piece (player + piece index) is at this location
    for (const player of state.players) {
      for (const piece of player.pieces) {
        if (locationsEqual(piece.location, location)) {
          return { playerIdx: player.idx, piece };
        }
      }
    }
    return null;
  }

  function locationsEqual(a, b) {
    if (a.type !== b.type) return false;
    if (a.type === 'track') return a.pos === b.pos;
    if (a.type === 'home')  return a.slot === b.slot; // home is per-player; comparison only valid in same player context
    if (a.type === 'kennel') return a.slot === b.slot;
    return false;
  }

  function trackPieceAt(state, pos) {
    for (const player of state.players) {
      for (const piece of player.pieces) {
        if (piece.location.type === 'track' && piece.location.pos === pos) {
          return { playerIdx: player.idx, piece };
        }
      }
    }
    return null;
  }

  function homePieceAt(state, playerIdx, slot) {
    const p = state.players[playerIdx];
    for (const piece of p.pieces) {
      if (piece.location.type === 'home' && piece.location.slot === slot) {
        return piece;
      }
    }
    return null;
  }

  /* Is the given track position a START square with an owner piece on it? (blockade) */
  function isStartBlockade(state, pos) {
    const owner = START_POS.indexOf(pos);
    if (owner < 0) return false;
    const occupant = trackPieceAt(state, pos);
    if (!occupant) return false;
    return occupant.playerIdx === owner;
  }

  /* Simulate moving a piece forward N steps; returns final location or null if blocked */
  function simulateForward(state, playerIdx, piece, steps) {
    if (steps <= 0) return null;
    if (piece.location.type === 'kennel') return null;

    let current = { ...piece.location };
    let hasLeftStart = piece.hasLeftStart;
    const startPos = START_POS[playerIdx];

    for (let i = 0; i < steps; i++) {
      // Determine next position
      let next;
      if (current.type === 'track') {
        // If we're at the player's own startPos and have already left it, branch logic
        // Specifically: when going from start-1 (i.e., position startPos + TRACK_LEN - 1 mod TRACK_LEN)
        // to startPos, enter home if hasLeftStart.
        const nextTrackPos = (current.pos + 1) % TRACK_LEN;
        if (nextTrackPos === startPos && hasLeftStart) {
          next = { type: 'home', slot: 0 };
        } else {
          next = { type: 'track', pos: nextTrackPos };
        }
        // mark as left start
        if (current.pos === startPos) {
          hasLeftStart = true;
        }
      } else if (current.type === 'home') {
        if (current.slot >= HOME_LEN - 1) return null;
        next = { type: 'home', slot: current.slot + 1 };
      } else {
        return null;
      }

      // Check blockades and pass-through rules
      if (next.type === 'track') {
        if (isStartBlockade(state, next.pos)) return null;
      }

      // Final step: cannot land on own piece
      if (i === steps - 1) {
        if (next.type === 'track') {
          const occ = trackPieceAt(state, next.pos);
          if (occ && occ.playerIdx === playerIdx) return null;
        } else if (next.type === 'home') {
          const occ = homePieceAt(state, playerIdx, next.slot);
          if (occ) return null;
        }
      } else {
        // Intermediate: can't pass through own pieces in home stretch (cannot pass own piece in home)
        if (next.type === 'home') {
          const occ = homePieceAt(state, playerIdx, next.slot);
          if (occ) return null;
        }
        // Can pass through other pieces on track (except start blockades, handled above)
      }

      current = next;
    }

    return { location: current, hasLeftStart };
  }

  /* Simulate moving piece backward 4 (track only) */
  function simulateBackward(state, playerIdx, piece, steps) {
    if (piece.location.type !== 'track') return null;
    let pos = piece.location.pos;
    let hasLeftStart = piece.hasLeftStart;
    for (let i = 0; i < steps; i++) {
      pos = (pos - 1 + TRACK_LEN) % TRACK_LEN;
      // Cannot pass start blockade (its own player still wins)
      if (isStartBlockade(state, pos) && i < steps - 1) return null;
      if (i === steps - 1) {
        const occ = trackPieceAt(state, pos);
        if (occ && occ.playerIdx === playerIdx) return null;
        if (isStartBlockade(state, pos)) return null;
      }
    }
    // After backward move, mark hasLeftStart true if we moved past our start
    if (pos !== START_POS[playerIdx]) hasLeftStart = true;
    return { location: { type: 'track', pos }, hasLeftStart };
  }

  /* ------------------------------------------------------------
     Generate possible moves for a card
     A move is: { card, type, pieceRef, dest, swapWith?, splits? }
     ------------------------------------------------------------ */

  function getCardValue(card) {
    if (card.rank === 'A') return 1;
    if (card.rank === 'Q') return 12;
    if (card.rank === 'K') return null; // special
    if (card.rank === 'J') return null; // special (swap)
    if (card.rank === '7') return 7;    // special split
    if (card.rank === '4') return -4;   // backward
    return parseInt(card.rank, 10);
  }

  /* Pieces a player owns that are on the track (not kennel, not home) */
  function trackPieces(state, playerIdx) {
    return state.players[playerIdx].pieces.filter(p => p.location.type === 'track');
  }
  function kennelPieces(state, playerIdx) {
    return state.players[playerIdx].pieces.filter(p => p.location.type === 'kennel');
  }
  function trackOrHomePieces(state, playerIdx) {
    return state.players[playerIdx].pieces.filter(p => p.location.type !== 'kennel');
  }

  /* Returns true if player has any pieces left to advance (track/home with room) */
  function getMovesForCard(state, playerIdx, card) {
    const moves = [];
    const player = state.players[playerIdx];
    const startPos = START_POS[playerIdx];

    // Determine teammate index for "play teammate's pieces when own are home"
    const allMyPiecesHome = player.pieces.every(p => p.location.type === 'home');
    const effectivePlayerIdx = allMyPiecesHome ? (playerIdx + 2) % 4 : playerIdx;
    const movePieces = allMyPiecesHome ? state.players[effectivePlayerIdx].pieces : player.pieces;
    const teammateIdx = effectivePlayerIdx;

    // Helper to add a forward move
    const tryForward = (piece, steps) => {
      const result = simulateForward(state, teammateIdx, piece, steps);
      if (result) {
        moves.push({
          card, type: 'forward', steps,
          pieceRef: { playerIdx: teammateIdx, pieceIdx: piece.index },
          dest: result.location, hasLeftStart: result.hasLeftStart,
        });
      }
    };

    if (card.rank === 'A') {
      // Option 1: Exit kennel
      for (const piece of movePieces.filter(p => p.location.type === 'kennel')) {
        // Need to enter on own start; check it's not blocked by own piece
        const occ = trackPieceAt(state, START_POS[teammateIdx]);
        if (occ && occ.playerIdx === teammateIdx) continue;
        moves.push({
          card, type: 'exitKennel',
          pieceRef: { playerIdx: teammateIdx, pieceIdx: piece.index },
          dest: { type: 'track', pos: START_POS[teammateIdx] },
        });
      }
      // Option 2: Move 1 forward
      for (const piece of movePieces.filter(p => p.location.type !== 'kennel')) {
        tryForward(piece, 1);
      }
    } else if (card.rank === 'K') {
      // Only exit kennel
      for (const piece of movePieces.filter(p => p.location.type === 'kennel')) {
        const occ = trackPieceAt(state, START_POS[teammateIdx]);
        if (occ && occ.playerIdx === teammateIdx) continue;
        moves.push({
          card, type: 'exitKennel',
          pieceRef: { playerIdx: teammateIdx, pieceIdx: piece.index },
          dest: { type: 'track', pos: START_POS[teammateIdx] },
        });
      }
    } else if (card.rank === 'Q') {
      for (const piece of movePieces.filter(p => p.location.type !== 'kennel')) {
        tryForward(piece, 12);
      }
    } else if (card.rank === 'J') {
      // Swap: own track piece with any other player's track piece (not on own start square, not own teammate? rule allows any)
      const myTrackPieces = movePieces.filter(p => p.location.type === 'track');
      for (const mine of myTrackPieces) {
        // Cannot swap if mine is on its own start square (mine's owner is teammateIdx)
        if (mine.location.pos === START_POS[teammateIdx]) continue;
        for (const other of state.players) {
          if (other.idx === teammateIdx) continue;
          for (const otherPiece of other.pieces) {
            if (otherPiece.location.type !== 'track') continue;
            // Cannot swap with piece on its own start
            if (otherPiece.location.pos === START_POS[other.idx]) continue;
            moves.push({
              card, type: 'swap',
              pieceRef: { playerIdx: teammateIdx, pieceIdx: mine.index },
              swapWith: { playerIdx: other.idx, pieceIdx: otherPiece.index },
              dest: { ...otherPiece.location },
              swapDest: { ...mine.location },
            });
          }
        }
      }
    } else if (card.rank === '7') {
      // Split 7 between 1 or 2 own pieces. We add ALL possible single moves of N where N=1..7.
      // The full split is handled interactively (user selects pieces and splits).
      // For the validity check (canPlay), we just need ANY way to spend 7 totally.
      // For the actual move generation here, return the partial moves; UI handles iteration.
      for (const piece of movePieces.filter(p => p.location.type !== 'kennel')) {
        for (let steps = 1; steps <= 7; steps++) {
          const r = simulateForward(state, teammateIdx, piece, steps);
          if (r) {
            moves.push({
              card, type: 'sevenStep', steps,
              pieceRef: { playerIdx: teammateIdx, pieceIdx: piece.index },
              dest: r.location, hasLeftStart: r.hasLeftStart,
            });
          }
        }
      }
    } else if (card.rank === '4') {
      for (const piece of movePieces.filter(p => p.location.type === 'track')) {
        const r = simulateBackward(state, teammateIdx, piece, 4);
        if (r) {
          moves.push({
            card, type: 'backward', steps: 4,
            pieceRef: { playerIdx: teammateIdx, pieceIdx: piece.index },
            dest: r.location, hasLeftStart: r.hasLeftStart,
          });
        }
      }
    } else {
      const n = parseInt(card.rank, 10);
      for (const piece of movePieces.filter(p => p.location.type !== 'kennel')) {
        tryForward(piece, n);
      }
    }

    return moves;
  }

  /* Returns true if there's at least one valid action with the given card */
  function canPlayCard(state, playerIdx, card) {
    if (card.rank === '7') {
      // Special: must be able to fully spend 7
      return canSpendSeven(state, playerIdx);
    }
    return getMovesForCard(state, playerIdx, card).length > 0;
  }

  /* Can the player fully spend a 7? (split between 1-2 own pieces, total 7) */
  function canSpendSeven(state, playerIdx) {
    const player = state.players[playerIdx];
    const allMyHome = player.pieces.every(p => p.location.type === 'home');
    const effective = allMyHome ? (playerIdx + 2) % 4 : playerIdx;
    const pieces = state.players[effective].pieces.filter(p => p.location.type !== 'kennel');
    if (pieces.length === 0) return false;
    // Try single piece full 7
    for (const p of pieces) {
      if (simulateForward(state, effective, p, 7)) return true;
    }
    // Try splits
    for (let i = 0; i < pieces.length; i++) {
      for (let j = 0; j < pieces.length; j++) {
        if (i === j) continue;
        for (let s = 1; s <= 6; s++) {
          // Need to apply first move tentatively, then check second
          const r1 = simulateForward(state, effective, pieces[i], s);
          if (!r1) continue;
          const tempState = applyMoveTemporary(state, effective, pieces[i], r1, true);
          const piece2InTemp = tempState.players[effective].pieces[pieces[j].index];
          const r2 = simulateForward(tempState, effective, piece2InTemp, 7 - s);
          if (r2) return true;
        }
      }
    }
    return false;
  }

  /* Returns true if player can play ANY card in hand */
  function canPlayAny(state, playerIdx) {
    const player = state.players[playerIdx];
    if (player.hand.length === 0) return false;
    return player.hand.some(card => canPlayCard(state, playerIdx, card));
  }

  /* ------------------------------------------------------------
     Apply a move (mutate state)
     ------------------------------------------------------------ */
  function applyMove(state, playerIdx, move) {
    const targetPlayerIdx = move.pieceRef.playerIdx;
    const piece = state.players[targetPlayerIdx].pieces[move.pieceRef.pieceIdx];
    const cardIdx = state.players[playerIdx].hand.findIndex(c => c.id === move.card.id);
    if (cardIdx < 0) return false;

    // For swap, no need to remove pieces, just swap locations
    if (move.type === 'swap') {
      const otherPlayer = state.players[move.swapWith.playerIdx];
      const otherPiece = otherPlayer.pieces[move.swapWith.pieceIdx];
      const tmp = piece.location;
      piece.location = otherPiece.location;
      otherPiece.location = tmp;
      // hasLeftStart status follows the piece position
      piece.hasLeftStart = true;
      otherPiece.hasLeftStart = true;
      state.log.push(`🔄 ${state.players[playerIdx].name} ruilt schepen om`);
    } else if (move.type === 'exitKennel') {
      // Capture if opponent on start
      const occ = trackPieceAt(state, move.dest.pos);
      if (occ) {
        capturePiece(state, occ.playerIdx, occ.piece.index);
      }
      piece.location = { type: 'track', pos: move.dest.pos };
      piece.hasLeftStart = false;
      state.log.push(`⚓ ${state.players[playerIdx].name} vaart uit`);
    } else if (move.type === 'forward' || move.type === 'backward' || move.type === 'sevenStep') {
      // Capture if landing on opponent piece on track
      if (move.dest.type === 'track') {
        const occ = trackPieceAt(state, move.dest.pos);
        if (occ && occ.playerIdx !== targetPlayerIdx) {
          capturePiece(state, occ.playerIdx, occ.piece.index);
        }
      }
      piece.location = { ...move.dest };
      piece.hasLeftStart = move.hasLeftStart;
      const dirIcon = move.type === 'backward' ? '⬅' : '➡';
      state.log.push(`${dirIcon} ${state.players[playerIdx].name} verzet een schip`);
    }

    // Remove the card from hand and discard
    const [used] = state.players[playerIdx].hand.splice(cardIdx, 1);
    state.discard.push(used);

    // Check win condition
    checkWin(state);

    return true;
  }

  /* Apply a temporary forward result (used for 7-card check) — returns a deep-cloned new state */
  function applyMoveTemporary(state, playerIdx, piece, result, /*forSevenCheck*/ _) {
    const newState = deepClone(state);
    const np = newState.players[playerIdx].pieces[piece.index];
    if (result.location.type === 'track') {
      const occ = trackPieceAt(newState, result.location.pos);
      if (occ && occ.playerIdx !== playerIdx) {
        capturePiece(newState, occ.playerIdx, occ.piece.index);
      }
    }
    np.location = { ...result.location };
    np.hasLeftStart = result.hasLeftStart;
    return newState;
  }

  function capturePiece(state, playerIdx, pieceIdx) {
    const p = state.players[playerIdx].pieces[pieceIdx];
    // Find empty kennel slot
    const used = state.players[playerIdx].pieces
      .filter(x => x.location.type === 'kennel')
      .map(x => x.location.slot);
    let slot = 0;
    while (used.includes(slot)) slot++;
    p.location = { type: 'kennel', slot };
    p.hasLeftStart = false;
    state.log.push(`💥 schip van ${state.players[playerIdx].name} keert terug naar haven`);
  }

  /* ------------------------------------------------------------
     Turn flow
     ------------------------------------------------------------ */

  function endTurn(state) {
    // Find next non-passed player
    for (let i = 1; i <= 4; i++) {
      const idx = (state.currentPlayerIdx + i) % 4;
      if (!state.players[idx].passed && state.players[idx].hand.length > 0) {
        state.currentPlayerIdx = idx;
        return;
      }
    }
    // No one can play → next round or new deal
    advanceRound(state);
  }

  function passTurn(state, playerIdx) {
    while (state.players[playerIdx].hand.length > 0) {
      state.discard.push(state.players[playerIdx].hand.pop());
    }
    state.players[playerIdx].passed = true;
    state.log.push(`🚫 ${state.players[playerIdx].name} kan niets en past`);
    endTurn(state);
  }

  function advanceRound(state) {
    if (state.roundNumber < 3) {
      dealRound(state, state.roundNumber + 1);
    } else {
      // New deal: rotate dealer
      state.dealerIdx = (state.dealerIdx + 1) % 4;
      dealRound(state, 1);
    }
  }

  function checkWin(state) {
    // A team wins when both members' pieces are all in their home stretches
    const teams = [[0, 2], [1, 3]];
    for (let t = 0; t < 2; t++) {
      const allHome = teams[t].every(idx =>
        state.players[idx].pieces.every(p => p.location.type === 'home')
      );
      if (allHome) {
        state.phase = 'finished';
        state.winnerTeam = t;
        state.log.push(`🏆 Team ${t === 0 ? 'Zon & Diepzee' : 'Vuurtoren & Oceaan'} wint!`);
        return;
      }
    }
  }

  /* ------------------------------------------------------------
     Bot turn (simple AI)
     ------------------------------------------------------------ */

  function pickBotMove(state, playerIdx) {
    const player = state.players[playerIdx];
    // Try each card; pick the first one that has a move; prefer captures and exiting kennel.
    let bestPlay = null;
    let bestScore = -1;

    for (const card of player.hand) {
      if (!canPlayCard(state, playerIdx, card)) continue;
      if (card.rank === '7') {
        const plan = pickBotSevenPlan(state, playerIdx, card);
        if (plan) {
          const score = scoreSevenPlan(state, playerIdx, plan);
          if (score > bestScore) { bestScore = score; bestPlay = { card, sevenPlan: plan }; }
        }
        continue;
      }
      const moves = getMovesForCard(state, playerIdx, card);
      for (const m of moves) {
        const score = scoreMove(state, playerIdx, m);
        if (score > bestScore) { bestScore = score; bestPlay = { card, move: m }; }
      }
    }
    return bestPlay;
  }

  function scoreMove(state, playerIdx, move) {
    let score = 1;
    // Prefer exiting kennel
    if (move.type === 'exitKennel') score += 50;
    // Prefer captures
    if (move.dest.type === 'track') {
      const occ = trackPieceAt(state, move.dest.pos);
      if (occ && occ.playerIdx !== move.pieceRef.playerIdx) {
        if (state.players[occ.playerIdx].team !== state.players[playerIdx].team) score += 40;
      }
    }
    // Prefer entering home
    if (move.dest.type === 'home') score += 20 + move.dest.slot * 5;
    // Prefer moving farthest pieces (more progress)
    if (move.steps) score += move.steps;
    return score;
  }

  function pickBotSevenPlan(state, playerIdx, card) {
    // Try all single-piece full-7 plans first
    const player = state.players[playerIdx];
    const allMyHome = player.pieces.every(p => p.location.type === 'home');
    const eff = allMyHome ? (playerIdx + 2) % 4 : playerIdx;
    const pieces = state.players[eff].pieces.filter(p => p.location.type !== 'kennel');

    // Single piece
    for (const p of pieces) {
      const r = simulateForward(state, eff, p, 7);
      if (r) return [{ pieceRef: { playerIdx: eff, pieceIdx: p.index }, steps: 7, dest: r.location, hasLeftStart: r.hasLeftStart }];
    }
    // Split
    for (let i = 0; i < pieces.length; i++) {
      for (let j = 0; j < pieces.length; j++) {
        if (i === j) continue;
        for (let s = 1; s <= 6; s++) {
          const r1 = simulateForward(state, eff, pieces[i], s);
          if (!r1) continue;
          const temp = applyMoveTemporary(state, eff, pieces[i], r1);
          const r2 = simulateForward(temp, eff, temp.players[eff].pieces[pieces[j].index], 7 - s);
          if (r2) {
            return [
              { pieceRef: { playerIdx: eff, pieceIdx: pieces[i].index }, steps: s, dest: r1.location, hasLeftStart: r1.hasLeftStart },
              { pieceRef: { playerIdx: eff, pieceIdx: pieces[j].index }, steps: 7 - s, dest: r2.location, hasLeftStart: r2.hasLeftStart },
            ];
          }
        }
      }
    }
    return null;
  }

  function scoreSevenPlan(state, playerIdx, plan) {
    // Simple: prefer plans that capture opponents or enter home
    let score = 7;
    for (const step of plan) {
      if (step.dest.type === 'home') score += 15;
      if (step.dest.type === 'track') {
        const occ = trackPieceAt(state, step.dest.pos);
        if (occ && state.players[occ.playerIdx].team !== state.players[playerIdx].team) score += 30;
      }
    }
    return score;
  }

  /* ------------------------------------------------------------
     Apply seven plan (array of moves) atomically
     ------------------------------------------------------------ */
  function applySevenPlan(state, playerIdx, card, plan) {
    const cardIdx = state.players[playerIdx].hand.findIndex(c => c.id === card.id);
    if (cardIdx < 0) return false;
    // Apply each step in order, capturing along the way
    for (const step of plan) {
      const piece = state.players[step.pieceRef.playerIdx].pieces[step.pieceRef.pieceIdx];
      // Re-simulate with current state since each step affects board
      const result = simulateForward(state, step.pieceRef.playerIdx, piece, step.steps);
      if (!result) return false;
      if (result.location.type === 'track') {
        const occ = trackPieceAt(state, result.location.pos);
        if (occ && occ.playerIdx !== step.pieceRef.playerIdx) {
          capturePiece(state, occ.playerIdx, occ.piece.index);
        }
      }
      piece.location = { ...result.location };
      piece.hasLeftStart = result.hasLeftStart;
    }
    const [used] = state.players[playerIdx].hand.splice(cardIdx, 1);
    state.discard.push(used);
    state.log.push(`✂ ${state.players[playerIdx].name} verdeelt een 7`);
    checkWin(state);
    return true;
  }

  /* ------------------------------------------------------------
     Helpers
     ------------------------------------------------------------ */
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  /* Public API */
  return {
    TRACK_LEN, START_POS, HOME_LEN, NUM_PIECES,
    newGame,
    getMovesForCard,
    canPlayCard,
    canPlayAny,
    canSpendSeven,
    applyMove,
    applySevenPlan,
    passTurn,
    endTurn,
    pickBotMove,
    simulateForward,
    simulateBackward,
    trackPieceAt,
    homePieceAt,
    checkWin,
    deepClone,
  };
})();
