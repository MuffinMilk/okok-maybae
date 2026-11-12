import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerUser,
  authenticateUser,
  linkSpotifyToken,
  getUserByUsername,
  hashPassword,
  isValidUsername
} from './userDb.js';

test('isValidUsername validates correctly', () => {
  assert.equal(isValidUsername('ab'), true);
  assert.equal(isValidUsername('muffin_123'), true);
  assert.equal(isValidUsername('user.name'), true);
  assert.equal(isValidUsername('a'), false);
  assert.equal(isValidUsername(''), false);
  assert.equal(isValidUsername('invalid space'), false);
});

test('hashPassword produces consistent SHA256 hex digests with salt', () => {
  const salt = 'random_salt_123';
  const hash1 = hashPassword('secret123', salt);
  const hash2 = hashPassword('secret123', salt);
  const hash3 = hashPassword('different', salt);

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
  assert.equal(hash1.length, 128);
});

test('registerUser creates a new account and sanitizes returned record', () => {
  const testUser = 'tester_' + Date.now();
  const res = registerUser(testUser, 'myPassword123');

  assert.equal(res.success, true);
  assert.ok(res.user);
  assert.equal(res.user.username, testUser.toLowerCase());
  assert.equal(res.user.hasSpotify, false);
  assert.ok(res.sessionToken);

  // Assert sensitive fields are stripped
  assert.equal((res.user as any).passwordHash, undefined);
  assert.equal((res.user as any).salt, undefined);
});

test('registerUser rejects duplicate usernames case-insensitively', () => {
  const testUser = 'unique_' + Date.now();
  const res1 = registerUser(testUser, 'pass1');
  assert.equal(res1.success, true);

  const res2 = registerUser(testUser.toUpperCase(), 'pass2');
  assert.equal(res2.success, false);
  assert.match(res2.error || '', /already taken/i);
});

test('authenticateUser validates correct and incorrect credentials', () => {
  const testUser = 'auth_test_' + Date.now();
  registerUser(testUser, 'correctPassword');

  const fail = authenticateUser(testUser, 'wrongPassword');
  assert.equal(fail.success, false);
  assert.match(fail.error || '', /incorrect password/i);

  const pass = authenticateUser(testUser.toUpperCase(), 'correctPassword');
  assert.equal(pass.success, true);
  assert.ok(pass.user);
  assert.equal(pass.user.username, testUser.toLowerCase());
  assert.ok(pass.sessionToken);
});

test('linkSpotifyToken associates token and allows seamless cross-device login', () => {
  const testUser = 'spotify_sync_' + Date.now();
  registerUser(testUser, 'pass456');

  const linkRes = linkSpotifyToken(testUser, 'BQD_mock_spotify_token_xyz', 'Muffin');
  assert.equal(linkRes.success, true);
  assert.equal(linkRes.user?.hasSpotify, true);
  assert.equal(linkRes.user?.spotifyToken, 'BQD_mock_spotify_token_xyz');

  // Simulate logging in from "another computer or phone"
  const loginOnOtherDevice = authenticateUser(testUser, 'pass456');
  assert.equal(loginOnOtherDevice.success, true);
  assert.equal(loginOnOtherDevice.user?.hasSpotify, true);
  assert.equal(loginOnOtherDevice.user?.spotifyToken, 'BQD_mock_spotify_token_xyz');
});
