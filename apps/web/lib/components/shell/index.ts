// The navbar's stock controls (book P1.22m), in one piece: the root layout loads this file once the client has
// started, so the library's code is in no page's first load, and swaps each control in for its native twin.
export { default as AccountMenu } from "./account-menu.svelte";
export { default as HeaderMenu } from "./header-menu.svelte";
