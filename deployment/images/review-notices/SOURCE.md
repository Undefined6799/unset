# Source of the LGPL libraries in the review image

The review image (`deployment/images/review.Dockerfile`, ADR 0070) runs sharp 0.35.5, which loads libvips and its
dependencies from the prebuilt npm package `@img/sharp-libvips-linux-x64` 1.3.4, unmodified. libvips, glib, fribidi,
libexif, libheif, librsvg, pango and proxy-libintl in it are used under the GNU Lesser General Public License version 3
(`LGPL-3.0.txt`, which incorporates `GPL-3.0.txt`); `sharp-libvips-THIRD-PARTY-NOTICES.md` lists every library in the
package and its licence.

- Package as installed: https://registry.npmjs.org/@img/sharp-libvips-linux-x64/-/sharp-libvips-linux-x64-1.3.4.tgz
  (integrity in the repository's `package-lock.json`).
- Build scripts and versions it was built from: https://github.com/lovell/sharp-libvips/tree/v1.3.4 (libvips 8.18.7;
  each library's version in the package's `versions.json`, at `node_modules/@img/sharp-libvips-linux-x64/` in the image).
- libvips source: https://github.com/libvips/libvips/releases/tag/v8.18.7

The libraries are shared objects under `node_modules/@img/sharp-libvips-linux-x64/lib/` and can be replaced with a
modified build of the same interface. This repository (AGPL-3.0-only) is the source of everything else in the image.
