<script lang="ts">
  import { isRestricted } from '$lib/utils/sc-restrictions';
  import PurchaseInfo from './PurchaseInfo.svelte';
  import ServerStatus from './ServerStatus.svelte';
  import StorageSpace from './StorageSpace.svelte';
</script>

<div class="mt-auto">
  <StorageSpace />
</div>

{#if !isRestricted()}
  <PurchaseInfo />
{/if}

<div class="mt-2 mb-6">
  <ServerStatus />
</div>
