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
     activeSeats: optional array of seat indices in use (e.g., [0,2] for 2-player)
                  If omitted, all 4 seats are active.
     ------------------------------------------------------------ */
  function newGame(playerInfos /* [{id,name,isBot,seat?}] */, seed, options = {}) {
    const activeSeats = options.activeSeats || [0, 1, 2, 3];

    const players = [];
    for (let idx = 0; idx < 4; idx++) {
      const info = playerInfos[idx];
      const isActive = activeSeats.includes(idx);
      players.push({
        idx,
        id: info ? info.id : `seat-${idx}`,
        name: info ? info.name : `Stoel ${idx + 1}`,
        isBot: info ? !!info.isBot : false,
        active: isActive,
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
      activeSeats,
      currentPlayerIdx: activeSeats[0],
      dealerIdx: activeSeats[0],
      roundNumber: 1,
      deck: [],
      discard: [],
      seed: seed || Math.floor(Math.random() * 1e9),
      phase: 'playing',
      finishOrder: [],          // seat indices in order of finishing
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
    if (roundNumber === 1) {
      state.deck = shuffle(makeDeck(), makeRng(state.seed + state.dealerIdx * 1000));
      state.discard = [];
    }
    for (const p of state.players) {
      p.hand = [];
      p.passed = false;
    }
    const active = state.activeSeats || [0, 1, 2, 3];
    // Deal starting from seat after dealer (only to active seats, in seat order)
    const startIdx = active.indexOf(state.dealerIdx);
    for (let i = 0; i < cardCount; i++) {
      for (let j = 0; j < active.length; j++) {
        const pIdx = active[(startIdx + 1 + j) % active.length];
        if (state.deck.length > 0) {
          state.players[pIdx].hand.push(state.deck.pop());
        }
      }
    }
    state.roundNumber = roundNumber;
    state.currentPlayerIdx = active[(startIdx + 1) % active.length];
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

  /* Simulate moving a piece forward N steps; returns ARRAY of possible final
     destinations (multiple when the path can choose between entering home or
     continuing along the track). Each entry: { location, hasLeftStart, path }.
     Self-capture is allowed: landing on own piece is OK (caller will capture). */
  function simulateForward(state, playerIdx, piece, steps) {
    if (steps <= 0) return [];
    if (piece.location.type === 'kennel') return [];

    const startPos = START_POS[playerIdx];
    let frontier = [{ loc: { ...piece.location }, hasLeftStart: piece.hasLeftStart, path: [] }];

    for (let i = 0; i < steps; i++) {
      const isFinal = (i === steps - 1);
      const next = [];
      for (const node of frontier) {
        for (const opt of stepForwardOptions(state, playerIdx, node.loc, node.hasLeftStart, isFinal)) {
          next.push({
            loc: opt.loc,
            hasLeftStart: opt.hasLeftStart,
            path: node.path.concat([opt.loc]),
          });
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    // Deduplicate by destination
    const seen = new Set();
    const results = [];
    for (const f of frontier) {
      const key = `${f.loc.type}:${f.loc.type === 'track' ? f.loc.pos : f.loc.slot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ location: f.loc, hasLeftStart: f.hasLeftStart, path: f.path });
    }
    return results;
  }

  /* All next-step options from current (loc, hasLeftStart). Final step has different rules. */
  function stepForwardOptions(state, playerIdx, current, hasLeftStart, isFinal) {
    const startPos = START_POS[playerIdx];
    const out = [];

    if (current.type === 'track') {
      const nextTrack = (current.pos + 1) % TRACK_LEN;
      const newHasLeft = (current.pos === startPos) ? true : hasLeftStart;

      // Option A: enter home if we're about to step onto our own start and we've left it before
      if (nextTrack === startPos && hasLeftStart) {
        const homeOpt = { type: 'home', slot: 0 };
        if (canOccupy(state, playerIdx, homeOpt, isFinal)) {
          out.push({ loc: homeOpt, hasLeftStart });
        }
      }

      // Option B: stay on the track and continue around (always available — pass home and lap again)
      const trackOpt = { type: 'track', pos: nextTrack };
      if (canOccupy(state, playerIdx, trackOpt, isFinal)) {
        out.push({ loc: trackOpt, hasLeftStart: newHasLeft });
      }
    } else if (current.type === 'home') {
      if (current.slot < HOME_LEN - 1) {
        const homeOpt = { type: 'home', slot: current.slot + 1 };
        if (canOccupy(state, playerIdx, homeOpt, isFinal)) {
          out.push({ loc: homeOpt, hasLeftStart });
        }
      }
      // Cannot leave home back to track
    }

    return out;
  }

  /* Can a piece end its step at this location? (final or intermediate)
     - Start blockades block all (passing or landing)
     - Home cells block if occupied (intermediate AND final — can't pass own pieces in home)
     - Track final cell: own piece OK (self-capture), opp OK (capture), start blockade NOT
     - Track intermediate: anything except start blockade */
  function canOccupy(state, playerIdx, loc, isFinal) {
    if (loc.type === 'track') {
      if (isStartBlockade(state, loc.pos)) return false;
      // Intermediate / final on regular track is fine — captures resolved by applyMove
      return true;
    }
    if (loc.type === 'home') {
      const occ = homePieceAt(state, playerIdx, loc.slot);
      return !occ;  // home is exclusive
    }
    return false;
  }

  /* Simulate moving piece backward N (track only). Returns array of 0/1 destinations. */
  function simulateBackward(state, playerIdx, piece, steps) {
    if (piece.location.type !== 'track') return [];
    let pos = piece.location.pos;
    let hasLeftStart = piece.hasLeftStart;
    for (let i = 0; i < steps; i++) {
      pos = (pos - 1 + TRACK_LEN) % TRACK_LEN;
      if (isStartBlockade(state, pos)) return [];     // can't pass over a start blockade either
    }
    // Self-capture allowed: own piece on final track cell is captured by applyMove
    if (pos !== START_POS[playerIdx]) hasLeftStart = true;
    return [{ location: { type: 'track', pos }, hasLeftStart, path: [{ type: 'track', pos }] }];
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

    const teammateIdx = playerIdx;
    const movePieces = player.pieces;

    // Helper to add a forward move (may produce multiple — home vs continue-track)
    const tryForward = (piece, steps) => {
      const results = simulateForward(state, teammateIdx, piece, steps);
      for (const result of results) {
        moves.push({
          card, type: 'forward', steps,
          pieceRef: { playerIdx: teammateIdx, pieceIdx: piece.index },
          dest: result.location, hasLeftStart: result.hasLeftStart, path: result.path,
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
      // Swap (Boer): own piece on track with any opponent's piece on track.
      // - Your OWN piece on its own start IS allowed to be swapped.
      // - An OPPONENT's piece on its own start is a blockade — cannot be swapped.
      const myTrackPieces = movePieces.filter(p => p.location.type === 'track');
      for (const mine of myTrackPieces) {
        for (const other of state.players) {
          if (other.idx === teammateIdx) continue;
          for (const otherPiece of other.pieces) {
            if (otherPiece.location.type !== 'track') continue;
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
      // Split 7 between 1 or 2 own pieces — generate all single-step moves of size 1..7
      for (const piece of movePieces.filter(p => p.location.type !== 'kennel')) {
        for (let steps = 1; steps <= 7; steps++) {
          for (const r of simulateForward(state, teammateIdx, piece, steps)) {
            moves.push({
              card, type: 'sevenStep', steps,
              pieceRef: { playerIdx: teammateIdx, pieceIdx: piece.index },
              dest: r.location, hasLeftStart: r.hasLeftStart, path: r.path,
            });
          }
        }
      }
    } else if (card.rank === '4') {
      for (const piece of movePieces.filter(p => p.location.type === 'track')) {
        for (const r of simulateBackward(state, teammateIdx, piece, 4)) {
          moves.push({
            card, type: 'backward', steps: 4,
            pieceRef: { playerIdx: teammateIdx, pieceIdx: piece.index },
            dest: r.location, hasLeftStart: r.hasLeftStart, path: r.path,
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

  /* Can the player fully spend a 7? Split must be over 1 or 2 DIFFERENT pieces.
     Same piece may NOT be used in two stages. */
  function canSpendSeven(state, playerIdx) {
    const effective = playerIdx;
    const pieces = state.players[effective].pieces.filter(p => p.location.type !== 'kennel');
    if (pieces.length === 0) return false;
    // Try single piece full 7
    for (const p of pieces) {
      if (simulateForward(state, effective, p, 7).length > 0) return true;
    }
    // Try splits across two DIFFERENT pieces
    for (let i = 0; i < pieces.length; i++) {
      for (let j = 0; j < pieces.length; j++) {
        if (i === j) continue;
        for (let s = 1; s <= 6; s++) {
          const firsts = simulateForward(state, effective, pieces[i], s);
          for (const r1 of firsts) {
            const tempState = applyMoveTemporary(state, effective, pieces[i], r1, true);
            const piece2InTemp = tempState.players[effective].pieces[pieces[j].index];
            if (simulateForward(tempState, effective, piece2InTemp, 7 - s).length > 0) return true;
          }
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
      // Capture ANY piece on the landing cell — including own (self-capture allowed)
      if (move.dest.type === 'track') {
        const occ = trackPieceAt(state, move.dest.pos);
        if (occ && (occ.playerIdx !== targetPlayerIdx || occ.piece.index !== piece.index)) {
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
      if (occ && (occ.playerIdx !== playerIdx || occ.piece.index !== piece.index)) {
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
    const active = state.activeSeats || [0, 1, 2, 3];
    const curPos = active.indexOf(state.currentPlayerIdx);
    for (let i = 1; i <= active.length; i++) {
      const idx = active[(curPos + i) % active.length];
      if (!state.players[idx].passed && state.players[idx].hand.length > 0) {
        state.currentPlayerIdx = idx;
        return;
      }
    }
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
      // New deal: rotate dealer to next active seat
      const active = state.activeSeats || [0, 1, 2, 3];
      const pos = active.indexOf(state.dealerIdx);
      state.dealerIdx = active[(pos + 1) % active.length];
      dealRound(state, 1);
    }
  }

  /* Update finishOrder + finalize when nobody has anything left to play.
     - A player "finishes" when all their pieces are in home.
     - The game ends when all but optionally one player have finished,
       OR when only one team is still unfinished (in team mode).
     Game keeps going so everyone can claim a placement (1st, 2nd, 3rd, 4th). */
  function checkWin(state) {
    if (!state.finishOrder) state.finishOrder = [];
    const activePlayers = state.players.filter(p => p.active !== false);

    // Mark newly-finished players (all pieces home for first time)
    for (const p of activePlayers) {
      const allHome = p.pieces.every(x => x.location.type === 'home');
      if (allHome && !state.finishOrder.includes(p.idx)) {
        state.finishOrder.push(p.idx);
        state.log.push(`🏁 ${p.name} is binnengevaren (plaats ${state.finishOrder.length})`);
      }
    }

    const n = activePlayers.length;
    if (state.finishOrder.length >= n - 1) {
      for (const p of activePlayers) {
        if (!state.finishOrder.includes(p.idx)) state.finishOrder.push(p.idx);
      }
      state.phase = 'finished';
      state.log.push(`🏆 Spel afgelopen`);
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
    if (move.type === 'exitKennel') score += 50;
    if (move.dest.type === 'track') {
      const occ = trackPieceAt(state, move.dest.pos);
      if (occ && occ.playerIdx !== move.pieceRef.playerIdx) score += 40;
    }
    if (move.dest.type === 'home') score += 20 + move.dest.slot * 5;
    if (move.steps) score += move.steps;
    return score;
  }

  function pickBotSevenPlan(state, playerIdx, card) {
    const eff = playerIdx;
    const pieces = state.players[eff].pieces.filter(p => p.location.type !== 'kennel');

    // Single piece full 7 (pick first valid destination)
    for (const p of pieces) {
      const rs = simulateForward(state, eff, p, 7);
      if (rs.length > 0) {
        const r = rs[0];
        return [{ pieceRef: { playerIdx: eff, pieceIdx: p.index }, steps: 7, dest: r.location, hasLeftStart: r.hasLeftStart }];
      }
    }
    // Split across two DIFFERENT pieces
    for (let i = 0; i < pieces.length; i++) {
      for (let j = 0; j < pieces.length; j++) {
        if (i === j) continue;
        for (let s = 1; s <= 6; s++) {
          const firsts = simulateForward(state, eff, pieces[i], s);
          for (const r1 of firsts) {
            const temp = applyMoveTemporary(state, eff, pieces[i], r1);
            const seconds = simulateForward(temp, eff, temp.players[eff].pieces[pieces[j].index], 7 - s);
            if (seconds.length > 0) {
              const r2 = seconds[0];
              return [
                { pieceRef: { playerIdx: eff, pieceIdx: pieces[i].index }, steps: s, dest: r1.location, hasLeftStart: r1.hasLeftStart },
                { pieceRef: { playerIdx: eff, pieceIdx: pieces[j].index }, steps: 7 - s, dest: r2.location, hasLeftStart: r2.hasLeftStart },
              ];
            }
          }
        }
      }
    }
    return null;
  }

  function scoreSevenPlan(state, playerIdx, plan) {
    let score = 7;
    for (const step of plan) {
      if (step.dest.type === 'home') score += 15;
      if (step.dest.type === 'track') {
        const occ = trackPieceAt(state, step.dest.pos);
        if (occ && occ.playerIdx !== playerIdx) score += 30;
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
    // Apply each step in order, capturing (including own) along the way.
    // Must use exactly the destination chosen in the original plan.
    for (const step of plan) {
      const piece = state.players[step.pieceRef.playerIdx].pieces[step.pieceRef.pieceIdx];
      const results = simulateForward(state, step.pieceRef.playerIdx, piece, step.steps);
      // Find the matching destination from the plan
      const matched = results.find(r =>
        r.location.type === step.dest.type &&
        (r.location.type !== 'track' || r.location.pos === step.dest.pos) &&
        (r.location.type !== 'home'  || r.location.slot === step.dest.slot)
      );
      if (!matched) return false;
      if (matched.location.type === 'track') {
        const occ = trackPieceAt(state, matched.location.pos);
        if (occ && (occ.playerIdx !== step.pieceRef.playerIdx || occ.piece.index !== piece.index)) {
          capturePiece(state, occ.playerIdx, occ.piece.index);
        }
      }
      piece.location = { ...matched.location };
      piece.hasLeftStart = matched.hasLeftStart;
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
