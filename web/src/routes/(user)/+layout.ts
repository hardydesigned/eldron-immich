import { authenticate } from '$lib/utils/auth';
import { redirect } from '@sveltejs/kit';
import { getAssetInfoFromParam, isSharedLinkRoute } from '$lib/utils/navigation';
import { isRestricted, isRestrictedPath, restrictedRedirect } from '$lib/utils/sc-restrictions';
import type { LayoutLoad } from './$types';

export const load = (async ({ url, params, route }) => {
  await authenticate(url, { public: isSharedLinkRoute(route.id) });
  if (isRestricted() && isRestrictedPath(url.pathname)) {
    redirect(307, restrictedRedirect);
  }
  const asset = await getAssetInfoFromParam(params);

  return {
    asset,
  };
}) satisfies LayoutLoad;
