/* ============================================================
   APP — UI controller, glue between Game / Board / Network
   ============================================================ */

const App = (() => {
  const PLAYER_COLOR_NAMES = ['Zon', 'Vuurtoren', 'Diepzee', 'Oceaan'];
  const PLAYER_COLOR_HEX  = ['#e8c547', '#c0392b', '#2e8b57', '#2b6cb0'];
  const TEAM_NAMES = ['Team Zon & Diepzee', 'Team Vuurtoren & Oceaan'];

  let audioCtx = null;
  function playTurnSound() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      // Tiny two-note "ding" — bell-like
      const now = audioCtx.currentTime;
      [880, 1320].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.18, now + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.45);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.5);
      });
    } catch (e) { /* audio not available */ }
  }

  let lastTurnSeat = null;
  function maybePlayTurnSound() {
    if (!state.gameState) return;
    const cur = state.gameState.currentPlayerIdx;
    if (cur === state.mySeat && cur !== lastTurnSeat) {
      playTurnSound();
    }
    lastTurnSeat = cur;
  }

  const state = {
    mode: 'menu',                   // 'menu' | 'host' | 'client'
    mySeat: null,                   // 0..3
    myName: '',
    gameState: null,
    lobby: null,                    // { players: [{peerId, name, seat}], code, seatMapping, botSeats }
    svg: null,
    selectedCardId: null,
    selectedPieceId: null,          // 'piece-P-I'
    availableMoves: [],
    sevenInProgress: null,          // { card, remaining, plan: [], baseState }
    swapInProgress: null,           // { card, myPieceRef }
    pendingMove: null,              // move awaiting confirmation
    botSeats: new Set(),            // host: seats explicitly marked as bot in lobby
    activeSeats: [0, 1, 2, 3],      // seats actually playing this game
  };

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    bindMenuButtons();
    bindLobby();
    bindGameControls();
    bindModals();

    // Handle ?room= URL
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      const codeInput = document.getElementById('join-code');
      codeInput.value = roomParam.toUpperCase();
      showScreen('join');
    }
  }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + name).classList.add('active');
  }

  function showMessage(text, duration = 2400) {
    const box = document.getElementById('message-box');
    box.textContent = text;
    box.classList.add('show');
    clearTimeout(box._t);
    box._t = setTimeout(() => box.classList.remove('show'), duration);
  }

  /* ============================================================
     MENU BUTTONS
     ============================================================ */
  function bindMenuButtons() {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.getAttribute('data-action');
        if (a === 'create') showScreen('name');
        else if (a === 'join') showScreen('join');
      });
    });

    document.querySelectorAll('[data-back]').forEach(btn => {
      btn.addEventListener('click', () => {
        Network.disconnect();
        state.mode = 'menu';
        state.lobby = null;
        state.gameState = null;
        showScreen(btn.getAttribute('data-back'));
      });
    });

    // Create host
    document.getElementById('host-submit').addEventListener('click', async () => {
      const name = document.getElementById('host-name').value.trim() || 'Kapitein';
      state.myName = name;
      try {
        attachNetworkListeners();
        const { code } = await Network.createGame();
        state.mode = 'host';
        initLobbyAsHost(code, name);
      } catch (e) {
        alert('Verbindingsfout: ' + e.message);
      }
    });

    // Join client
    document.getElementById('join-submit').addEventListener('click', async () => {
      const code = document.getElementById('join-code').value.trim().toUpperCase();
      const name = document.getElementById('join-name').value.trim() || 'Matroos';
      if (code.length < 4) {
        document.getElementById('join-error').textContent = 'Voer een geldige havencode in.';
        return;
      }
      state.myName = name;
      try {
        attachNetworkListeners();
        await Network.joinGame(code, name);
        state.mode = 'client';
        showScreen('lobby');
        document.getElementById('lobby-code').textContent = code;
        document.getElementById('lobby-controls').classList.remove('show');
        document.getElementById('lobby-waiting').classList.add('show');
      } catch (e) {
        document.getElementById('join-error').textContent = e.message || 'Verbinding mislukt.';
      }
    });

    document.getElementById('join-code').addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase();
    });
  }

  /* ============================================================
     LOBBY — HOST
     ============================================================ */
  function initLobbyAsHost(code, hostName) {
    state.lobby = {
      code,
      players: [{ peerId: 'host', name: hostName, isHost: true }],
      activeSeats: [0, 1, 2, 3],
    };
    state.activeSeats = [0, 1, 2, 3];
    showScreen('lobby');
    document.getElementById('lobby-code').textContent = code;
    document.getElementById('lobby-controls').classList.add('show');
    document.getElementById('lobby-waiting').classList.remove('show');
    document.querySelector('.lobby-only-host')?.classList.remove('hide');
    bindLobbyCountPicker();
    renderLobby();
  }

  function bindLobbyCountPicker() {
    const buttons = document.querySelectorAll('#player-count button');
    if (buttons.length === 0) return;
    buttons.forEach(btn => {
      btn.onclick = () => {
        const n = parseInt(btn.getAttribute('data-count'));
        const seats = n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3];
        state.activeSeats = seats;
        state.lobby.activeSeats = seats;
        // Prune bot markers and players beyond the new count
        const newBotSeats = new Set();
        for (const s of state.botSeats) {
          if (seats.includes(s)) newBotSeats.add(s);
        }
        state.botSeats = newBotSeats;
        state.lobby.players = state.lobby.players.slice(0, seats.length);
        buttons.forEach(b => b.classList.toggle('active', b === btn));
        const hint = document.getElementById('count-hint');
        if (hint) {
          if (n === 4) hint.textContent = 'Vier spelers — teamspel (geel + groen tegen rood + blauw)';
          else if (n === 3) hint.textContent = 'Drie spelers — ieder voor zich';
          else hint.textContent = 'Twee spelers — geel tegen groen (tegenover elkaar)';
        }
        renderLobby();
        Network.broadcastLobby(state.lobby);
      };
    });
  }

  function bindLobby() {
    document.getElementById('copy-code').addEventListener('click', () => {
      const code = document.getElementById('lobby-code').textContent;
      navigator.clipboard.writeText(code).then(() => showMessage('Havencode gekopieerd'));
    });
    document.getElementById('copy-link').addEventListener('click', () => {
      const code = document.getElementById('lobby-code').textContent;
      const url = location.origin + location.pathname + '?room=' + code;
      navigator.clipboard.writeText(url).then(() => showMessage('Link gekopieerd'));
    });

    document.getElementById('start-game').addEventListener('click', () => {
      if (state.mode !== 'host') return;
      startHostedGame();
    });
  }

  function renderLobby() {
    const container = document.getElementById('lobby-players');
    container.innerHTML = '';
    const lobby = state.lobby;
    if (!lobby) return;

    const isHostView = state.mode === 'host';
    const activeSeats = (lobby.activeSeats && lobby.activeSeats.length)
      ? lobby.activeSeats
      : [0, 1, 2, 3];
    const teamMode = activeSeats.length === 4;

    // Show the player-count picker only for host
    const picker = document.querySelector('.lobby-only-host');
    if (picker) picker.style.display = isHostView ? '' : 'none';

    activeSeats.forEach((seatIdx, posInLobby) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      const dot = document.createElement('span');
      dot.className = 'color-dot';
      dot.setAttribute('data-color', ['yellow', 'red', 'green', 'blue'][seatIdx]);
      const nameEl = document.createElement('span');
      nameEl.className = 'player-name';
      const roleEl = document.createElement('span');
      roleEl.className = 'player-role';

      const p = lobby.players[posInLobby];
      const isBotSeat = state.botSeats && state.botSeats.has(seatIdx);

      if (p) {
        nameEl.textContent = p.name + (p.isHost ? ' ⚓' : '');
        roleEl.textContent = PLAYER_COLOR_NAMES[seatIdx];
      } else if (isBotSeat) {
        nameEl.textContent = '🤖 Bot';
        roleEl.textContent = PLAYER_COLOR_NAMES[seatIdx];
        row.style.opacity = '0.85';
      } else {
        nameEl.textContent = '— wachten op speler —';
        roleEl.textContent = PLAYER_COLOR_NAMES[seatIdx];
        row.style.opacity = '0.55';
        if (isHostView) row.classList.add('empty-seat');
      }

      row.append(dot, nameEl, roleEl);

      if (teamMode) {
        const team = document.createElement('span');
        team.className = 'team-badge';
        team.textContent = (seatIdx % 2 === 0) ? 'TEAM ★' : 'TEAM ◆';
        row.append(team);
      }

      if (isHostView && !p) {
        if (isBotSeat) {
          const rm = document.createElement('button');
          rm.className = 'seat-action';
          rm.textContent = '✕ verwijder bot';
          rm.onclick = (e) => { e.stopPropagation(); state.botSeats.delete(seatIdx); renderLobby(); };
          row.appendChild(rm);
        } else {
          const add = document.createElement('button');
          add.className = 'seat-action';
          add.textContent = '+ bot';
          add.onclick = (e) => { e.stopPropagation(); state.botSeats.add(seatIdx); renderLobby(); };
          row.appendChild(add);
        }
      }

      container.appendChild(row);
    });
  }

  /* ============================================================
     LOBBY — CLIENT (renders received lobby state)
     ============================================================ */

  /* ============================================================
     NETWORK LISTENERS
     ============================================================ */
  function attachNetworkListeners() {
    Network.setListeners({
      onConnected: info => {},

      // HOST
      onPlayerJoin: ({ peerId, name }) => {
        if (state.mode !== 'host') return;
        const exists = state.lobby.players.some(p => p.peerId === peerId);
        if (!exists && state.lobby.players.length < 4) {
          state.lobby.players.push({ peerId, name, isHost: false });
        }
        renderLobby();
        Network.broadcastLobby(state.lobby);
      },
      onPlayerLeave: ({ peerId }) => {
        if (state.mode !== 'host') return;
        state.lobby.players = state.lobby.players.filter(p => p.peerId !== peerId);
        renderLobby();
        Network.broadcastLobby(state.lobby);
      },
      onAction: ({ peerId, action }) => {
        if (state.mode !== 'host') return;
        const seat = state.lobby.seatMapping[peerId];
        if (seat === undefined) return;
        if (state.gameState.currentPlayerIdx !== seat) return;
        applyAction(seat, action);
        Network.broadcastState(state.gameState);
        renderGame();                 // host UI must refresh too
        scheduleBotsIfNeeded();
      },

      // CLIENT
      onLobbyUpdate: lobby => {
        state.lobby = lobby;
        renderLobby();
      },
      onGameStart: ({ state: gs, seatMapping }) => {
        state.gameState = gs;
        state.mySeat = seatMapping[Network.peerId];
        enterGameScreen();
      },
      onStateUpdate: gs => {
        state.gameState = gs;
        renderGame();
      },
      onError: err => console.warn('Net error:', err),
      onDisconnected: () => {
        showMessage('Verbinding verbroken');
      },
    });
  }

  /* ============================================================
     HOST: START GAME
     ============================================================ */
  function startHostedGame() {
    const activeSeats = (state.lobby.activeSeats && state.lobby.activeSeats.length)
      ? state.lobby.activeSeats
      : [0, 1, 2, 3];
    const lobbyPlayers = state.lobby.players.slice(0, activeSeats.length);

    // Each lobby player position -> board seat (in activeSeats order)
    const playerInfos = [null, null, null, null];
    const seatMapping = {};
    const botNames = ['Kapitein Bot', 'Stuurman Bot', 'Bootsman Bot', 'Matroos Bot'];

    activeSeats.forEach((seatIdx, posInLobby) => {
      const p = lobbyPlayers[posInLobby];
      if (p) {
        playerInfos[seatIdx] = { id: p.peerId, name: p.name, isBot: false };
        seatMapping[p.peerId] = seatIdx;
      } else {
        playerInfos[seatIdx] = { id: `bot-${seatIdx}`, name: botNames[seatIdx], isBot: true };
      }
    });
    // Inactive seats get placeholder bots (won't play)
    for (let i = 0; i < 4; i++) {
      if (!playerInfos[i]) playerInfos[i] = { id: `inactive-${i}`, name: '—', isBot: true };
    }

    state.lobby.seatMapping = seatMapping;
    state.gameState = Game.newGame(playerInfos, Date.now() & 0x7fffffff, {
      activeSeats,
      teamMode: activeSeats.length === 4,
    });
    state.activeSeats = activeSeats;
    state.mySeat = activeSeats[0];

    Network.broadcastGameStart(state.gameState, seatMapping);
    enterGameScreen();
    scheduleBotsIfNeeded();
  }


  /* ============================================================
     GAME SCREEN
     ============================================================ */
  function enterGameScreen() {
    showScreen('game');
    const container = document.getElementById('board-container');
    const gs = state.gameState;
    const activeSeats = gs?.activeSeats || state.activeSeats || [0, 1, 2, 3];
    state.activeSeats = activeSeats;
    state.svg = Board.buildBoard(container, { activeSeats });
    state.svg.addEventListener('click', e => handleBoardClick(e));
    lastRound = null;
    fitBoardWrap();
    if (!state._resizeBound) {
      window.addEventListener('resize', fitBoardWrap);
      state._resizeBound = true;
    }
    renderGame();
  }

  function fitBoardWrap() {
    const main = document.querySelector('.game-main');
    const wrap = document.querySelector('.board-wrapper');
    if (!main || !wrap) return;
    // Reserve 70 px of room around the board for player badges floating outside the loop
    const reserve = 70;
    const size = Math.max(280, Math.min(main.clientWidth, main.clientHeight) - reserve);
    wrap.style.width = size + 'px';
    wrap.style.height = size + 'px';
  }

  function isMyTurn() {
    const gs = state.gameState;
    if (!gs) return false;
    return gs.currentPlayerIdx === state.mySeat;
  }

  function viewingSeat() {
    return state.mySeat != null ? state.mySeat : 0;
  }

  let lastRound = null;

  function renderGame() {
    if (!state.gameState) return;
    const gs = state.gameState;

    Board.setViewRotation(state.svg, viewingSeat());
    Board.updatePieces(state.svg, gs.players);
    renderHeader();
    renderOpponents();
    renderHand();
    renderDiscard();
    refreshHighlights();
    refreshPreview();
    maybePlayTurnSound();
    maybeShowIntermezzo();

    if (gs.phase === 'finished') {
      showWinModal();
    }
  }

  function renderDiscard() {
    const gs = state.gameState;
    const container = document.getElementById('discard-stack');
    if (!container) return;
    container.innerHTML = '';
    const last = (gs.discard || []).slice(-1)[0];
    if (!last) return;
    const el = makeCardEl(last);
    el.classList.add('discard-card');
    el.style.cursor = 'default';
    container.appendChild(el);
    // Small "n cards in pile" label under the card
    const count = document.createElement('div');
    count.className = 'discard-count';
    count.textContent = `${gs.discard.length} kaart${gs.discard.length === 1 ? '' : 'en'} afgelegd`;
    container.appendChild(count);
  }

  function maybeShowIntermezzo() {
    const gs = state.gameState;
    if (!gs) return;
    if (lastRound != null && lastRound !== gs.roundNumber) {
      showIntermezzo(gs, lastRound, gs.roundNumber);
    }
    lastRound = gs.roundNumber;
  }

  function showIntermezzo(gs, prevRound, newRound) {
    const newDeal = (prevRound === 3 && newRound === 1);
    const titleEl = document.getElementById('intermezzo-title');
    const bodyEl = document.getElementById('intermezzo-body');
    const embEl = document.getElementById('intermezzo-emblem');

    if (newDeal) {
      embEl.textContent = '🌊';
      titleEl.textContent = 'Tussenstand';
      bodyEl.innerHTML = buildStandingsHtml(gs);
    } else {
      embEl.textContent = '📜';
      titleEl.textContent = `Ronde ${newRound}`;
      bodyEl.innerHTML = `<p class="intermezzo-text">Nieuwe kaarten worden uitgedeeld...</p>` + buildStandingsHtml(gs);
    }

    document.getElementById('modal-intermezzo').classList.add('show');
  }

  function buildStandingsHtml(gs) {
    const active = (gs.activeSeats || [0, 1, 2, 3]).slice();
    // Sort: most pieces home → fewest in kennel → seat order
    active.sort((a, b) => {
      const pa = gs.players[a], pb = gs.players[b];
      const ha = pa.pieces.filter(p => p.location.type === 'home').length;
      const hb = pb.pieces.filter(p => p.location.type === 'home').length;
      if (hb !== ha) return hb - ha;
      const ka = pa.pieces.filter(p => p.location.type === 'kennel').length;
      const kb = pb.pieces.filter(p => p.location.type === 'kennel').length;
      return ka - kb;
    });
    const colorClass = ['yellow', 'red', 'green', 'blue'];
    const rows = active.map((seat, i) => {
      const p = gs.players[seat];
      const home = p.pieces.filter(x => x.location.type === 'home').length;
      const track = p.pieces.filter(x => x.location.type === 'track').length;
      const kennel = p.pieces.filter(x => x.location.type === 'kennel').length;
      return `<div class="rank-row">
        <span class="rank-num">${i + 1}.</span>
        <span class="rank-dot" data-color="${colorClass[seat]}"></span>
        <strong>${p.name}</strong>
        <span class="rank-stats">🏠 ${kennel} · ⛵ ${track} · ⚓ ${home}</span>
      </div>`;
    }).join('');
    return `<div class="ranking">${rows}</div>`;
  }

  function renderHeader() {
    const gs = state.gameState;
    const cur = gs.players[gs.currentPlayerIdx];
    const ind = document.getElementById('turn-indicator');
    ind.textContent = isMyTurn() ? 'Jouw beurt' : `Aan zet: ${cur.name}`;
    ind.style.background = PLAYER_COLOR_HEX[gs.currentPlayerIdx];
    ind.style.color = '#fff';

    const cardCount = gs.players.reduce((s, p) => s + p.hand.length, 0);
    document.getElementById('round-info').textContent =
      `Ronde ${gs.roundNumber}/3 · ${cardCount} kaarten over`;
  }

  function renderOpponents() {
    const myIdx = viewingSeat();
    const container = document.getElementById('player-badges');
    if (!container) return;
    container.innerHTML = '';
    const gs = state.gameState;
    const active = (gs.activeSeats || [0, 1, 2, 3]);
    const colorClass = ['yellow', 'red', 'green', 'blue'];

    for (const idx of active) {
      if (idx === myIdx) continue;
      // Where does this seat appear AFTER rotation? Board rotates (2-mySeat)*90 CW,
      // so seat idx ends at clock position (idx + 2 - mySeat) % 4 (0=top, 1=right, 2=bottom, 3=left).
      const finalPos = (idx + 2 - myIdx + 4) % 4;
      const posClass = finalPos === 0 ? 'pos-top'
                      : finalPos === 1 ? 'pos-right'
                      : finalPos === 3 ? 'pos-left'
                      : 'pos-top';        // (2 = my own seat — shouldn't reach here)
      const p = gs.players[idx];

      const badge = document.createElement('div');
      badge.className = `player-badge ${posClass}`;
      if (gs.currentPlayerIdx === idx) badge.classList.add('active');

      const dot = document.createElement('span');
      dot.className = 'color-dot';
      dot.setAttribute('data-color', colorClass[idx]);
      badge.appendChild(dot);

      const info = document.createElement('div');
      info.className = 'badge-info';
      const name = document.createElement('div');
      name.className = 'badge-name';
      name.textContent = p.name + (p.isBot ? ' 🤖' : '');
      info.appendChild(name);

      const status = document.createElement('div');
      status.className = 'badge-status';
      if (p.passed) status.textContent = '🚫 gepast';
      else if (p.hand.length === 0) status.textContent = 'geen kaarten';
      else status.textContent = `🃏 ${p.hand.length}`;
      info.appendChild(status);
      badge.appendChild(info);

      container.appendChild(badge);
    }
  }

  function renderHand() {
    const myIdx = viewingSeat();
    const gs = state.gameState;
    const player = gs.players[myIdx];
    const handEl = document.getElementById('my-hand');
    handEl.innerHTML = '';

    if (player.isBot) {
      const note = document.createElement('div');
      note.className = 'action-hint';
      note.textContent = `🤖 ${player.name} denkt na...`;
      handEl.appendChild(note);
      renderActions();
      return;
    }

    for (const card of player.hand) {
      const el = makeCardEl(card);
      // Determine if this card can be played
      const playable = isMyTurn() && Game.canPlayCard(gs, myIdx, card);
      if (!playable) el.classList.add('disabled');
      if (state.selectedCardId === card.id) el.classList.add('selected');
      el.addEventListener('click', () => {
        if (!isMyTurn()) return;
        if (!playable) {
          showMessage('Deze kaart kun je nu niet spelen');
          return;
        }
        selectCard(card.id);
      });
      handEl.appendChild(el);
    }

    if (player.hand.length === 0) {
      const note = document.createElement('div');
      note.className = 'action-hint';
      note.textContent = '— geen kaarten meer —';
      handEl.appendChild(note);
    }

    renderActions();
  }

  function makeCardEl(card) {
    const el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('data-card-id', card.id);
    const color = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
    el.classList.add(color);
    const top = document.createElement('div'); top.className = 'rank-top'; top.textContent = card.rank;
    const mid = document.createElement('div'); mid.className = 'suit-center'; mid.textContent = card.suit;
    const bot = document.createElement('div'); bot.className = 'rank-bottom'; bot.textContent = card.rank;
    el.append(top, mid, bot);
    return el;
  }

  function renderActions() {
    const myIdx = viewingSeat();
    const gs = state.gameState;
    const actions = document.getElementById('my-actions');
    actions.innerHTML = '';
    if (!isMyTurn() || gs.players[myIdx].isBot) return;

    const player = gs.players[myIdx];

    // Confirm/cancel takes priority over other action-bar content
    if (state.pendingMove) {
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'btn btn-action-confirm';
      confirmBtn.innerHTML = '⚓ Bevestig zet';
      confirmBtn.addEventListener('click', confirmPendingMove);
      actions.appendChild(confirmBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-action-cancel';
      cancelBtn.textContent = '✕ Annuleer';
      cancelBtn.addEventListener('click', clearPendingMove);
      actions.appendChild(cancelBtn);
      return;
    }

    const canPlay = Game.canPlayAny(gs, myIdx);
    if (!canPlay && player.hand.length > 0) {
      const passBtn = document.createElement('button');
      passBtn.className = 'btn btn-action-pass';
      passBtn.textContent = '🚫 Hand afleggen & passen';
      passBtn.addEventListener('click', () => doAction({ type: 'pass' }));
      actions.appendChild(passBtn);
      return;
    }

    if (state.sevenInProgress) {
      const hint = document.createElement('div');
      hint.className = 'action-hint';
      hint.textContent = `7 verdelen — nog ${state.sevenInProgress.remaining} stappen over`;
      actions.appendChild(hint);

      const cancel = document.createElement('button');
      cancel.className = 'btn btn-action-cancel';
      cancel.textContent = '✕ Annuleren';
      cancel.addEventListener('click', () => {
        state.gameState = Game.deepClone(state.sevenInProgress.baseState);
        state.sevenInProgress = null;
        state.selectedCardId = null;
        state.selectedPieceId = null;
        renderGame();
      });
      actions.appendChild(cancel);
      return;
    }

    if (state.swapInProgress) {
      const hint = document.createElement('div');
      hint.className = 'action-hint';
      hint.textContent = `Boer — kies een schip om mee te ruilen`;
      actions.appendChild(hint);
      const cancel = document.createElement('button');
      cancel.className = 'btn btn-action-cancel';
      cancel.textContent = '✕ Annuleer';
      cancel.addEventListener('click', () => {
        state.swapInProgress = null;
        state.selectedCardId = null;
        state.selectedPieceId = null;
        refreshHighlights();
        renderActions();
      });
      actions.appendChild(cancel);
    }
  }

  /* ============================================================
     CARD SELECTION
     ============================================================ */
  function selectCard(cardId) {
    const myIdx = viewingSeat();
    const gs = state.gameState;
    if (state.pendingMove) clearPendingMove();
    state.selectedCardId = cardId;
    state.selectedPieceId = null;
    state.swapInProgress = null;
    state.sevenInProgress = null;
    const card = gs.players[myIdx].hand.find(c => c.id === cardId);
    if (!card) return;

    if (card.rank === '7') {
      // Start interactive split: track remaining steps and pieces moved
      state.sevenInProgress = {
        card,
        remaining: 7,
        plan: [],
        baseState: Game.deepClone(gs),
      };
      state.availableMoves = computeSevenStepMoves(gs, myIdx, card, 7);
    } else if (card.rank === 'J') {
      state.swapInProgress = { card };
      state.availableMoves = Game.getMovesForCard(gs, myIdx, card);
    } else {
      state.availableMoves = Game.getMovesForCard(gs, myIdx, card);
    }

    renderHand();
    refreshHighlights();
  }

  function computeSevenStepMoves(gs, playerIdx, card, remaining) {
    // A 7 may be split across 1 or 2 DIFFERENT pieces. Each piece appears in the
    // plan at most once. So:
    //  - 1st step: any piece, any 1..7 steps
    //  - 2nd step: a DIFFERENT piece, exactly the remaining steps
    const player = gs.players[playerIdx];
    const allHome = player.pieces.every(p => p.location.type === 'home');
    const eff = (gs.teamMode && allHome) ? (playerIdx + 2) % 4 : playerIdx;

    const usedKeys = new Set();
    if (state.sevenInProgress) {
      for (const step of state.sevenInProgress.plan) {
        usedKeys.add(`${step.pieceRef.playerIdx}-${step.pieceRef.pieceIdx}`);
      }
    }
    const isFirstStep = usedKeys.size === 0;
    const moves = [];
    for (const piece of gs.players[eff].pieces.filter(p => p.location.type !== 'kennel')) {
      const key = `${eff}-${piece.index}`;
      if (usedKeys.has(key)) continue;   // can't reuse the same piece
      const stepOptions = isFirstStep
        ? Array.from({ length: remaining }, (_, i) => i + 1)
        : [remaining];                    // second step must consume the rest
      for (const s of stepOptions) {
        for (const r of Game.simulateForward(gs, eff, piece, s)) {
          moves.push({
            card, type: 'sevenStep', steps: s,
            pieceRef: { playerIdx: eff, pieceIdx: piece.index },
            dest: r.location, hasLeftStart: r.hasLeftStart, path: r.path,
          });
        }
      }
    }
    return moves;
  }

  /* ============================================================
     BOARD CLICK HANDLING
     ============================================================ */
  function handleBoardClick(e) {
    if (!isMyTurn()) return;
    const target = e.target.closest('[data-piece-player], [data-cell-type]');
    if (!target) return;

    if (target.hasAttribute('data-piece-player')) {
      const playerIdx = parseInt(target.getAttribute('data-piece-player'));
      const pieceIdx = parseInt(target.getAttribute('data-piece-index'));
      onPieceClick(playerIdx, pieceIdx);
    } else if (target.classList.contains('cell-target')) {
      // Determine which move corresponds to this cell
      onCellClick(target);
    }
  }

  function onPieceClick(playerIdx, pieceIdx) {
    const myIdx = viewingSeat();
    if (!state.selectedCardId) {
      showMessage('Kies eerst een kaart');
      return;
    }
    const gs = state.gameState;
    const card = gs.players[myIdx].hand.find(c => c.id === state.selectedCardId);
    if (!card) return;

    // If a piece is already selected and clicked-on piece sits on a target cell (capture), treat as destination
    if (state.selectedPieceId && !state.swapInProgress) {
      const piece = gs.players[playerIdx].pieces[pieceIdx];
      if (piece.location.type === 'track') {
        const cell = state.svg.querySelector(`#cell-track-${piece.location.pos}.cell-target`);
        if (cell) { onCellClick(cell); return; }
      }
    }

    // SWAP (Boer)
    if (state.swapInProgress) {
      if (!state.swapInProgress.myPieceRef) {
        if (playerIdx !== myIdx) {
          showMessage('Kies eerst een van je eigen schepen');
          return;
        }
        const possible = state.availableMoves.filter(m =>
          m.pieceRef.playerIdx === myIdx && m.pieceRef.pieceIdx === pieceIdx
        );
        if (possible.length === 0) {
          showMessage('Dit schip kan niet wisselen');
          return;
        }
        state.swapInProgress.myPieceRef = { playerIdx, pieceIdx };
        state.selectedPieceId = `piece-${playerIdx}-${pieceIdx}`;
        refreshHighlights();
        return;
      } else {
        const mine = state.swapInProgress.myPieceRef;
        const move = state.availableMoves.find(m =>
          m.pieceRef.playerIdx === mine.playerIdx && m.pieceRef.pieceIdx === mine.pieceIdx &&
          m.swapWith.playerIdx === playerIdx && m.swapWith.pieceIdx === pieceIdx
        );
        if (!move) {
          showMessage('Dit schip kun je niet ruilen');
          return;
        }
        setPendingMove(move);
        return;
      }
    }

    const possible = state.availableMoves.filter(m =>
      m.pieceRef.playerIdx === playerIdx && m.pieceRef.pieceIdx === pieceIdx
    );
    if (possible.length === 0) {
      showMessage('Dit schip kun je hiermee niet bewegen');
      return;
    }

    // If only one possible move (and not seven-split), preview it directly
    if (possible.length === 1 && !state.sevenInProgress) {
      state.selectedPieceId = `piece-${playerIdx}-${pieceIdx}`;
      setPendingMove(possible[0]);
      return;
    }

    state.selectedPieceId = `piece-${playerIdx}-${pieceIdx}`;
    refreshHighlights();
  }

  function onCellClick(targetEl) {
    if (!state.selectedPieceId) {
      // Couldn't have highlighted cell without a piece selected
      return;
    }
    const myIdx = viewingSeat();
    const [_, playerIdxStr, pieceIdxStr] = state.selectedPieceId.split('-');
    const playerIdx = parseInt(playerIdxStr);
    const pieceIdx = parseInt(pieceIdxStr);

    // Determine destination from cell attributes
    const cellType = targetEl.getAttribute('data-cell-type');
    let dest;
    if (cellType === 'track') {
      dest = { type: 'track', pos: parseInt(targetEl.getAttribute('data-cell-pos')) };
    } else if (cellType === 'home') {
      dest = { type: 'home', slot: parseInt(targetEl.getAttribute('data-cell-slot')) };
    } else if (cellType === 'kennel') {
      dest = { type: 'kennel', slot: parseInt(targetEl.getAttribute('data-cell-slot')) };
    }

    // Find matching move
    const candidates = state.availableMoves.filter(m =>
      m.pieceRef.playerIdx === playerIdx && m.pieceRef.pieceIdx === pieceIdx
      && m.dest.type === dest.type
      && (m.dest.type !== 'track' || m.dest.pos === dest.pos)
      && (m.dest.type !== 'home'  || m.dest.slot === dest.slot)
    );
    if (candidates.length === 0) return;

    // Pick the move with highest steps (most relevant when multiple steps possible — rare)
    const move = candidates.sort((a, b) => (b.steps || 0) - (a.steps || 0))[0];

    // Always use preview + confirm — the breadcrumb numbers help reading the move
    setPendingMove(move);
  }

  /* ============================================================
     MOVE PREVIEW + CONFIRM
     ============================================================ */
  function setPendingMove(move) {
    removePreview();
    state.pendingMove = move;
    drawPreview(move);
    renderActions();
  }

  function clearPendingMove() {
    removePreview();
    state.pendingMove = null;
    refreshHighlights();
    renderActions();
  }

  function confirmPendingMove() {
    if (!state.pendingMove) return;
    const move = state.pendingMove;
    state.pendingMove = null;
    removePreview();
    if (move.type === 'sevenStep') {
      applySevenStep(move);
    } else {
      doAction({ type: 'move', move });
    }
  }

  function drawPreview(move) {
    if (!state.svg) return;
    const root = state.svg.querySelector('#board-root') || state.svg;
    const mine = move.pieceRef;

    if (move.type === 'swap') {
      const a = state.svg.querySelector(`#piece-${mine.playerIdx}-${mine.pieceIdx}`);
      const b = state.svg.querySelector(`#piece-${move.swapWith.playerIdx}-${move.swapWith.pieceIdx}`);
      if (a) a.classList.add('selected');
      if (b) b.classList.add('selected');
      return;
    }

    // Translucent ghost boat at the destination
    const original = state.svg.querySelector(`#piece-${mine.playerIdx}-${mine.pieceIdx}`);
    if (!original) return;
    const ghost = original.cloneNode(true);
    ghost.id = 'piece-preview';
    ghost.removeAttribute('data-piece-player');
    ghost.removeAttribute('data-piece-index');
    ghost.classList.add('preview-ghost');
    const xy = Board.pieceXY(move.dest, mine.playerIdx);
    const rot = Board.rotationFor(move.dest, mine.playerIdx);
    ghost.setAttribute('transform', `translate(${xy.x}, ${xy.y}) rotate(${rot})`);
    ghost.setAttribute('pointer-events', 'none');
    root.appendChild(ghost);
    original.classList.add('selected');
  }

  function removePreview() {
    if (!state.svg) return;
    const ghost = state.svg.querySelector('#piece-preview');
    if (ghost) ghost.remove();
    Board.clearPathNumbers(state.svg);
  }

  function refreshPreview() {
    // Called from renderGame after state updates. If pendingMove is set, re-draw the ghost
    // so it survives state-driven re-renders (e.g. after opponent state update).
    if (state.pendingMove) {
      const stillValid = state.availableMoves.some(m => sameMove(m, state.pendingMove));
      if (!stillValid) {
        state.pendingMove = null;
        return;
      }
      removePreview();
      drawPreview(state.pendingMove);
    } else {
      removePreview();
    }
  }

  function sameMove(a, b) {
    if (a.type !== b.type) return false;
    if (a.pieceRef.playerIdx !== b.pieceRef.playerIdx) return false;
    if (a.pieceRef.pieceIdx !== b.pieceRef.pieceIdx) return false;
    if (a.type === 'swap') {
      return a.swapWith.playerIdx === b.swapWith.playerIdx && a.swapWith.pieceIdx === b.swapWith.pieceIdx;
    }
    if (a.dest.type !== b.dest.type) return false;
    if (a.dest.type === 'track') return a.dest.pos === b.dest.pos;
    if (a.dest.type === 'home')  return a.dest.slot === b.dest.slot;
    return true;
  }

  /* Apply one step of a 7-split locally for visualization, send full plan when done */
  function applySevenStep(move) {
    const gs = state.gameState;
    const piece = gs.players[move.pieceRef.playerIdx].pieces[move.pieceRef.pieceIdx];
    if (move.dest.type === 'track') {
      const occ = Game.trackPieceAt(gs, move.dest.pos);
      if (occ && (occ.playerIdx !== move.pieceRef.playerIdx || occ.piece.index !== piece.index)) {
        const used = gs.players[occ.playerIdx].pieces
          .filter(x => x.location.type === 'kennel').map(x => x.location.slot);
        let slot = 0;
        while (used.includes(slot)) slot++;
        occ.piece.location = { type: 'kennel', slot };
        occ.piece.hasLeftStart = false;
      }
    }
    piece.location = { ...move.dest };
    piece.hasLeftStart = move.hasLeftStart;

    const ip = state.sevenInProgress;
    ip.plan.push({
      pieceRef: move.pieceRef, steps: move.steps,
      dest: move.dest, hasLeftStart: move.hasLeftStart,
    });
    ip.remaining -= move.steps;

    if (ip.remaining === 0) {
      const card = ip.card;
      const plan = ip.plan;
      // Revert to base state (host will apply authoritatively)
      state.gameState = Game.deepClone(ip.baseState);
      state.sevenInProgress = null;
      doAction({ type: 'sevenPlan', card, plan });
    } else {
      state.availableMoves = computeSevenStepMoves(gs, gs.currentPlayerIdx, ip.card, ip.remaining);
      if (state.availableMoves.length === 0) {
        showMessage('Kan de 7 niet helemaal verdelen, kies opnieuw');
        state.gameState = Game.deepClone(state.sevenInProgress.baseState);
        state.sevenInProgress = null;
        state.selectedCardId = null;
        state.selectedPieceId = null;
        renderGame();
        return;
      }
      state.selectedPieceId = null;
      renderGame();
    }
  }

  /* ============================================================
     HIGHLIGHTS
     ============================================================ */
  function refreshHighlights() {
    Board.clearHighlights(state.svg);
    if (!isMyTurn()) return;
    if (state.gameState.phase !== 'playing') return;

    if (!state.selectedCardId) return;

    if (state.swapInProgress) {
      if (!state.swapInProgress.myPieceRef) {
        // Highlight own pieces that can swap
        const myIdx = viewingSeat();
        const ids = new Set();
        for (const m of state.availableMoves) {
          if (m.pieceRef.playerIdx === myIdx) {
            ids.add(`piece-${m.pieceRef.playerIdx}-${m.pieceRef.pieceIdx}`);
          }
        }
        Board.markSelectablePieces(state.svg, [...ids]);
      } else {
        // Highlight opponent pieces that can be swapped with my selected
        const mine = state.swapInProgress.myPieceRef;
        Board.markSelectedPiece(state.svg, `piece-${mine.playerIdx}-${mine.pieceIdx}`);
        const ids = new Set();
        for (const m of state.availableMoves) {
          if (m.pieceRef.playerIdx === mine.playerIdx && m.pieceRef.pieceIdx === mine.pieceIdx) {
            ids.add(`piece-${m.swapWith.playerIdx}-${m.swapWith.pieceIdx}`);
          }
        }
        Board.markSelectablePieces(state.svg, [...ids]);
      }
      return;
    }

    if (!state.selectedPieceId) {
      // Highlight selectable pieces
      const ids = new Set();
      for (const m of state.availableMoves) {
        ids.add(`piece-${m.pieceRef.playerIdx}-${m.pieceRef.pieceIdx}`);
      }
      Board.markSelectablePieces(state.svg, [...ids]);
    } else {
      // Highlight destination cells for selected piece
      Board.markSelectedPiece(state.svg, state.selectedPieceId);
      const [_, pIdxStr, piIdxStr] = state.selectedPieceId.split('-');
      const pIdx = parseInt(pIdxStr); const piIdx = parseInt(piIdxStr);
      const cells = new Set();
      for (const m of state.availableMoves) {
        if (m.pieceRef.playerIdx !== pIdx || m.pieceRef.pieceIdx !== piIdx) continue;
        if (m.dest.type === 'track') cells.add(`cell-track-${m.dest.pos}`);
        else if (m.dest.type === 'home') cells.add(`cell-home-${m.pieceRef.playerIdx}-${m.dest.slot}`);
      }
      Board.markTargetCells(state.svg, [...cells]);
    }
  }

  /* ============================================================
     ACTION DISPATCH
     ============================================================ */
  function doAction(action) {
    if (state.mode === 'client') {
      // Send to host; wait for state update
      Network.sendAction(action);
      // Optimistically clear selection
      state.selectedCardId = null;
      state.selectedPieceId = null;
      return;
    }
    // Host or local: apply locally
    const seat = state.gameState.currentPlayerIdx;
    applyAction(seat, action);
    finishAction();
    if (state.mode === 'host') Network.broadcastState(state.gameState);
    scheduleBotsIfNeeded();
  }

  function applyAction(seat, action) {
    const gs = state.gameState;
    if (action.type === 'pass') {
      Game.passTurn(gs, seat);
    } else if (action.type === 'move') {
      Game.applyMove(gs, seat, action.move);
      Game.endTurn(gs);
    } else if (action.type === 'sevenPlan') {
      Game.applySevenPlan(gs, seat, action.card, action.plan);
      Game.endTurn(gs);
    }
  }

  function finishAction() {
    state.selectedCardId = null;
    state.selectedPieceId = null;
    state.availableMoves = [];
    state.sevenInProgress = null;
    state.swapInProgress = null;
    state.pendingMove = null;
    removePreview();
    renderGame();
  }

  /* ============================================================
     BOT TURNS
     ============================================================ */
  function scheduleBotsIfNeeded() {
    if (state.mode === 'client') return; // host runs bots
    // 3 second pause before & after each bot — humans need time to read what happened
    setTimeout(playBotIfNeeded, 3000);
  }

  function playBotIfNeeded() {
    if (!state.gameState || state.gameState.phase !== 'playing') return;
    // Hold off bots while the intermezzo modal is open — let the player(s) acknowledge first
    if (document.getElementById('modal-intermezzo').classList.contains('show')) {
      setTimeout(playBotIfNeeded, 1500);
      return;
    }
    const gs = state.gameState;
    const cur = gs.players[gs.currentPlayerIdx];
    if (!cur.isBot) return;

    if (cur.hand.length === 0 || !Game.canPlayAny(gs, gs.currentPlayerIdx)) {
      Game.passTurn(gs, gs.currentPlayerIdx);
      finishAction();
      if (state.mode === 'host') Network.broadcastState(gs);
      scheduleBotsIfNeeded();
      return;
    }

    const play = Game.pickBotMove(gs, gs.currentPlayerIdx);
    if (!play) {
      Game.passTurn(gs, gs.currentPlayerIdx);
    } else if (play.sevenPlan) {
      Game.applySevenPlan(gs, gs.currentPlayerIdx, play.card, play.sevenPlan);
      Game.endTurn(gs);
    } else {
      Game.applyMove(gs, gs.currentPlayerIdx, play.move);
      Game.endTurn(gs);
    }
    finishAction();
    if (state.mode === 'host') Network.broadcastState(gs);
    scheduleBotsIfNeeded();
  }

  /* ============================================================
     CONTROLS
     ============================================================ */
  function bindGameControls() {
    document.getElementById('rules-btn').addEventListener('click', () => {
      document.getElementById('modal-rules').classList.add('show');
    });
    document.getElementById('leave-btn').addEventListener('click', () => {
      if (confirm('Het spel verlaten en terug naar de kade?')) {
        Network.disconnect();
        state.gameState = null;
        state.lobby = null;
        state.mode = 'menu';
        showScreen('menu');
      }
    });
  }

  function bindModals() {
    document.querySelectorAll('[data-close-modal]').forEach(el => {
      el.addEventListener('click', () => {
        el.closest('.modal-overlay').classList.remove('show');
      });
    });
    document.querySelectorAll('.modal-overlay').forEach(ov => {
      ov.addEventListener('click', e => {
        if (e.target === ov && ov.id !== 'modal-intermezzo' && ov.id !== 'modal-win') {
          ov.classList.remove('show');
        }
      });
    });
    document.getElementById('intermezzo-continue').addEventListener('click', () => {
      document.getElementById('modal-intermezzo').classList.remove('show');
    });
    document.getElementById('win-back').addEventListener('click', () => {
      document.getElementById('modal-win').classList.remove('show');
      Network.disconnect();
      state.gameState = null;
      state.lobby = null;
      state.mode = 'menu';
      showScreen('menu');
    });
  }

  function showWinModal() {
    const gs = state.gameState;
    const order = gs.finishOrder || [];
    const trophy = ['🥇', '🥈', '🥉', '🎖'];

    let title;
    if (gs.teamMode && gs.winnerTeam != null) {
      title = '🏆 ' + TEAM_NAMES[gs.winnerTeam] + ' wint!';
    } else if (order.length > 0) {
      const winner = gs.players[order[0]];
      title = '🏆 ' + winner.name + ' wint!';
    } else {
      title = '🏆 Spel afgelopen';
    }
    document.getElementById('win-title').textContent = title;

    const lines = order.map((seat, i) => {
      const p = gs.players[seat];
      const dot = `<span class="rank-dot" data-color="${['yellow','red','green','blue'][seat]}"></span>`;
      return `<div class="rank-row">${trophy[i] || (i + 1) + '.'} ${dot}<strong>${p.name}</strong></div>`;
    }).join('');
    document.getElementById('win-subtitle').innerHTML =
      `<div class="ranking">${lines}</div><p>Alle schepen binnen — wat een reis!</p>`;

    document.getElementById('modal-win').classList.add('show');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
