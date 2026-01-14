import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV (NIST Recommended for GCM)

export interface EncryptedPayload {
  iv: string;
  tag: string;
  content: string;
  aad: string;
}

export class Cipher {
  /**
   * Encrypts plaintext using AES-256-GCM with AAD context binding.
   */
  static encrypt(text: string, masterKey: Buffer, context: string): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, masterKey, iv);

    // AAD: Context Binding (Prevent Cross-App Replay)
    cipher.setAAD(Buffer.from(context, 'utf8'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      content: encrypted,
      aad: context,
    };
  }

  /**
   * Decrypts payload using AES-256-GCM with AAD verification.
   * Throws if AAD context doesn't match or integrity check fails.
   */
  static decrypt(payload: EncryptedPayload, masterKey: Buffer, expectedContext: string): string {
    if (payload.aad !== expectedContext) {
      throw new Error(
        `Opal: Context Mismatch. Data belongs to '${payload.aad}', expected '${expectedContext}'`
      );
    }

    const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(payload.iv, 'hex'));

    decipher.setAAD(Buffer.from(payload.aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

    let decrypted = decipher.update(payload.content, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
