import { commandPaletteManager } from '@immich/ui';
import { goto } from '$app/navigation';
import { languageManager } from '$lib/managers/language-manager.svelte';
import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
import { maintenanceCreateUrl, maintenanceReturnUrl, maintenanceShouldRedirect } from '$lib/utils/maintenance';
import { rememberScReturn } from '$lib/utils/sc-return';
import { init } from '$lib/utils/server';
import type { LayoutLoad } from './$types';

export const ssr = false;
export const csr = true;

export const load = (async ({ fetch, url }) => {
  // Vor der Wurzel-Weiterleitung und vor dem Mount der Kopfzeile, die den Rücksprung liest.
  rememberScReturn(url);
  let error;
  try {
    await init(fetch);

    if (maintenanceShouldRedirect(serverConfigManager.value.maintenanceMode, url)) {
      await goto(
        serverConfigManager.value.maintenanceMode ? maintenanceCreateUrl(url) : maintenanceReturnUrl(url.searchParams),
      );
    }
  } catch (initError) {
    error = initError;
  }

  commandPaletteManager.enable();
  languageManager.init();

  return {
    error,
    meta: {
      title: 'ELDRON',
    },
  };
}) satisfies LayoutLoad;
