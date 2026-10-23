import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface VaultProfile {
  name: string;
  domain?: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  secrets: Record<string, string>;
  storageState?: Record<string, unknown>;
  updatedAt: string;
}

interface VaultData {
  version: 1;
  profiles: Record<string, VaultProfile>;
}

const ALGORITHM = 'aes-256-gcm';

/**
 * Local AES-256-GCM Encrypted Session & Secret Vault.
 * Stores per-site cookies, auth headers, secrets, and Playwright storageState locally on disk.
 */
export class SessionVault {
  private readonly vaultDir: string;
  private readonly vaultFile: string;
  private readonly keyFile: string;

  constructor(baseDir: string = process.cwd()) {
    this.vaultDir = path.join(baseDir, '.openact');
    this.vaultFile = path.join(this.vaultDir, 'vault.enc.json');
    this.keyFile = path.join(this.vaultDir, 'vault.key');
  }

  private ensureKey(): Buffer {
    const envSecret = process.env.OPENACT_VAULT_KEY;
    if (envSecret) {
      return crypto.scryptSync(envSecret, 'openact-vault-salt-v1', 32);
    }

    if (!fs.existsSync(this.vaultDir)) {
      fs.mkdirSync(this.vaultDir, { recursive: true, mode: 0o700 });
    }

    if (fs.existsSync(this.keyFile)) {
      const hex = fs.readFileSync(this.keyFile, 'utf8').trim();
      return Buffer.from(hex, 'hex');
    }

    const randomKey = crypto.randomBytes(32);
    fs.writeFileSync(this.keyFile, randomKey.toString('hex'), { mode: 0o600 });
    return randomKey;
  }

  private readVaultData(): VaultData {
    if (!fs.existsSync(this.vaultFile)) {
      return { version: 1, profiles: {} };
    }

    try {
      const raw = JSON.parse(fs.readFileSync(this.vaultFile, 'utf8')) as {
        iv: string;
        tag: string;
        ciphertext: string;
      };
      const key = this.ensureKey();
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(raw.iv, 'hex')
      );
      decipher.setAuthTag(Buffer.from(raw.tag, 'hex'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(raw.ciphertext, 'hex')),
        decipher.final(),
      ]);
      return JSON.parse(decrypted.toString('utf8')) as VaultData;
    } catch {
      return { version: 1, profiles: {} };
    }
  }

  private writeVaultData(data: VaultData): void {
    if (!fs.existsSync(this.vaultDir)) {
      fs.mkdirSync(this.vaultDir, { recursive: true, mode: 0o700 });
    }
    const key = this.ensureKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload = {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      ciphertext: encrypted.toString('hex'),
    };
    fs.writeFileSync(this.vaultFile, JSON.stringify(payload, null, 2), {
      mode: 0o600,
    });
  }

  public listProfiles(): Array<{
    name: string;
    domain?: string;
    headerKeys: string[];
    cookieKeys: string[];
    secretKeys: string[];
    hasStorageState: boolean;
    updatedAt: string;
  }> {
    const data = this.readVaultData();
    return Object.values(data.profiles).map((p) => ({
      name: p.name,
      domain: p.domain,
      headerKeys: Object.keys(p.headers),
      cookieKeys: Object.keys(p.cookies),
      secretKeys: Object.keys(p.secrets),
      hasStorageState: Boolean(p.storageState),
      updatedAt: p.updatedAt,
    }));
  }

  public getProfile(name: string): VaultProfile | undefined {
    const data = this.readVaultData();
    return data.profiles[name];
  }

  public upsertProfile(
    name: string,
    partial: {
      domain?: string;
      headers?: Record<string, string>;
      cookies?: Record<string, string>;
      secrets?: Record<string, string>;
      storageState?: Record<string, unknown>;
    }
  ): VaultProfile {
    const data = this.readVaultData();
    const existing = data.profiles[name] ?? {
      name,
      headers: {},
      cookies: {},
      secrets: {},
      updatedAt: new Date().toISOString(),
    };

    const updated: VaultProfile = {
      name,
      domain: partial.domain ?? existing.domain,
      headers: { ...existing.headers, ...(partial.headers ?? {}) },
      cookies: { ...existing.cookies, ...(partial.cookies ?? {}) },
      secrets: { ...existing.secrets, ...(partial.secrets ?? {}) },
      storageState: partial.storageState ?? existing.storageState,
      updatedAt: new Date().toISOString(),
    };

    data.profiles[name] = updated;
    this.writeVaultData(data);
    return updated;
  }

  public deleteProfile(name: string): boolean {
    const data = this.readVaultData();
    if (!data.profiles[name]) return false;
    delete data.profiles[name];
    this.writeVaultData(data);
    return true;
  }

  /**
   * Builds merged request headers (including Cookie string) for a given VaultProfile.
   */
  public getRequestHeaders(profileName?: string): Record<string, string> {
    if (!profileName) return {};
    const profile = this.getProfile(profileName);
    if (!profile) return {};

    const headers: Record<string, string> = { ...profile.headers };
    const cookiePairs = Object.entries(profile.cookies).map(
      ([k, v]) => `${k}=${v}`
    );
    if (cookiePairs.length > 0) {
      headers.Cookie = headers.Cookie
        ? `${headers.Cookie}; ${cookiePairs.join('; ')}`
        : cookiePairs.join('; ');
    }
    return headers;
  }

  /**
   * Flattens secrets across 'default' and an optional specific profile for `{{vault.*}}` interpolation.
   */
  public getMergedSecrets(profileName?: string): Record<string, string> {
    const data = this.readVaultData();
    const defaults = data.profiles.default?.secrets ?? {};
    const specific = profileName ? (data.profiles[profileName]?.secrets ?? {}) : {};
    return { ...defaults, ...specific };
  }
}
