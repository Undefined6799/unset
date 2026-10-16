// The toast island (P1.24b): the Toast's close control, which hides the toast in place once JS runs.
import { defineIsland } from "@unset/shared-islands";
import { isToastCloseProps, ToastClose } from "../components/Toast/ToastClose.tsx";

export default defineIsland(ToastClose, { propsSchema: isToastCloseProps });
