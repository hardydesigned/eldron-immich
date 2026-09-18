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
  <img src="/eldron-logo.png" alt="ELDRON" class="{heights[size]} w-auto object-contain" />
  {#if variant !== 'icon'}
    <span class="text-2xl font-semibold tracking-wide text-primary">ELDRON</span>
  {/if}
</span>
