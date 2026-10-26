import { isScUserMismatch } from '$lib/utils/sc-return';

describe('isScUserMismatch', () => {
  it('ignores urls without sc_uid', () => {
    expect(isScUserMismatch(new URL('https://media.example/photos'), 'user_a')).toBe(false);
  });

  it('accepts the matching account', () => {
    expect(isScUserMismatch(new URL('https://media.example/photos?sc_uid=user_a'), 'user_a')).toBe(false);
  });

  it('detects a different account', () => {
    expect(isScUserMismatch(new URL('https://media.example/photos?sc_uid=user_b'), 'user_a')).toBe(true);
  });

  it('detects a session without linked oauth id', () => {
    expect(isScUserMismatch(new URL('https://media.example/photos?sc_uid=user_a'), '')).toBe(true);
  });
});
