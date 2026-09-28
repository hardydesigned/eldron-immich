<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiLayersTriple } from '@mdi/js';
  import { LngLatBounds, type Map, type RasterSourceSpecification } from 'maplibre-gl';
  import { onDestroy, onMount } from 'svelte';
  import type { TimeRange } from './types';

  type Mosaic = { id: string; operationId: string; name: string; bounds: [number, number, number, number]; createdAt: number; updatedAt: number };

  interface Props {
    map: Map;
    timeRange: TimeRange;
  }

  let { map, timeRange }: Props = $props();

  let mosaics = $state.raw<Mosaic[]>([]);
  let hidden = $state<string[]>([]);
  let open = $state(false);
  let added: string[] = [];

  const visible = $derived(
    mosaics.filter(
      (m) =>
        (!timeRange.after || m.updatedAt >= Date.parse(timeRange.after)) &&
        (!timeRange.before || m.createdAt <= Date.parse(timeRange.before)),
    ),
  );
  const shown = $derived(visible.filter((m) => !hidden.includes(m.id)));
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
    if (!map.isStyleLoaded()) return;
    for (const mosaic of shown) {
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

  const format = (ms: number) =>
    new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function toggle(id: string) {
    hidden = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
  }

  function fly(mosaic: Mosaic) {
    hidden = hidden.filter((h) => h !== mosaic.id);
    const bounds = new LngLatBounds([mosaic.bounds[0], mosaic.bounds[1]], [mosaic.bounds[2], mosaic.bounds[3]]);
    map.fitBounds(bounds, { padding: 60, maxZoom: 18 });
  }

  onMount(async () => {
    const response = await fetch('/sc-api/mosaics', { credentials: 'include' }).catch(() => undefined);
    mosaics = response?.ok ? ((await response.json()) as Mosaic[]) : [];
    map.on('style.load', draw);
  });

  $effect(() => {
    void shown;
    void tileTime;
    draw();
  });

  onDestroy(() => {
    map.off('style.load', draw);
    clear();
  });
</script>

{#if mosaics.length > 0}
  <div class="absolute top-[6.5rem] right-3 z-10 text-sm text-black dark:text-white">
    <button
      type="button"
      class={[
        'ml-auto flex items-center gap-2 rounded-full px-3 py-1.5 font-medium shadow-lg',
        shown.length > 0 ? 'bg-immich-primary text-white' : 'bg-white dark:bg-immich-dark-gray',
      ]}
      onclick={() => (open = !open)}
      data-testid="sc-mosaic-toggle"
      data-count={visible.length}
      data-shown={shown.length}
    >
      <Icon icon={mdiLayersTriple} size="18" />
      Mosaik ({shown.length}/{visible.length})
    </button>
    {#if open}
      <div class="mt-2 w-72 rounded-2xl bg-white p-1 shadow-2xl dark:bg-immich-dark-gray" data-testid="sc-mosaic-list">
        <div class="flex gap-1 p-1 text-xs">
          <button
            type="button"
            class="rounded-full px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700"
            onclick={() => (hidden = [])}
            data-testid="sc-mosaic-all">Alle anzeigen</button
          >
          <button
            type="button"
            class="rounded-full px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700"
            onclick={() => (hidden = visible.map((m) => m.id))}
            data-testid="sc-mosaic-none">Alle ausblenden</button
          >
        </div>
        <ul class="max-h-80 overflow-y-auto">
          {#each visible as mosaic (mosaic.id)}
            <li class="flex items-center gap-2 rounded-xl p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700">
              <input
                type="checkbox"
                class="size-4 shrink-0"
                checked={!hidden.includes(mosaic.id)}
                onchange={() => toggle(mosaic.id)}
                aria-label="{mosaic.name} anzeigen"
                data-testid="sc-mosaic-check"
                data-id={mosaic.id}
              />
              <button
                type="button"
                class="min-w-0 flex-1 text-left"
                onclick={() => fly(mosaic)}
                title="Zum Mosaik springen"
                data-testid="sc-mosaic-item"
                data-id={mosaic.id}
              >
                <span class="block truncate">{mosaic.name}</span>
                <span class="text-xs text-gray-500">{format(mosaic.updatedAt)}</span>
              </button>
            </li>
          {:else}
            <li class="p-2 text-gray-500">Kein Mosaik im gewählten Zeitraum</li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/if}
