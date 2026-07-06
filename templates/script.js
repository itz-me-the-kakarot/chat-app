KNOCK FULLSCREEN — replaces openKnockDoor() from knock_v2
  ═══════════════════════════════════════════════════════════════ */
   
  // Tap overlay to dismiss after reveal
  document.getElementById('knockDoorOverlay').addEventListener('click', () => {
    const overlay = document.getElementById('knockDoorOverlay');
    if (overlay.dataset.revealed === 'true') dismissKnockOverlay();
  });
   
  function dismissKnockOverlay() {
    const overlay = document.getElementById('knockDoorOverlay');
    overlay.style.transition = 'opacity 0.4s ease';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.classList.remove('active');
      overlay.style.opacity = '';
      overlay.style.transition = '';
      overlay.dataset.revealed = 'false';
      // Reset door
      const panel = document.getElementById('knockDoorPanel');
      panel.style.transition = 'none';
      panel.classList.remove('open');
      void panel.offsetWidth;
      panel.style.transition = '';
      document.getElementById('knockDoorRoom').classList.remove('visible');
    }, 400);
  }
   
  async function openKnockDoor(msgId, encMessage) {
    const li = document.getElementById('msg-' + msgId);
    if (!li) return;
    const card = li.querySelector('.knock-card');
    if (card && card.dataset.state === 'revealed') return;
    if (card) card.dataset.state = 'revealed';
   
    // Mark mini-card as acked
    if (card) {
      const sub = card.querySelector('.knock-sub');
      if (sub) sub.textContent = 'Opening…';
      const btn = card.querySelector('.knock-tap-btn');
      if (btn) btn.remove();
      const door = document.getElementById('kd-' + msgId);
      if (door) door.classList.add('open');
    }
   
    // Play knock sound
    playKnockSound();
   
    // Add ripple circles
    const overlay = document.getElementById('knockDoorOverlay');
    overlay.classList.add('active');
    overlay.dataset.revealed = 'false';
   
    // Ripple circles
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const c = document.createElement('div');
        c.className = 'knock-circle';
        document.getElementById('knockDoorPanel').appendChild(c);
        setTimeout(() => c.remove(), 900);
      }, i * 180);
    }
   
    // Swing door open after short delay
    await new Promise(r => setTimeout(r, 500));
    playKnockSound();
   
    const panel = document.getElementById('knockDoorPanel');
    panel.classList.add('open');
   
    // Reveal room + decrypt message
    await new Promise(r => setTimeout(r, 800));
    playRevealSound();
   
    let plaintext = '🔒';
    try { plaintext = await dec(encMessage); } catch {}
   
    document.getElementById('knockRoomMsg').textContent = plaintext;
    document.getElementById('knockDoorRoom').classList.add('visible');
    overlay.dataset.revealed = 'true';
   
    // Update mini card in messages list
    if (card) {
      const label = card.querySelector('.knock-label');
      if (label) label.textContent = '🚪 Knock';
      const sub = card.querySelector('.knock-sub');
      if (sub) sub.style.display = 'none';
      const revealed = document.createElement('span');
      revealed.className = 'knock-revealed';
      revealed.textContent = plaintext;
      card.appendChild(revealed);
      const badge = document.createElement('div');
      badge.className = 'knock-acked-badge';
      badge.textContent = '✓ Revealed';
      card.appendChild(badge);
    }
  }
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Sender opens chat → emit trigger to recipient
     Patch openChat() to emit 'knock_chat_opened' when applicable
  ═══════════════════════════════════════════════════════════════ */
  const _origOpenChat = window.openChat;
  window.openChat = async function openChat(username) {
    await _origOpenChat(username);
    // Emit that sender opened this chat — recipient listens and opens door
    socket.emit('knock_chat_opened', { chat_with: username });
  };
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Socket: recipient receives trigger when sender opens chat
  ═══════════════════════════════════════════════════════════════ */
  socket.on('knock_open_signal', async function(data) {
    await openKnockDoor(data.msg_id, data.enc_message);
  });
   
  console.log('[Knock Fullscreen] Loaded ✓');
