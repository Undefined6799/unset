// The modal island (P1.24j): the Modal's trigger, which opens the native <dialog> once JS runs.
import { defineIsland } from "@unset/shared-islands";
import { isModalTriggerProps, ModalTrigger } from "../components/Modal/ModalTrigger.tsx";

export default defineIsland(ModalTrigger, { propsSchema: isModalTriggerProps });
