export interface EncryptedPayload {
  iv: string
  tag: string
  content: string
  aad: string
}

export interface OpalV1Header {
  v: 1
  kdf: 'HKDF-SHA256'
  salt: string
  keyId: string
}

export interface OpalV1File {
  header: OpalV1Header
  payload: EncryptedPayload
}
