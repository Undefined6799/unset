// Vite 8.3.4 CSSModuleClasses (node_modules/vite/client.d.ts); no browser build tool import in presentation.
declare module "*.module.css" {
  const classes: { readonly [className: string]: string };
  export default classes;
}
