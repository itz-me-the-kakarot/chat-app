/**
 * profile.js
 * Profile details loading, editing, avatar cropping and uploading
 */

let cropState = null;

async function loadProfile() {
  myProfile = await fetch('/profile').then(r => r.json());
  const init = (myProfile.display_name || me)[0].toUpperCase();
  const avContent = myProfile.avatar_url ? `<img src="${myProfile.avatar_url}"/>` : init;
  
  const myAvBtn = document.getElementById('myAvBtn');
  const profileAvBig = document.getElementById('profileAvBig');
  const profileDN = document.getElementById('profileDN');
  const profileUID = document.getElementById('profileUID');
  const profileUN = document.getElementById('profileUN');
  const newNameInput = document.getElementById('newNameInput');

  if (myAvBtn) myAvBtn.innerHTML = avContent;
  if (profileAvBig) profileAvBig.innerHTML = avContent;
  if (profileDN) profileDN.textContent = myProfile.display_name || me;
  if (profileUID) profileUID.textContent = '#' + (myProfile.user_id || '0000');
  if (profileUN) profileUN.textContent = '@' + me;
  if (newNameInput) newNameInput.value = myProfile.display_name || me;
  if (typeof loadStoriesBar === 'function') {
    await loadStoriesBar();
  }
}

async function saveName() {
  const name = document.getElementById('newNameInput').value.trim();
  if (!name) return;
  await fetch('/update_profile', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ display_name: name }) 
  });
  const profileDN = document.getElementById('profileDN');
  if (profileDN) profileDN.textContent = name;
  myProfile.display_name = name;
}

async function uploadAvatarBlob(blob) {
  const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
  const { url } = await cloudUpload(file);
  await fetch('/upload_avatar', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ url }) 
  });
  const av = `<img src="${url}"/>`;
  const myAvBtn = document.getElementById('myAvBtn');
  const profileAvBig = document.getElementById('profileAvBig');
  if (myAvBtn) myAvBtn.innerHTML = av;
  if (profileAvBig) profileAvBig.innerHTML = av;
}

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
      cropState = { 
        img, canvas, vw, vh, size, scale, 
        offsetX: (vw - img.width * scale) / 2, 
        offsetY: (vh - img.height * scale) / 2, 
        lastDist: 0, lastX: 0, lastY: 0, 
        dragging: false, pinching: false 
      };
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

// Cloudinary upload
async function cloudUpload(file) {
  const type = file.type.startsWith('video') ? 'video' : file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') ? 'video' : 'raw';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/${type === 'raw' ? 'raw' : type}/upload`, { method: 'POST', body: fd });
  const d = await res.json();
  return { 
    url: d.secure_url, 
    type: file.type.startsWith('video') || file.type.startsWith('audio') ? 'video' : file.type.startsWith('image') ? 'image' : 'file' 
  };
}

console.log('✓ Profile module loaded');
