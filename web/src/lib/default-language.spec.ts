import { defaultLang } from '$lib/constants';

describe('default language', () => {
  it('is German', () => {
    expect(defaultLang.code).toBe('de');
  });
});
