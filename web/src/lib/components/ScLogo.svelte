<script lang="ts">
  interface Props {
    variant?: 'icon' | 'inline' | 'stacked' | 'logo';
    size?: 'tiny' | 'small' | 'medium' | 'large' | 'giant';
    class?: string;
  }

  let { variant = 'icon', size = 'medium', class: className = '' }: Props = $props();

  const heights = { tiny: 'h-6', small: 'h-8', medium: 'h-10', large: 'h-14', giant: 'h-24' };
</script>

<span class="inline-flex items-center gap-2 {className}" data-testid="eldron-logo">
  {#if variant === 'icon'}
    <img src="/eldron-logo.png" alt="ELDRON" class="{heights[size]} w-auto object-contain" />
  {:else}
    <span class="flex aspect-square size-8 items-center justify-center">
      <img src="/eldron-logo.png" alt="ELDRON" class="size-6 object-contain" />
    </span>
    <span class="grid text-left leading-tight">
      <span class="truncate text-sm font-medium">HardyTec Industries</span>
      <span class="truncate text-xs">ELDRON</span>
    </span>
  {/if}
</span>
