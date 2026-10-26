<script lang="ts">
  import { logout } from '@immich/sdk';
  import { LoadingSpinner } from '@immich/ui';
  import { onMount } from 'svelte';
  import { Route } from '$lib/route';
  import { scReturnTarget } from '$lib/utils/sc-return';

  onMount(async () => {
    const target = scReturnTarget(new URL(location.href));
    await logout().catch(() => {});
    location.assign(target ?? Route.login());
  });
</script>

<div class="h-screen w-screen overflow-hidden">
  <div class="m-auto">
    <LoadingSpinner />
  </div>
</div>
