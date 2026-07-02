/**
 * crypto.js
 * End-to-end encryption using RSA-OAEP
 * 
 * Usage:
 *   initKeys()          - Initialize or load user's keypair
 *   getPubKey(user)     - Fetch public key of another user
 *   enc(key, text)      - Encrypt text with public key
 *   dec(cipher)         - Decrypt ciphertext with private key
 */

let myPrivateKey = null;
let myPublicKey = null;
let publicKeys = {};  // Cache of other users' public keys

/**
 * Initialize encryption keypair
 * Loads existing keys from localStorage or generates new ones
 */
async function initKeys() {
  const stored = localStorage.getItem(`privkey_${me}`);
  
  if (stored) {
    // Load existing keypair
    myPrivateKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(stored),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
    
    const pubS = localStorage.getItem(`pubkey_${me}`);
    if (pubS) {
      myPublicKey = await crypto.subtle.importKey(
        'jwk',
        JSON.parse(pubS),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['encrypt']
      );
      
      // Verify key is on server
      const chk = await fetch(`/pubkey/${me}`).then(r => r.json());
      if (!chk.key) {
        await fetch('/save_key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: pubS })
        });
      }
    }
  } else {
    // Generate new keypair
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true,  // extractable
      ['encrypt', 'decrypt']
    );
    
    myPrivateKey = pair.privateKey;
    myPublicKey = pair.publicKey;
    
    // Save to localStorage
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
    
    localStorage.setItem(`privkey_${me}`, JSON.stringify(priv));
    localStorage.setItem(`pubkey_${me}`, JSON.stringify(pub));
    
    // Upload public key to server
    let saved = false;
    while (!saved) {
      try {
        const r = await fetch('/save_key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: JSON.stringify(pub) })
        });
        if ((await r.json()).ok) saved = true;
      } catch (e) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  
  console.log('✓ Encryption keys initialized');
}

/**
 * Fetch public key of another user
 * Caches result to avoid repeated server calls
 * 
 * @param {string} username - User ID to fetch key for
 * @returns {Promise<CryptoKey|null>} - Public key object or null if not found
 */
async function getPubKey(username) {
  if (publicKeys[username]) {
    return publicKeys[username];
  }
  
  try {
    const d = await fetch(`/pubkey/${username}`).then(r => r.json());
    
    if (!d.key) {
      console.warn(`No public key found for ${username}`);
      return null;
    }
    
    const k = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(d.key),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
    
    publicKeys[username] = k;
    return k;
  } catch (error) {
    console.error(`Failed to get public key for ${username}:`, error);
    return null;
  }
}

/**
 * Encrypt text with a public key
 * 
 * @param {CryptoKey} key - Public key to encrypt with
 * @param {string} text - Plain text to encrypt
 * @returns {Promise<string>} - Base64-encoded ciphertext
 */
async function enc(key, text) {
  try {
    const b = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      key,
      new TextEncoder().encode(text)
    );
    return btoa(String.fromCharCode(...new Uint8Array(b)));
  } catch (error) {
    console.error('Encryption error:', error);
    throw error;
  }
}

/**
 * Decrypt ciphertext with private key
 * 
 * @param {string} cipher - Base64-encoded ciphertext
 * @returns {Promise<string>} - Decrypted plaintext, or '🔒' if decryption fails
 */
async function dec(cipher) {
  try {
    const b = Uint8Array.from(atob(cipher), c => c.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      myPrivateKey,
      b
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    console.error('Decryption error:', error);
    return '🔒';  // Fallback if decryption fails
  }
}

/**
 * Clear cached public keys (useful for logout)
 */
function clearKeyCache() {
  publicKeys = {};
  console.log('Public key cache cleared');
}

console.log('✓ Crypto module loaded');
