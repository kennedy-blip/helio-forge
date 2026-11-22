<script>
  import { fly } from 'svelte/transition';
  import { app } from '$lib/state/app.svelte.js';
  import HeliodonModule from '$lib/components/modules/HeliodonModule.svelte';
  import ClinometerModule from '$lib/components/modules/ClinometerModule.svelte';
  import BatteryModule from '$lib/components/modules/BatteryModule.svelte';
  import AuditorModule from '$lib/components/modules/AuditorModule.svelte';
  import VaultModule from '$lib/components/modules/VaultModule.svelte';

  const key = $derived(app.activeModule);
</script>

{#key key}
  <div in:fly={{ y: 14, duration: 320, opacity: 0.4 }}>
    {#if key === 'heliodon'}
      <HeliodonModule />
    {:else if key === 'clinometer'}
      <ClinometerModule />
    {:else if key === 'battery'}
      <BatteryModule />
    {:else if key === 'auditor'}
      <AuditorModule />
    {:else if key === 'vault'}
      <VaultModule />
    {:else}
      <HeliodonModule />
    {/if}
  </div>
{/key}
