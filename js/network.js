/* ============================================================
   NETWORK — PeerJS-based host/client networking for online play
   Host is authoritative; clients send actions and receive state updates.
   ============================================================ */

const Network = (() => {
  // Use a stable prefix so peer IDs are easy to share
  const PEER_PREFIX = 'keezen-zee-';

  let peer = null;
  let isHost = false;
  let hostConnections = new Map(); // peerId -> connection (host only)
  let clientConnection = null;     // client only
  let myCode = null;               // 6-char code for joining

  let listeners = {
    onConnected: () => {},
    onDisconnected: () => {},
    onPlayerJoin: () => {},          // host: new player joined
    onPlayerLeave: () => {},         // host: player left
    onLobbyUpdate: () => {},         // client: lobby info updated
    onGameStart: () => {},           // client: game starting
    onStateUpdate: () => {},         // client: game state updated
    onAction: () => {},              // host: received action from client
    onError: () => {},
    onMessage: () => {},
  };

  function setListeners(l) { listeners = { ...listeners, ...l }; }

  function makeCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // exclude confusing chars
    let s = '';
    for (let i = 0; i < 6; i++) s += letters[Math.floor(Math.random() * letters.length)];
    return s;
  }

  /* ------------------------------------------------------------
     HOST
     ------------------------------------------------------------ */
  function createGame() {
    return new Promise((resolve, reject) => {
      isHost = true;
      myCode = makeCode();
      const peerId = PEER_PREFIX + myCode;
      peer = new Peer(peerId, { debug: 1 });

      peer.on('open', id => {
        listeners.onConnected({ code: myCode, peerId: id, isHost: true });
        resolve({ code: myCode });
      });

      peer.on('error', err => {
        if (err.type === 'unavailable-id') {
          // Try a different code
          peer.destroy();
          myCode = makeCode();
          peer = new Peer(PEER_PREFIX + myCode, { debug: 1 });
          peer.on('open', id => {
            listeners.onConnected({ code: myCode, peerId: id, isHost: true });
            resolve({ code: myCode });
          });
          peer.on('error', e => { listeners.onError(e); reject(e); });
          attachHostConnHandlers();
          return;
        }
        listeners.onError(err);
        reject(err);
      });

      attachHostConnHandlers();
    });
  }

  function attachHostConnHandlers() {
    peer.on('connection', conn => {
      conn.on('open', () => {
        // Store connection
        hostConnections.set(conn.peer, conn);
      });
      conn.on('data', data => {
        try {
          handleHostMessage(conn, data);
        } catch (e) {
          console.error('Host msg error:', e);
        }
      });
      conn.on('close', () => {
        hostConnections.delete(conn.peer);
        listeners.onPlayerLeave({ peerId: conn.peer });
      });
    });
  }

  function handleHostMessage(conn, data) {
    if (data.type === 'join') {
      listeners.onPlayerJoin({ peerId: conn.peer, name: data.name });
    } else if (data.type === 'action') {
      listeners.onAction({ peerId: conn.peer, action: data.action });
    } else if (data.type === 'chat') {
      listeners.onMessage({ peerId: conn.peer, text: data.text });
    }
  }

  function broadcast(message) {
    for (const conn of hostConnections.values()) {
      try { conn.send(message); } catch (e) { console.warn('send failed', e); }
    }
  }

  function sendToClient(peerId, message) {
    const conn = hostConnections.get(peerId);
    if (conn) try { conn.send(message); } catch (e) { console.warn('send failed', e); }
  }

  function broadcastLobby(lobby) {
    broadcast({ type: 'lobby', lobby });
  }

  function broadcastGameStart(initialState, seatMapping) {
    broadcast({ type: 'gameStart', state: initialState, seatMapping });
  }

  function broadcastState(state) {
    broadcast({ type: 'state', state });
  }

  /* ------------------------------------------------------------
     CLIENT
     ------------------------------------------------------------ */
  function joinGame(code, name) {
    return new Promise((resolve, reject) => {
      isHost = false;
      const peerId = PEER_PREFIX + 'c-' + Math.random().toString(36).slice(2, 10);
      peer = new Peer(peerId, { debug: 1 });

      peer.on('open', myId => {
        const hostId = PEER_PREFIX + code;
        const conn = peer.connect(hostId, { reliable: true });
        clientConnection = conn;

        conn.on('open', () => {
          conn.send({ type: 'join', name });
          listeners.onConnected({ code, peerId: myId, isHost: false });
          resolve({ peerId: myId });
        });

        conn.on('data', data => handleClientMessage(data));
        conn.on('close', () => {
          listeners.onDisconnected();
        });
        conn.on('error', err => {
          listeners.onError(err);
          reject(err);
        });

        // Timeout if host not reachable
        setTimeout(() => {
          if (!conn.open) {
            reject(new Error('Kon geen verbinding maken — controleer de havencode.'));
          }
        }, 8000);
      });

      peer.on('error', err => {
        listeners.onError(err);
        if (err.type === 'peer-unavailable') {
          reject(new Error('Havencode niet gevonden. Vraag de kapitein om de juiste code.'));
        } else {
          reject(err);
        }
      });
    });
  }

  function handleClientMessage(data) {
    if (data.type === 'lobby') {
      listeners.onLobbyUpdate(data.lobby);
    } else if (data.type === 'gameStart') {
      listeners.onGameStart({ state: data.state, seatMapping: data.seatMapping });
    } else if (data.type === 'state') {
      listeners.onStateUpdate(data.state);
    } else if (data.type === 'chat') {
      listeners.onMessage(data);
    }
  }

  function sendAction(action) {
    if (clientConnection && clientConnection.open) {
      clientConnection.send({ type: 'action', action });
    }
  }

  /* ------------------------------------------------------------
     Common
     ------------------------------------------------------------ */
  function disconnect() {
    if (peer) {
      try { peer.destroy(); } catch (e) {}
    }
    peer = null;
    isHost = false;
    hostConnections.clear();
    clientConnection = null;
    myCode = null;
  }

  return {
    setListeners,
    createGame,
    joinGame,
    broadcastLobby,
    broadcastGameStart,
    broadcastState,
    sendToClient,
    sendAction,
    disconnect,
    get isHost() { return isHost; },
    get code() { return myCode; },
    get peerId() { return peer ? peer.id : null; },
  };
})();
