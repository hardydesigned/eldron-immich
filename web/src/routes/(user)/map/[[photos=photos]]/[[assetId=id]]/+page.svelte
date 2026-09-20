<script lang="ts">
  import { goto } from '$app/navigation';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ScClusterPanel from '$lib/components/shared-components/map/sc/ScClusterPanel.svelte';
  import ScMosaicLayer from '$lib/components/shared-components/map/sc/ScMosaicLayer.svelte';
  import ScTrackLayer from '$lib/components/shared-components/map/sc/ScTrackLayer.svelte';
  import ScTimeBar from '$lib/components/shared-components/map/sc/ScTimeBar.svelte';
  import ScVideoTelemetry from '$lib/components/shared-components/map/sc/ScVideoTelemetry.svelte';
  import type { TimeRange, Track } from '$lib/components/shared-components/map/sc/types';
  import type { Map as MapLibreMap } from 'maplibre-gl';
  import type { SelectionBBox } from '$lib/components/shared-components/map/types';
  import { timeToLoadTheMap } from '$lib/constants';
  import Portal from '$lib/elements/Portal.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { Route } from '$lib/route';
  import { handlePromiseError } from '$lib/utils';
  import { delay } from '$lib/utils/asset-utils';
  import { navigate } from '$lib/utils/navigation';
  import { mapSettings } from '$lib/stores/preferences.store';
  import { LoadingSpinner } from '@immich/ui';
  import { onDestroy } from 'svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let selectedClusterIds = $state.raw(new Set<string>());
  let selectedClusterBBox = $state.raw<SelectionBBox>();
  let isTimelinePanelVisible = $state(false);
  let timeRange = $state<TimeRange>({});
  let mapInstance = $state.raw<MapLibreMap>();
  let telemetryTrack = $state.raw<Track>();

  async function loadTrack(assetId: string): Promise<Track | undefined> {
    const response = await fetch(`/sc-api/telemetry/${assetId}`, { credentials: 'include' }).catch(() => undefined);
    if (!response?.ok) {
      return undefined;
    }
    const track = (await response.json()) as Track;
    return track.points.length >= 2 ? track : undefined;
  }

  function closeTimelinePanel() {
    isTimelinePanelVisible = false;
    selectedClusterBBox = undefined;
    selectedClusterIds = new Set();
  }

  onDestroy(() => {
    assetViewerManager.showAssetViewer(false);
  });

  if (!featureFlagsManager.value.map) {
    handlePromiseError(goto(Route.photos()));
  }

  async function onViewAssets(assetIds: string[]) {
    const track = assetIds.length === 1 && mapInstance ? await loadTrack(assetIds[0]) : undefined;
    if (track) {
      telemetryTrack = track;
      closeTimelinePanel();
      return;
    }
    await assetViewerManager.setAssetId(assetIds[0]);
    closeTimelinePanel();
  }

  async function openInViewer(assetId: string) {
    telemetryTrack = undefined;
    await assetViewerManager.setAssetId(assetId);
  }

  function onClusterSelect(assetIds: string[], bbox: SelectionBBox) {
    selectedClusterIds = new Set(assetIds);
    selectedClusterBBox = bbox;
    isTimelinePanelVisible = true;
    assetViewerManager.showAssetViewer(false);
    handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
  }
</script>

{#if featureFlagsManager.value.map}
  <UserPageLayout title={data.meta.title}>
    <div class="isolate flex size-full flex-col sm:flex-row">
      <div
        class={[
          'relative min-h-0',
          isTimelinePanelVisible ? 'h-1/2 w-full pb-2 sm:h-full sm:w-2/3 sm:pe-2 sm:pb-0' : 'size-full',
        ]}
      >
        {#await import('$lib/components/shared-components/map/Map.svelte')}
          {#await delay(timeToLoadTheMap) then}
            <!-- show the loading spinner only if loading the map takes too much time -->
            <div class="flex size-full items-center justify-center">
              <LoadingSpinner />
            </div>
          {/await}
        {:then { default: Map }}
          <Map
            hash
            onSelect={onViewAssets}
            {onClusterSelect}
            onViewportClose={closeTimelinePanel}
            viewportGridActive={isTimelinePanelVisible}
            autoOpenPanel={$mapSettings.showAssetPanel}
            {timeRange}
            onMapLoad={(map) => (mapInstance = map)}
          />
          <ScTimeBar onChange={(range) => (timeRange = range)} />
          {#if mapInstance}
            <ScMosaicLayer map={mapInstance} {timeRange} />
            <ScTrackLayer map={mapInstance} {timeRange} onSelect={(id) => handlePromiseError(onViewAssets([id]))} />
          {/if}
          {#if telemetryTrack && mapInstance}
            {#key telemetryTrack.assetId}
              <ScVideoTelemetry
                map={mapInstance}
                track={telemetryTrack}
                onClose={() => (telemetryTrack = undefined)}
                onOpenViewer={(id) => handlePromiseError(openInViewer(id))}
              />
            {/key}
          {/if}
        {/await}
      </div>

      {#if isTimelinePanelVisible && selectedClusterBBox}
        <div class="h-1/2 min-h-0 w-full pt-2 sm:h-full sm:w-1/3 sm:ps-2 sm:pt-0">
          <ScClusterPanel
            assetIds={[...selectedClusterIds]}
            onOpen={(id) => handlePromiseError(openInViewer(id))}
            onClose={closeTimelinePanel}
          />
        </div>
      {/if}
    </div>
  </UserPageLayout>
  <Portal target="body">
    {#if assetViewerManager.isViewing}
      {#await import('$lib/components/asset-viewer/AssetViewer.svelte') then { default: AssetViewer }}
        <AssetViewer
          cursor={{ current: assetViewerManager.asset! }}
          showNavigation={false}
          onClose={() => {
            assetViewerManager.showAssetViewer(false);
            handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
          }}
          isShared={false}
        />
      {/await}
    {/if}
  </Portal>
{/if}
