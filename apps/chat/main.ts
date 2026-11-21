// The chat page's entry (ADR 0099): mounts the shell, which owns everything else.
import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (target !== null) mount(App, { target });
