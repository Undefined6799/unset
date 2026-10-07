// The toast island (P1.24b): the Toast's close control, which hides the toast in place once JS runs.
import { isToastCloseProps, ToastClose } from "../components/Toast/ToastClose.tsx";
import { defineIsland } from "./define.ts";

export default defineIsland(ToastClose, { propsSchema: isToastCloseProps });
