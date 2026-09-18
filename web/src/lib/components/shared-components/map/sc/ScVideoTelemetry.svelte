<script lang="ts">
  import { getAssetPlaybackUrl } from '$lib/utils';
  import { Icon } from '@immich/ui';
  import { mdiClose, mdiOpenInNew } from '@mdi/js';
  import { LngLatBounds, Marker, type GeoJSONSource, type Map } from 'maplibre-gl';
  import { onDestroy, onMount } from 'svelte';

  import type { Track, TrackPoint } from './types';

  interface Props {
    map: Map;
    track: Track;
    onClose: () => void;
    onOpenViewer: (assetId: string) => void;
  }

  let { map, track, onClose, onOpenViewer }: Props = $props();

  const SOURCE = 'sc-track';
  let current = $state<TrackPoint>(track.points[0]);
  let drone: Marker | undefined;

  function pointAt(time: number): TrackPoint {
    const points = track.points;
    if (time <= points[0].t) return points[0];
    for (let i = 1; i < points.length; i++) {
      const next = points[i];
      if (time > next.t) continue;
      const prev = points[i - 1];
      const f = (time - prev.t) / Math.max(1, next.t - prev.t);
      return { ...prev, t: time, lat: prev.lat + (next.lat - prev.lat) * f, lng: prev.lng + (next.lng - prev.lng) * f };
    }
    return points.at(-1)!;
  }

  function onTime(seconds: number) {
    current = pointAt(track.start + seconds * 1000);
    drone?.setLngLat([current.lng, current.lat]);
    drone?.getElement().setAttribute('data-lnglat', `${current.lng.toFixed(6)},${current.lat.toFixed(6)}`);
    const arrow = drone?.getElement().firstElementChild as HTMLElement | null;
    if (arrow && current.heading != null) arrow.style.transform = `rotate(${current.heading}deg)`;
  }

  onMount(() => {
    const coordinates = track.points.map((point) => [point.lng, point.lat]);
    const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } };
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(data) ?? map.addSource(SOURCE, { type: 'geojson', data });
    if (!map.getLayer(SOURCE)) {
      map.addLayer({
        id: SOURCE,
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#e11d48', 'line-width': 4, 'line-opacity': 0.9 },
      });
    }
    const element = document.createElement('div');
    element.dataset.testid = 'sc-telemetry-drone';
    element.className = 'flex size-8 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg ring-2 ring-white';
    element.innerHTML = '<span style="display:block;font-size:18px;line-height:1">▲</span>';
    drone = new Marker({ element }).setLngLat([current.lng, current.lat]).addTo(map);
    onTime(0);
    const bounds = new LngLatBounds();
    for (const [lng, lat] of coordinates) bounds.extend([lng, lat]);
    map.fitBounds(bounds, { padding: 80, maxZoom: 18, duration: 0 });
  });

  onDestroy(() => {
    drone?.remove();
    if (map.getLayer(SOURCE)) map.removeLayer(SOURCE);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  });

  const value = (v: number | null, digits: number, unit: string) => (v == null ? '–' : `${v.toFixed(digits)} ${unit}`);
</script>

<div
  class="absolute top-3 right-3 z-20 w-[min(420px,calc(100%-24px))] overflow-hidden rounded-2xl bg-white text-sm text-black shadow-2xl dark:bg-immich-dark-gray dark:text-white"
  data-testid="sc-telemetry-panel"
  data-points={track.points.length}
>
  <div class="flex items-center justify-between px-3 py-2">
    <span class="font-medium">Video mit Flugspur</span>
    <div class="flex gap-1">
      <button type="button" title="Im Viewer öffnen" onclick={() => onOpenViewer(track.assetId)} data-testid="sc-telemetry-open">
        <Icon icon={mdiOpenInNew} size="20" />
      </button>
      <button type="button" title="Schließen" onclick={onClose} data-testid="sc-telemetry-close">
        <Icon icon={mdiClose} size="20" />
      </button>
    </div>
  </div>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    class="aspect-video w-full bg-black"
    src={getAssetPlaybackUrl({ id: track.assetId })}
    controls
    autoplay
    muted
    playsinline
    ontimeupdate={(event) => onTime(event.currentTarget.currentTime)}
    onseeked={(event) => onTime(event.currentTarget.currentTime)}
    data-testid="sc-telemetry-video"
  ></video>
  <dl class="grid grid-cols-3 gap-x-3 gap-y-1 px-3 py-2">
    <div class="col-span-3 flex justify-between">
      <dt class="text-gray-500">Zeit</dt>
      <dd data-testid="sc-telemetry-time">{new Date(current.t).toLocaleTimeString('de-DE')}</dd>
    </div>
    <div>
      <dt class="text-gray-500">Höhe</dt>
      <dd data-testid="sc-telemetry-alt">{value(current.alt, 1, 'm')}</dd>
    </div>
    <div>
      <dt class="text-gray-500">Geschw.</dt>
      <dd data-testid="sc-telemetry-speed">{value(current.speed, 1, 'm/s')}</dd>
    </div>
    <div>
      <dt class="text-gray-500">Richtung</dt>
      <dd data-testid="sc-telemetry-heading">{value(current.heading, 0, '°')}</dd>
    </div>
    <div class="col-span-3">
      <dt class="inline text-gray-500">Akku</dt>
      <dd class="inline" data-testid="sc-telemetry-battery">{value(current.battery, 0, '%')}</dd>
    </div>
  </dl>
</div>
