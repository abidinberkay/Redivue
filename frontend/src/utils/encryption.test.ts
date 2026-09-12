import { encryptPassword, decryptPassword, isEncrypted } from './encryption'

describe('Password Encryption', () => {
  it('encrypts and decrypts password correctly', () => {
    const password = 'mySecretPassword123'
    const encrypted = encryptPassword(password)
    const decrypted = decryptPassword(encrypted)
    expect(decrypted).toBe(password)
  })

  it('handles null passwords', () => {
    expect(encryptPassword(null)).toBeNull()
    expect(decryptPassword(null)).toBeNull()
  })

  it('detects encrypted passwords', () => {
    const password = 'test123'
    const encrypted = encryptPassword(password)
    expect(isEncrypted(encrypted)).toBe(true)
    expect(isEncrypted(password)).toBe(false)
  })

  it('does not return plaintext in encrypted form', () => {
    const password = 'secretPassword'
    const encrypted = encryptPassword(password)
    expect(encrypted).not.toBe(password)
    expect(encrypted).toBeDefined()
    expect(typeof encrypted).toBe('string')
  })

  it('handles special characters', () => {
    const password = 'P@ssw0rd!#$%&*()_+-=[]{}|;:,.<>?'
    const encrypted = encryptPassword(password)
    const decrypted = decryptPassword(encrypted)
    expect(decrypted).toBe(password)
  })

  it('handles empty string', () => {
    const encrypted = encryptPassword('')
    const decrypted = decryptPassword(encrypted)
    expect(decrypted).toBe('')
  })
})
