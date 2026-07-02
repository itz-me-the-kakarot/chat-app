/**
 * chat.js
 * Chat window management, message rendering, message interactions (pinned, reaction, reply, forward), Giphy, wallpaper, disappearing timers
 */

let editingMsgId = null;

async function openChat(username) {
  currentChat = username;
  document.getElementById('chatName').textContent = username;
  document.getElementById('chatStatus').textContent = onlineUsers.includes(username) ? 'online' : 'offline';
  document.getElementById('messages').innerHTML = '';
  document.getElementById('csName').textContent = username;
  cancelReply();
  if (typeof cancelVoiceRec === 'function') cancelVoiceRec();
  showScreen('chatScreen');

  // Avatar
  const up = await fetch('/profile/' + username).then(r => r.json());
  const avWrapper = document.getElementById('chatAvWrapper');
  const avHtml = up.avatar_url ? `<img src="${up.avatar_url}"/>` : (up.display_name||username)[0].toUpperCase();
  
  const storyIdx = (typeof myStories !== 'undefined') ? myStories.findIndex(s => s.user_id === username) : -1;
  if (storyIdx !== -1) {
    const sGroup = myStories[storyIdx];
    avWrapper.innerHTML = `
      <div class="story-ring ${sGroup.has_unviewed ? '' : 'viewed'}" style="width: 42px; height: 42px; padding: 2.5px; cursor: pointer;" onclick="event.stopPropagation(); openStoryViewer(${storyIdx});">
        <div class="av" id="chatAv" style="width: 100%; height: 100%; border: 2px solid var(--bg-secondary);">${avHtml}</div>
      </div>`;
  } else {
    avWrapper.innerHTML = `<div class="av av-md" id="chatAv" onclick="openChatProfile()">${avHtml}</div>`;
  }
  document.getElementById('chatName').textContent = up.display_name || username;

  // Chat settings & Themes
  const cs = await fetch('/chat_settings/' + username).then(r => r.json());
  document.getElementById('chatBg').style.backgroundImage = cs.wallpaper_url ? `url(${cs.wallpaper_url})` : '';
  document.getElementById('disappearSelect').value = cs.disappear_timer || 0;
  
  if (cs.theme_color) {
    if (typeof applyThemeColor === 'function') applyThemeColor(cs.theme_color);
  } else {
    if (typeof applyThemeColor === 'function') applyThemeColor('#4f8ef7'); // default
  }
  
  if (cs.pinned_msg_id) {
    document.getElementById('pinnedBar').style.display = 'flex';
    document.getElementById('pinnedBar').dataset.msgId = cs.pinned_msg_id;
    document.getElementById('pinnedContent').textContent = 'Pinned Message';
  } else {
    document.getElementById('pinnedBar').style.display = 'none';
  }

  await getPubKey(username);

  const msgs = await fetch('/history/' + username).then(r => r.json());
  for (const m of msgs) await renderMsg(m, m.sender === me);

  socket.emit('seen', { sender: username });
  document.getElementById('msgInput').focus();
}

function openChatProfile() {
  if (!currentChat) return;
  showScreen('chatSettingsScreen');
}

async function renderMsg(m, isSent, prepend = false) {
  const ul = document.getElementById('messages');
  if (!ul) return;
  const li = document.createElement('li');
  li.id = 'msg-' + m.id;
  if (isSent) li.classList.add('sent');

  let html = `<div class="msender">${isSent ? 'You' : m.sender}</div>`;
  if (m.story_ref) html += `<div class="story-ref-prev"><img src="${m.story_ref.thumb}"/><span>Replied to your story</span></div>`;
  if (m.reply_to) html += `<div class="reply-prev">↩ ${m.reply_to}</div>`;

  if (m.deleted) {
    html += `<span class="del-text">This message was deleted</span>`;
  } else if (m.msg_type === 'image') {
    html += `<img src="${m.media_url}" class="cmedia" onclick="window.open('${m.media_url}','_blank')"/>
      <a href="${m.media_url}" download class="dload">⬇ Save image</a>`;
  } else if (m.msg_type === 'voice') {
    html += `<div style="display:flex;align-items:center;gap:6px;"><audio src="${m.media_url}" controls style="max-width:200px;margin-top:4px;"></audio>
             <button onclick="toggleAudioSpeed(this)" style="background:rgba(0,0,0,.2);border:none;color:inherit;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;">1x</button></div>`;
  } else if (m.msg_type === 'video' && m.media_url && /\.(webm|ogg|mp3|m4a|wav)(\?|$)/i.test(m.media_url)) {
    html += `<div style="display:flex;align-items:center;gap:6px;"><audio src="${m.media_url}" controls style="max-width:200px;margin-top:4px;"></audio>
             <button onclick="toggleAudioSpeed(this)" style="background:rgba(0,0,0,.2);border:none;color:inherit;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;">1x</button></div>`;
  } else if (m.msg_type === 'video') {
    html += `<video src="${m.media_url}" class="cmedia" controls></video>
      <a href="${m.media_url}" download class="dload">⬇ Save video</a>`;
  } else if (m.msg_type === 'file') {
    let fName = 'Document';
    let fSize = '';
    if (m.file_metadata) {
      fName = m.file_metadata.name || 'Document';
      fSize = m.file_metadata.size ? (m.file_metadata.size / 1024).toFixed(1) + ' KB' : '';
    }
    html += `<div style="background:rgba(255,255,255,0.1);padding:10px;border-radius:8px;display:flex;align-items:center;gap:10px;">
      <div style="font-size:24px;">📄</div>
      <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        <div style="font-weight:bold;font-size:13px;">${fName}</div>
        <div style="font-size:11px;color:#a0aec0;">${fSize}</div>
      </div>
      <a href="${m.media_url}" target="_blank" class="dload" style="margin-top:0;">⬇</a>
    </div>`;
  } else if (m.msg_type === 'poll') {
    if (typeof renderPoll === 'function') {
      html += renderPoll(m);
    } else {
      html += `[Poll message]`;
    }
  } else {
    const plain = isSent ? (m.sender_message ? await dec(m.sender_message) : '🔒') : await dec(m.message);
    let editedHtml = m.edited ? `<small class="edited-badge" style="color:#a0aec0;font-size:11px;margin-left:4px;">(edited)</small>` : '';
    html += `<span class="msg-text">${plain}${editedHtml}</span>`;
    if (m.link_preview && m.link_preview.title) {
      html += `<a href="${m.link_preview.url}" target="_blank" class="link-preview">
        ${m.link_preview.image ? `<img src="${m.link_preview.image}"/>` : ''}
        <div class="link-preview-info">
          <div class="link-preview-title">${m.link_preview.title}</div>
          <div class="link-preview-desc">${m.link_preview.description}</div>
        </div>
      </a>`;
    }
  }

  // Reactions
  if (m.reactions && Object.keys(m.reactions).length) {
    html += `<div class="reactions">`;
    for (const [emoji, users] of Object.entries(m.reactions)) {
      html += `<span class="rxn" onclick="reactTo(${m.id},'${emoji}')">${emoji} ${users.length}</span>`;
    }
    html += `</div>`;
  }

  // Ticks (only for sent)
  if (isSent) {
    const timeTitle = m.seen ? (m.seen_at ? 'Read at ' + new Date(m.seen_at + 'Z').toLocaleString() : 'Read') : (m.delivered_at ? 'Delivered at ' + new Date(m.delivered_at + 'Z').toLocaleString() : 'Sent');
    html += `<div class="ticks ${m.seen ? 'seen' : ''}" title="${timeTitle}">${m.seen ? '✓✓' : '✓'}</div>`;
  }

  li.innerHTML = '<div class="reply-drag-icon">↩</div>' + html;

  // Touch and drag-to-reply
  let pressTimer, dragStartX = 0, dragging = false, dragTriggered = false;
  const threshold = 60;

  li.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    dragStartX = e.touches[0].clientX;
    dragging = false;
    dragTriggered = false;
    pressTimer = setTimeout(() => { if (!dragging) showCtxMenu(e, m, isSent); }, 500);
  }, { passive: true });

  li.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    clearTimeout(pressTimer);
    const diff = e.touches[0].clientX - dragStartX;
    const valid = isSent ? diff < 0 : diff > 0;
    if (!valid) { li.style.transform = ''; li.classList.remove('dragging'); dragging = false; return; }
    dragging = true;
    const clamped = isSent ? Math.max(diff, -threshold * 1.2) : Math.min(diff, threshold * 1.2);
    li.style.transform = `translateX(${clamped}px)`;
    li.classList.add('dragging');
    if (Math.abs(diff) >= threshold) dragTriggered = true;
  }, { passive: true });

  li.addEventListener('touchend', e => {
    clearTimeout(pressTimer);
    li.classList.remove('dragging');
    li.style.transform = '';
    if (dragging && dragTriggered) {
      const text = li.querySelector('span:not(.del-text)') ? li.querySelector('span:not(.del-text)').textContent : (m.msg_type === 'image' ? '[image]' : m.msg_type === 'video' ? '[media]' : '[message]');
      setReply(text);
    }
    dragging = false;
  }, { passive: true });

  li.addEventListener('touchcancel', () => {
    clearTimeout(pressTimer);
    li.classList.remove('dragging');
    li.style.transform = '';
    dragging = false;
  }, { passive: true });

  // Mouse drag-to-reply (desktop)
  let mouseDown = false, mouseStartX = 0;
  li.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    mouseDown = true;
    mouseStartX = e.clientX;
    dragTriggered = false;
  });
  li.addEventListener('mousemove', e => {
    if (!mouseDown) return;
    const diff = e.clientX - mouseStartX;
    const valid = isSent ? diff < 0 : diff > 0;
    if (!valid) { li.style.transform = ''; li.classList.remove('dragging'); return; }
    const clamped = isSent ? Math.max(diff, -threshold * 1.2) : Math.min(diff, threshold * 1.2);
    li.style.transform = `translateX(${clamped}px)`;
    li.classList.add('dragging');
    if (Math.abs(diff) >= threshold) dragTriggered = true;
  });
  li.addEventListener('mouseup', () => {
    if (!mouseDown) return;
    mouseDown = false;
    li.classList.remove('dragging');
    li.style.transform = '';
    if (dragTriggered) {
      const text = li.querySelector('span:not(.del-text)') ? li.querySelector('span:not(.del-text)').textContent : '[message]';
      setReply(text);
    }
  });
  li.addEventListener('mouseleave', () => {
    if (!mouseDown) return;
    mouseDown = false;
    li.classList.remove('dragging');
    li.style.transform = '';
  });

  if (prepend) ul.prepend(li); else ul.appendChild(li);
  if (!prepend) li.scrollIntoView({ behavior: 'smooth' });
}

// Context Menu
function showCtxMenu(e, m, isSent) {
  ctxMsgId = m.id;
  ctxMsgSender = m.sender;
  ctxMsgText = m.msg_type === 'text' && !m.deleted ? (document.getElementById('msg-' + m.id)?.querySelector('span')?.textContent || '') : '';
  const menu = document.getElementById('ctxMenu');
  const emojis = document.getElementById('ctxEmojis');
  if (emojis) {
    emojis.innerHTML = EMOJIS.map(em => `<span onclick="reactTo(${m.id},'${em}');hideCtx()">${em}</span>`).join('');
  }
  const ctxEdit = document.getElementById('ctxEdit');
  const ctxDelete = document.getElementById('ctxDelete');
  if (ctxEdit) ctxEdit.style.display = isSent && !m.deleted && m.msg_type === 'text' ? 'flex' : 'none';
  if (ctxDelete) ctxDelete.style.display = isSent && !m.deleted ? 'flex' : 'none';
  menu.classList.add('show');
  const touch = e.touches ? e.touches[0] : e;
  const x = Math.min(touch.clientX, window.innerWidth - 180);
  const y = Math.min(touch.clientY, window.innerHeight - 240);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  document.addEventListener('touchstart', hideCtxOnOutside, { once: true });
}

function hideCtxOnOutside(e) {
  if (!document.getElementById('ctxMenu').contains(e.target)) hideCtx();
}

function hideCtx() {
  document.getElementById('ctxMenu').classList.remove('show');
}

function ctxReply() {
  if (ctxMsgText) setReply(ctxMsgText);
  hideCtx();
}

function ctxForward() {
  hideCtx();
  if (!ctxMsgText) { alert('Can only forward text messages'); return; }
  const friends = prompt('Forward to username:');
  if (friends && ctxMsgText) {
    const msg = ctxMsgText;
    getPubKey(friends).then(rKey => {
      if (!rKey) { alert('User not found or no key'); return; }
      enc(rKey, msg).then(eR => {
        enc(myPublicKey, msg).then(eS => {
          socket.emit('private_message', { receiver: friends, message: eR, sender_message: eS, msg_type: 'text', reply_to: '' });
          alert('Forwarded to ' + friends);
        });
      });
    });
  }
}

async function ctxDeleteMsg() {
  hideCtx();
  if (!ctxMsgId) return;
  await fetch('/delete_message/' + ctxMsgId, { method: 'POST' });
  const li = document.getElementById('msg-' + ctxMsgId);
  if (li) {
    li.innerHTML = '<span class="deleted-text" style="color:#a0aec0;font-style:italic;font-size:13px">This message was deleted</span>';
  }
}

function ctxEditMsg() {
  hideCtx();
  if (!ctxMsgId || !ctxMsgText) return;
  editingMsgId = ctxMsgId;
  const input = document.getElementById('msgInput');
  input.value = ctxMsgText;
  if (typeof updateInputUI === 'function') updateInputUI(); 
  input.focus();
  const replyBar = document.getElementById('replyBar');
  const replyText = document.getElementById('replyText');
  if (replyText) replyText.textContent = 'Editing message...';
  if (replyBar) replyBar.style.display = 'flex';
}

async function reactTo(msgId, emoji) {
  await fetch('/react/' + msgId, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ emoji }) 
  });
}

// Reply
function setReply(text) {
  replyingTo = text.length > 60 ? text.slice(0, 60) + '…' : text;
  const replyText = document.getElementById('replyText');
  const replyBar = document.getElementById('replyBar');
  if (replyText) replyText.textContent = '↩ ' + replyingTo;
  if (replyBar) replyBar.style.display = 'block';
  document.getElementById('msgInput').focus();
}

function cancelReply() {
  replyingTo = null;
  editingMsgId = null; 
  const replyBar = document.getElementById('replyBar');
  const replyText = document.getElementById('replyText');
  if (replyBar) replyBar.style.display = 'none';
  if (replyText) replyText.textContent = '';
}

// Send
async function sendMsg() {
  const input = document.getElementById('msgInput');
  const msg = input.value.trim();
  if (!msg || !currentChat) return;
  const rKey = await getPubKey(currentChat);
  if (!rKey) { alert('Cannot get recipient key'); return; }
  const eR = await enc(rKey, msg);
  const eS = await enc(myPublicKey, msg);
  
  if (editingMsgId) {
    await fetch('/edit_message/' + editingMsgId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: eR, sender_message: eS })
    });
    editingMsgId = null;
  } else {
    socket.emit('private_message', { receiver: currentChat, message: eR, sender_message: eS, msg_type: 'text', reply_to: replyingTo || '' });
  }
  
  cancelReply();
  input.value = '';
  if (typeof updateInputUI === 'function') updateInputUI();
  socket.emit('typing', { receiver: currentChat, typing: false });
}

async function sendFile(input) {
  const file = input.files[0];
  if (!file || !currentChat) return;
  const { url, type } = await cloudUpload(file);
  const metadata = { name: file.name, size: file.size, type: file.type };
  socket.emit('private_message', { receiver: currentChat, message: '', sender_message: '', msg_type: type, media_url: url, reply_to: replyingTo || '', file_metadata: metadata });
  cancelReply();
  input.value = '';
  if (typeof updateInputUI === 'function') updateInputUI();
}

// Chat Wallpaper / settings
async function setChatWallpaper(input) {
  const file = input.files[0]; if (!file) return;
  const { url } = await cloudUpload(file);
  await fetch('/update_chat_settings/' + currentChat, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ wallpaper_url: url, disappear_timer: parseInt(document.getElementById('disappearSelect').value) }) 
  });
  document.getElementById('chatBg').style.backgroundImage = `url(${url})`;
  input.value = '';
}

async function clearChatWall() {
  await fetch('/update_chat_settings/' + currentChat, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ wallpaper_url: null, disappear_timer: parseInt(document.getElementById('disappearSelect').value) }) 
  });
  document.getElementById('chatBg').style.backgroundImage = '';
}

async function saveDisappear() {
  const timer = parseInt(document.getElementById('disappearSelect').value);
  const cs = await fetch('/chat_settings/' + currentChat).then(r => r.json());
  await fetch('/update_chat_settings/' + currentChat, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ wallpaper_url: cs.wallpaper_url, disappear_timer: timer }) 
  });
}

async function doRemoveFriend() {
  if (!confirm('Remove ' + currentChat + ' as friend?')) return;
  await fetch('/remove_friend/' + currentChat, { method: 'POST' });
  showScreen('contactsScreen');
  currentChat = null;
  if (typeof renderTab === 'function') renderTab();
}

// Media view
async function openMediaView() {
  showScreen('mediaScreen');
  const media = await fetch('/media/' + currentChat).then(r => r.json());
  const grid = document.getElementById('mediaGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!media.length) { grid.innerHTML = '<div class="empty" style="grid-column:span 3">No shared media</div>'; return; }
  media.forEach(m => {
    const div = document.createElement('div');
    div.className = 'media-thumb';
    if (m.type === 'image') {
      div.innerHTML = `<img src="${m.url}" onclick="window.open('${m.url}','_blank')"/>`;
    } else {
      div.innerHTML = `<video src="${m.url}"></video><div class="play-icon">▶</div>`;
      div.onclick = () => window.open(m.url, '_blank');
    }
    grid.appendChild(div);
  });
}

function toggleAudioSpeed(btn) {
  const aud = btn.previousElementSibling;
  if (!aud) return;
  let spd = aud.playbackRate;
  if (spd === 1) spd = 1.5; else if (spd === 1.5) spd = 2; else spd = 1;
  aud.playbackRate = spd;
  if ('preservesPitch' in aud) aud.preservesPitch = true;
  btn.textContent = spd + 'x';
}

function toggleChatSearch() {
  const bar = document.getElementById('chatSearchBar');
  if (!bar) return;
  bar.style.display = bar.style.display === 'block' ? 'none' : 'block';
  if (bar.style.display === 'block') document.getElementById('chatSearchInput').focus();
}

function filterMessages() {
  const q = document.getElementById('chatSearchInput').value.toLowerCase();
  document.querySelectorAll('#messages li').forEach(li => {
    const txt = li.querySelector('.msg-text')?.textContent.toLowerCase() || '';
    li.style.display = txt.includes(q) ? '' : 'none';
  });
}

async function ctxPin() {
  hideCtx();
  if (!ctxMsgId) return;
  const res = await fetch('/pin_message/' + ctxMsgId, { method: 'POST' }).then(r => r.json());
  if (!res.ok) alert('Cannot pin message');
}

async function unpinMessage() {
  const pinnedBar = document.getElementById('pinnedBar');
  const pid = pinnedBar ? pinnedBar.dataset.msgId : null;
  if (!pid) return;
  await fetch('/pin_message/' + pid, { method: 'POST' });
}

function scrollToPinned() {
  const pinnedBar = document.getElementById('pinnedBar');
  const pid = pinnedBar ? pinnedBar.dataset.msgId : null;
  if (!pid) return;
  const li = document.getElementById('msg-' + pid);
  if (li) { 
    li.scrollIntoView({behavior:'smooth', block:'center'}); 
    li.style.animation = 'micPulse 1s 2'; 
    setTimeout(() => li.style.animation='', 2000); 
  }
}

console.log('✓ Chat module loaded');
