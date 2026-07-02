/**
 * constants.js
 * Global constants, API keys, configuration
 */

// Cloudinary setup
const CLOUD = 'ddgmbuhg9';
const PRESET = 'chatly_upload';
const GIPHY_API_KEY = 'GlVGYHk3VVVWVN155555555555555555';

// Current user (set by server in template, with static fallback for GitHub Pages/static rendering)
let me = window.CHATLY_USER_ID || "{{ user_id }}";
if (me.startsWith('{{') || !me) {
  me = localStorage.getItem('chatly_user_id') || 'user_' + Math.random().toString(36).substring(2, 9);
  localStorage.setItem('chatly_user_id', me);
}

// App Globals that were previously undeclared in the monolith
let currentChat = null;
let onlineUsers = new Set();
let currentTab = 'contactsScreen';

// Socket.IO instance
const socket = io({ autoConnect: false });

// Feature flags
const FEATURES = {
  VOICE_CALLS: true,
  STORIES: true,
  POLLS: true,
  GIFS: true,
  FILE_SHARING: true,
  DISAPPEARING_MESSAGES: true,
};

// Reaction emojis
const EMOJIS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];

// Timeout settings (ms)
const TIMEOUTS = {
  TYPING_INDICATOR: 1500,
  TOAST: 2500,
  CALL_RING: 30000,
  VOICE_MIN_LENGTH: 500,
  STORY_DURATION: 5000,
  INPUT_DEBOUNCE: 500,
};

// Size limits
const LIMITS = {
  FILE_MAX_MB: 100,
  VOICE_MAX_MB: 50,
  MESSAGE_MAX_CHARS: 5000,
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
};

// Color presets
const COLOR_PRESETS = {
  blue: '#4f8ef7',
  violet: '#a78bfa',
  red: '#ff2200',
  pink: '#ff007f',
  green: '#22c55e',
};

const VALID_THEMES = Object.keys(COLOR_PRESETS);
const VALID_MODES = ['light', 'dark'];
const VALID_GLOW = ['off', 'mild', 'strong'];

// Local storage keys
const STORAGE_KEYS = {
  PRIVATE_KEY: 'privkey_',
  PUBLIC_KEY: 'pubkey_',
  THEME_MODE: 'chatly_theme_mode',
  THEME_COLOR: 'chatly_theme_color',
  THEME_GLOW: 'chatly_theme_glow_val',
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CLOUD,
    PRESET,
    GIPHY_API_KEY,
    FEATURES,
    EMOJIS,
    TIMEOUTS,
    LIMITS,
    COLOR_PRESETS,
    VALID_THEMES,
    VALID_MODES,
    VALID_GLOW,
    STORAGE_KEYS,
  };
}
