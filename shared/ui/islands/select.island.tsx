// The select island (P1.24b): the sheet's own listbox over the native <select>, which stays as the form value.
import { isSelectListboxProps, SelectListbox } from "../components/Select/SelectListbox.tsx";
import { defineIsland } from "./define.ts";

export default defineIsland(SelectListbox, { propsSchema: isSelectListboxProps });
