// Per-device random key stored in localStorage.
// Protects against: offline analysis of exported localStorage backups (different devices have different keys).
// Does NOT protect against: local attacker with access to this browser session.
// For production deployments, use backend-stored auth tokens instead of client-side passwords.

const KEY_STORAGE = 'redivue_enc_key'
const LEGACY_KEY = 'redivue_secure_2024'
const FORMAT_PREFIX = 'rv1:'

function getDeviceKey(): string {
  try {
    const stored = localStorage.getItem(KEY_STORAGE)
    if (stored) return atob(stored)
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const binaryStr = Array.from(bytes, b => String.fromCharCode(b)).join('')
    localStorage.setItem(KEY_STORAGE, btoa(binaryStr))
    return binaryStr
  } catch {
    return LEGACY_KEY
  }
}

function xor(text: string, key: string): string {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return result
}

export function encryptPassword(password: string | null): string | null {
  if (password == null) return null
  try {
    return FORMAT_PREFIX + btoa(xor(password, getDeviceKey()))
  } catch {
    return password
  }
}

export function decryptPassword(encrypted: string | null): string | null {
  if (!encrypted) return null
  try {
    if (encrypted.startsWith(FORMAT_PREFIX)) {
      return xor(atob(encrypted.slice(FORMAT_PREFIX.length)), getDeviceKey())
    }
    // Legacy format: base64 XOR with hardcoded key — migrate transparently
    return xor(atob(encrypted), LEGACY_KEY)
  } catch {
    return null
  }
}

export function isEncrypted(password: string | null): boolean {
  if (!password) return false
  if (password.startsWith(FORMAT_PREFIX)) return true
  // Legacy format is base64 — require well-formed base64 (charset + padding), since
  // atob() is too permissive on its own and accepts most short plaintext strings.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(password) || password.length % 4 !== 0) return false
  try { atob(password); return true } catch { return false }
}
