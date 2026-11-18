<script lang="ts">
let { data } = $props();
</script>

<svelte:head>
  <title>Continue signing in</title>
  <meta http-equiv="refresh" content={`0;url=${data.target}`} />
</svelte:head>

<h1>You are going to <strong>{data.host}</strong></h1>
{#if data.ours}<p>This is our sign-in server; it is the only place you type your password.</p>{/if}
<a href={data.target}>Continue to {data.host}</a>
