// The modal island (P1.24j): the Modal's trigger, which opens the native <dialog> once JS runs.
import { isModalTriggerProps, ModalTrigger } from "../components/Modal/ModalTrigger.tsx";
import { defineIsland } from "./define.ts";

export default defineIsland(ModalTrigger, { propsSchema: isModalTriggerProps });
