<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiLayersTriple } from '@mdi/js';
  import { LngLatBounds, type Map, type RasterSourceSpecification } from 'maplibre-gl';
  import { onDestroy, onMount } from 'svelte';
  import type { TimeRange } from './types';

  type Mosaic = { id: string; operationId: string; bounds: [number, number, number, number]; updatedAt: number };

  interface Props {
    map: Map;
    timeRange: TimeRange;
  }

  let { map, timeRange }: Props = $props();

  let mosaics = $state.raw<Mosaic[]>([]);
  let enabled = $state(true);
  let added: string[] = [];

  const visible = $derived(mosaics.filter((m) => !timeRange.after || m.updatedAt >= Date.parse(timeRange.after)));
  const tileTime = $derived(timeRange.before ? `?t=${Date.parse(timeRange.before)}` : '');

  function clear() {
    for (const id of added) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    added = [];
  }

  function draw() {
    clear();
    if (!enabled || !map.isStyleLoaded()) return;
    for (const mosaic of visible) {
      const id = `sc-mosaic-${mosaic.id}`;
      const source: RasterSourceSpecification = {
        type: 'raster',
        tiles: [`${location.origin}/sc-api/mosaics/${mosaic.id}/tiles/{z}/{x}/{y}.webp${tileTime}`],
        tileSize: 256,
        minzoom: 12,
        maxzoom: 21,
        bounds: mosaic.bounds,
      };
      map.addSource(id, source);
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.95 } });
      added.push(id);
    }
  }

  let cursor = 0;
  function fitNext() {
    if (visible.length === 0) return;
    const mosaic = visible[cursor % visible.length];
    cursor++;
    const bounds = new LngLatBounds([mosaic.bounds[0], mosaic.bounds[1]], [mosaic.bounds[2], mosaic.bounds[3]]);
    map.fitBounds(bounds, { padding: 60, maxZoom: 18 });
  }

  onMount(async () => {
    const response = await fetch('/sc-api/mosaics', { credentials: 'include' }).catch(() => undefined);
    mosaics = response?.ok ? ((await response.json()) as Mosaic[]) : [];
    map.on('style.load', draw);
  });

  $effect(() => {
    void visible;
    void enabled;
    void tileTime;
    draw();
  });

  onDestroy(() => {
    map.off('style.load', draw);
    clear();
  });
</script>

{#if mosaics.length > 0}
  <div class="absolute top-[6.5rem] right-3 z-10 flex gap-1 text-sm text-black dark:text-white">
    <button
      type="button"
      class={[
        'flex items-center gap-2 rounded-full px-3 py-1.5 font-medium shadow-lg',
        enabled ? 'bg-immich-primary text-white' : 'bg-white dark:bg-immich-dark-gray',
      ]}
      onclick={() => (enabled = !enabled)}
      data-testid="sc-mosaic-toggle"
      data-count={visible.length}
      data-enabled={enabled}
    >
      <Icon icon={mdiLayersTriple} size="18" />
      Mosaik ({visible.length})
    </button>
    <button
      type="button"
      class="rounded-full bg-white px-3 py-1.5 shadow-lg dark:bg-immich-dark-gray"
      onclick={fitNext}
      title="Zum nächsten Mosaik springen"
      data-testid="sc-mosaic-fit">⤢</button
    >
  </div>
{/if}
