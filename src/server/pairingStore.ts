import fs from 'fs';
import path from 'path';

export interface PairingRecord {
  code: string;
  status: 'pending' | 'paired';
  accessToken?: string;
  refreshToken?: string;
  username?: string;
  expiresAt?: number;
  createdAt: string;
  updatedAt: string;
}

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

const VALID_CODE_REGEX = /^[A-HJ-NP-Z2-9]{6}$/;

// In-memory cache supplements Firestore for local dev and ultra-fast repeat reads
const memoryPairings = new Map<string, PairingRecord>();

let cachedFirebaseConfig: FirebaseAppletConfig | null | undefined;

export function loadFirebaseConfig(): FirebaseAppletConfig | null {
  if (cachedFirebaseConfig !== undefined) return cachedFirebaseConfig;
  const candidatePaths = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(process.cwd(), 'public', 'firebase-applet-config.json'),
    path.resolve(process.cwd(), '..', 'firebase-applet-config.json')
  ];
  for (const filePath of candidatePaths) {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (parsed && parsed.projectId && parsed.apiKey && parsed.firestoreDatabaseId) {
          cachedFirebaseConfig = {
            projectId: parsed.projectId,
            apiKey: parsed.apiKey,
            firestoreDatabaseId: parsed.firestoreDatabaseId
          };
          return cachedFirebaseConfig;
        }
      }
    } catch {
      // Ignore parse errors and try next location
    }
  }
  cachedFirebaseConfig = null;
  return null;
}

export function isValidPairingCode(code: string): boolean {
  return typeof code === 'string' && VALID_CODE_REGEX.test(code.trim().toUpperCase());
}

export function generateSafePairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function encodeFirestorePairingFields(record: PairingRecord): Record<string, any> {
  const fields: Record<string, any> = {
    code: { stringValue: record.code },
    status: { stringValue: record.status },
    createdAt: { stringValue: record.createdAt },
    updatedAt: { stringValue: record.updatedAt }
  };
  if (record.accessToken) {
    fields.accessToken = { stringValue: record.accessToken.slice(0, 1024) };
  }
  if (record.refreshToken) {
    fields.refreshToken = { stringValue: record.refreshToken.slice(0, 1024) };
  }
  if (record.username) {
    fields.username = { stringValue: record.username.slice(0, 64) };
  }
  if (typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt)) {
    fields.expiresAt = { integerValue: String(Math.floor(record.expiresAt)) };
  }
  return fields;
}

export function decodeFirestorePairingDoc(doc: any): PairingRecord | null {
  if (!doc || !doc.fields) return null;
  const f = doc.fields;
  const code = f.code?.stringValue || '';
  const status = f.status?.stringValue === 'paired' ? 'paired' : 'pending';
  if (!isValidPairingCode(code)) return null;

  const record: PairingRecord = {
    code: code.toUpperCase(),
    status,
    createdAt: f.createdAt?.stringValue || new Date().toISOString(),
    updatedAt: f.updatedAt?.stringValue || new Date().toISOString()
  };
  if (f.accessToken?.stringValue) record.accessToken = f.accessToken.stringValue;
  if (f.refreshToken?.stringValue) record.refreshToken = f.refreshToken.stringValue;
  if (f.username?.stringValue) record.username = f.username.stringValue;
  if (f.expiresAt?.integerValue) record.expiresAt = Number(f.expiresAt.integerValue);
  return record;
}

function buildFirestoreDocUrl(cfg: FirebaseAppletConfig, code: string): string {
  const dbId = encodeURIComponent(cfg.firestoreDatabaseId);
  const projId = encodeURIComponent(cfg.projectId);
  return `https://firestore.googleapis.com/v1/projects/${projId}/databases/${dbId}/documents/pairings/${encodeURIComponent(code)}?key=${encodeURIComponent(cfg.apiKey)}`;
}

async function firestoreGetPairing(code: string): Promise<PairingRecord | null> {
  const cfg = loadFirebaseConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(buildFirestoreDocUrl(cfg, code), { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    return decodeFirestorePairingDoc(data);
  } catch {
    return null;
  }
}

async function firestoreUpsertPairing(record: PairingRecord, isCreate: boolean): Promise<boolean> {
  const cfg = loadFirebaseConfig();
  if (!cfg) return false;
  try {
    if (isCreate) {
      const dbId = encodeURIComponent(cfg.firestoreDatabaseId);
      const projId = encodeURIComponent(cfg.projectId);
      const createUrl =
        `https://firestore.googleapis.com/v1/projects/${projId}/databases/${dbId}/documents/pairings` +
        `?documentId=${encodeURIComponent(record.code)}&key=${encodeURIComponent(cfg.apiKey)}`;
      const res = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: encodeFirestorePairingFields(record) })
      });
      return res.ok;
    }

    const res = await fetch(buildFirestoreDocUrl(cfg, record.code), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: encodeFirestorePairingFields(record) })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createPairingRecord(username?: string): Promise<PairingRecord> {
  const code = generateSafePairingCode();
  const nowIso = new Date().toISOString();
  const record: PairingRecord = {
    code,
    status: 'pending',
    username: username ? username.trim().toLowerCase().slice(0, 64) : undefined,
    expiresAt: Date.now() + 30 * 60 * 1000,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  memoryPairings.set(code, record);
  await firestoreUpsertPairing(record, true);
  return record;
}

export async function getPairingRecord(rawCode: string): Promise<PairingRecord> {
  const code = (rawCode || '').trim().toUpperCase();
  if (!isValidPairingCode(code)) {
    const nowIso = new Date().toISOString();
    return { code: 'INVALID', status: 'pending', createdAt: nowIso, updatedAt: nowIso };
  }

  const remote = await firestoreGetPairing(code);
  if (remote) {
    memoryPairings.set(code, remote);
    return remote;
  }

  const cached = memoryPairings.get(code);
  if (cached) {
    return cached;
  }

  // Materialize pending record if client generated code or hit status first
  const nowIso = new Date().toISOString();
  const created: PairingRecord = {
    code,
    status: 'pending',
    expiresAt: Date.now() + 30 * 60 * 1000,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  memoryPairings.set(code, created);
  await firestoreUpsertPairing(created, true);
  return created;
}

export async function approvePairingRecord(
  rawCode: string,
  accessToken: string,
  username?: string,
  refreshToken?: string
): Promise<{ success: boolean; record?: PairingRecord; error?: string }> {
  const code = (rawCode || '').trim().toUpperCase();
  if (!isValidPairingCode(code)) {
    return { success: false, error: 'Pairing code must be 6 valid uppercase characters' };
  }

  let existing = (await firestoreGetPairing(code)) || memoryPairings.get(code);
  const nowIso = new Date().toISOString();

  if (!existing) {
    // Must create pending first so Firestore terminal-state update rules are satisfied if created remotely
    existing = {
      code,
      status: 'pending',
      expiresAt: Date.now() + 30 * 60 * 1000,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    await firestoreUpsertPairing(existing, true);
  }

  const updated: PairingRecord = {
    code,
    status: 'paired',
    accessToken: accessToken.slice(0, 1024),
    refreshToken: refreshToken ? refreshToken.slice(0, 1024) : existing.refreshToken,
    username: (username || existing.username || '').trim().toLowerCase().slice(0, 64) || undefined,
    expiresAt: Date.now() + 60 * 60 * 1000,
    createdAt: existing.createdAt || nowIso,
    updatedAt: nowIso
  };

  memoryPairings.set(code, updated);
  let persisted = await firestoreUpsertPairing(updated, false);
  if (!persisted) {
    // Re-check remote document state (may have been concurrently created/paired or missing)
    const remoteCheck = await firestoreGetPairing(code);
    if (remoteCheck && remoteCheck.status === 'paired' && remoteCheck.accessToken) {
      memoryPairings.set(code, remoteCheck);
      return { success: true, record: remoteCheck };
    }
    if (!remoteCheck) {
      const pendingDoc: PairingRecord = {
        code,
        status: 'pending',
        expiresAt: Date.now() + 30 * 60 * 1000,
        createdAt: updated.createdAt,
        updatedAt: nowIso
      };
      await firestoreUpsertPairing(pendingDoc, true);
      persisted = await firestoreUpsertPairing(updated, false);
    }
  }

  return { success: true, record: updated };
}
