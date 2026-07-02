/**
 * ui.js
 * Screen management, navigation, and Toast notifications
 */

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const targetScreen = document.getElementById(id);
  if (targetScreen) targetScreen.classList.add('active');
  
  // Handle bottom navigation bar visibility and active tabs
  const navPill = document.getElementById('bottomNavPill');
  if (navPill) {
    if (id === 'contactsScreen' || id === 'profileScreen') {
      navPill.classList.remove('hidden');
      if (typeof restoreGlobalTheme === 'function') restoreGlobalTheme();
      
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
  }

  if (id !== 'contactsScreen') {
    history.pushState({ screen: id }, '', window.location.pathname);
  }
}

function moveNavGlider(activeTab) {
  const pill = document.getElementById('bottomNavPill');
  const glider = document.getElementById('navGlider');
  if (!glider || !activeTab || !pill) return;
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
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    renderTab();
  }
  // Move the glider to the clicked tab
  moveNavGlider(el);
}

function goBack() {
  history.back();
}

function switchTab(tab, el) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  renderTab();
}

async function renderTab() {
  const list = document.getElementById('mainList');
  if (!list) return;
  list.innerHTML = '';
  const searchInput = document.getElementById('searchInput');
  const q = searchInput ? searchInput.value.toLowerCase() : '';

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
  const storyIdx = (typeof myStories !== 'undefined') ? myStories.findIndex(s => s.user_id === u.user_id) : -1;
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
  const reqTab = document.getElementById('reqTab');
  if (reqTab) reqTab.innerHTML = 'Requests';
  renderTab();
}

async function removeFriend(e, username) {
  e.stopPropagation();
  if (!confirm('Remove ' + username + '?')) return;
  await fetch('/remove_friend/' + username, { method: 'POST' });
  renderTab();
}

console.log('✓ UI module loaded');
