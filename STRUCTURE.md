# Chatly Split Codebase Structure

This document explains the new modular structure of Chatly for easier debugging and maintenance.

## File Organization

### HTML Structure
```
templates/
├── index.html          (Main HTML - DOM only, ~150 lines)
└── [Old index.html]    (Backup of original 3500+ line file)
```

**index.html** now contains only:
- DOCTYPE and metadata
- CSS/JS imports
- Clean DOM structure
- No inline scripts or styles

### CSS Architecture
```
static/css/
├── themes.css          (CSS variables, color presets)
├── main.css            (Base styles, layout, typography)
├── components.css      (Chat, messages, modals, buttons)
├── stories.css         (Stories feature UI)
└── calls.css           (Voice call modal UI)
```

**Separation by concern:**
- `themes.css`: Reusable design tokens (colors, spacing)
- `main.css`: Global layout, screens, basic components
- `components.css`: Complex UI pieces (chat, messages, modals)
- `stories.css`: Stories-specific styling
- `calls.css`: Call-specific styling

### JavaScript Modules
```
static/js/
├── constants.js        (Global constants, CloudinaryAPI keys)
├── crypto.js           (RSA encryption/decryption)
├── ui.js               (Screen management, navigation)
├── themes.js           (Theme switching, appearance settings)
├── profile.js          (Profile management, avatar crop)
├── chat.js             (Message rendering, chat features)
├── voice.js            (Voice recording, gestures, playback)
├── stories.js          (Stories viewer, upload, interactions)
├── polls.js            (Poll creation, voting)
├── gif.js              (GIF search and sending)
├── socket-handlers.js  (Socket.IO event listeners)
├── call-handlers.js    (Voice call socket handlers)
├── init.js             (App initialization, main entry point)
└── call.js             (WebRTC call logic - external)
```

**Responsibilities by module:**
- `constants.js`: Configuration, API keys
- `crypto.js`: All encryption/decryption logic
- `ui.js`: Screen switching, navigation, modal management
- `themes.js`: Theme application, glow settings, appearance
- `profile.js`: Profile loading, name editing, avatar cropping
- `chat.js`: Message display, sending, editing, reactions
- `voice.js`: Microphone recording, gesture recognition, playback
- `stories.js`: Story viewer, upload, likes, replies
- `polls.js`: Poll UI, voting logic
- `gif.js`: Giphy integration
- `socket-handlers.js`: Incoming message handling, typing indicators, etc.
- `call-handlers.js`: WebRTC and call signaling
- `init.js`: Loads keys, connects socket, initializes app

## Module Dependency Graph

```
init.js
  ├→ constants.js
  ├→ crypto.js
  ├→ ui.js
  ├→ themes.js
  ├→ profile.js
  ├→ chat.js
  ├→ voice.js
  ├→ stories.js
  ├→ socket-handlers.js
  └→ call.js

chat.js
  ├→ crypto.js
  ├→ polls.js
  └→ gif.js

voice.js
  ├→ constants.js
  └→ chat.js

stories.js
  ├→ crypto.js
  └→ socket-handlers.js
```

## Debugging Guide

### 1. **Finding Code by Feature**

| Feature | Location |
|---------|----------|
| Message display | `chat.js` → `renderMsg()` |
| Send message | `chat.js` → `sendMsg()` |
| Voice recording | `voice.js` → `startVoiceRec()` |
| Encryption | `crypto.js` → `enc()`, `dec()` |
| Theme switching | `themes.js` → `setAppThemeColor()` |
| Stories | `stories.js` → `openStoryViewer()` |
| Polls | `polls.js` → `sendPoll()` |
| Socket events | `socket-handlers.js` |
| Styling | `static/css/` files |

### 2. **Common Debugging Tasks**

**Fix message display bug:**
1. Open `static/js/chat.js`
2. Look for `renderMsg()` function
3. Check message HTML template
4. Verify CSS in `static/css/components.css`

**Debug encryption issue:**
1. Open `static/js/crypto.js`
2. Check `enc()` and `dec()` functions
3. Verify key management in `constants.js`

**Modify theme colors:**
1. Edit `static/css/themes.css`
2. Update color values in `:root` or class selectors
3. No need to touch HTML or other JS files

**Fix voice recording:**
1. Check `static/js/voice.js`
2. Look for `startVoiceRec()` and gesture handlers
3. Test with browser console

### 3. **Browser DevTools Tips**

```javascript
// In console, you can access:
me                    // Current user ID
currentChat           // Active chat partner
myProfile             // User profile object
onlineUsers           // List of online users
socket                // Socket.IO connection

// Example:
console.log(currentChat);
console.log(myProfile);
```

## Performance Considerations

- **Lazy loading**: JS modules load sequentially but are small
- **CSS**: Split files reduce specificity conflicts
- **Socket.IO**: Handlers in separate module for clarity
- **WebRTC**: Call logic remains in external `call.js` file

## Migration Path from Old Code

If you need to migrate custom features:

1. **UI changes** → Update `templates/index.html` and relevant CSS
2. **New feature** → Create new `.js` file in `static/js/`
3. **Styling** → Add to appropriate CSS file or create new one
4. **Socket events** → Add handler to `socket-handlers.js`

## Building for Production

```bash
# No build step needed - files are ready to use
# Serve files normally:
python app.py
```

Optional minification (future):
```bash
# Minify CSS
cssnano main.css components.css ...

# Minify JS
terser constants.js crypto.js ... -o bundle.min.js
```

## File Sizes Reference

| File | Lines | Purpose |
|------|-------|---------|
| `index.html` | ~150 | DOM + imports |
| `themes.css` | ~100 | CSS variables |
| `main.css` | ~200 | Base styles |
| `components.css` | ~600 | UI components |
| `crypto.js` | ~80 | Encryption |
| `chat.js` | ~400 | Chat logic |
| `voice.js` | ~300 | Voice recording |
| `stories.js` | ~400 | Stories feature |
| `init.js` | ~50 | App setup |

Total: ~2,500 lines (vs 3,500 in original) + better organization

## Future Improvements

1. **Component library**: Create reusable UI component classes
2. **State management**: Consider Zustand/Redux for complex state
3. **Testing**: Add Jest tests for crypto, chat, voice modules
4. **TypeScript**: Type-safe version of modules
5. **Service Workers**: Offline support
