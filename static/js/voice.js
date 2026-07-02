/**
 * voice.js
 * Voice recording, hands-free locking, wave animation, and drag gesture controls (up to lock, left to cancel, right to send)
 */

let voiceRec = null, voiceChunks = [], voiceStream = null, voiceLocked = false, voicePaused = false;
let voiceStartTime = 0, voiceElapsed = 0, voiceTimerInterval = null;
let voiceMicStartX = 0, voiceMicStartY = 0, voiceMicActive = false;

function formatRecTime(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function enterRecordingMode(locked) {
  const row = document.getElementById('inputRow');
  if (row) row.classList.add('recording-mode');
  const hint = document.getElementById('voiceGestureHint');
  if (hint) hint.classList.toggle('show', !locked);
  const pauseBtn = document.getElementById('voicePauseBtn');
  if (pauseBtn) pauseBtn.style.display = locked ? 'inline-flex' : 'none';
  const waveform = document.getElementById('waveform');
  if (waveform) waveform.classList.toggle('paused', false);
  voiceLocked = locked;
}

function exitRecordingMode() {
  const row = document.getElementById('inputRow');
  if (row) row.classList.remove('recording-mode');
  const hint = document.getElementById('voiceGestureHint');
  if (hint) hint.classList.remove('show');
  
  const recTime = document.getElementById('recTime');
  const pauseBtn = document.getElementById('voicePauseBtn');
  const waveform = document.getElementById('waveform');
  const micBtn = document.getElementById('micBtn');

  if (recTime) recTime.textContent = '0:00';
  if (pauseBtn) {
    pauseBtn.textContent = '⏸';
    pauseBtn.style.display = 'none';
  }
  if (waveform) waveform.classList.remove('paused');
  clearInterval(voiceTimerInterval);
  voiceTimerInterval = null;
  voiceLocked = false;
  voicePaused = false;
  voiceMicActive = false;
  voiceElapsed = 0;
  if (micBtn) micBtn.classList.remove('recording');
}

async function startVoiceRec() {
  if (!currentChat || voiceRec) return;
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch { 
    if (typeof showToast === 'function') showToast('Microphone access denied'); 
    return; 
  }
  voiceChunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
  voiceRec = new MediaRecorder(voiceStream, { mimeType: mime });
  voiceRec.ondataavailable = e => { if (e.data.size) voiceChunks.push(e.data); };
  voiceRec.onstop = () => { if (voiceStream) { voiceStream.getTracks().forEach(t => t.stop()); voiceStream = null; } };
  voiceRec.start(100);
  voiceStartTime = Date.now();
  voiceElapsed = 0;
  voiceMicActive = true;
  const micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.classList.add('recording');
  voiceTimerInterval = setInterval(() => {
    if (!voicePaused) {
      voiceElapsed = Date.now() - voiceStartTime;
      const recTime = document.getElementById('recTime');
      if (recTime) recTime.textContent = formatRecTime(voiceElapsed);
    }
  }, 200);
  enterRecordingMode(false);
}

function resetVoiceRec() {
  if (voiceRec && voiceRec.state !== 'inactive') voiceRec.stop();
  voiceRec = null;
  voiceChunks = [];
  const micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.classList.remove('recording');
  exitRecordingMode();
}

function cancelVoiceRec() {
  resetVoiceRec();
}

function toggleVoicePause() {
  if (!voiceRec || !voiceLocked) return;
  const waveform = document.getElementById('waveform');
  const pauseBtn = document.getElementById('voicePauseBtn');
  if (voicePaused) {
    voiceRec.resume();
    voicePaused = false;
    voiceStartTime = Date.now() - voiceElapsed; 
    if (waveform) waveform.classList.remove('paused');
    if (pauseBtn) pauseBtn.textContent = '⏸';
  } else {
    voiceRec.pause();
    voicePaused = true;
    if (waveform) waveform.classList.add('paused');
    if (pauseBtn) pauseBtn.textContent = '▶';
  }
}

function lockVoiceRec() {
  if (!voiceRec) return;
  voiceLocked = true;
  const hint = document.getElementById('voiceGestureHint');
  if (hint) hint.classList.remove('show');
  const micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.classList.remove('recording');
  const pauseBtn = document.getElementById('voicePauseBtn');
  if (pauseBtn) pauseBtn.style.display = 'inline-flex';
  
  const lk = document.getElementById('vghLock');
  if (lk) {
    lk.classList.add('active');
    setTimeout(() => lk.classList.remove('active'), 400);
  }
  if (typeof showToast === 'function') showToast('🔒 Locked — recording hands-free');
}

async function sendVoiceMsg() {
  const rec = voiceRec;
  if (!rec && !voiceChunks.length) return;
  if (rec && rec.state !== 'inactive') {
    await new Promise(resolve => { rec.addEventListener('stop', resolve, { once: true }); rec.stop(); });
  }
  const chunks = voiceChunks.slice();
  voiceRec = null;
  voiceChunks = [];
  const micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.classList.remove('recording');
  exitRecordingMode();
  if (!chunks.length || !currentChat) return;
  const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
  if (blob.size < 500) return;
  if (typeof showToast === 'function') showToast('Sending voice message…');
  const file = new File([blob], 'voice.webm', { type: blob.type });
  const { url } = await cloudUpload(file);
  socket.emit('private_message', { receiver: currentChat, message: '', sender_message: '', msg_type: 'voice', media_url: url, reply_to: replyingTo || '' });
  if (typeof cancelReply === 'function') cancelReply();
}

// Visual layout microgesture helper
(function initVoiceMic() {
  const mic = document.getElementById('micBtn');
  if (!mic) return;
  const LOCK_THRESHOLD   = 60; // px upward   → lock
  const CANCEL_THRESHOLD = 60; // px leftward  → cancel
  const SEND_THRESHOLD   = 60; // px rightward → send

  const NEAR_LOCK   = 30;
  const NEAR_CANCEL = 30;

  function applyMicTranslate(dx, dy) {
    const clampX = Math.max(-CANCEL_THRESHOLD * 1.4, Math.min(SEND_THRESHOLD * 1.4, dx));
    const clampY = Math.max(-LOCK_THRESHOLD * 1.4, Math.min(20, -dy)); 
    mic.style.transform = `translate(${clampX}px, ${-dy > 0 ? Math.min(clampY * 0.4, 8) : Math.max(clampY * 0.4, -8)}px) scale(1.15)`;
  }

  function snapMicBack() {
    mic.classList.remove('dragging-active');
    mic.style.transform = '';
  }

  function updateZoneIcons(dx, dy) {
    const lk  = document.getElementById('vghLock');
    const cnc = document.getElementById('vghCancel');
    if (lk) {
      if (dy >= LOCK_THRESHOLD) {
        lk.classList.add('active');  lk.classList.remove('near');
      } else if (dy >= NEAR_LOCK) {
        lk.classList.add('near');    lk.classList.remove('active');
      } else {
        lk.classList.remove('active', 'near');
      }
    }
    if (cnc) {
      if (dx <= -CANCEL_THRESHOLD) {
        cnc.classList.add('active'); cnc.classList.remove('near');
      } else if (dx <= -NEAR_CANCEL) {
        cnc.classList.add('near');   cnc.classList.remove('active');
      } else {
        cnc.classList.remove('active', 'near');
      }
    }
  }

  function clearZoneIcons() {
    const lk  = document.getElementById('vghLock');
    const cnc = document.getElementById('vghCancel');
    if (lk) lk.classList.remove('active', 'near');
    if (cnc) cnc.classList.remove('active', 'near');
  }

  function handleStart(startX, startY) {
    voiceMicStartX = startX;
    voiceMicStartY = startY;
    mic.classList.add('dragging-active');
    mic.style.transform = 'scale(1.15)';
    startVoiceRec();
  }

  function handleMove(curX, curY) {
    if (!voiceRec || voiceLocked) return;
    const dx = curX - voiceMicStartX;
    const dy = voiceMicStartY - curY; 

    applyMicTranslate(dx, dy);
    updateZoneIcons(dx, dy);

    if (dy > LOCK_THRESHOLD) { snapMicBack(); clearZoneIcons(); lockVoiceRec(); return; }
    if (dx < -CANCEL_THRESHOLD) { snapMicBack(); clearZoneIcons(); cancelVoiceRec(); return; }
    if (dx > SEND_THRESHOLD) { snapMicBack(); clearZoneIcons(); sendVoiceMsg(); return; }
  }

  function handleEnd() {
    if (!voiceRec || voiceLocked) return;
    snapMicBack();
    clearZoneIcons();
    const elapsed = Date.now() - voiceStartTime;
    if (elapsed < 500) cancelVoiceRec();
    else sendVoiceMsg();
  }

  mic.addEventListener('touchstart', e => {
    e.preventDefault();
    handleStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!voiceMicActive) return;
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!voiceMicActive) return;
    handleEnd();
  });

  document.addEventListener('touchcancel', () => {
    if (!voiceMicActive) return;
    snapMicBack();
    clearZoneIcons();
    cancelVoiceRec();
  });

  mic.addEventListener('mousedown', e => {
    e.preventDefault();
    handleStart(e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', e => {
    if (!voiceMicActive) return;
    handleMove(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', () => {
    if (!voiceMicActive) return;
    handleEnd();
  });
})();

console.log('✓ Voice module loaded');
