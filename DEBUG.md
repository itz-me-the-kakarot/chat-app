# Debugging Guide for Split Chatly

Quick reference for common debugging tasks.

## Browser Console Commands

Open DevTools (F12) → Console tab:

```javascript
// Current state
console.log(me)                    // Current user ID
console.log(currentChat)           // Active chat partner  
console.log(myProfile)             // User profile
console.log(onlineUsers)           // Online users list
console.log(myStories)             // Stories data

// Socket state
console.log(socket.connected)      // Socket connected?
socket.emit('test')                // Send test event

// Encryption
console.log(myPublicKey)           // Your public key object
console.log(publicKeys)            // Cached public keys

// Storage
console.log(localStorage)          // All stored data
localStorage.removeItem('privkey_'+me)  // Clear keys
```

## Common Issues & Solutions

### 1. Messages not showing

**Symptoms:** Chat loads but no messages appear

**Check:**
```javascript
// 1. Check message list
console.log(document.querySelectorAll('#messages li').length)  // Count messages

// 2. Check renderMsg being called
// Add to chat.js temporarily:
const origRender = renderMsg;
window.renderMsg = async function(...args) {
  console.log('renderMsg called:', args);
  return origRender(...args);
};

// 3. Check socket listener
socket.on('private_message', (data) => {
  console.log('Message received:', data);
});
```

**Common causes:**
- Encryption failure → check `crypto.js`
- Socket not connected → check `socket-handlers.js`
- Message not decrypting → wrong private key

### 2. Encryption errors

**Symptoms:** "🔒" appears instead of message text

**Debug:**
```javascript
// Test encryption
const testKey = myPublicKey;
const testMsg = 'Hello';

enc(testKey, testMsg)
  .then(cipher => {
    console.log('Encrypted:', cipher);
    return dec(cipher);
  })
  .then(plain => {
    console.log('Decrypted:', plain);
  })
  .catch(err => console.error('Crypto error:', err));
```

**Fixes:**
- Reload page to reinitialize keys
- Check localStorage has private key: `localStorage.getItem('privkey_'+me)`
- Verify public key uploaded to server

### 3. Voice recording not working

**Symptoms:** Microphone button unresponsive or error

**Debug:**
```javascript
// Check microphone access
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('✓ Mic access granted');
    stream.getTracks().forEach(t => t.stop());
  })
  .catch(err => console.error('✗ Mic error:', err.message));

// Check recording state
console.log(voiceRec)           // Recording object
console.log(voiceChunks)        // Audio chunks
console.log(voiceStream)        // Media stream
```

**Fixes:**
- Check browser microphone permissions
- Allow https or localhost
- Check browser console for `DOMException`

### 4. Styles not applying

**Symptoms:** Wrong colors, misaligned layout

**Check:**
```javascript
// Verify CSS variables
getComputedStyle(document.documentElement).getPropertyValue('--accent')
// Should return a color like "#4f8ef7"

// Check theme applied
document.body.classList  // Should contain "theme-blue" etc

// Force theme refresh
initAppTheme();
```

**Fixes:**
- Hard refresh (Ctrl+Shift+R)
- Check CSS files loaded (Network tab)
- Check `themes.js` runs before other CSS

### 5. Socket.IO not connecting

**Symptoms:** Messages send but don't receive, socket shows as disconnected

**Debug:**
```javascript
// Check socket connection
console.log(socket.connected)     // true/false
console.log(socket.id)            // Socket ID or undefined

// Listen to socket events
socket.on('connect', () => console.log('✓ Connected'));
socket.on('disconnect', () => console.log('✗ Disconnected'));
socket.on('error', (err) => console.error('Socket error:', err));

// Force reconnect
socket.disconnect();
socket.connect();
```

**Fixes:**
- Restart Flask server
- Check WebSocket support (some proxies block it)
- Check server logs for socket errors

### 6. Stories not loading

**Symptoms:** Stories bar empty or error

**Debug:**
```javascript
// Check stories data
console.log(myStories)

// Test story fetch
fetch('/stories').then(r => r.json()).then(console.log)

// Check story permissions
console.log(me)                  // Your user ID
console.log(currentChat)         // Viewing whose chat?

// Test story image load
fetch('/story/1')
  .then(r => r.json())
  .then(d => {
    console.log('Story data:', d);
    new Image().src = d.media_url;  // Test image loads
  });
```

## DevTools Snippets

Save these as snippets in DevTools (Sources → Snippets):

**Check app state:**
```javascript
console.table({
  User: me,
  Chat: currentChat,
  Connected: socket?.connected,
  Profile: myProfile,
  ThemeColor: localStorage.getItem('chatly_theme_color'),
  Glow: localStorage.getItem('chatly_theme_glow_val'),
});
```

**Test message sending:**
```javascript
if (!currentChat) { console.error('No chat open'); throw new Error(); }
const testMsg = prompt('Message to send:');
if (!testMsg) throw new Error('Cancelled');

getPubKey(currentChat)
  .then(async rKey => {
    if (!rKey) throw new Error('No recipient key');
    const eR = await enc(rKey, testMsg);
    const eS = await enc(myPublicKey, testMsg);
    socket.emit('private_message', {
      receiver: currentChat,
      message: eR,
      sender_message: eS,
      msg_type: 'text',
      reply_to: ''
    });
    console.log('✓ Message sent');
  })
  .catch(err => console.error('✗ Error:', err));
```

**Clear all app data:**
```javascript
// WARNING: This clears everything!
Object.keys(localStorage).forEach(key => {
  if (key.includes('chatly') || key.includes('privkey') || key.includes('pubkey')) {
    localStorage.removeItem(key);
    console.log('Cleared:', key);
  }
});
location.reload();
```

## Performance Analysis

```javascript
// Measure JS module load times
console.time('App Load');
// ... app loads ...
console.timeEnd('App Load');

// Check memory usage (Chrome only)
if (performance.memory) {
  console.log('Memory:', {
    usedMB: (performance.memory.usedJSHeapSize / 1048576).toFixed(2),
    limitMB: (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2),
  });
}

// Check rendering performance
console.time('Render Messages');
renderTab();
console.timeEnd('Render Messages');
```

## Network Debugging

Network tab in DevTools:

1. **Check CSS loads:** Should see all `.css` files with 200 status
2. **Check JS loads:** Should see all `.js` files with 200 status
3. **Check socket.io:** Should see WebSocket upgrade
4. **Check API calls:** Check `/pubkey/`, `/profile/`, etc. respond

**Slow loading?**
- Check file sizes (⚠️ if > 500KB)
- Check Network tab throttling
- Check server logs for errors

## Server Logs

Run Flask with debug output:

```bash
FLASK_ENV=development python app.py
```

Watch for:
- Socket.IO connection messages
- Database errors
- Encryption key uploads

## Reset Everything

Complete factory reset:

```javascript
// 1. Clear localStorage
localStorage.clear();

// 2. Clear IndexedDB (if used)
const dbs = await indexedDB.databases();
dbs.forEach(db => indexedDB.deleteDatabase(db.name));

// 3. Disconnect socket
socket.disconnect();

// 4. Reload page
location.reload();
```

## Debug Checklist

When something breaks:
- [ ] Check browser console for errors
- [ ] Check Network tab - all files loaded?
- [ ] Check server logs for errors
- [ ] Hard refresh (Ctrl+Shift+R)
- [ ] Test in incognito/private mode
- [ ] Check localStorage isn't full
- [ ] Verify socket.io connected
- [ ] Try in different browser
- [ ] Compare with backup version
- [ ] Ask in #debugging channel with console output

## Getting Help

When reporting bugs, include:
1. Browser + version
2. Error message from console
3. Steps to reproduce
4. Expected vs actual behavior
5. Screenshot of Network tab
6. Relevant code snippet
