/**
 * themes.js
 * Theme and glow system configuration
 */

function setAppThemeMode(mode) {
  localStorage.setItem('chatly_theme_mode', mode);
  const pillOptions = document.querySelectorAll('#appearanceModePill .pill-option');
  if (pillOptions.length) {
    pillOptions.forEach(el => el.classList.remove('active'));
  }
  const btnLight = document.getElementById('btnModeLight');
  const btnDark = document.getElementById('btnModeDark');
  if (mode === 'light') {
    document.body.classList.add('mode-light');
    if (btnLight) btnLight.classList.add('active');
  } else {
    document.body.classList.remove('mode-light');
    if (btnDark) btnDark.classList.add('active');
  }
}

function setAppThemeColor(color) {
  localStorage.setItem('chatly_theme_color', color);
  document.body.classList.remove('theme-blue', 'theme-violet', 'theme-red', 'theme-pink', 'theme-green');
  document.body.classList.add('theme-' + color);
  
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
  const swatch = document.getElementById('swatch-' + color);
  if (swatch) swatch.classList.add('active');
  
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

function applyThemeColor(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-dark', color); 
}

async function setTheme(el, color) {
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
  if (el) el.classList.add('active');
  applyThemeColor(color);
  if (currentChat) {
    const cs = await fetch('/chat_settings/' + currentChat).then(r => r.json());
    await fetch('/update_chat_settings/' + currentChat, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ wallpaper_url: cs.wallpaper_url, disappear_timer: cs.disappear_timer, theme_color: color }) 
    });
  }
}

console.log('✓ Themes module loaded');
