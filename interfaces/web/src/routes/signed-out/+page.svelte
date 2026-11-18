<script lang="ts">
// After signing out (P2.08s): one box asking whether to sign out of the atproto account too. Signing out there ends
// only that browser's session on the PDS; other apps' grants stay until removed there, so the box says so. The link
// opens a new tab, so unset.sh stays open behind it (P2.08k).
let { data } = $props();
</script>

<svelte:head><title>Signed out</title></svelte:head>

<section aria-labelledby="signed-out-title">
  <h1 id="signed-out-title">You are signed out of unset</h1>
  <p>Also sign out of your atproto account? Apps you allowed stay signed in until you remove them there.</p>
  {#if data.link !== null}
    {#if data.link.ours}
      <p>You are going to {data.link.host}, our sign-in server; it is the only place you type your password.</p>
    {/if}
    <a href={data.link.href} target="_blank" rel="noopener noreferrer">
      {data.link.ours ? `Your account on ${data.link.host}` : `your sign-in server (${data.link.host})`}
      (opens in a new tab)
    </a>
  {/if}
  <form method="POST"><button type="submit">No thanks</button></form>
</section>
