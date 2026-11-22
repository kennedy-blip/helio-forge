<script>
  import { scale, fade } from 'svelte/transition';
  import { app, closeModal } from '$lib/state/app.svelte.js';
  import ApkModal from '$lib/components/modals/ApkModal.svelte';
  import PrivilegesModal from '$lib/components/modals/PrivilegesModal.svelte';
  import InspectorModal from '$lib/components/modals/InspectorModal.svelte';
  import BlueprintModal from '$lib/components/modals/BlueprintModal.svelte';
  import ExportModal from '$lib/components/modals/ExportModal.svelte';

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.key === 'Escape' && app.modal) closeModal();
  }
</script>

<svelte:window on:keydown={onKey} />

{#if app.modal}
  <div class="modal-layer" transition:fade={{ duration: 220 }}>
    <button class="backdrop" aria-label="Close modal" onclick={closeModal}></button>
    <div class="modal-slot" transition:scale={{ start: 0.9, duration: 380, opacity: 0.2 }}>
      {#if app.modal === 'apk'}
        <ApkModal />
      {:else if app.modal === 'privileges'}
        <PrivilegesModal />
      {:else if app.modal === 'inspector'}
        <InspectorModal />
      {:else if app.modal === 'blueprint'}
        <BlueprintModal payload={app.modalPayload} />
      {:else if app.modal === 'export'}
        <ExportModal />
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-layer {
    position: fixed;
    inset: 0;
    z-index: 210;
    display: grid;
    place-items: center;
    padding: 1.2rem;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: radial-gradient(80% 60% at 50% 20%, rgba(4, 8, 16, 0.62), rgba(2, 4, 8, 0.9));
    backdrop-filter: blur(10px) saturate(120%);
    -webkit-backdrop-filter: blur(10px) saturate(120%);
  }

  .modal-slot {
    position: relative;
    width: min(1080px, 100%);
    max-height: min(88dvh, 900px);
    overflow-y: auto;
    border-radius: 26px;
    overscroll-behavior: contain;
  }
</style>
