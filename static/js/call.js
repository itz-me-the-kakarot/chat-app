/**
 * call.js — Voice-only WebRTC calling module (v1)
 * Reuses the global `socket` instance from index.html.
 * STUN only | audio only | no group calls.
 */
(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────── */
  let pc            = null;
  let localStream   = null;
  let callPeer      = null;
  let isCaller      = false;
  let muted         = false;
  let timerInterval = null;
  let timerSeconds  = 0;
  let timeoutHandle = null;
  let callActive    = false;
  let pendingOffer  = null;  // SDP offer stored while callee decides
  let candidateQueue = [];
  let onHold         = false;
  let speakerOn      = true;
  let wasConnected   = false;

  const STUN_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  /* ── DOM helpers ───────────────────────────────────────── */
  const $   = id => document.getElementById(id);
  const modal      = () => $('callModal');
  const statusEl   = () => $('callStatus');
  const timerEl    = () => $('callTimer');
  const muteBtn    = () => $('muteBtn');
  const muteLbl    = () => $('muteBtnLabel');
  const ringEl     = () => $('callAvatarRing');
  const avatarEl   = () => $('callAvatarCircle');
  const remoteAudio = () => $('remoteAudio');

  /* Show / hide wrappers (not individual buttons) */
  function showBtns (accept, decline, mute, hold, speaker, hangup) {
    const show = (id, v) => { const el = $(id); if (el) el.style.display = v ? 'flex' : 'none'; };
    show('acceptWrap',  accept);
    show('declineWrap', decline);
    show('muteWrap',    mute);
    show('holdWrap',    hold);
    show('speakerWrap', speaker);
    show('hangupWrap',  hangup);
  }

  function showModal () {
    modal().style.display = 'flex';
    // re-trigger card animation on each open
    const card = modal().querySelector('.call-modal-card');
    if (card) { card.style.animation = 'none'; card.offsetHeight; card.style.animation = ''; }
  }
  function hideModal () { modal().style.display = 'none'; }
  function setStatus (t) { statusEl().textContent = t; }

  /* Update avatar circle to show peer's first letter */
  function setAvatar (peer) {
    const el = avatarEl();
    if (!el) return;
    el.textContent = peer ? peer[0].toUpperCase() : '📞';
  }

  /* Toggle ringing pulse animation */
  function setRinging (on) {
    const el = ringEl();
    if (!el) return;
    el.classList.toggle('call-ringing', on);
  }

  function showCallerUI () {
    setStatus('Calling ' + callPeer + '…');
    setAvatar(callPeer);
    setRinging(true);
    showBtns(false, false, true, false, true, true);
    timerEl().style.display = 'none';
  }
  function showCalleeUI (from) {
    setStatus('Incoming call from ' + from);
    setAvatar(from);
    setRinging(true);
    showBtns(true, true, false, false, false, false);
    timerEl().style.display = 'none';
  }
  async function sendEncryptedMsg (peer, text) {
    if (typeof socket === 'undefined' || !peer) return;
    try {
      if (typeof getPubKey === 'function' && typeof enc === 'function' && myPublicKey) {
        const rKey = await getPubKey(peer);
        if (rKey) {
          const eR = await enc(rKey, text);
          const eS = await enc(myPublicKey, text);
          socket.emit('private_message', {
            receiver: peer,
            message: eR,
            sender_message: eS,
            msg_type: 'text',
            reply_to: ''
          });
          return;
        }
      }
    } catch (err) {
      console.error('Failed to encrypt call message:', err);
    }
    // Fallback
    socket.emit('private_message', {
      receiver: peer,
      message: text,
      sender_message: text,
      msg_type: 'text',
      reply_to: ''
    });
  }

  function showConnectedUI () {
    setStatus('🔊 ' + callPeer);
    setRinging(false);
    showBtns(false, false, true, true, true, true);
    timerEl().style.display = 'block';
    startTimer();

    if (isCaller && !wasConnected) {
      wasConnected = true;
      const startTimeStr = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      sendEncryptedMsg(callPeer, `📞 Call started at ${startTimeStr}`);
    }
  }

  /* ── Timer ─────────────────────────────────────────────── */
  function startTimer () {
    timerSeconds = 0;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timerSeconds++;
      const m = String(Math.floor(timerSeconds / 60)).padStart(2,'0');
      const s = String(timerSeconds % 60).padStart(2,'0');
      timerEl().textContent = m + ':' + s;
    }, 1000);
  }
  function stopTimer () {
    clearInterval(timerInterval);
    timerInterval = null;
    timerEl().textContent = '00:00';
  }

  /* ── Cleanup ───────────────────────────────────────────── */
  function cleanup () {
    clearTimeout(timeoutHandle);
    stopTimer();
    setRinging(false);
    if (pc)          { pc.close();  pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    const ra = remoteAudio(); if (ra) { ra.srcObject = null; ra.muted = false; ra.volume = 1.0; }
    pendingOffer = null;
    candidateQueue = [];

    if (isCaller && wasConnected && callPeer) {
      const endTimeStr = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      sendEncryptedMsg(callPeer, `📞 Call ended at ${endTimeStr}`);
    }
    wasConnected = false;

    callPeer = null; isCaller = false; muted = false; callActive = false;
    onHold = false;
    speakerOn = true;
    // Reset mute button state
    const mb = muteBtn();
    if (mb) { mb.textContent = '🎙️'; mb.classList.remove('muted'); }
    const ml = muteLbl();
    if (ml) ml.textContent = 'Mute';
    const hb = $('holdBtn');
    if (hb) { hb.textContent = '⏸️'; hb.classList.remove('muted'); }
    const hl = $('holdBtnLabel');
    if (hl) hl.textContent = 'Hold';
    const sb = $('speakerBtn');
    if (sb) { sb.textContent = '🔊'; sb.classList.remove('muted'); }
    const sl = $('speakerBtnLabel');
    if (sl) sl.textContent = 'Speaker';
    hideModal();
  }

  /* ── Missed call message ───────────────────────────────── */
  function sendMissedMsg (peer) {
    sendEncryptedMsg(peer, '📵 Missed voice call');
  }

  /* ── RTCPeerConnection factory ─────────────────────────── */
  function buildPC () {
    const conn = new RTCPeerConnection(STUN_CFG);

    localStream.getTracks().forEach(t => conn.addTrack(t, localStream));

    conn.onicecandidate = (e) => {
      if (e.candidate && callPeer) {
        socket.emit('call-signal', { to: callPeer, candidate: e.candidate });
      }
    };

    conn.ontrack = (e) => {
      const ra = remoteAudio();
      if (ra && !ra.srcObject) ra.srcObject = e.streams[0];
    };

    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'disconnected' || conn.connectionState === 'failed') {
        hangUp(false);
      }
    };

    return conn;
  }

  /* ── Initiate call (caller side) ───────────────────────── */
  async function initiateCall (peer) {
    if (!peer) return;
    if (callActive) { if (typeof showToast === 'function') showToast('Already in a call'); return; }
    callActive = true; callPeer = peer; isCaller = true;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (_) {
      if (typeof showToast === 'function') showToast('Microphone access denied');
      cleanup(); return;
    }

    pc = buildPC();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit('call-request', { to: callPeer, sdp: offer });
    showModal(); showCallerUI();

    // 30 s timeout → missed
    timeoutHandle = setTimeout(() => {
      socket.emit('call-end', { to: callPeer, reason: 'timeout' });
      sendMissedMsg(callPeer);
      cleanup();
      if (typeof showToast === 'function') showToast('No answer');
    }, 30000);
  }

  /* ── Accept (callee side) ──────────────────────────────── */
  async function acceptCall () {
    clearTimeout(timeoutHandle);

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (_) {
      if (typeof showToast === 'function') showToast('Microphone access denied');
      socket.emit('call-end', { to: callPeer, reason: 'mic-denied' });
      cleanup(); return;
    }

    pc = buildPC();
    await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));
    
    // Process queued candidates
    while (candidateQueue.length > 0) {
      const candidate = candidateQueue.shift();
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('call-accept', { to: callPeer, sdp: answer });
    showConnectedUI();
  }

  /* ── Hang up ───────────────────────────────────────────── */
  function hangUp (notify = true) {
    if (notify && callPeer) socket.emit('call-end', { to: callPeer, reason: 'hangup' });
    cleanup();
  }

  /* ── Mute toggle ───────────────────────────────────────── */
  function toggleMute () {
    if (!localStream) return;
    muted = !muted;
    localStream.getAudioTracks().forEach(t => { t.enabled = !muted && !onHold; });
    const mb = muteBtn();
    const ml = muteLbl();
    if (mb) {
      mb.textContent = muted ? '🔇' : '🎙️';
      mb.classList.toggle('muted', muted);
    }
    if (ml) ml.textContent = muted ? 'Unmute' : 'Mute';
  }

  /* ── Hold toggle ───────────────────────────────────────── */
  function toggleHold () {
    if (!localStream) return;
    onHold = !onHold;
    // Mute local microphone
    localStream.getAudioTracks().forEach(t => { t.enabled = !onHold && !muted; });
    // Mute remote audio element
    const ra = remoteAudio();
    if (ra) ra.muted = onHold;

    const hb = $('holdBtn');
    const hl = $('holdBtnLabel');
    if (hb) {
      hb.textContent = onHold ? '▶️' : '⏸️';
      hb.classList.toggle('muted', onHold);
    }
    if (hl) hl.textContent = onHold ? 'Resume' : 'Hold';
    setStatus(onHold ? '⏸️ On Hold' : '🔊 ' + callPeer);
  }

  /* ── Speaker toggle ────────────────────────────────────── */
  function toggleSpeaker () {
    speakerOn = !speakerOn;
    const ra = remoteAudio();
    if (ra) {
      ra.volume = speakerOn ? 1.0 : 0.15;
    }
    const sb = $('speakerBtn');
    const sl = $('speakerBtnLabel');
    if (sb) {
      sb.textContent = speakerOn ? '🔊' : '🔈';
      sb.classList.toggle('muted', !speakerOn);
    }
    if (sl) sl.textContent = speakerOn ? 'Speaker' : 'Earpiece';
    if (typeof showToast === 'function') {
      showToast(speakerOn ? 'Speaker mode active' : 'Earpiece mode active');
    }
  }

  /* ── Expose globals (called by inline onclick in modal) ── */
  window.initiateCall  = initiateCall;
  window._callAccept   = acceptCall;
  window._callDecline  = () => { socket.emit('call-end', { to: callPeer, reason: 'declined' }); cleanup(); };
  window._callMute     = toggleMute;
  window._callHold     = toggleHold;
  window._callSpeaker  = toggleSpeaker;
  window._callHangup   = () => hangUp(true);

  /* ── Socket listeners ──────────────────────────────────── */
  // Socket is declared after this script in some page orderings,
  // so we hook in once the page has fully loaded or immediately if already loaded.
  function attachCallSocketListeners () {
    if (typeof socket === 'undefined') {
      // Retry in case socket.io hasn't initialised yet
      setTimeout(attachCallSocketListeners, 300);
      return;
    }

    /* Callee: incoming call request */
    socket.on('call-request', (data) => {
      if (callActive) {
        socket.emit('call-end', { to: data.from, reason: 'busy' }); return;
      }
      callActive   = true;
      callPeer     = data.from;
      isCaller     = false;
      pendingOffer = data.sdp;

      showModal(); showCalleeUI(data.from);

      // Auto-decline after 30 s — also send missed-call message to caller
      timeoutHandle = setTimeout(() => {
        socket.emit('call-end', { to: callPeer, reason: 'timeout' });
        sendMissedMsg(callPeer);
        cleanup();
      }, 30000);
    });

    /* Caller: answered */
    socket.on('call-accept', async (data) => {
      clearTimeout(timeoutHandle);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      
      // Process queued candidates
      while (candidateQueue.length > 0) {
        const candidate = candidateQueue.shift();
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
      }
      
      showConnectedUI();
    });

    /* Both: ICE candidates */
    socket.on('call-signal', async (data) => {
      if (data.candidate) {
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (_) {}
        } else {
          candidateQueue.push(data.candidate);
        }
      }
    });

    /* Both: call ended / declined / missed */
    socket.on('call-end', (data) => {
      const reason = (data || {}).reason || 'ended';
      const senderName = (data && data.from) || callPeer || 'Receiver';
      const msgs = {
        declined: senderName + ' declined the call',
        busy:     senderName + ' is busy',
        timeout:  'Missed call',
        hangup:   'Call ended',
        'mic-denied': 'Could not access microphone'
      };
      const msg = msgs[reason] || 'Call ended';
      if (typeof showToast === 'function') showToast(msg);
      cleanup();
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    attachCallSocketListeners();
  } else {
    window.addEventListener('load', attachCallSocketListeners);
  }

})();
