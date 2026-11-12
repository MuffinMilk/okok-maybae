import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface UserRecord {
  username: string; // Lowercase unique ID
  displayName: string;
  salt: string;
  passwordHash: string;
  sessionToken: string;
  spotifyToken?: string;
  spotifyDisplayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SafeUser {
  username: string;
  displayName: string;
  hasSpotify: boolean;
  spotifyToken?: string;
  spotifyDisplayName?: string;
  createdAt: string;
  updatedAt: string;
}

const DB_PATH = path.resolve(__dirname, '../../data/users.json');

// In-memory cache for speed and consistency
let usersCache: Map<string, UserRecord> | null = null;

function ensureDataDirectory() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadUsersFromDisk(): Map<string, UserRecord> {
  if (usersCache) return usersCache;

  ensureDataDirectory();
  usersCache = new Map<string, UserRecord>();

  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      console.log('Loaded users file:', raw.length, 'bytes');
      const list: UserRecord[] = JSON.parse(raw);
      if (Array.isArray(list)) {
        list.forEach(u => {
          if (u && u.username) {
            usersCache!.set(u.username.toLowerCase(), u);
          }
        });
      }
    } catch (e) {
      console.error('Error reading users database:', e);
    }
  } else {
    console.log('Users file does not exist at:', DB_PATH);
  }

  // Pre-seed default user "muffin" with password "muffin" if no users exist
  if (usersCache.size === 0) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword('muffin', salt);
    const defaultUser: UserRecord = {
      username: 'muffin',
      displayName: 'Muffin',
      salt,
      passwordHash: hash,
      sessionToken: crypto.randomBytes(24).toString('hex'),
      spotifyDisplayName: 'Muffin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    usersCache.set('muffin', defaultUser);
    saveUsersToDisk();
  }

  return usersCache;
}

export function saveUsersToDisk(): void {
  if (!usersCache) return;
  ensureDataDirectory();

  const list = Array.from(usersCache.values());
  const tempPath = `${DB_PATH}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tempPath, DB_PATH);
  } catch (err) {
    console.error('Failed to save users database:', err);
  }
}

export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha256').toString('hex');
}

export function isValidUsername(username: string): boolean {
  if (!username || typeof username !== 'string') return false;
  const clean = username.trim();
  return clean.length >= 2 && clean.length <= 32 && /^[a-zA-Z0-9_\-\.]+$/.test(clean);
}

export function sanitizeUser(user: UserRecord): SafeUser {
  return {
    username: user.username,
    displayName: user.displayName,
    hasSpotify: Boolean(user.spotifyToken && user.spotifyToken.length > 5),
    spotifyToken: user.spotifyToken,
    spotifyDisplayName: user.spotifyDisplayName,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export function registerUser(
  usernameRaw: string,
  passwordRaw: string,
  initialSpotifyToken?: string
): { success: boolean; user?: SafeUser; sessionToken?: string; error?: string } {
  const users = loadUsersFromDisk();
  const username = (usernameRaw || '').trim().toLowerCase();

  if (!isValidUsername(username)) {
    return {
      success: false,
      error: 'Username must be 2-32 characters (letters, numbers, underscores)'
    };
  }

  if (!passwordRaw || passwordRaw.length < 3) {
    return {
      success: false,
      error: 'Password must be at least 3 characters long'
    };
  }

  if (users.has(username)) {
    return {
      success: false,
      error: 'Username already taken. Please sign in.'
    };
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(passwordRaw, salt);
  const sessionToken = crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();

  const newUser: UserRecord = {
    username,
    displayName: usernameRaw.trim(),
    salt,
    passwordHash,
    sessionToken,
    spotifyToken: initialSpotifyToken || undefined,
    createdAt: now,
    updatedAt: now
  };

  users.set(username, newUser);
  saveUsersToDisk();

  return {
    success: true,
    user: sanitizeUser(newUser),
    sessionToken
  };
}

export function authenticateUser(
  usernameRaw: string,
  passwordRaw: string
): { success: boolean; user?: SafeUser; sessionToken?: string; error?: string } {
  const users = loadUsersFromDisk();
  const username = (usernameRaw || '').trim().toLowerCase();

  if (!username || !passwordRaw) {
    return { success: false, error: 'Please enter both username and password' };
  }

  const user = users.get(username);
  console.log('User lookup result for', username, ':', !!user);
  if (!user) {
    return { success: false, error: 'Account not found. Please check your username or sign up.' };
  }

  const checkHash = hashPassword(passwordRaw, user.salt);
  if (checkHash !== user.passwordHash) {
    return { success: false, error: 'Incorrect password. Please try again.' };
  }

  // Refresh session token on valid login
  user.sessionToken = crypto.randomBytes(24).toString('hex');
  user.updatedAt = new Date().toISOString();
  saveUsersToDisk();

  return {
    success: true,
    user: sanitizeUser(user),
    sessionToken: user.sessionToken
  };
}

export function linkSpotifyToken(
  usernameRaw: string,
  spotifyToken: string,
  spotifyDisplayName?: string
): { success: boolean; user?: SafeUser; error?: string } {
  const users = loadUsersFromDisk();
  const username = (usernameRaw || '').trim().toLowerCase();

  const user = users.get(username);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  user.spotifyToken = spotifyToken;
  if (spotifyDisplayName) {
    user.spotifyDisplayName = spotifyDisplayName;
  }
  user.updatedAt = new Date().toISOString();
  saveUsersToDisk();

  return {
    success: true,
    user: sanitizeUser(user)
  };
}

export function getUserByUsername(usernameRaw: string): SafeUser | null {
  const users = loadUsersFromDisk();
  const username = (usernameRaw || '').trim().toLowerCase();
  const user = users.get(username);
  return user ? sanitizeUser(user) : null;
}
