// Phone-to-phone link over WebRTC. The free public PeerJS service is used only
// to introduce the two phones; battle messages then go directly between them
// (or through PeerJS's TURN relay when a direct route is impossible).

import { randomRoom } from './pvp.js';

const PREFIX = 'barbrawl-v1-';
const JOIN_TIMEOUT_MS = 15000;
let peerModule = null;

async function loadPeer() {
  peerModule ||= import('peerjs');
  return (await peerModule).Peer;
}

export function linkErrorText(err, code) {
  switch (err?.type) {
    case 'peer-unavailable':
      return `No battle found with code ${code}. Check the code with your friend and make sure their room is still open.`;
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'disconnected':
      return 'Could not reach the pairing service. Check your internet connection and try again.';
    case 'browser-incompatible':
    case 'webrtc':
      return 'This browser cannot make direct connections. Try Chrome.';
    case 'timeout':
      return "Could not connect to your friend's phone. Putting both phones on the same Wi-Fi usually fixes this.";
    default:
      return 'The connection failed. Try again.';
  }
}

/** Open a room. Calls onCode(code) once it is live and onConnection(conn) when a friend joins. */
export async function hostRoom({ onCode, onConnection, onError }) {
  const Peer = await loadPeer();
  let peer = null;
  let tries = 0;
  let taken = false;
  let destroyed = false;

  const start = () => {
    const code = randomRoom();
    peer = new Peer(PREFIX + code, { debug: 0 });
    peer.on('open', () => { if (!destroyed) onCode(code); });
    peer.on('connection', (conn) => {
      if (taken) { conn.close(); return; } // one friend per room
      taken = true;
      conn.on('open', () => {
        peer.disconnect(); // leave the pairing service; the direct link stays up
        onConnection(conn);
      });
    });
    peer.on('error', (err) => {
      if (destroyed) return;
      if (err.type === 'unavailable-id' && tries++ < 5) { peer.destroy(); start(); return; }
      if (!taken) onError(err);
    });
  };
  start();
  return { destroy() { destroyed = true; peer?.destroy(); } };
}

/** Join a friend's room by code. */
export async function joinRoom(code, { onConnection, onError }) {
  const Peer = await loadPeer();
  const peer = new Peer({ debug: 0 });
  let timer = null;
  let connected = false;
  let destroyed = false;
  const fail = (err) => {
    if (destroyed || connected) return;
    clearTimeout(timer);
    onError(err);
  };
  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code, { reliable: true });
    timer = setTimeout(() => fail({ type: 'timeout' }), JOIN_TIMEOUT_MS);
    conn.on('open', () => {
      clearTimeout(timer);
      connected = true;
      peer.disconnect();
      onConnection(conn);
    });
    conn.on('error', fail);
  });
  peer.on('error', fail);
  return { destroy() { destroyed = true; clearTimeout(timer); peer.destroy(); } };
}
