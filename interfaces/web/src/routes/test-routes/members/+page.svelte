<script lang="ts">
let { data } = $props();
</script>

<p>{data.signedIn ? "signed in" : "visitor"}</p>
{#if data.privacyNotice}<p>privacy notice</p>{/if}
