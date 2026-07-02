/**
 * socket-handlers.js
 * Listeners for incoming real-time socket events (messages, typing, seen, pins, deleted, edits, reactions, friend list updates)
 */

socket.on('private_message', async function(data) {
  if (data.sender !== currentChat && !data.is_own) return;
  const m = {
    id: data.id,
    sender: data.is_own ? me : data.sender,
    message: data.message,
    sender_message: data.message,
    msg_type: data.msg_type || 'text',
    media_url: data.media_url || '',
    reply_to: data.reply_to || '',
    poll_data: data.poll_data || null,
    link_preview: data.link_preview || null,
    timestamp: data.timestamp || new Date().toISOString(),
    seen_at: null,
    delivered_at: data.timestamp || new Date().toISOString(),
    reactions: {},
    deleted: false,
    seen: false
  };
  if (typeof renderMsg === 'function') {
    await renderMsg(m, !!data.is_own);
  }
  if (!data.is_own && currentChat) socket.emit('seen', { sender: data.sender });
});

socket.on('typing', function(data) {
  if (data.sender !== currentChat) return;
  const bar = document.getElementById('typingBar');
  if (!bar) return;
  if (data.typing) {
    const chatAv = document.getElementById('chatAv');
    const avHtml = chatAv ? chatAv.innerHTML : '';
    bar.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">
      <div class="av av-sm">${avHtml}</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-weight:600;">typing...</div>
    </div>`;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
});

socket.on('seen', function(data) {
  document.querySelectorAll('#messages li.sent .ticks').forEach(t => {
    t.textContent = '✓✓'; 
    t.classList.add('seen');
    if (data.seen_at) t.title = 'Read at ' + new Date(data.seen_at + 'Z').toLocaleString();
  });
});

socket.on('poll_updated', function(data) {
  const li = document.getElementById('msg-' + data.msg_id);
  if (!li) return;
  const m = { id: data.msg_id, poll_data: data.poll_data };
  if (typeof renderPoll === 'function') {
    const pollHtml = renderPoll(m);
    const pm = li.querySelector('.poll-msg');
    if (pm) pm.outerHTML = pollHtml;
  }
});

socket.on('message_pinned', function(data) {
  if (data.chat !== currentChat) return;
  const pinnedBar = document.getElementById('pinnedBar');
  if (!pinnedBar) return;
  if (data.pinned_msg_id) {
    pinnedBar.style.display = 'flex';
    pinnedBar.dataset.msgId = data.pinned_msg_id;
  } else {
    pinnedBar.style.display = 'none';
  }
});

socket.on('message_deleted', function(data) {
  const li = document.getElementById('msg-' + data.id);
  if (li) {
    li.innerHTML = '<span class="deleted-text" style="color:#a0aec0;font-style:italic;font-size:13px">This message was deleted</span>';
  }
});

socket.on('message_edited', async function(data) {
  const li = document.getElementById('msg-' + data.id);
  if (li) {
    const span = li.querySelector('span:not(.deleted-text)');
    if (span) {
      let plain = data.message;
      if (data.sender === me && data.sender_message) {
         plain = await dec(data.sender_message);
      } else if (data.sender !== me && !data.is_group) {
         plain = await dec(data.message);
      }
      span.textContent = plain;
      if (!li.querySelector('.edited-badge')) {
        const badge = document.createElement('small');
        badge.className = 'edited-badge';
        badge.textContent = ' (edited)';
        badge.style.color = '#a0aec0';
        badge.style.fontSize = '11px';
        badge.style.marginLeft = '4px';
        span.appendChild(badge);
      }
    }
  }
});

socket.on('reaction_update', function(data) {
  const li = document.getElementById('msg-' + data.msg_id);
  if (!li) return;
  let rxnDiv = li.querySelector('.reactions');
  if (!rxnDiv) { rxnDiv = document.createElement('div'); rxnDiv.className = 'reactions'; li.appendChild(rxnDiv); }
  rxnDiv.innerHTML = Object.entries(data.reactions).map(([em, users]) =>
    `<span class="rxn" onclick="reactTo(${data.msg_id},'${em}');hideCtx()">${em} ${users.length}</span>`
  ).join('');
});

socket.on('friend_request', () => {
  const reqTab = document.getElementById('reqTab');
  if (reqTab) reqTab.innerHTML = `Requests<span class="ndot"></span>`;
});

socket.on('new_story', () => {
  if (typeof loadStoriesBar === 'function') loadStoriesBar();
});

socket.on('story_liked', () => {
  if (typeof showToast === 'function') showToast('Someone liked your story ❤️');
});

socket.on('request_accepted', () => {
  if (typeof renderTab === 'function') renderTab();
});

socket.on('user_list_update', users => {
  onlineUsers = users;
  const chatStatus = document.getElementById('chatStatus');
  if (currentChat && chatStatus) {
    chatStatus.textContent = users.includes(currentChat) ? 'online' : 'offline';
  }
});

// Typing indicator emit triggers
const msgInput = document.getElementById('msgInput');
if (msgInput) {
  msgInput.addEventListener('input', () => {
    updateInputUI();
    if (!currentChat) return;
    socket.emit('typing', { receiver: currentChat, typing: true });
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => socket.emit('typing', { receiver: currentChat, typing: false }), 1500);
  });

  msgInput.addEventListener('keydown', e => { 
    if (e.key === 'Enter') {
      if (typeof sendMsg === 'function') sendMsg();
    }
  });

  msgInput.addEventListener('focus', () => {
    const inputWrap = document.getElementById('inputWrap');
    if (inputWrap) inputWrap.style.borderColor = 'var(--accent)';
  });
  msgInput.addEventListener('blur', () => {
    const inputWrap = document.getElementById('inputWrap');
    if (inputWrap) inputWrap.style.borderColor = '#1e2a45';
  });
}

function updateInputUI() {
  const msgInput = document.getElementById('msgInput');
  if (!msgInput) return;
  const val = msgInput.value.trim();
  const plusSend = document.getElementById('plusSendBtn');
  const mic = document.getElementById('micBtn');
  const gal = document.getElementById('galleryBtn');
  const gif = document.getElementById('gifBtn');
  const plusMenu = document.getElementById('plusMenuBtn');
  const cam = document.getElementById('cameraBtn');
  
  if (val.length > 0) {
    if (mic) mic.style.display = 'none';
    if (gal) gal.style.display = 'none';
    if (gif) gif.style.display = 'none';
    if (plusMenu) plusMenu.style.display = 'none';
    if (cam) cam.style.display = 'none';
    if (plusSend) plusSend.style.display = 'flex';
  } else {
    if (mic) mic.style.display = 'flex';
    if (gal) gal.style.display = 'flex';
    if (gif) gif.style.display = 'flex';
    if (plusMenu) plusMenu.style.display = 'flex';
    if (cam) cam.style.display = 'flex';
    if (plusSend) plusSend.style.display = 'none';
  }
}

function togglePlusMenu(e) {
  if (e) e.stopPropagation();
  const m = document.getElementById('plusMenu');
  if (m) m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
}

document.addEventListener('click', e => {
  const m = document.getElementById('plusMenu');
  if (m && m.style.display === 'flex' && !e.target.closest('#plusMenu') && !e.target.closest('.cam-btn')) {
    m.style.display = 'none';
  }
});

// Perform initial UI update
updateInputUI();

console.log('✓ Socket listeners loaded');
