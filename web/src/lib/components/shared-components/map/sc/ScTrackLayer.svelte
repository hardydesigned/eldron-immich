<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { Icon } from '@immich/ui';
  import { mdiQuadcopter } from '@mdi/js';
  import { Marker, type Map } from 'maplibre-gl';
  import { onDestroy, onMount } from 'svelte';
  import type { TimeRange } from './types';

  type TrackSummary = { assetId: string; start: number; end: number; lat: number; lng: number };

  interface Props {
    map: Map;
    timeRange: TimeRange;
    onSelect: (assetId: string) => void;
  }

  let { map, timeRange, onSelect }: Props = $props();

  let tracks = $state.raw<TrackSummary[]>([]);
  let open = $state(false);
  let markers: Marker[] = [];

  const visible = $derived(
    tracks.filter(
      (track) =>
        (!timeRange.after || track.end >= Date.parse(timeRange.after)) &&
        (!timeRange.before || track.start <= Date.parse(timeRange.before)),
    ),
  );

  const format = (ms: number) =>
    new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const minutes = (track: TrackSummary) => Math.max(1, Math.round((track.end - track.start) / 60_000));

  onMount(async () => {
    const response = await fetch('/sc-api/tracks', { credentials: 'include' }).catch(() => undefined);
    tracks = response?.ok ? ((await response.json()) as TrackSummary[]) : [];
  });

  $effect(() => {
    for (const marker of markers) marker.remove();
    markers = visible.map((track) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.dataset.testid = 'sc-track-marker';
      element.dataset.assetId = track.assetId;
      element.title = `Video mit Flugspur · ${format(track.start)}`;
      element.className =
        'flex size-7 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white shadow-lg ring-2 ring-white';
      element.textContent = '▶';
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelect(track.assetId);
      });
      return new Marker({ element, anchor: 'bottom', offset: [0, -34] }).setLngLat([track.lng, track.lat]).addTo(map);
    });
  });

  onDestroy(() => {
    for (const marker of markers) marker.remove();
  });
</script>

{#if tracks.length > 0}
  <div class="absolute top-14 right-3 z-10 text-sm text-black dark:text-white">
    <button
      type="button"
      class="ml-auto flex items-center gap-2 rounded-full bg-white px-3 py-1.5 font-medium shadow-lg dark:bg-immich-dark-gray"
      onclick={() => (open = !open)}
      data-testid="sc-tracks-toggle"
      data-count={visible.length}
    >
      <Icon icon={mdiQuadcopter} size="18" />
      Flugspuren ({visible.length})
    </button>
    {#if open}
      <ul
        class="mt-2 max-h-80 w-72 overflow-y-auto rounded-2xl bg-white p-1 shadow-2xl dark:bg-immich-dark-gray"
        data-testid="sc-tracks-list"
      >
        {#each visible as track (track.assetId)}
          <li>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-xl p-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700"
              onclick={() => {
                open = false;
                onSelect(track.assetId);
              }}
              data-testid="sc-tracks-item"
              data-asset-id={track.assetId}
            >
              <img src={getAssetMediaUrl({ id: track.assetId })} alt="" class="size-10 rounded-lg object-cover" />
              <span>{format(track.start)}<br /><span class="text-xs text-gray-500">{minutes(track)} min Flug</span></span>
            </button>
          </li>
        {:else}
          <li class="p-2 text-gray-500">Keine Flugspur im gewählten Zeitraum</li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
