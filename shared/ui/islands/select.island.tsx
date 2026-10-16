// The select island (P1.24b): the sheet's own listbox over the native <select>, which stays as the form value.
import { defineIsland } from "@unset/shared-islands";
import { isSelectListboxProps, SelectListbox } from "../components/Select/SelectListbox.tsx";

export default defineIsland(SelectListbox, { propsSchema: isSelectListboxProps });
