<script lang="ts">
// The sign-in page (P2.05m: "the sign in should only be a modal"): the sign-in box alone, as a page region, not an
// aria-modal dialog, because with no script it cannot trap focus. Close goes back to the page before. The error is
// a catalog code the server already checked (readErrorParam).
let { data } = $props();
</script>

<svelte:head><title>Sign in</title></svelte:head>

<main id="main">
  <section aria-labelledby="sign-in-title">
    <h1 id="sign-in-title">Sign in</h1>
    <a href={data.close}>Close</a>
    {#if data.message !== null}
      <p role="alert">{data.message}</p>
    {/if}
    <p>You sign in on <strong>{data.pdsHost}</strong>, our sign-in server. It is the only place you type your password.</p>
    <form method="POST">
      {#if data.next !== null}<input type="hidden" name="next" value={data.next} />{/if}
      <button type="submit" name="intent" value="chooser">Sign in with AtProto</button>
    </form>
  </section>
</main>
