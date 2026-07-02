/**
 * init.js
 * Main app initialization - called after all modules load
 * 
 * Responsibilities:
 * 1. Set up viewport height
 * 2. Initialize encryption
 * 3. Load user profile
 * 4. Connect WebSocket
 * 5. Load initial data
 * 6. Set default theme
 */

/**
 * Set CSS custom property for viewport height
 * Helps with mobile viewport issues
 */
function setVH() {
  document.documentElement.style.setProperty(
    '--vh',
    (window.innerHeight * 0.01) + 'px'
  );
}

/**
 * Main initialization sequence
 */
async function initializeApp() {
  console.log('🚀 Initializing Chatly...');
  
  try {
    // 1. Set viewport height
    setVH();
    window.addEventListener('resize', setVH);
    
    // 2. Initialize encryption keys
    console.log('Initializing encryption...');
    await initKeys();
    
    // 3. Set up theme from storage
    console.log('Loading theme...');
    initAppTheme();
    
    // 4. Load user profile
    console.log('Loading profile...');
    await loadProfile();
    
    // 5. Connect WebSocket
    console.log('Connecting socket...');
    socket.connect();
    
    // 6. Load initial contacts/chats
    console.log('Loading contacts...');
    await renderTab();
    
    // 7. Initialize navigation glider position
    requestAnimationFrame(() => {
      moveNavGlider(document.getElementById('navChatsTab'));
    });
    
    console.log('✓ Chatly ready!');
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    showToast('Failed to load app');
  }
}

/**
 * Listen for navigation changes to update glider
 */
window.addEventListener('resize', () => {
  const active = document.querySelector('.bottom-nav-pill .tab.active');
  if (active) moveNavGlider(active);
});

/**
 * Handle browser back button
 */
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

/**
 * Start app when DOM is ready and all modules loaded
 */
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initializeApp();
} else {
  window.addEventListener('DOMContentLoaded', initializeApp);
}

console.log('✓ Init module loaded');
