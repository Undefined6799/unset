// CSS Modules (P1.24): a component's `import styles from "./X.module.css"` is its class map. Vite and Vitest compile
// the file (scripts/ui/css-scope.ts names every class), so the type is all this project needs; it matches vite 8.3.1's
// own `CSSModuleClasses` (client.d.ts), which shared/ui does not load because vite is not one of its dependencies.
declare module "*.module.css" {
  const classes: { readonly [className: string]: string };
  export default classes;
}
