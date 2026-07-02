/**
 * stories.js
 * Stories viewer, uploads, likes, viewers details, 3D cube rotation, timer bars, hold-to-freeze
 */

let myStories = [], svUserIdx = 0, svStoryIdx = 0, svTimer = null, svDuration = 5000;
let svPausedForInput = false;
let svRemainingMs = 0;
let svSegStartTime = 0;

const svReplyInput = document.getElementById('svReplyInput');
if (svReplyInput) {
  svReplyInput.addEventListener('focus', () => {
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

  svReplyInput.addEventListener('blur', () => {
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
}

async function uploadStory(input) {
  const file = input.files[0];
  if (!file) return;
  const preview = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video');
  const ok = await confirmStoryPost(preview, isVideo);
  if (!ok) { input.value = ''; URL.revokeObjectURL(preview); return; }
  const { url, type } = await cloudUpload(file);
  await fetch('/story', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ media_url: url, media_type: type === 'video' ? 'video' : 'image' }) 
  });
  input.value = '';
  URL.revokeObjectURL(preview);
  loadStoriesBar();
}

function confirmStoryPost(previewUrl, isVideo) {
  return new Promise(resolve => {
    const navPill = document.getElementById('bottomNavPill');
    if (navPill) navPill.classList.add('hidden');
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
    modal.querySelector('#storyCancelBtn').onclick = () => { modal.remove(); if (navPill) navPill.classList.remove('hidden'); resolve(false); };
    modal.querySelector('#storyShareBtn').onclick = () => { modal.remove(); if (navPill) navPill.classList.remove('hidden'); resolve(true); };
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
  const bottomNavPill = document.getElementById('bottomNavPill');
  if (bottomNavPill) bottomNavPill.classList.add('hidden');
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
  const inspectBtn = document.getElementById('svInspectBtn');
  const replyPill = document.getElementById('svReplyPill');
  
  if (likeBtn) likeBtn.classList.remove('liked');
  if (isMe) {
    if (replyPill) replyPill.style.display = 'none';
    if (inspectBtn) inspectBtn.style.display = 'flex';
  } else {
    if (replyPill) replyPill.style.display = 'flex';
    if (inspectBtn) inspectBtn.style.display = 'none';
    if (replyInput) {
      replyInput.disabled = false;
      replyInput.placeholder = "Reply to story...";
    }
    if (likeBtn) likeBtn.style.display = 'flex';
    if (sendBtn) sendBtn.style.display = 'flex';
  }
  const wrap = document.getElementById('svMediaWrap');
  if (wrap) {
    wrap.innerHTML = s.media_type === 'video'
      ? `<video src="${s.media_url}" autoplay muted></video>`
      : `<img src="${s.media_url}"/>`;
  }
  document.querySelectorAll('.story-progress .fill').forEach(f => {
    f.style.transition = 'none';
    f.style.width = '0%';
  });
  void document.getElementById('storyProgress').offsetWidth; // force reflow
  for (let i = 0; i < svStoryIdx; i++) {
    const f = document.getElementById('svFill'+i);
    if (f) f.style.width = '100%';
  }
  if (!g.is_me) fetch(`/story/${s.id}/view`, { method: 'POST' });
  const fill = document.getElementById('svFill'+svStoryIdx);
  if (fill) {
    requestAnimationFrame(() => { 
      fill.style.transition = `width ${svDuration}ms linear`; 
      fill.style.width = '100%'; 
    });
  }
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
  if (wrap) {
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
}

function tapPrevStory() {
  if (svStoryIdx > 0) { svStoryIdx--; showStory(); }
}
function tapNextStory() {
  const g = myStories[svUserIdx];
  if (svStoryIdx < g.stories.length - 1) { svStoryIdx++; showStory(); }
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
if (svMediaEl) {
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

  svMediaEl.addEventListener('click', e => {
    if (svPausedForInput) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.3) tapPrevStory();
    else tapNextStory();
  });

  let svTouchStartX = 0, svTouchStartY = 0;
  svMediaEl.addEventListener('touchstart', e => {
    svTouchStartX = e.touches[0].clientX;
    svTouchStartY = e.touches[0].clientY;
  }, { passive: true });

  svMediaEl.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - svTouchStartX;
    const dy = e.changedTouches[0].clientY - svTouchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0 && svUserIdx < myStories.length - 1) switchUser(svUserIdx + 1, 'right');
      else if (dx > 0 && svUserIdx > 0) switchUser(svUserIdx - 1, 'left');
    }
  }, { passive: true });
}

function closeStoryViewer() {
  clearTimeout(svTimer);
  document.getElementById('storyViewer').classList.remove('show', 'inspecting');
  const bottomNavPill = document.getElementById('bottomNavPill');
  if (bottomNavPill) bottomNavPill.classList.remove('hidden');
  loadStoriesBar();
}

function likeCurrentStory() {
  if (myStories[svUserIdx].is_me) return;
  const s = myStories[svUserIdx].stories[svStoryIdx];
  fetch(`/story/${s.id}/like`, { method: 'POST' });
  const likeBtn = document.getElementById('svLikeBtn');
  if (likeBtn) likeBtn.classList.add('liked');
}

async function sendStoryReply() {
  if (myStories[svUserIdx].is_me) return;
  const input = document.getElementById('svReplyInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const g = myStories[svUserIdx];
  const s = g.stories[svStoryIdx];
  const rKey = await getPubKey(g.user_id);
  if (!rKey) { if (typeof showToast === 'function') showToast('Cannot reply'); return; }
  const eR = await enc(rKey, text);
  const eS = await enc(myPublicKey, text);
  const story_ref = { story_id: s.id, thumb: s.media_url, caption: s.caption || '' };
  socket.emit('private_message', { receiver: g.user_id, message: eR, sender_message: eS, msg_type: 'text', story_ref });
  input.value = '';
  if (typeof showToast === 'function') showToast('Reply sent');
}

async function toggleViewersPanel() {
  const viewer = document.getElementById('storyViewer');
  const isInspecting = viewer.classList.toggle('inspecting');
  const g = myStories[svUserIdx];
  const s = g.stories[svStoryIdx];
  const listEl = document.getElementById('svViewersList');
  if (!listEl) return;
  
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

console.log('✓ Stories module loaded');
