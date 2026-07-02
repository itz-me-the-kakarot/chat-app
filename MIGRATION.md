# Migration Guide: From Monolith to Split Codebase

This guide helps you migrate your original Chatly from the single 3,500-line `index.html` to the new modular structure.

## Quick Start

### Option 1: Clean Migration (Recommended)

1. **Backup original file:**
   ```bash
   cp templates/index.html templates/index.html.backup
   ```

2. **Update Flask app to serve split files:**
   - Flask already serves `static/` and `templates/` correctly
   - No changes needed to `app.py`

3. **Copy new files:**
   ```bash
   # Copy new HTML
   cp split/index.html templates/index.html
   
   # Copy CSS
   cp split/themes.css static/css/
   cp split/main.css static/css/
   cp split/components.css static/css/
   cp split/stories.css static/css/
   cp split/calls.css static/css/
   
   # Copy JS modules
   cp split/constants.js static/js/
   cp split/crypto.js static/js/
   cp split/init.js static/js/
   # ... copy all other JS files
   ```

4. **Verify structure:**
   ```
   templates/
   ├── index.html           (150 lines - new split version)
   ├── index.html.backup    (3500 lines - old monolith)
   ├── login.html
   ├── signup.html
   └── landing.html
   
   static/
   ├── css/
   │   ├── themes.css
   │   ├── main.css
   │   ├── components.css
   │   ├── stories.css
   │   └── calls.css
   ├── js/
   │   ├── constants.js
   │   ├── crypto.js
   │   ├── ui.js
   │   ├── themes.js
   │   ├── profile.js
   │   ├── chat.js
   │   ├── voice.js
   │   ├── stories.js
   │   ├── polls.js
   │   ├── gif.js
   │   ├── socket-handlers.js
   │   ├── call-handlers.js
   │   ├── init.js
   │   └── call.js
   └── socket.io.min.js
   ```

5. **Test locally:**
   ```bash
   python app.py
   # Visit http://localhost:5000
   ```

### Option 2: Gradual Migration

Keep both versions running in parallel:

```html
<!-- In your new templates/index.html -->
<script>
  // Try loading split version
  const useSplit = true;
  
  if (!useSplit) {
    // Fallback to old monolith
    location.href = '/old';
  }
</script>
```

Then gradually migrate pieces.

## Extracting Code from Original

If you have custom modifications in your original `index.html`, use this mapping:

### Where to move code:

| Original Code | New Location |
|---|---|
| CSS in `<style>` | `static/css/` files |
| Encryption functions | `static/js/crypto.js` |
| Screen management | `static/js/ui.js` |
| Message functions | `static/js/chat.js` |
| Voice recording | `static/js/voice.js` |
| Theme switching | `static/js/themes.js` |
| Socket.IO listeners | `static/js/socket-handlers.js` |
| Stories code | `static/js/stories.js` |
| Polls code | `static/js/polls.js` |
| GIF search | `static/js/gif.js` |

### Example: Moving a custom chat feature

**Original (monolith):**
```html
<style>
  .my-custom-button { /* CSS */ }
</style>

<script>
  function myCustomFeature() {
    // code here
  }
  
  socket.on('my-event', (data) => {
    // handler
  });
</script>
```

**After split:**

1. **Create** `static/css/custom-features.css`:
   ```css
   .my-custom-button { /* CSS */ }
   ```

2. **Create** `static/js/my-feature.js`:
   ```javascript
   function myCustomFeature() {
     // code here
   }
   
   console.log('✓ My feature module loaded');
   ```

3. **Update** `static/js/socket-handlers.js`:
   ```javascript
   socket.on('my-event', (data) => {
     // handler
   });
   ```

4. **Add imports to** `templates/index.html`:
   ```html
   <link rel="stylesheet" href="/static/css/custom-features.css"/>
   <script src="/static/js/my-feature.js"></script>
   ```

## Testing Checklist

- [ ] App loads without console errors
- [ ] Login/signup works
- [ ] Can send messages
- [ ] Voice recording works
- [ ] Stories display correctly
- [ ] Theme switching works
- [ ] Emoji reactions work
- [ ] Polls work
- [ ] GIF search works
- [ ] Voice calls work
- [ ] All pages responsive

## Common Issues & Fixes

### Issue: "Undefined function" error

**Problem:** A function from one module is called before it loads.

**Fix:** Check script load order in `templates/index.html`:
```html
<!-- Load dependencies first -->
<script src="/static/js/constants.js"></script>
<script src="/static/js/crypto.js"></script>
<script src="/static/js/ui.js"></script>
<!-- Then modules that depend on above -->
<script src="/static/js/chat.js"></script>
<!-- Finally, initialization -->
<script src="/static/js/init.js"></script>
```

### Issue: Styles not applied

**Problem:** CSS file not loaded or missing.

**Fix:** Check in browser DevTools:
1. Network tab → verify CSS files load (200 status)
2. Elements tab → check computed styles
3. Console → look for CSS parsing errors

### Issue: Module conflicts

**Problem:** Global variables colliding.

**Fix:** Wrap modules in IIFE (Immediately Invoked Function Expression):
```javascript
(function() {
  'use strict';
  
  // Your code here - isolated scope
  function privateFunction() { }
  
  window.publicFunction = publicFunction;  // Export if needed
})();
```

## Browser Support

The split version supports the same browsers as the original:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Performance Considerations

### Before (monolith):
- Single 3,500-line file
- Parse time: ~150ms
- Network: 1 request

### After (split):
- 14 JS files (~2,500 lines total)
- Parse time: ~100ms (better, smaller files)
- Network: 14 requests (parallelize better with HTTP/2)

For production, you might want to bundle:
```bash
# Concatenate JS files (maintain order!)
cat static/js/constants.js \
    static/js/crypto.js \
    static/js/ui.js \
    static/js/themes.js \
    static/js/profile.js \
    static/js/chat.js \
    static/js/voice.js \
    static/js/stories.js \
    static/js/polls.js \
    static/js/gif.js \
    static/js/socket-handlers.js \
    static/js/call-handlers.js \
    static/js/init.js > static/js/bundle.js

# Then minify
terser static/js/bundle.js -o static/js/bundle.min.js
```

Update `index.html` to use bundle:
```html
<!-- In production: -->
<script src="/static/js/bundle.min.js"></script>

<!-- In development: -->
<script src="/static/js/constants.js"></script>
<!-- ... individual files ... -->
```

## Rollback

If you need to go back to the monolith:

```bash
cp templates/index.html.backup templates/index.html
```

Then restart Flask.

## Troubleshooting

**Q: App loads but nothing works**
- Check browser console for errors
- Verify all JS files loaded (Network tab)
- Check localStorage isn't full

**Q: Styles look broken**
- Check CSS files loaded
- Verify theme CSS variables in DevTools
- Clear browser cache (Ctrl+Shift+R)

**Q: Socket.IO not connecting**
- Check socket initialization in `socket-handlers.js`
- Verify server has SocketIO enabled
- Check firewall/proxy settings

**Q: Module not found**
- Verify file in `static/js/` exists
- Check spelling in `<script src="">` tag
- Ensure module loads before dependent modules

## Support

For issues during migration:
1. Check `STRUCTURE.md` for file organization
2. Review corresponding module in `static/js/`
3. Check DevTools Console for error messages
4. Compare with backup `templates/index.html.backup`
