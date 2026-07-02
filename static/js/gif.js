/**
 * gif.js
 * Giphy search and selection controls
 */

let gifTimeout;

function openGifModal() { 
  const modal = document.getElementById('gifModal');
  if (modal) modal.classList.add('show'); 
  searchGifs(); 
}

function closeGifModal() { 
  const modal = document.getElementById('gifModal');
  if (modal) modal.classList.remove('show'); 
  const searchInput = document.getElementById('gifSearch');
  if (searchInput) searchInput.value = ''; 
  const grid = document.getElementById('gifGrid');
  if (grid) grid.innerHTML = ''; 
}

function searchGifs() {
  clearTimeout(gifTimeout);
  gifTimeout = setTimeout(async () => {
    const searchInput = document.getElementById('gifSearch');
    const q = searchInput ? searchInput.value.trim() : '';
    const url = q ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=20` : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20`;
    try {
      const res = await fetch(url).then(r => r.json());
      const grid = document.getElementById('gifGrid');
      if (!grid) return;
      grid.innerHTML = '';
      if (res.data) {
        res.data.forEach(gif => {
          const img = document.createElement('img');
          img.src = gif.images.fixed_height_small.url;
          img.onclick = () => sendGif(gif.images.original.url);
          grid.appendChild(img);
        });
      }
    } catch { 
      const grid = document.getElementById('gifGrid');
      if (grid) grid.innerHTML = '<div class="empty">Could not load GIFs</div>'; 
    }
  }, 500);
}

function sendGif(url) {
  closeGifModal();
  socket.emit('private_message', { receiver: currentChat, message: '', sender_message: '', msg_type: 'image', media_url: url });
}

console.log('✓ GIF module loaded');
