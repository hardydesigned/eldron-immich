import { isScUserMismatch, rememberScReturn, scReturnUrl } from '$lib/utils/sc-return';

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

describe('rememberScReturn', () => {
  beforeEach(() => localStorage.clear());

  it('keeps an eldron.cloud return address for the logo', () => {
    rememberScReturn(new URL('https://media.example/?sc_return=https%3A%2F%2Fapp.stg.eldron.cloud%2Fmedia'));
    expect(scReturnUrl()).toBe('https://app.stg.eldron.cloud/media');
  });

  it('ignores foreign return addresses', () => {
    rememberScReturn(new URL('https://media.example/?sc_return=https%3A%2F%2Fevil.example.com%2Fx'));
    expect(scReturnUrl()).toBeNull();
  });
});
