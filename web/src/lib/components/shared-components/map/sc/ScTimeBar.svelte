<script lang="ts">
  import { AssetVisibility, getAllAlbums, getTimeBuckets } from '@immich/sdk';
  import { onMount } from 'svelte';
  import type { TimeRange } from './types';

  interface Props {
    onChange: (range: TimeRange) => void;
  }

  let { onChange }: Props = $props();

  const HOUR = 3_600_000;
  let min = $state(0);
  let max = $state(0);
  let from = $state(0);
  let to = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const steps = $derived(Math.max(1, Math.ceil((max - min) / HOUR)));
  const active = $derived(max > min && (from > min || to < max));
  const format = (ms: number) =>
    new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  onMount(async () => {
    const [buckets, albums] = await Promise.all([
      getTimeBuckets({ withPartners: true, visibility: AssetVisibility.Timeline }).catch(() => []),
      getAllAlbums({}).catch(() => []),
    ]);
    const starts = [
      ...buckets.map((bucket) => Date.parse(bucket.timeBucket)),
      ...albums.flatMap((album) => (album.startDate ? [Date.parse(album.startDate)] : [])),
    ].filter(Number.isFinite);
    max = Math.ceil(Date.now() / HOUR) * HOUR;
    min = starts.length > 0 ? Math.floor(Math.min(...starts) / HOUR) * HOUR : max - 30 * 24 * HOUR;
    from = min;
    to = max;
  });

  function emit() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      onChange(active ? { after: new Date(from).toISOString(), before: new Date(to).toISOString() } : {});
    }, 250);
  }

  function setFrom(step: number) {
    from = Math.min(min + step * HOUR, to - HOUR);
    emit();
  }

  function setTo(step: number) {
    to = Math.max(min + step * HOUR, from + HOUR);
    emit();
  }

  function reset() {
    from = min;
    to = max;
    emit();
  }
</script>

{#if max > min}
  <div
    class="pointer-events-auto absolute right-3 bottom-8 left-3 z-10 rounded-2xl bg-white/95 px-4 py-3 text-sm text-black shadow-lg sm:right-auto sm:left-1/2 sm:w-[640px] sm:-translate-x-1/2 dark:bg-immich-dark-gray/95 dark:text-white"
    data-testid="sc-timebar"
    data-from={new Date(from).toISOString()}
    data-to={new Date(to).toISOString()}
  >
    <div class="mb-1 flex items-center justify-between gap-2">
      <span class="font-medium">Zeitstrahl</span>
      <span data-testid="sc-timebar-label">{format(from)} – {format(to)}</span>
      <button
        type="button"
        class="rounded-full px-2 py-0.5 text-xs text-immich-primary disabled:opacity-40"
        disabled={!active}
        onclick={reset}
        data-testid="sc-timebar-reset">Alle</button
      >
    </div>
    <div class="relative h-6">
      <div class="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded bg-gray-300 dark:bg-gray-600"></div>
      <div
        class="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-immich-primary"
        style:left="{((from - min) / (max - min)) * 100}%"
        style:right="{100 - ((to - min) / (max - min)) * 100}%"
      ></div>
      <input
        type="range"
        min="0"
        max={steps}
        value={Math.round((from - min) / HOUR)}
        oninput={(event) => setFrom(Number(event.currentTarget.value))}
        class="sc-range absolute inset-0 w-full"
        aria-label="Zeitstrahl von"
        data-testid="sc-timebar-from"
      />
      <input
        type="range"
        min="0"
        max={steps}
        value={Math.round((to - min) / HOUR)}
        oninput={(event) => setTo(Number(event.currentTarget.value))}
        class="sc-range absolute inset-0 w-full"
        aria-label="Zeitstrahl bis"
        data-testid="sc-timebar-to"
      />
    </div>
  </div>
{/if}

<style>
  .sc-range {
    appearance: none;
    background: transparent;
    pointer-events: none;
  }
  .sc-range::-webkit-slider-thumb {
    appearance: none;
    pointer-events: auto;
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: #4250af;
    border: 2px solid white;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
    cursor: pointer;
  }
  .sc-range::-moz-range-thumb {
    pointer-events: auto;
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: #4250af;
    border: 2px solid white;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
    cursor: pointer;
  }
</style>
