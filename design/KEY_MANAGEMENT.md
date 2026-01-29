# Key Management

**Status:** ACTIVE
**Version:** 1.0
**Last Updated:** 2026-01-29

This document specifies how meao handles encryption keys: generation, storage, rotation, and migration.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      KEY HIERARCHY                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  USER INPUT                                                         │
│  ──────────                                                          │
│  Passphrase (user remembers)   OR   OS Keychain (user unlocks)     │
│                    │                        │                        │
│                    ▼                        ▼                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    KEY ENCRYPTION KEY (KEK)                  │   │
│  │                                                              │   │
│  │  Derived from passphrase (Argon2id)                         │   │
│  │  OR retrieved from OS keychain                               │   │
│  │                                                              │   │
│  │  NEVER stored on disk in plaintext                          │   │
│  │  Lives in memory only during runtime                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              │ encrypts                             │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   DATA ENCRYPTION KEYS (DEK)                 │   │
│  │                                                              │   │
│  │  credentials.dek  - API keys, tokens                        │   │
│  │  backup.dek       - Backup files                            │   │
│  │  memory.dek       - Sensitive memory (if encrypted)         │   │
│  │                                                              │   │
│  │  Stored on disk, encrypted by KEK                           │   │
│  │  256-bit random, AES-256-GCM                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              │ encrypts                             │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      PROTECTED DATA                          │   │
│  │                                                              │   │
│  │  credentials.enc  - Encrypted credentials                   │   │
│  │  backup.enc       - Encrypted backup                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Key Types

| Key | Purpose | Generation | Storage | Rotation |
|-----|---------|------------|---------|----------|
| KEK | Wraps DEKs | Argon2id from passphrase OR random in keychain | Memory only (or OS keychain) | On passphrase change |
| credentials.dek | Encrypts API keys | Random 256-bit | Encrypted file | On compromise |
| backup.dek | Encrypts backups | Random 256-bit | Encrypted file | Per backup (optional) |
| memory.dek | Encrypts sensitive memory | Random 256-bit | Encrypted file | On demand |

---

## KEK Derivation

### Option A: Passphrase-Derived (Default)

User provides a passphrase, KEK is derived using Argon2id:

```typescript
interface KDFConfig {
  algorithm: 'argon2id'
  // OWASP recommended minimum for sensitive data
  memoryCost: 65536      // 64 MB
  timeCost: 3            // 3 iterations
  parallelism: 4         // 4 threads
  hashLength: 32         // 256-bit key
}

async function deriveKEK(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  return argon2id.hash(passphrase, {
    salt,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
    hashLength: 32,
  })
}
```

**Salt storage:**

```
~/.meao/
└── keys/
    └── kek.salt           # Random 16 bytes, stored plaintext
```

**Security properties:**
- Passphrase never stored
- Salt unique per installation
- Argon2id resistant to GPU/ASIC attacks
- KEK lives in memory only

### Option B: OS Keychain

For users who prefer not to enter a passphrase:

```typescript
interface KeychainConfig {
  service: 'meao'
  account: 'kek'
}

// macOS: Keychain Access
// Windows: Windows Credential Manager
// Linux: Secret Service API (gnome-keyring, KWallet)

async function getKEKFromKeychain(): Promise<Uint8Array | null> {
  try {
    const stored = await keytar.getPassword('meao', 'kek')
    return stored ? Buffer.from(stored, 'base64') : null
  } catch {
    return null
  }
}

async function storeKEKInKeychain(kek: Uint8Array): Promise<void> {
  await keytar.setPassword('meao', 'kek', Buffer.from(kek).toString('base64'))
}
```

**Security properties:**
- KEK stored in OS-protected storage
- Unlocked when user logs in to OS
- Hardware-backed on some platforms (macOS Secure Enclave, TPM)

### Configuration

User chooses during setup:

```json
{
  "keyManagement": {
    "kekSource": "passphrase",    // or "keychain"
    "kdfConfig": {
      "memoryCost": 65536,
      "timeCost": 3,
      "parallelism": 4
    }
  }
}
```

---

## DEK Management

### Generation

```typescript
async function generateDEK(): Promise<Uint8Array> {
  // Cryptographically secure random
  return crypto.randomBytes(32)  // 256 bits
}
```

### Storage

DEKs are encrypted by KEK and stored on disk:

```typescript
interface EncryptedDEK {
  // Encrypted DEK
  ciphertext: Uint8Array
  // AES-GCM nonce
  iv: Uint8Array
  // AES-GCM auth tag
  tag: Uint8Array
  // Metadata
  version: number
  createdAt: string
}

async function encryptDEK(dek: Uint8Array, kek: Uint8Array): Promise<EncryptedDEK> {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv)

  const ciphertext = Buffer.concat([
    cipher.update(dek),
    cipher.final()
  ])

  return {
    ciphertext,
    iv,
    tag: cipher.getAuthTag(),
    version: 1,
    createdAt: new Date().toISOString(),
  }
}

async function decryptDEK(encrypted: EncryptedDEK, kek: Uint8Array): Promise<Uint8Array> {
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, encrypted.iv)
  decipher.setAuthTag(encrypted.tag)

  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final()
  ])
}
```

### File Structure

```
~/.meao/
└── keys/
    ├── kek.salt              # Salt for passphrase derivation
    ├── credentials.dek.enc   # Encrypted credentials DEK
    ├── backup.dek.enc        # Encrypted backup DEK
    └── memory.dek.enc        # Encrypted memory DEK (optional)
```

---

## Data Encryption

Using DEKs to encrypt actual data:

```typescript
interface EncryptedData {
  ciphertext: Uint8Array
  iv: Uint8Array
  tag: Uint8Array
  dekId: string            // Which DEK was used
  version: number
}

async function encryptData(data: Uint8Array, dek: Uint8Array, dekId: string): Promise<EncryptedData> {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv)

  const ciphertext = Buffer.concat([
    cipher.update(data),
    cipher.final()
  ])

  return {
    ciphertext,
    iv,
    tag: cipher.getAuthTag(),
    dekId,
    version: 1,
  }
}

async function decryptData(encrypted: EncryptedData, dek: Uint8Array): Promise<Uint8Array> {
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, encrypted.iv)
  decipher.setAuthTag(encrypted.tag)

  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final()
  ])
}
```

---

## Credential Storage

```typescript
interface CredentialStore {
  // Encrypt and store a credential
  set(name: string, value: string): Promise<void>

  // Retrieve and decrypt a credential
  get(name: string): Promise<string | null>

  // List credential names (not values)
  list(): Promise<string[]>

  // Delete a credential
  delete(name: string): Promise<void>
}

// Implementation
class EncryptedCredentialStore implements CredentialStore {
  private dek: Uint8Array | null = null
  private path = path.join(MEAO_DIR, 'credentials.enc')

  async unlock(kek: Uint8Array): Promise<void> {
    const encryptedDek = await this.loadEncryptedDEK('credentials')
    this.dek = await decryptDEK(encryptedDek, kek)
  }

  async set(name: string, value: string): Promise<void> {
    if (!this.dek) throw new Error('Store not unlocked')

    const data = await this.loadAll()
    data[name] = value

    const encrypted = await encryptData(
      Buffer.from(JSON.stringify(data)),
      this.dek,
      'credentials'
    )

    await fs.writeFile(this.path, JSON.stringify(encrypted))
  }

  async get(name: string): Promise<string | null> {
    if (!this.dek) throw new Error('Store not unlocked')

    const data = await this.loadAll()
    return data[name] ?? null
  }

  lock(): void {
    // Wipe DEK from memory
    if (this.dek) {
      crypto.randomFillSync(this.dek)
      this.dek = null
    }
  }
}
```

---

## Key Rotation

### Passphrase Change

When user changes their passphrase:

```typescript
async function rotatePassphrase(oldPassphrase: string, newPassphrase: string): Promise<void> {
  // 1. Derive old KEK
  const salt = await fs.readFile(path.join(MEAO_DIR, 'keys/kek.salt'))
  const oldKek = await deriveKEK(oldPassphrase, salt)

  // 2. Decrypt all DEKs with old KEK
  const credentialsDek = await decryptDEK(await loadEncryptedDEK('credentials'), oldKek)
  const backupDek = await decryptDEK(await loadEncryptedDEK('backup'), oldKek)
  const memoryDek = await decryptDEK(await loadEncryptedDEK('memory'), oldKek)

  // 3. Generate new salt and derive new KEK
  const newSalt = crypto.randomBytes(16)
  const newKek = await deriveKEK(newPassphrase, newSalt)

  // 4. Re-encrypt DEKs with new KEK
  await saveEncryptedDEK('credentials', await encryptDEK(credentialsDek, newKek))
  await saveEncryptedDEK('backup', await encryptDEK(backupDek, newKek))
  await saveEncryptedDEK('memory', await encryptDEK(memoryDek, newKek))

  // 5. Save new salt
  await fs.writeFile(path.join(MEAO_DIR, 'keys/kek.salt'), newSalt)

  // 6. Wipe old keys from memory
  crypto.randomFillSync(oldKek)
  crypto.randomFillSync(credentialsDek)
  crypto.randomFillSync(backupDek)
  crypto.randomFillSync(memoryDek)

  // 7. Audit log
  await audit.log({ action: 'passphrase_rotated', timestamp: new Date() })
}
```

### DEK Rotation (Compromise Response)

If a DEK might be compromised:

```typescript
async function rotateDEK(dekId: string, kek: Uint8Array): Promise<void> {
  // 1. Generate new DEK
  const newDek = await generateDEK()

  // 2. Decrypt all data with old DEK
  const oldEncryptedDek = await loadEncryptedDEK(dekId)
  const oldDek = await decryptDEK(oldEncryptedDek, kek)
  const data = await decryptAllData(dekId, oldDek)

  // 3. Re-encrypt all data with new DEK
  await encryptAllData(dekId, data, newDek)

  // 4. Encrypt and save new DEK
  await saveEncryptedDEK(dekId, await encryptDEK(newDek, kek))

  // 5. Wipe old keys
  crypto.randomFillSync(oldDek)
  crypto.randomFillSync(newDek)

  // 6. Audit
  await audit.log({ action: 'dek_rotated', dekId, timestamp: new Date() })
}
```

---

## Device Migration

Moving meao to a new device:

### Export for Migration

```typescript
interface MigrationBundle {
  version: number

  // All DEKs, encrypted by a migration-specific key
  encryptedDeks: {
    credentials: EncryptedDEK
    backup: EncryptedDEK
    memory: EncryptedDEK
  }

  // All protected data
  encryptedData: {
    credentials: EncryptedData
    // Memory and other data as needed
  }

  // Salt for migration passphrase
  migrationSalt: Uint8Array

  // Checksum
  checksum: string
}

async function exportForMigration(
  kek: Uint8Array,
  migrationPassphrase: string
): Promise<MigrationBundle> {
  // 1. Derive migration KEK from migration passphrase
  const migrationSalt = crypto.randomBytes(16)
  const migrationKek = await deriveKEK(migrationPassphrase, migrationSalt)

  // 2. Decrypt DEKs with current KEK
  const credentialsDek = await decryptDEK(await loadEncryptedDEK('credentials'), kek)
  const backupDek = await decryptDEK(await loadEncryptedDEK('backup'), kek)
  const memoryDek = await decryptDEK(await loadEncryptedDEK('memory'), kek)

  // 3. Re-encrypt DEKs with migration KEK
  const bundle: MigrationBundle = {
    version: 1,
    encryptedDeks: {
      credentials: await encryptDEK(credentialsDek, migrationKek),
      backup: await encryptDEK(backupDek, migrationKek),
      memory: await encryptDEK(memoryDek, migrationKek),
    },
    encryptedData: {
      credentials: await loadEncryptedData('credentials'),
    },
    migrationSalt,
    checksum: '', // Filled below
  }

  // 4. Calculate checksum
  bundle.checksum = crypto
    .createHash('sha256')
    .update(JSON.stringify({ ...bundle, checksum: '' }))
    .digest('hex')

  // 5. Wipe keys from memory
  crypto.randomFillSync(credentialsDek)
  crypto.randomFillSync(backupDek)
  crypto.randomFillSync(memoryDek)
  crypto.randomFillSync(migrationKek)

  return bundle
}
```

### Import on New Device

```typescript
async function importFromMigration(
  bundle: MigrationBundle,
  migrationPassphrase: string,
  newPassphrase: string
): Promise<void> {
  // 1. Verify checksum
  const expectedChecksum = crypto
    .createHash('sha256')
    .update(JSON.stringify({ ...bundle, checksum: '' }))
    .digest('hex')

  if (bundle.checksum !== expectedChecksum) {
    throw new Error('Migration bundle corrupted')
  }

  // 2. Derive migration KEK
  const migrationKek = await deriveKEK(migrationPassphrase, bundle.migrationSalt)

  // 3. Decrypt DEKs
  const credentialsDek = await decryptDEK(bundle.encryptedDeks.credentials, migrationKek)
  const backupDek = await decryptDEK(bundle.encryptedDeks.backup, migrationKek)
  const memoryDek = await decryptDEK(bundle.encryptedDeks.memory, migrationKek)

  // 4. Generate new salt and derive new KEK for this device
  const newSalt = crypto.randomBytes(16)
  const newKek = await deriveKEK(newPassphrase, newSalt)

  // 5. Re-encrypt DEKs with new KEK
  await saveEncryptedDEK('credentials', await encryptDEK(credentialsDek, newKek))
  await saveEncryptedDEK('backup', await encryptDEK(backupDek, newKek))
  await saveEncryptedDEK('memory', await encryptDEK(memoryDek, newKek))

  // 6. Save new salt
  await fs.writeFile(path.join(MEAO_DIR, 'keys/kek.salt'), newSalt)

  // 7. Import encrypted data files
  await fs.writeFile(
    path.join(MEAO_DIR, 'credentials.enc'),
    JSON.stringify(bundle.encryptedData.credentials)
  )

  // 8. Wipe keys from memory
  crypto.randomFillSync(migrationKek)
  crypto.randomFillSync(credentialsDek)
  crypto.randomFillSync(backupDek)
  crypto.randomFillSync(memoryDek)
  crypto.randomFillSync(newKek)

  // 9. Audit
  await audit.log({ action: 'migration_imported', timestamp: new Date() })
}
```

---

## CLI Commands

```bash
# Initial setup
meao keys init                      # Interactive: choose passphrase or keychain
meao keys init --passphrase         # Use passphrase
meao keys init --keychain           # Use OS keychain

# Passphrase operations
meao keys change-passphrase         # Interactive passphrase change
meao keys verify                    # Verify current passphrase works

# Migration
meao keys export                    # Create migration bundle (interactive)
meao keys import <file>             # Import migration bundle (interactive)

# Status
meao keys status                    # Show key configuration (no secrets)

# Emergency
meao keys rotate credentials        # Rotate credentials DEK (if compromised)
```

---

## Implementation Notes

### AAD (Associated Authenticated Data)

Bind ciphertext to its context to prevent mix-and-match attacks:

```typescript
interface EncryptedDEK {
  ciphertext: Uint8Array
  iv: Uint8Array
  tag: Uint8Array
  version: number
  createdAt: string
  dekId: string           // Which DEK this is
}

async function encryptDEK(
  dek: Uint8Array,
  kek: Uint8Array,
  dekId: string,
  userId?: string
): Promise<EncryptedDEK> {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv)

  // AAD binds ciphertext to context - prevents wrong blob decrypted with right key
  const aad = Buffer.from(JSON.stringify({
    dekId,
    userId: userId ?? 'owner',
    version: 1,
  }))
  cipher.setAAD(aad)

  const ciphertext = Buffer.concat([
    cipher.update(dek),
    cipher.final()
  ])

  return {
    ciphertext,
    iv,
    tag: cipher.getAuthTag(),
    version: 1,
    createdAt: new Date().toISOString(),
    dekId,
  }
}

async function decryptDEK(
  encrypted: EncryptedDEK,
  kek: Uint8Array,
  userId?: string
): Promise<Uint8Array> {
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, encrypted.iv)

  // Must match AAD used during encryption
  const aad = Buffer.from(JSON.stringify({
    dekId: encrypted.dekId,
    userId: userId ?? 'owner',
    version: encrypted.version,
  }))
  decipher.setAAD(aad)
  decipher.setAuthTag(encrypted.tag)

  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final()
  ])
}
```

### Canonical Serialization

JSON stringification is unstable across platforms. Use canonical form for checksums:

```typescript
import canonicalize from 'canonicalize'  // RFC 8785

function computeBundleChecksum(bundle: MigrationBundle): string {
  // Remove checksum field, canonicalize, then hash
  const { checksum, ...rest } = bundle
  const canonical = canonicalize(rest)  // Deterministic JSON
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

// For binary formats, use MessagePack or CBOR with deterministic mode
```

### Memory Wiping Caveat

**Best effort only.** In JavaScript/Node.js, memory wiping is not guaranteed due to:
- String interning
- V8 garbage collection
- Buffer copies during operations

Mitigations:
- Keep secrets in `Buffer` or `crypto.KeyObject`, never convert to string
- Overwrite buffers immediately after use
- Use short-lived processes for sensitive operations where possible

```typescript
// GOOD: Use Buffer, wipe after use
const dek = Buffer.alloc(32)
crypto.randomFillSync(dek)
// ... use dek ...
crypto.randomFillSync(dek)  // Overwrite

// BAD: Converting to string creates copies we can't wipe
const dekString = dek.toString('hex')  // AVOID
```

### Multi-User Key Directories

For multi-user support, scope key storage per user:

```
~/.meao/
├── keys/                           # Owner keys (backward compat)
│   ├── kek.salt
│   └── credentials.dek.enc
└── users/
    ├── user-123/
    │   └── keys/
    │       ├── kek.salt
    │       └── credentials.dek.enc
    └── user-456/
        └── keys/
            └── ...
```

One user's unlock never decrypts another's vault.

### File Permissions

```bash
# Key directory and files must be owner-only
chmod 700 ~/.meao/keys
chmod 600 ~/.meao/keys/*

# Verify on startup
if (stat.mode & 0o077) !== 0:
  throw SecurityError('Key files have insecure permissions')
```

---

## Security Considerations

### Memory Handling

```typescript
// After using any key:
crypto.randomFillSync(key)  // Overwrite with random bytes (best effort)

// Use secure buffers where available:
const secureBuffer = crypto.createSecretKey(key)
// Node.js will attempt to prevent swapping
```

### Passphrase Requirements

```typescript
interface PassphrasePolicy {
  minLength: 12           // Minimum 12 characters
  maxLength: 128          // Prevent DoS
  requireMixedCase: false // Not required (length > complexity)
  requireNumbers: false   // Not required
  requireSymbols: false   // Not required
  // Encourage passphrases, not passwords
}

function validatePassphrase(passphrase: string): ValidationResult {
  if (passphrase.length < 12) {
    return { valid: false, reason: 'Passphrase must be at least 12 characters' }
  }

  // Warn about weak passphrases
  if (isCommonPassword(passphrase)) {
    return { valid: false, reason: 'Passphrase is too common' }
  }

  return { valid: true }
}
```

### Audit Trail

All key operations are logged:

```typescript
interface KeyAuditEntry {
  action:
    | 'keys_initialized'
    | 'passphrase_rotated'
    | 'dek_rotated'
    | 'migration_exported'
    | 'migration_imported'
    | 'unlock_success'
    | 'unlock_failure'

  timestamp: Date

  // Metadata (never includes actual keys or passphrases)
  metadata?: {
    dekId?: string
    kekSource?: 'passphrase' | 'keychain'
  }
}
```

---

## Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Passphrase brute force | Argon2id with high memory cost |
| Memory dump | Keys wiped after use |
| Stolen encrypted file | Useless without KEK |
| Keylogger captures passphrase | OS keychain option |
| Device theft | Passphrase required to unlock |
| Backup exposure | Separate backup.dek, migration uses temp key |

---

## Implementation Checklist

```
[ ] Argon2id integration (node-argon2 or similar)
[ ] OS keychain integration (keytar)
[ ] AES-256-GCM encryption/decryption
[ ] Secure memory wiping
[ ] CLI commands for key management
[ ] Migration bundle format
[ ] Passphrase validation
[ ] Audit logging for key operations
```

---

*This specification is living documentation. Update as security requirements evolve.*

*Last updated: 2026-01-29*
