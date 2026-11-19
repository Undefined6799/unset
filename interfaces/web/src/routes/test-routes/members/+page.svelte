<script lang="ts">
let { data } = $props();
</script>

<p>{data.signedIn ? "signed in" : "visitor"}</p>
