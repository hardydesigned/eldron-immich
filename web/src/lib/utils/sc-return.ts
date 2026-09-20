// Rücksprung nach SentryCommand: die App öffnet ELDRON mit ?sc_return=<ihre Seite>.
const KEY = 'sc-return-url';

function isAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return url.protocol === 'http:' || url.protocol === 'https:';
    }
    return url.protocol === 'https:' && /(^|\.)sentrycommand\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

export function rememberScReturn(url: URL): void {
  const value = url.searchParams.get('sc_return');
  if (value && isAllowed(value)) {
    localStorage.setItem(KEY, value);
  }
}

export function scReturnUrl(): string | null {
  const value = localStorage.getItem(KEY);
  return value && isAllowed(value) ? value : null;
}
