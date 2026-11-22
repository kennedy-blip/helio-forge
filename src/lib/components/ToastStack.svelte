<script>
  import { fly } from 'svelte/transition';
  import { app } from '$lib/state/app.svelte.js';
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div
      class="toast glass pad"
      class:ok={t.kind === 'success'}
      class:warn={t.kind === 'warn'}
      class:bad={t.kind === 'error'}
      transition:fly={{ y: 18, duration: 240 }}
    >
      <span class="dot"></span>
      <span class="small">{t.message}</span>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    z-index: 220;
    right: 1.1rem;
    bottom: 6.6rem;
    display: grid;
    gap: 0.5rem;
    max-width: min(340px, calc(100vw - 2rem));
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.6rem 0.85rem;
    border-radius: 14px;
  }

  .toast .dot {
    color: var(--cyan);
  }

  .toast.ok .dot {
    color: var(--emerald);
  }

  .toast.warn .dot {
    color: var(--gold);
  }

  .toast.bad .dot {
    color: var(--magenta);
  }

  @media (max-width: 720px) {
    .toasts {
      bottom: 6.4rem;
      right: 0.7rem;
      left: 0.7rem;
      max-width: none;
    }
  }
</style>
