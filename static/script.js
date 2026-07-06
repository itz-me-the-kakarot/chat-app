function setVH() {
  document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
}
setVH();
window.addEventListener('resize', setVH);
const me = "{{ user_id }}";
const CLOUD = 'ddgmbuhg9';
const PRESET = 'chatly_upload';

let currentChat = null;
let onlineUsers = [];
let currentTab = 'chats';
let publicKeys = {};
let myPrivateKey = null, myPublicKey = null;
let myProfile = null;
let replyingTo = null;
let ctxMsgId = null, ctxMsgSender = null, ctxMsgText = null;
let typingTimer = null;
let screenStack = ['contactsScreen'];

// ── Toast ─────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

const socket = io({ autoConnect: false });

// ── Screen management ─────────────────────────────────────────
// ── Themes and Glow System ────────────────────────────────────
function setAppThemeMode(mode) {
  localStorage.setItem('chatly_theme_mode', mode);
  document.querySelectorAll('#appearanceModePill .pill-option').forEach(el => el.classList.remove('active'));
  if (mode === 'light') {
    document.body.classList.add('mode-light');
    document.getElementById('btnModeLight').classList.add('active');
  } else {
    document.body.classList.remove('mode-light');
    document.getElementById('btnModeDark').classList.add('active');
  }
}

function setAppThemeColor(color) {
  localStorage.setItem('chatly_theme_color', color);
  // Remove existing color classes
  document.body.classList.remove('theme-blue', 'theme-violet', 'theme-red', 'theme-pink', 'theme-green');
  document.body.classList.add('theme-' + color);
  
  // Highlight active swatch
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
  const swatch = document.getElementById('swatch-' + color);
  if (swatch) swatch.classList.add('active');
  
  // Keep the Light/Dark buttons accent styled correctly
  const currentMode = localStorage.getItem('chatly_theme_mode') || 'dark';
  setAppThemeMode(currentMode);
}

function setAppThemeGlowSlider(val) {
  localStorage.setItem('chatly_theme_glow_val', val);
  document.documentElement.style.setProperty('--glow-strength', val);
  
  if (parseFloat(val) === 0) {
    document.body.classList.add('glow-none');
  } else {
    document.body.classList.remove('glow-none');
  }
  
  const label = document.getElementById('glowValText');
  if (label) {
    const v = parseFloat(val);
    if (v === 0) label.textContent = 'Off';
    else if (v <= 0.5) label.textContent = 'Mild';
    else if (v <= 1.0) label.textContent = 'Normal';
    else if (v <= 1.5) label.textContent = 'Strong';
    else label.textContent = 'Super Glow';
  }
}

function restoreGlobalTheme() {
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent-dark');
  document.documentElement.style.removeProperty('--accent-light');
  document.documentElement.style.removeProperty('--accent-glow');
}

function initAppTheme() {
  const mode = localStorage.getItem('chatly_theme_mode') || 'dark';
  const color = localStorage.getItem('chatly_theme_color') || 'violet';
  const glowVal = localStorage.getItem('chatly_theme_glow_val') || '1';
  
  setAppThemeMode(mode);
  setAppThemeColor(color);
  
  const slider = document.getElementById('glowSlider');
  if (slider) {
    slider.value = glowVal;
  }
  setAppThemeGlowSlider(glowVal);
}

// ── Screen management & Bottom Nav Switcher ───────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  
  // Handle bottom navigation bar visibility and active tabs
  const navPill = document.getElementById('bottomNavPill');
  if (id === 'contactsScreen' || id === 'profileScreen') {
    navPill.classList.remove('hidden');
    restoreGlobalTheme();
    
    document.querySelectorAll('.bottom-nav-pill .tab').forEach(t => t.classList.remove('active'));
    let activeNavTab;
    if (id === 'profileScreen') {
      activeNavTab = document.getElementById('navProfileTab');
    } else {
      if (currentTab === 'chats') activeNavTab = document.getElementById('navChatsTab');
      if (currentTab === 'requests') activeNavTab = document.getElementById('navRequestsTab');
      if (currentTab === 'add') activeNavTab = document.getElementById('navAddTab');
    }
    if (activeNavTab) {
      activeNavTab.classList.add('active');
      requestAnimationFrame(() => moveNavGlider(activeNavTab));
    }
  } else {
    navPill.classList.add('hidden');
  }

  if (id !== 'contactsScreen') {
    history.pushState({ screen: id }, '', window.location.pathname);
  }
}

function moveNavGlider(activeTab) {
  const pill = document.getElementById('bottomNavPill');
  const glider = document.getElementById('navGlider');
  if (!glider || !activeTab) return;
  const pillRect = pill.getBoundingClientRect();
  const tabRect = activeTab.getBoundingClientRect();
  const padding = 6;
  glider.style.left = (tabRect.left - pillRect.left - padding) + 'px';
  glider.style.width = (tabRect.width + padding * 2) + 'px';
}

function switchNavTab(tab, el) {
  if (tab === 'profile') {
    showScreen('profileScreen');
  } else {
    currentTab = tab;
    showScreen('contactsScreen');
    document.getElementById('searchInput').value = '';
    renderTab();
  }
  // Move the glider to the clicked tab
  moveNavGlider(el);
}

window.addEventListener('popstate', function(e) {
  const prev = e.state?.screen;
  if (!prev || prev === 'contactsScreen') {
    showScreen('contactsScreen');
    currentChat = null;
  } else {
    showScreen(prev);
  }
});
history.replaceState({ screen: 'contactsScreen' }, '', window.location.pathname);

function goBack() {
  history.back();
}

// ── E2E ──────────────────────────────────────────────────────
async function initKeys() {
  const stored = localStorage.getItem('privkey_' + me);
  if (stored) {
    myPrivateKey = await crypto.subtle.importKey('jwk', JSON.parse(stored), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const pubS = localStorage.getItem('pubkey_' + me);
    if (pubS) {
      myPublicKey = await crypto.subtle.importKey('jwk', JSON.parse(pubS), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
      const chk = await fetch('/pubkey/' + me).then(r => r.json());
      if (!chk.key) await fetch('/save_key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: pubS }) });
    }
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    myPrivateKey = pair.privateKey; myPublicKey = pair.publicKey;
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
    localStorage.setItem('privkey_' + me, JSON.stringify(priv));
    localStorage.setItem('pubkey_' + me, JSON.stringify(pub));
    let saved = false;
    while (!saved) {
      try { const r = await fetch('/save_key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: JSON.stringify(pub) }) }); if ((await r.json()).ok) saved = true; }
      catch { await new Promise(r => setTimeout(r, 1000)); }
    }
  }
}

async function getPubKey(username) {
  if (publicKeys[username]) return publicKeys[username];
  const d = await fetch('/pubkey/' + username).then(r => r.json());
  if (!d.key) return null;
  const k = await crypto.subtle.importKey('jwk', JSON.parse(d.key), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  publicKeys[username] = k; return k;
}

async function enc(key, text) {
  const b = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(b)));
}

async function dec(cipher) {
  try {
    const b = Uint8Array.from(atob(cipher), c => c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, myPrivateKey, b));
  } catch { return '🔒'; }
}

// ── Cloudinary upload ─────────────────────────────────────────
async function cloudUpload(file) {
  const type = file.type.startsWith('video') ? 'video' : file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') ? 'video' : 'raw';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/${type === 'raw' ? 'raw' : type}/upload`, { method: 'POST', body: fd });
  const d = await res.json();
  return { url: d.secure_url, type: file.type.startsWith('video') || file.type.startsWith('audio') ? 'video' : file.type.startsWith('image') ? 'image' : 'file' };
}

// ── Profile ───────────────────────────────────────────────────
async function loadProfile() {
  myProfile = await fetch('/profile').then(r => r.json());
  const init = (myProfile.display_name || me)[0].toUpperCase();
  const avContent = myProfile.avatar_url ? `<img src="${myProfile.avatar_url}"/>` : init;
  document.getElementById('myAvBtn').innerHTML = avContent;
  document.getElementById('profileAvBig').innerHTML = avContent;
  document.getElementById('profileDN').textContent = myProfile.display_name || me;
  document.getElementById('profileUID').textContent = '#' + (myProfile.user_id || '0000');
  document.getElementById('profileUN').textContent = '@' + me;
  document.getElementById('newNameInput').value = myProfile.display_name || me;
}

async function saveName() {
  const name = document.getElementById('newNameInput').value.trim();
  if (!name) return;
  await fetch('/update_profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: name }) });
  document.getElementById('profileDN').textContent = name;
  myProfile.display_name = name;
}

async function uploadAvatarBlob(blob) {
  const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
  const { url } = await cloudUpload(file);
  await fetch('/upload_avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  const av = `<img src="${url}"/>`;
  document.getElementById('myAvBtn').innerHTML = av;
  document.getElementById('profileAvBig').innerHTML = av;
}

// ── Avatar crop ───────────────────────────────────────────────
let cropState = null;

function openAvatarCrop(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      document.getElementById('cropModal').classList.add('show');
      document.getElementById('bottomNavPill').classList.add('hidden');
      const vp = document.getElementById('cropViewport');
      const canvas = document.getElementById('cropCanvas');
      const frame = document.getElementById('cropFrame');
      const vw = vp.clientWidth;
      const vh = vp.clientHeight;
      const size = Math.min(vw, vh) * 0.75;
      canvas.width = vw;
      canvas.height = vh;
      frame.style.width = size + 'px';
      frame.style.height = size + 'px';
      frame.style.left = (vw - size) / 2 + 'px';
      frame.style.top = (vh - size) / 2 + 'px';
      const scale = Math.max(size / img.width, size / img.height);
      cropState = { img, canvas, vw, vh, size, scale, offsetX: (vw - img.width * scale) / 2, offsetY: (vh - img.height * scale) / 2, lastDist: 0, lastX: 0, lastY: 0, dragging: false, pinching: false };
      drawCrop();

      setupCropGestures(vp);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function drawCrop() {
  if (!cropState) return;
  const { img, canvas, vw, vh, scale, offsetX, offsetY } = cropState;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, vw, vh);
  ctx.drawImage(img, offsetX, offsetY, img.width * scale, img.height * scale);
}

function setupCropGestures(vp) {
  vp.onmousedown = e => { if (e.button !== 0) return; cropState.dragging = true; cropState.lastX = e.clientX; cropState.lastY = e.clientY; };
  vp.onmousemove = e => { if (!cropState?.dragging) return; cropState.offsetX += e.clientX - cropState.lastX; cropState.offsetY += e.clientY - cropState.lastY; cropState.lastX = e.clientX; cropState.lastY = e.clientY; drawCrop(); };
  vp.onmouseup = () => { if (cropState) cropState.dragging = false; };
  vp.onwheel = e => { e.preventDefault(); if (!cropState) return; const f = e.deltaY < 0 ? 1.08 : 0.92; const mx = e.clientX - vp.getBoundingClientRect().left; const my = e.clientY - vp.getBoundingClientRect().top; cropState.offsetX = mx - (mx - cropState.offsetX) * f; cropState.offsetY = my - (my - cropState.offsetY) * f; cropState.scale *= f; drawCrop(); };
  vp.ontouchstart = e => {
    if (e.touches.length === 1) { cropState.dragging = true; cropState.lastX = e.touches[0].clientX; cropState.lastY = e.touches[0].clientY; }
    else if (e.touches.length === 2) { cropState.pinching = true; cropState.lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
  };
  vp.ontouchmove = e => {
    e.preventDefault();
    if (!cropState) return;
    if (e.touches.length === 1 && cropState.dragging && !cropState.pinching) {
      cropState.offsetX += e.touches[0].clientX - cropState.lastX;
      cropState.offsetY += e.touches[0].clientY - cropState.lastY;
      cropState.lastX = e.touches[0].clientX;
      cropState.lastY = e.touches[0].clientY;
      drawCrop();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - vp.getBoundingClientRect().left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - vp.getBoundingClientRect().top;
      const f = dist / (cropState.lastDist || dist);
      cropState.offsetX = cx - (cx - cropState.offsetX) * f;
      cropState.offsetY = cy - (cy - cropState.offsetY) * f;
      cropState.scale *= f;
      cropState.lastDist = dist;
      drawCrop();
    }
  };
  vp.ontouchend = () => { if (cropState) { cropState.dragging = false; cropState.pinching = false; cropState.lastDist = 0; } };
}

function cancelCrop() {
  document.getElementById('cropModal').classList.remove('show');
  document.getElementById('bottomNavPill').classList.remove('hidden');
  cropState = null;
}

async function confirmCrop() {
  if (!cropState) return;
  const { canvas, vw, vh, size } = cropState;
  const fx = (vw - size) / 2;
  const fy = (vh - size) / 2;
  const out = document.createElement('canvas');
  out.width = 512;
  out.height = 512;
  const ctx = out.getContext('2d');
  ctx.drawImage(canvas, fx, fy, size, size, 0, 0, 512, 512);
  out.toBlob(async blob => {
    cancelCrop();
    if (blob) await uploadAvatarBlob(blob);
  }, 'image/jpeg', 0.92);
}

// ── Tabs ──────────────────────────────────────────────────────
function switchTab(tab, el) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('searchInput').value = '';
  renderTab();
}

async function renderTab() {
  const list = document.getElementById('mainList');
  list.innerHTML = '';
  const q = document.getElementById('searchInput').value.toLowerCase();

  if (currentTab === 'chats') {
    const friends = await fetch('/friends').then(r => r.json());
    const filtered = friends.filter(u => !q || u.display_name.toLowerCase().includes(q) || (u.user_id||'').includes(q));
    if (!filtered.length) { list.innerHTML = '<div class="empty">No friends yet.<br>Go to Add tab.</div>'; return; }
    filtered.forEach(u => list.appendChild(makeUserItem(u, 'friend')));

  } else if (currentTab === 'requests') {
    const reqs = await fetch('/friend_requests').then(r => r.json());
    if (!reqs.length) { list.innerHTML = '<div class="empty">No pending requests.</div>'; return; }
    reqs.forEach(sender => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `<div class="av av-md">${sender[0].toUpperCase()}</div>
        <div class="item-info"><div class="name">${sender}</div><div class="sub">wants to connect</div></div>
        <div class="act-btns">
          <button class="btn-xs btn-blue" onclick="respondReq('${sender}','accept')">✓</button>
          <button class="btn-xs btn-red" onclick="respondReq('${sender}','decline')">✗</button>
        </div>`;
      list.appendChild(div);
    });

  } else {
    const users = await fetch('/users?q=' + encodeURIComponent(q)).then(r => r.json());
    if (!users.length) { list.innerHTML = '<div class="empty">No users found.</div>'; return; }
    users.forEach(u => list.appendChild(makeUserItem(u, 'add')));
  }
}

function makeUserItem(u, mode) {
  const div = document.createElement('div');
  div.className = 'item';
  const badge = u.online ? '<div class="online-dot"></div>' : '';
  const avC = u.avatar_url ? `<img src="${u.avatar_url}"/>` : (u.display_name||u.user_id)[0].toUpperCase();
  let action = '';
  if (mode === 'add') action = `<button class="btn-xs btn-outline" onclick="addFriend('${u.user_id}')">Add</button>`;
  if (mode === 'friend') action = `<button class="remove-btn" onclick="removeFriend(event,'${u.user_id}')">✕</button>`;
  
  // Find story
  const storyIdx = myStories.findIndex(s => s.user_id === u.user_id);
  let avSection = '';
  if (storyIdx !== -1 && mode === 'friend') {
    const sGroup = myStories[storyIdx];
    avSection = `
      <div class="story-ring ${sGroup.has_unviewed ? '' : 'viewed'}" style="width: 44px; height: 44px; padding: 2px; cursor: pointer; flex-shrink: 0; margin-right: 8px;" onclick="event.stopPropagation(); openStoryViewer(${storyIdx});">
        <div class="av" style="width: 100%; height: 100%; margin:0; border: 2px solid var(--bg-primary);">${avC}${badge}</div>
      </div>`;
  } else {
    avSection = `<div class="av av-md">${avC}${badge}</div>`;
  }
  
  div.innerHTML = `
    ${avSection}
    <div class="item-info">
      <div class="name">${u.display_name || u.username}</div>
      <div class="sub">#${u.user_id||'0000'} · ${u.online?'online':'offline'}</div>
    </div>${action}`;
  if (mode === 'friend') div.onclick = e => { if (!e.target.classList.contains('remove-btn')) openChat(u.user_id); };
  return div;
}

async function addFriend(to) {
  const res = await fetch('/send_request/' + to, { method: 'POST' }).then(r => r.json());
  alert(res.ok ? 'Request sent to ' + to : (res.error || 'Already sent'));
}

async function respondReq(from, action) {
  await fetch('/respond_request/' + from + '/' + action, { method: 'POST' });
  document.getElementById('reqTab').innerHTML = 'Requests';
  renderTab();
}

async function removeFriend(e, username) {
  e.stopPropagation();
  if (!confirm('Remove ' + username + '?')) return;
  await fetch('/remove_friend/' + username, { method: 'POST' });
  renderTab();
}

// ── Chat ──────────────────────────────────────────────────────
async function openChat(username) {
  currentChat = username;
  document.getElementById('chatName').textContent = username;
  document.getElementById('chatStatus').textContent = onlineUsers.includes(username) ? 'online' : 'offline';
  document.getElementById('messages').innerHTML = '';
  document.getElementById('csName').textContent = username;
  cancelReply();
  cancelVoiceRec();
  showScreen('chatScreen');

  // Avatar
  const up = await fetch('/profile/' + username).then(r => r.json());
  const avWrapper = document.getElementById('chatAvWrapper');
  const avHtml = up.avatar_url ? `<img src="${up.avatar_url}"/>` : (up.display_name||username)[0].toUpperCase();
  
  const storyIdx = myStories.findIndex(s => s.user_id === username);
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
  
  if (cs.theme_color) applyThemeColor(cs.theme_color);
  else applyThemeColor('#4f8ef7'); // default
  
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
    html += renderPoll(m);
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

  // Long press → context menu + drag-to-reply
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

// ── Context menu ──────────────────────────────────────────────
const EMOJIS = ['❤️','😂','😮','😢','👍','🔥'];

function showCtxMenu(e, m, isSent) {
  ctxMsgId = m.id;
  ctxMsgSender = m.sender;
  ctxMsgText = m.msg_type === 'text' && !m.deleted ? (document.getElementById('msg-' + m.id)?.querySelector('span')?.textContent || '') : '';
  const menu = document.getElementById('ctxMenu');
  const emojis = document.getElementById('ctxEmojis');
  emojis.innerHTML = EMOJIS.map(em => `<span onclick="reactTo(${m.id},'${em}');hideCtx()">${em}</span>`).join('');
  document.getElementById('ctxEdit').style.display = isSent && !m.deleted && m.msg_type === 'text' ? 'flex' : 'none';
  document.getElementById('ctxDelete').style.display = isSent && !m.deleted ? 'flex' : 'none';
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

let editingMsgId = null;

function ctxEditMsg() {
  hideCtx();
  if (!ctxMsgId || !ctxMsgText) return;
  editingMsgId = ctxMsgId;
  const input = document.getElementById('msgInput');
  input.value = ctxMsgText;
  updateInputUI(); 
  input.focus();
  // Show an editing indicator
  const replyBar = document.getElementById('replyBar');
  document.getElementById('replyText').textContent = 'Editing message...';
  replyBar.style.display = 'flex';
}

async function reactTo(msgId, emoji) {
  await fetch('/react/' + msgId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }) });
}

// ── Reply ─────────────────────────────────────────────────────
function setReply(text) {
  replyingTo = text.length > 60 ? text.slice(0, 60) + '…' : text;
  document.getElementById('replyText').textContent = '↩ ' + replyingTo;
  document.getElementById('replyBar').style.display = 'block';
  document.getElementById('msgInput').focus();
}

function cancelReply() {
  replyingTo = null;
  editingMsgId = null; 
  document.getElementById('replyBar').style.display = 'none';
  document.getElementById('replyText').textContent = '';
}

// ── Send ──────────────────────────────────────────────────────
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
  updateInputUI();
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
  updateInputUI();
}

// ── Voice messages ────────────────────────────────────────────
let voiceRec = null, voiceChunks = [], voiceStream = null, voiceLocked = false, voicePaused = false;
let voiceStartTime = 0, voiceElapsed = 0, voiceTimerInterval = null;
let voiceMicStartX = 0, voiceMicStartY = 0, voiceMicActive = false;

function formatRecTime(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function enterRecordingMode(locked) {
  const row = document.getElementById('inputRow');
  row.classList.add('recording-mode');
  document.getElementById('voiceGestureHint').classList.toggle('show', !locked);
  document.getElementById('voicePauseBtn').style.display = locked ? 'inline-flex' : 'none';
  const waveform = document.getElementById('waveform');
  waveform.classList.toggle('paused', false);
  voiceLocked = locked;
}

function exitRecordingMode() {
  const row = document.getElementById('inputRow');
  row.classList.remove('recording-mode');
  document.getElementById('voiceGestureHint').classList.remove('show');
  document.getElementById('recTime').textContent = '0:00';
  document.getElementById('voicePauseBtn').textContent = '⏸';
  document.getElementById('voicePauseBtn').style.display = 'none';
  document.getElementById('waveform').classList.remove('paused');
  clearInterval(voiceTimerInterval);
  voiceTimerInterval = null;
  voiceLocked = false;
  voicePaused = false;
  voiceMicActive = false;
  voiceElapsed = 0;
}

async function startVoiceRec() {
  if (!currentChat || voiceRec) return;
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch { showToast('Microphone access denied'); return; }
  voiceChunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
  voiceRec = new MediaRecorder(voiceStream, { mimeType: mime });
  voiceRec.ondataavailable = e => { if (e.data.size) voiceChunks.push(e.data); };
  voiceRec.onstop = () => { if (voiceStream) { voiceStream.getTracks().forEach(t => t.stop()); voiceStream = null; } };
  voiceRec.start(100);
  voiceStartTime = Date.now();
  voiceElapsed = 0;
  voiceMicActive = true;
  document.getElementById('micBtn').classList.add('recording');
  voiceTimerInterval = setInterval(() => {
    if (!voicePaused) {
      voiceElapsed = Date.now() - voiceStartTime;
      document.getElementById('recTime').textContent = formatRecTime(voiceElapsed);
    }
  }, 200);
  enterRecordingMode(false);
}

function resetVoiceRec() {
  if (voiceRec && voiceRec.state !== 'inactive') voiceRec.stop();
  voiceRec = null;
  voiceChunks = [];
  document.getElementById('micBtn').classList.remove('recording');
  exitRecordingMode();
}

function cancelVoiceRec() {
  resetVoiceRec();
}

function toggleVoicePause() {
  if (!voiceRec || !voiceLocked) return;
  if (voicePaused) {
    voiceRec.resume();
    voicePaused = false;
    voiceStartTime = Date.now() - voiceElapsed; // adjust so timer continues from where it was
    document.getElementById('waveform').classList.remove('paused');
    document.getElementById('voicePauseBtn').textContent = '⏸';
  } else {
    voiceRec.pause();
    voicePaused = true;
    document.getElementById('waveform').classList.add('paused');
    document.getElementById('voicePauseBtn').textContent = '▶';
  }
}

function lockVoiceRec() {
  if (!voiceRec) return;
  voiceLocked = true;
  document.getElementById('voiceGestureHint').classList.remove('show');
  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('voicePauseBtn').style.display = 'inline-flex';
  // show vgh-lock as active briefly
  const lk = document.getElementById('vghLock');
  lk.classList.add('active');
  setTimeout(() => lk.classList.remove('active'), 400);
  showToast('🔒 Locked — recording hands-free');
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
  document.getElementById('micBtn').classList.remove('recording');
  exitRecordingMode();
  if (!chunks.length || !currentChat) return;
  const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
  if (blob.size < 500) return;
  showToast('Sending voice message…');
  const file = new File([blob], 'voice.webm', { type: blob.type });
  const { url } = await cloudUpload(file);
  socket.emit('private_message', { receiver: currentChat, message: '', sender_message: '', msg_type: 'voice', media_url: url, reply_to: replyingTo || '' });
  cancelReply();
}

(function initVoiceMic() {
  const mic = document.getElementById('micBtn');
  const LOCK_THRESHOLD   = 60; // px upward   → lock
  const CANCEL_THRESHOLD = 60; // px leftward  → cancel
  const SEND_THRESHOLD   = 60; // px rightward → send

  // Zone proximity thresholds for visual "near" feedback
  const NEAR_LOCK   = 30;
  const NEAR_CANCEL = 30;

  /* ── Drag-translation helpers ─────────────────────────────── */
  function applyMicTranslate(dx, dy) {
    // Clamp so button stays within a comfortable drag radius
    const clampX = Math.max(-CANCEL_THRESHOLD * 1.4, Math.min(SEND_THRESHOLD * 1.4, dx));
    const clampY = Math.max(-LOCK_THRESHOLD * 1.4, Math.min(20, -dy)); // dy positive=up → negative Y
    mic.style.transform = `translate(${clampX}px, ${-dy > 0 ? Math.min(clampY * 0.4, 8) : Math.max(clampY * 0.4, -8)}px) scale(1.15)`;
  }

  function snapMicBack() {
    // Re-enable elastic transition before clearing transform
    mic.classList.remove('dragging-active');
    mic.style.transform = '';
  }

  /* ── Zone icon state helpers ──────────────────────────────── */
  function updateZoneIcons(dx, dy) {
    const lk  = document.getElementById('vghLock');
    const cnc = document.getElementById('vghCancel');
    // Lock icon (upward)
    if (dy >= LOCK_THRESHOLD) {
      lk.classList.add('active');  lk.classList.remove('near');
    } else if (dy >= NEAR_LOCK) {
      lk.classList.add('near');    lk.classList.remove('active');
    } else {
      lk.classList.remove('active', 'near');
    }
    // Cancel icon (leftward)
    if (dx <= -CANCEL_THRESHOLD) {
      cnc.classList.add('active'); cnc.classList.remove('near');
    } else if (dx <= -NEAR_CANCEL) {
      cnc.classList.add('near');   cnc.classList.remove('active');
    } else {
      cnc.classList.remove('active', 'near');
    }
  }

  function clearZoneIcons() {
    const lk  = document.getElementById('vghLock');
    const cnc = document.getElementById('vghCancel');
    lk.classList.remove('active', 'near');
    cnc.classList.remove('active', 'near');
  }

  /* ── Core gesture handlers ────────────────────────────────── */
  function handleStart(startX, startY) {
    voiceMicStartX = startX;
    voiceMicStartY = startY;
    // Kill CSS transition immediately so button follows pointer with zero latency
    mic.classList.add('dragging-active');
    mic.style.transform = 'scale(1.15)';
    startVoiceRec();
  }

  function handleMove(curX, curY) {
    if (!voiceRec || voiceLocked) return;
    const dx = curX - voiceMicStartX;
    const dy = voiceMicStartY - curY; // positive = upward

    // Live translate the mic button with zero-latency
    applyMicTranslate(dx, dy);

    // Update zone icon visual states
    updateZoneIcons(dx, dy);

    // Trigger lock
    if (dy > LOCK_THRESHOLD) { snapMicBack(); clearZoneIcons(); lockVoiceRec(); return; }
    // Trigger instant cancel
    if (dx < -CANCEL_THRESHOLD) { snapMicBack(); clearZoneIcons(); cancelVoiceRec(); return; }
    // Trigger instant send
    if (dx > SEND_THRESHOLD) { snapMicBack(); clearZoneIcons(); sendVoiceMsg(); return; }
  }

  function handleEnd() {
    if (!voiceRec || voiceLocked) return;
    snapMicBack();
    clearZoneIcons();
    // Release without gesture = send if long enough, else cancel
    const elapsed = Date.now() - voiceStartTime;
    if (elapsed < 500) cancelVoiceRec();
    else sendVoiceMsg();
  }

  /* ── Touch events ─────────────────────────────────────────── */
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

  /* ── Mouse events (desktop) ───────────────────────────────── */
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

// ── Chat settings ─────────────────────────────────────────────
async function setChatWallpaper(input) {
  const file = input.files[0]; if (!file) return;
  const { url } = await cloudUpload(file);
  await fetch('/update_chat_settings/' + currentChat, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallpaper_url: url, disappear_timer: parseInt(document.getElementById('disappearSelect').value) }) });
  document.getElementById('chatBg').style.backgroundImage = `url(${url})`;
  input.value = '';
}

async function clearChatWall() {
  await fetch('/update_chat_settings/' + currentChat, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallpaper_url: null, disappear_timer: parseInt(document.getElementById('disappearSelect').value) }) });
  document.getElementById('chatBg').style.backgroundImage = '';
}

async function saveDisappear() {
  const timer = parseInt(document.getElementById('disappearSelect').value);
  const cs = await fetch('/chat_settings/' + currentChat).then(r => r.json());
  await fetch('/update_chat_settings/' + currentChat, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallpaper_url: cs.wallpaper_url, disappear_timer: timer }) });
}

async function doRemoveFriend() {
  if (!confirm('Remove ' + currentChat + ' as friend?')) return;
  await fetch('/remove_friend/' + currentChat, { method: 'POST' });
  showScreen('contactsScreen');
  currentChat = null;
  renderTab();
}

// ── Media view ────────────────────────────────────────────────
async function openMediaView() {
  showScreen('mediaScreen');
  const media = await fetch('/media/' + currentChat).then(r => r.json());
  const grid = document.getElementById('mediaGrid');
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

// ── V5 Features ───────────────────────────────────────────────
function applyThemeColor(color) {
  document.documentElement.style.setProperty('--accent', color);
  // Optional: darken for gradient end
  document.documentElement.style.setProperty('--accent-dark', color); 
}
async function setTheme(el, color) {
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  applyThemeColor(color);
  if (currentChat) {
    const cs = await fetch('/chat_settings/' + currentChat).then(r => r.json());
    await fetch('/update_chat_settings/' + currentChat, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallpaper_url: cs.wallpaper_url, disappear_timer: cs.disappear_timer, theme_color: color }) });
  }
}
function toggleAudioSpeed(btn) {
  const aud = btn.previousElementSibling;
  let spd = aud.playbackRate;
  if (spd === 1) spd = 1.5; else if (spd === 1.5) spd = 2; else spd = 1;
  aud.playbackRate = spd;
  if ('preservesPitch' in aud) aud.preservesPitch = true;
  btn.textContent = spd + 'x';
}
function toggleChatSearch() {
  const bar = document.getElementById('chatSearchBar');
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
  const pid = document.getElementById('pinnedBar').dataset.msgId;
  if (!pid) return;
  await fetch('/pin_message/' + pid, { method: 'POST' });
}
function scrollToPinned() {
  const pid = document.getElementById('pinnedBar').dataset.msgId;
  const li = document.getElementById('msg-' + pid);
  if (li) { li.scrollIntoView({behavior:'smooth', block:'center'}); li.style.animation = 'micPulse 1s 2'; setTimeout(() => li.style.animation='', 2000); }
}

// ── Polls ─────────────────────────────────────────────────────
function openPollModal() { document.getElementById('pollModal').classList.add('show'); document.getElementById('pollQuestion').value=''; document.querySelectorAll('.poll-opt-input').forEach(i=>i.value=''); }
function closePollModal() { document.getElementById('pollModal').classList.remove('show'); }
function addPollOption() {
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'poll-opt-input'; input.placeholder = 'Option ' + (document.querySelectorAll('.poll-opt-input').length + 1);
  const addBtn = document.querySelector('#pollModal .modal-content button[onclick="addPollOption()"]');
  addBtn.parentNode.insertBefore(input, addBtn);
}
function sendPoll() {
  const q = document.getElementById('pollQuestion').value.trim();
  if (!q) return alert('Enter a question');
  const opts = Array.from(document.querySelectorAll('.poll-opt-input')).map(i => i.value.trim()).filter(v => v);
  if (opts.length < 2) return alert('Enter at least 2 options');
  closePollModal();
  const poll_data = { question: q, options: opts.map((opt, i) => ({ id: i, text: opt, votes: [] })) };
  socket.emit('private_message', { receiver: currentChat, message: '', sender_message: '', msg_type: 'poll', poll_data });
}
function votePoll(msgId, optId) {
  socket.emit('vote_poll', { msg_id: msgId, option_id: optId });
}
function renderPoll(m) {
  if (!m.poll_data) return '[Poll Data Missing]';
  const totalVotes = m.poll_data.options.reduce((sum, opt) => sum + opt.votes.length, 0);
  let html = `<div class="poll-msg"><div class="poll-q">${m.poll_data.question}</div>`;
  m.poll_data.options.forEach(opt => {
    const hasVoted = opt.votes.includes(me);
    const pct = totalVotes > 0 ? Math.round((opt.votes.length / totalVotes) * 100) : 0;
    html += `<div class="poll-opt ${hasVoted ? 'voted' : ''}" onclick="votePoll(${m.id}, ${opt.id})">
      <div class="bar" style="width:${pct}%"></div>
      <span class="opt-text">${opt.text}</span>
      <span class="opt-pct">${pct}%</span>
    </div>`;
  });
  return html + `</div>`;
}

// ── GIF (Giphy API) ───────────────────────────────────────────
const GIPHY_API_KEY = 'GlVGYHk3VVVWVN155555555555555555'; // Use a public beta key or placeholder
function openGifModal() { document.getElementById('gifModal').classList.add('show'); searchGifs(); }
function closeGifModal() { document.getElementById('gifModal').classList.remove('show'); document.getElementById('gifSearch').value=''; document.getElementById('gifGrid').innerHTML=''; }
let gifTimeout;
function searchGifs() {
  clearTimeout(gifTimeout);
  gifTimeout = setTimeout(async () => {
    const q = document.getElementById('gifSearch').value.trim();
    const url = q ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=20` : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20`;
    try {
      const res = await fetch(url).then(r => r.json());
      const grid = document.getElementById('gifGrid');
      grid.innerHTML = '';
      res.data.forEach(gif => {
        const img = document.createElement('img');
        img.src = gif.images.fixed_height_small.url;
        img.onclick = () => sendGif(gif.images.original.url);
        grid.appendChild(img);
      });
    } catch { document.getElementById('gifGrid').innerHTML = '<div class="empty">Could not load GIFs</div>'; }
  }, 500);
}
function sendGif(url) {
  closeGifModal();
  socket.emit('private_message', { receiver: currentChat, message: '', sender_message: '', msg_type: 'image', media_url: url });
}

// ── Socket events ─────────────────────────────────────────────
socket.on('private_message', async function(data) {
  if (data.sender !== currentChat && !data.is_own) return;
  const m = {
    id: data.id,
    sender: data.is_own ? me : data.sender,
    message: data.message,
    sender_message: data.sender_message,
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
  await renderMsg(m, !!data.is_own);
  if (!data.is_own && currentChat) socket.emit('seen', { sender: data.sender });
});

socket.on('typing', function(data) {
  if (data.sender !== currentChat) return;
  const bar = document.getElementById('typingBar');
  if (data.typing) {
    const avHtml = document.getElementById('chatAv').innerHTML;
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
  const pollHtml = renderPoll(m);
  const pm = li.querySelector('.poll-msg');
  if (pm) pm.outerHTML = pollHtml;
});

socket.on('message_pinned', function(data) {
  if (data.chat !== currentChat) return;
  if (data.pinned_msg_id) {
    document.getElementById('pinnedBar').style.display = 'flex';
    document.getElementById('pinnedBar').dataset.msgId = data.pinned_msg_id;
  } else {
    document.getElementById('pinnedBar').style.display = 'none';
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
      // Decode if needed
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
  document.getElementById('reqTab').innerHTML = `Requests<span class="ndot"></span>`;
});

socket.on('request_accepted', () => renderTab());

socket.on('user_list_update', users => {
  onlineUsers = users;
  if (currentChat) document.getElementById('chatStatus').textContent = users.includes(currentChat) ? 'online' : 'offline';
});

// Typing indicator emit
document.getElementById('msgInput').addEventListener('input', () => {
  updateInputUI();
  if (!currentChat) return;
  socket.emit('typing', { receiver: currentChat, typing: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit('typing', { receiver: currentChat, typing: false }), 1500);
});

document.getElementById('msgInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });
function updateInputUI() {
  const val = document.getElementById('msgInput').value.trim();
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
  m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
}
document.addEventListener('click', e => {
  const m = document.getElementById('plusMenu');
  if (m && m.style.display === 'flex' && !e.target.closest('#plusMenu') && !e.target.closest('.cam-btn')) {
    m.style.display = 'none';
  }
});
document.getElementById('msgInput').addEventListener('focus', () => {
  document.getElementById('inputWrap').style.borderColor = 'var(--accent)';
});
document.getElementById('msgInput').addEventListener('blur', () => {
  document.getElementById('inputWrap').style.borderColor = '#1e2a45';
});

updateInputUI();

// ── Init ──────────────────────────────────────────────────────
initKeys().then(async () => {
  initAppTheme();
  socket.connect();
  await loadProfile();
  renderTab();
  // Init glider on the default active tab after layout is ready
  requestAnimationFrame(() => moveNavGlider(document.getElementById('navChatsTab')));
});

socket.on('connect', function() {
  socket.emit('get_online_users');
});

window.addEventListener('resize', () => {
  const active = document.querySelector('.bottom-nav-pill .tab.active');
  if (active) moveNavGlider(active);
});

let myStories = [], svUserIdx = 0, svStoryIdx = 0, svTimer = null, svDuration = 5000;
let svPausedForInput = false;
let svRemainingMs = 0;
let svSegStartTime = 0;

document.getElementById('svReplyInput').addEventListener('focus', () => {
  svPausedForInput = true;
  clearTimeout(svTimer);
  const fill = document.getElementById('svFill' + svStoryIdx);
  if (fill) {
    const rect = fill.getBoundingClientRect();
    const parentWidth = fill.parentElement.getBoundingClientRect().width;
    const pct = parentWidth ? (rect.width / parentWidth) : 0;
    svRemainingMs = svDuration * (1 - pct);
    fill.style.transition = 'none';
    fill.style.width = (pct * 100) + '%';
  }
  const vid = document.querySelector('#svMediaWrap video');
  if (vid) vid.pause();
});

document.getElementById('svReplyInput').addEventListener('blur', () => {
  svPausedForInput = false;
  const vid = document.querySelector('#svMediaWrap video');
  if (vid) vid.play();
  const fill = document.getElementById('svFill' + svStoryIdx);
  if (fill && svRemainingMs > 0) {
    requestAnimationFrame(() => {
      fill.style.transition = `width ${svRemainingMs}ms linear`;
      fill.style.width = '100%';
    });
    svTimer = setTimeout(nextStory, svRemainingMs);
  }
});
async function uploadStory(input) {
  const file = input.files[0];
  if (!file) return;
  const preview = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video');
  const ok = await confirmStoryPost(preview, isVideo);
  if (!ok) { input.value = ''; URL.revokeObjectURL(preview); return; }
  const { url, type } = await cloudUpload(file);
  await fetch('/story', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ media_url: url, media_type: type === 'video' ? 'video' : 'image' }) });
  input.value = '';
  URL.revokeObjectURL(preview);
  loadStoriesBar();
}

function confirmStoryPost(previewUrl, isVideo) {
  return new Promise(resolve => {
    const navPill = document.getElementById('bottomNavPill');
    navPill.classList.add('hidden');
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:700;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;';
    modal.innerHTML = `
      <div style="max-width:320px;max-height:60vh;border-radius:12px;overflow:hidden;">
        ${isVideo ? `<video src="${previewUrl}" autoplay muted loop style="width:100%;display:block;"></video>` : `<img src="${previewUrl}" style="width:100%;display:block;"/>`}
      </div>
      <div style="color:#fff;font-family:'Space Grotesk',sans-serif;font-size:15px;">Share to your story?</div>
      <div style="display:flex;gap:12px;">
        <button id="storyCancelBtn" style="padding:10px 24px;border-radius:10px;border:1px solid #4a5568;background:transparent;color:#fff;font-weight:600;cursor:pointer;">Cancel</button>
        <button id="storyShareBtn" style="padding:10px 24px;border-radius:10px;border:none;background:var(--accent);color:#fff;font-weight:600;cursor:pointer;">Share</button>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#storyCancelBtn').onclick = () => { modal.remove(); navPill.classList.remove('hidden'); resolve(false); };
    modal.querySelector('#storyShareBtn').onclick = () => { modal.remove(); navPill.classList.remove('hidden'); resolve(true); };
  });
}
async function loadStoriesBar() {
  const bar = document.getElementById('storiesBar');
  if (!bar) return;
  const data = await fetch('/stories').then(r => r.json());
  myStories = data;
  const addTile = `<div class="story-item" onclick="document.getElementById('storyUploadInput').click()">
    <div class="story-ring viewed"><div class="av av-md" style="font-size:24px;">+</div></div>
    <span>Add story</span>
  </div>`;
  bar.innerHTML = addTile + data.map((g, i) => {
    const av = g.avatar_url ? `<img src="${g.avatar_url}"/>` : (g.display_name||g.user_id)[0].toUpperCase();
    return `<div class="story-item" onclick="openStoryViewer(${i})">
      <div class="story-ring ${g.has_unviewed ? '' : 'viewed'}"><div class="av av-md">${av}</div></div>
      <span>${g.is_me ? 'Your story' : g.display_name}</span>
    </div>`;
  }).join('');
}

function openStoryViewer(uIdx) {
  svUserIdx = uIdx; svStoryIdx = 0;
  document.getElementById('storyViewer').classList.add('show');
  document.getElementById('bottomNavPill').classList.add('hidden');
  renderStoryProgress();
  showStory();
}
function renderStoryProgress() {
  const g = myStories[svUserIdx];
  document.getElementById('storyProgress').innerHTML = g.stories.map((_,i) =>
    `<div class="seg"><div class="fill" id="svFill${i}"></div></div>`).join('');
}
function showStory() {
  clearTimeout(svTimer);
  document.getElementById('storyViewer').classList.remove('inspecting');
  svPausedForInput = false;
  const g = myStories[svUserIdx];
  const s = g.stories[svStoryIdx];
  document.getElementById('svAvatar').innerHTML = g.avatar_url ? `<img src="${g.avatar_url}"/>` : (g.display_name||g.user_id)[0].toUpperCase();
  document.getElementById('svName').textContent = g.display_name;
  const isMe = g.is_me;
  const replyInput = document.getElementById('svReplyInput');
  const likeBtn = document.getElementById('svLikeBtn');
  const sendBtn = document.getElementById('svSendBtn');
  
  likeBtn.classList.remove('liked');
  if (isMe) {
    document.getElementById('svReplyPill').style.display = 'none';
    document.getElementById('svInspectBtn').style.display = 'flex';
  } else {
    document.getElementById('svReplyPill').style.display = 'flex';
    document.getElementById('svInspectBtn').style.display = 'none';
    replyInput.disabled = false;
    replyInput.placeholder = "Reply to story...";
    likeBtn.style.display = 'flex';
    sendBtn.style.display = 'flex';
  }
  const wrap = document.getElementById('svMediaWrap');
  wrap.innerHTML = s.media_type === 'video'
    ? `<video src="${s.media_url}" autoplay muted></video>`
    : `<img src="${s.media_url}"/>`;
  document.querySelectorAll('.story-progress .fill').forEach(f => {
  f.style.transition = 'none';
  f.style.width = '0%';
});
void document.getElementById('storyProgress').offsetWidth; // force reflow
for (let i = 0; i < svStoryIdx; i++) document.getElementById('svFill'+i).style.width = '100%';
  if (!g.is_me) fetch(`/story/${s.id}/view`, { method: 'POST' });
  const fill = document.getElementById('svFill'+svStoryIdx);
  requestAnimationFrame(() => { fill.style.transition = `width ${svDuration}ms linear`; fill.style.width = '100%'; });
  svTimer = setTimeout(nextStory, svDuration);
}
function nextStory() {
  const g = myStories[svUserIdx];
  if (svStoryIdx < g.stories.length - 1) { svStoryIdx++; showStory(); }
  else if (svUserIdx < myStories.length - 1) { switchUser(svUserIdx + 1, 'right'); }
  else closeStoryViewer();
}

function prevStory() {
  if (svStoryIdx > 0) { svStoryIdx--; showStory(); }
  else if (svUserIdx > 0) { switchUser(svUserIdx - 1, 'left'); }
}

function switchUser(newIdx, dir) {
  clearTimeout(svTimer);
  const wrap = document.getElementById('svMediaWrap');
  wrap.classList.add(dir === 'right' ? 'cube-out-left' : 'cube-out-right');
  setTimeout(() => {
    svUserIdx = newIdx;
    svStoryIdx = 0;
    renderStoryProgress();
    wrap.classList.remove('cube-out-left', 'cube-out-right');
    wrap.classList.add(dir === 'right' ? 'cube-in-from-right' : 'cube-in-from-left');
    showStory();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrap.classList.remove('cube-in-from-right', 'cube-in-from-left');
      });
    });
  }, 350);
}

// Tap zones: left third = prev, right two-thirds = next
function tapPrevStory() {
  if (svStoryIdx > 0) { svStoryIdx--; showStory(); }
}
function tapNextStory() {
  const g = myStories[svUserIdx];
  if (svStoryIdx < g.stories.length - 1) { svStoryIdx++; showStory(); }
  // else: do nothing — tap should NOT advance to next person
}
let svHoldTimer = null;
let svHoldFired = false;

function svFreeze() {
  svPausedForInput = true;
  clearTimeout(svTimer);
  const fill = document.getElementById('svFill' + svStoryIdx);
  if (fill) {
    const rect = fill.getBoundingClientRect();
    const parentWidth = fill.parentElement.getBoundingClientRect().width;
    const pct = parentWidth ? (rect.width / parentWidth) : 0;
    svRemainingMs = svDuration * (1 - pct);
    fill.style.transition = 'none';
    fill.style.width = (pct * 100) + '%';
  }
  const vid = document.querySelector('#svMediaWrap video');
  if (vid) vid.pause();
}

function svUnfreeze() {
  svPausedForInput = false;
  const vid = document.querySelector('#svMediaWrap video');
  if (vid) vid.play();
  const fill = document.getElementById('svFill' + svStoryIdx);
  if (fill && svRemainingMs > 0) {
    requestAnimationFrame(() => {
      fill.style.transition = `width ${svRemainingMs}ms linear`;
      fill.style.width = '100%';
    });
    svTimer = setTimeout(nextStory, svRemainingMs);
  }
}

const svMediaEl = document.getElementById('svMediaWrap');

svMediaEl.addEventListener('touchstart', () => {
  svHoldFired = false;
  svHoldTimer = setTimeout(() => { svHoldFired = true; svFreeze(); }, 180);
}, { passive: true });

svMediaEl.addEventListener('touchend', () => {
  clearTimeout(svHoldTimer);
  if (svHoldFired) { svUnfreeze(); svHoldFired = false; }
}, { passive: true });

svMediaEl.addEventListener('touchcancel', () => {
  clearTimeout(svHoldTimer);
  if (svHoldFired) { svUnfreeze(); svHoldFired = false; }
}, { passive: true });

document.getElementById('svMediaWrap').addEventListener('click', e => {
  if (svPausedForInput) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (x < rect.width * 0.3) tapPrevStory();
  else tapNextStory();
});
// Swipe left/right = jump between people (cube effect)
let svTouchStartX = 0, svTouchStartY = 0;
document.getElementById('svMediaWrap').addEventListener('touchstart', e => {
  svTouchStartX = e.touches[0].clientX;
  svTouchStartY = e.touches[0].clientY;
}, { passive: true });

document.getElementById('svMediaWrap').addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - svTouchStartX;
  const dy = e.changedTouches[0].clientY - svTouchStartY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0 && svUserIdx < myStories.length - 1) switchUser(svUserIdx + 1, 'right');
    else if (dx > 0 && svUserIdx > 0) switchUser(svUserIdx - 1, 'left');
  }
}, { passive: true });
function closeStoryViewer() {
  clearTimeout(svTimer);
  document.getElementById('storyViewer').classList.remove('show', 'inspecting');
  document.getElementById('bottomNavPill').classList.remove('hidden');
  loadStoriesBar();
}
function likeCurrentStory() {
  if (myStories[svUserIdx].is_me) return;
  const s = myStories[svUserIdx].stories[svStoryIdx];
  fetch(`/story/${s.id}/like`, { method: 'POST' });
  document.getElementById('svLikeBtn').classList.add('liked');
}
async function sendStoryReply() {
  if (myStories[svUserIdx].is_me) return;
  const input = document.getElementById('svReplyInput');
  const text = input.value.trim();
  if (!text) return;
  const g = myStories[svUserIdx];
  const s = g.stories[svStoryIdx];
  const rKey = await getPubKey(g.user_id);
  if (!rKey) { showToast('Cannot reply'); return; }
  const eR = await enc(rKey, text);
  const eS = await enc(myPublicKey, text);
  const story_ref = { story_id: s.id, thumb: s.media_url, caption: s.caption || '' };
  socket.emit('private_message', { receiver: g.user_id, message: eR, sender_message: eS, msg_type: 'text', story_ref });
  input.value = '';
  showToast('Reply sent');
}
socket.on('story_liked', d => showToast('Someone liked your story ❤️'));
socket.on('new_story', d => loadStoriesBar());

const _origLoadProfile = loadProfile;
loadProfile = async function() { await _origLoadProfile(); loadStoriesBar(); };

async function toggleViewersPanel() {
  const viewer = document.getElementById('storyViewer');
  const isInspecting = viewer.classList.toggle('inspecting');
  const g = myStories[svUserIdx];
  const s = g.stories[svStoryIdx];
  const listEl = document.getElementById('svViewersList');
  
  if (isInspecting) {
    svPausedForInput = true;
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Loading...</div>';
    try {
      const res = await fetch(`/story/${s.id}/viewers`);
      const viewers = await res.json();
      if (viewers.length === 0) {
        listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No viewers yet</div>';
      } else {
        listEl.innerHTML = viewers.map(v => `
          <div class="sv-viewer-item">
            <img class="av" src="${v.avatar_url || ''}" onerror="this.outerHTML='<div class=\\'av\\' style=\\'background:var(--theme-color);display:flex;align-items:center;justify-content:center\\'>${(v.display_name||v.user_id)[0].toUpperCase()}</div>'"/>
            <span class="name">${v.display_name}</span>
            ${v.liked ? '<span class="heart">❤️</span>' : ''}
          </div>
        `).join('');
      }
    } catch(e) {
      listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Error loading viewers</div>';
    }
  } else {
    svPausedForInput = false;
    svSegStartTime = Date.now();
    svTimer = setTimeout(nextStory, svRemainingMs);
  }
}

/* ═══════════════════════════════════════════════════════════════
     KNOCK — Audio
  ═══════════════════════════════════════════════════════════════ */
  const _kAC = (() => {
    try { return new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  })();
  function _kResume() { if (_kAC && _kAC.state === 'suspended') _kAC.resume(); }
  document.addEventListener('touchstart', _kResume, { once: true, passive: true });
  document.addEventListener('click', _kResume, { once: true });
   
  function playKnockSound() {
    if (!_kAC) return;
    _kResume();
    [0, 0.2, 0.4].forEach(delay => {
      const osc = _kAC.createOscillator();
      const gain = _kAC.createGain();
      osc.connect(gain); gain.connect(_kAC.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(190, _kAC.currentTime + delay);
      osc.frequency.exponentialRampToValueAtTime(75, _kAC.currentTime + delay + 0.09);
      gain.gain.setValueAtTime(0.6, _kAC.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, _kAC.currentTime + delay + 0.11);
      osc.start(_kAC.currentTime + delay);
      osc.stop(_kAC.currentTime + delay + 0.13);
    });
  }
   
  function playRevealSound() {
    if (!_kAC) return;
    _kResume();
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = _kAC.createOscillator();
      const gain = _kAC.createGain();
      osc.connect(gain); gain.connect(_kAC.destination);
      osc.type = 'sine';
      const t = _kAC.currentTime + i * 0.11;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t); osc.stop(t + 0.45);
    });
  }
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — State
  ═══════════════════════════════════════════════════════════════ */
  let _knockMode = false;
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Inject UI
  ═══════════════════════════════════════════════════════════════ */
  (function injectKnockUI() {
    // Knock mode bar above input row
    const bar = document.createElement('div');
    bar.id = 'knockModeBar';
    bar.innerHTML = `🚪 <span>Knock mode — message hidden until both are online</span>
      <button class="km-cancel" onclick="cancelKnockMode()">✕</button>`;
    const inputRow = document.getElementById('inputRow');
    inputRow.parentNode.insertBefore(bar, inputRow);
   
    // Add to plus menu
    const plusMenu = document.getElementById('plusMenu');
    if (plusMenu) {
      const item = document.createElement('div');
      item.className = 'plus-item';
      item.style.cssText = 'padding:10px 16px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:10px;color:var(--accent);font-weight:600;border-top:1px solid var(--border-color);';
      item.innerHTML = '🚪 Send as Knock';
      item.onclick = () => { enterKnockMode(); togglePlusMenu(); };
      plusMenu.appendChild(item);
    }
  })();
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Mode helpers
  ═══════════════════════════════════════════════════════════════ */
  function enterKnockMode() {
    _knockMode = true;
    document.getElementById('knockModeBar').style.display = 'flex';
    document.getElementById('msgInput').placeholder = 'Type secret knock message…';
    document.getElementById('msgInput').focus();
    updateInputUI();
  }
   
  function cancelKnockMode() {
    _knockMode = false;
    document.getElementById('knockModeBar').style.display = 'none';
    document.getElementById('msgInput').placeholder = 'Message...';
    updateInputUI();
  }
   
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _knockMode) cancelKnockMode();
  });
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Patch sendMsg
  ═══════════════════════════════════════════════════════════════ */
  const _origSendMsg = window.sendMsg;
  window.sendMsg = async function sendMsg() {
    if (!_knockMode) return _origSendMsg();
   
    const input = document.getElementById('msgInput');
    const msg = input.value.trim();
    if (!msg || !currentChat) return;
   
    // BLOCK if recipient is online
    if (onlineUsers.includes(currentChat)) {
      showToast("Recipient is online — can't send a Knock");
      return;
    }
   
    const rKey = await getPubKey(currentChat);
    if (!rKey) { alert('Cannot get recipient key'); return; }
    const eR = await enc(rKey, msg);
    const eS = await enc(myPublicKey, msg);
   
    socket.emit('private_message', {
      receiver: currentChat,
      message: eR,
      sender_message: eS,
      msg_type: 'knock',
      reply_to: replyingTo || ''
    });
   
    cancelReply();
    cancelKnockMode();
    input.value = '';
    updateInputUI();
    showToast('🚪 Knock sent — they\'ll see it when they come online');
  };
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Render card
     States:
     - sender,   not acked: "Waiting for them to come online"
     - recipient, not acked, sender offline: "Knock" tap button
     - recipient, not acked, sender online:  auto-open (handled in socket)
     - any, acked: show revealed text
  ═══════════════════════════════════════════════════════════════ */
  function buildKnockDoorHTML(msgId) {
    return `
      <div class="knock-door-wrap">
        <div class="knock-door" id="kd-${msgId}">
          <div class="knock-door-panels"></div>
        </div>
        <div class="knock-door-frame"></div>
        <div class="knock-door-back">✨</div>
        <div class="knock-ripple" id="kr-${msgId}"></div>
      </div>`;
  }
   
  function renderKnockCard(msgId, isSent, acknowledged, revealedText) {
    const door = buildKnockDoorHTML(msgId);
   
    if (acknowledged && revealedText) {
      return `<div class="knock-card" data-knock-id="${msgId}" data-state="revealed">
        ${door}
        <span class="knock-label">🚪 Knock</span>
        <span class="knock-revealed">${revealedText}</span>
        <div class="knock-acked-badge">${isSent ? '✓ Opened' : '✓ Revealed'}</div>
      </div>`;
    }
   
    if (isSent) {
      return `<div class="knock-card" data-knock-id="${msgId}" data-state="sent-waiting">
        ${door}
        <span class="knock-label">🚪 Knock sent</span>
        <span class="knock-sub">Waiting for them to come online…</span>
      </div>`;
    }
   
    // Recipient — not yet acked
    return `<div class="knock-card" data-knock-id="${msgId}" data-state="waiting-sender">
      ${door}
      <span class="knock-label">🚪 Knock</span>
      <span class="knock-sub">Sender is offline</span>
      <button class="knock-tap-btn" onclick="handleKnockTap(${msgId}, this.closest('.knock-card'))">
        🤛 Knock back
      </button>
    </div>`;
  }
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Recipient taps (sender offline)
  ═══════════════════════════════════════════════════════════════ */
  async function handleKnockTap(msgId, cardEl) {
    if (!cardEl || cardEl.dataset.state === 'knocked') return;
    cardEl.dataset.state = 'knocked';
   
    // Play knock sound
    playKnockSound();
    triggerKnockRipple(msgId);
   
    // Ack to server — queues notification for sender
    try {
      const res = await fetch('/knock_ack/' + msgId, { method: 'POST' });
      const data = await res.json();
      if (!data.ok && data.error === 'Already acknowledged') return;
    } catch {}
   
    // Update card — show waiting state
    const btn = cardEl.querySelector('.knock-tap-btn');
    if (btn) btn.remove();
    const sub = cardEl.querySelector('.knock-sub');
    if (sub) sub.textContent = 'Knock sent! Waiting for them to come online…';
   
    showToast('🤛 Knocked! They\'ll be notified when they come online');
  }
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Ripple helper
  ═══════════════════════════════════════════════════════════════ */
  function triggerKnockRipple(msgId) {
    const r = document.getElementById('kr-' + msgId);
    if (!r) return;
    r.classList.remove('pop');
    void r.offsetWidth;
    r.classList.add('pop');
  }
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Open door + reveal (recipient side only)
  ═══════════════════════════════════════════════════════════════ */
  async function openKnockDoor(msgId, encMessage) {
    const li = document.getElementById('msg-' + msgId);
    if (!li) return;
    const card = li.querySelector('.knock-card');
    if (!card) return;
   
    // Already revealed? Skip
    if (card.dataset.state === 'revealed') return;
    card.dataset.state = 'revealed';
   
    // Play knock sound then open
    playKnockSound();
    triggerKnockRipple(msgId);
   
    const door = document.getElementById('kd-' + msgId);
    setTimeout(() => {
      if (door) door.classList.add('open');
    }, 300);
   
    // Decrypt and reveal after door swings
    setTimeout(async () => {
      playRevealSound();
      let plaintext = '🔒';
      try { plaintext = await dec(encMessage); } catch {}
   
      const sub = card.querySelector('.knock-sub');
      if (sub) sub.style.display = 'none';
      const btn = card.querySelector('.knock-tap-btn');
      if (btn) btn.remove();
      const label = card.querySelector('.knock-label');
      if (label) label.textContent = '🚪 Knock';
   
      const revealed = document.createElement('span');
      revealed.className = 'knock-revealed';
      revealed.textContent = plaintext;
      card.appendChild(revealed);
   
      const badge = document.createElement('div');
      badge.className = 'knock-acked-badge';
      badge.textContent = '✓ Revealed';
      card.appendChild(badge);
    }, 1050);
  } 
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Sender: notification that someone knocked
     (push notification handled externally later)
     For now: in-app toast + sound
  ═══════════════════════════════════════════════════════════════ */
  socket.on('knock_acknowledged', function(data) {
    // Sender receives this when recipient knocked while they were offline
    playKnockSound();
    showToast('🤛 Someone knocked on your message!');
    // No door opens on sender side — only recipient side opens
  });
   
  /* ═══════════════════════════════════════════════════════════════
     KNOCK — Patch renderMsg
  ═══════════════════════════════════════════════════════════════ */
  const _origRenderMsg = window.renderMsg;
  window.renderMsg = async function renderMsg(m, isSent, prepend = false) {
    if (m.msg_type !== 'knock') return _origRenderMsg(m, isSent, prepend);
   
    const ul = document.getElementById('messages');
    const li = document.createElement('li');
    li.id = 'msg-' + m.id;
    if (isSent) li.classList.add('sent');
   
    // Store enc message for later decryption (recipient only needs m.message)
    if (m.message) li.dataset.encMessage = m.message;
   
    const ack = !!m.knock_acknowledged;
    let cardHtml = '';
   
    if (ack) {
      let plaintext = null;
      if (!isSent && m.message) {
        try { plaintext = await dec(m.message); } catch {}
      }
      // Sender side: just show acked state without text
      cardHtml = isSent
        ? `<div class="knock-card" data-knock-id="${m.id}" data-state="revealed">
             ${buildKnockDoorHTML(m.id)}
             <span class="knock-label">🚪 Knock sent</span>
             <div class="knock-acked-badge">✓ Opened</div>
           </div>`
        : renderKnockCard(m.id, false, true, plaintext);
    } else {
      cardHtml = renderKnockCard(m.id, isSent, false, null);
    }
   
    let html = `<div class="msender">${isSent ? 'You' : m.sender}</div>`;
    if (m.reply_to) html += `<div class="reply-prev">↩ ${m.reply_to}</div>`;
    html += cardHtml;
   
    if (isSent) {
      html += `<div class="ticks ${m.seen ? 'seen' : ''}">${m.seen ? '✓✓' : '✓'}</div>`;
    }
   
    li.innerHTML = '<div class="reply-drag-icon">↩</div>' + html;
   
    // Long press: only delete for knock messages
    let pressTimer;
    li.addEventListener('touchstart', e => {
      pressTimer = setTimeout(() => {
        ctxMsgId = m.id; ctxMsgSender = m.sender; ctxMsgText = '';
        const menu = document.getElementById('ctxMenu');
        document.getElementById('ctxEmojis').innerHTML = '';
        document.getElementById('ctxEdit').style.display = 'none';
        document.getElementById('ctxDelete').style.display = isSent ? 'flex' : 'none';
        menu.classList.add('show');
        const t = e.touches[0];
        menu.style.left = Math.min(t.clientX, window.innerWidth - 180) + 'px';
        menu.style.top  = Math.min(t.clientY, window.innerHeight - 200) + 'px';
      }, 500);
    }, { passive: true });
    li.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });
   
    if (prepend) ul.prepend(li); else ul.appendChild(li);
    if (!prepend) li.scrollIntoView({ behavior: 'smooth' });
   
    
  };
   
  console.log('[Knock v2] Loaded ✓');

/* ═══════════════════════════════════════════════════════════════
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
