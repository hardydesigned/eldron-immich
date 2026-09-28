<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { CloseButton, Icon } from '@immich/ui';
  import { mdiImageMultiple } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    assetIds: string[];
    onOpen: (assetId: string) => void;
    onClose: () => void;
  }

  let { assetIds, onOpen, onClose }: Props = $props();
</script>

<aside class="flex size-full flex-col overflow-hidden bg-immich-bg dark:bg-immich-dark-bg" data-testid="sc-cluster-panel">
  <div class="flex items-center justify-between border-b border-gray-200 pe-1 pb-1 dark:border-immich-dark-gray">
    <div class="flex items-center gap-2">
      <Icon icon={mdiImageMultiple} size="20" />
      <p class="text-sm font-medium text-immich-fg dark:text-immich-dark-fg">
        {$t('assets_count', { values: { count: assetIds.length } })}
      </p>
    </div>
    <CloseButton onclick={onClose} />
  </div>
  <div class="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-1 overflow-y-auto pt-2">
    {#each assetIds as id (id)}
      <button type="button" class="aspect-square overflow-hidden rounded-lg" onclick={() => onOpen(id)} data-testid="sc-cluster-asset">
        <img src={getAssetMediaUrl({ id })} alt="" loading="lazy" class="size-full object-cover transition hover:scale-105" />
      </button>
    {/each}
  </div>
</aside>
