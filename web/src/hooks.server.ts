import type { Handle } from '@sveltejs/kit';
import Geist from '$lib/assets/fonts/Geist/Geist.ttf?url';
import GeistMono from '$lib/assets/fonts/GeistMono/GeistMono.ttf?url';

// only used during the build to replace the variables from app.html
export const handle = (async ({ event, resolve }) => {
  return resolve(event, {
    transformPageChunk: ({ html }) => {
      return html.replace('%app.font%', () => Geist).replace('%app.monofont%', () => GeistMono);
    },
  });
}) satisfies Handle;
