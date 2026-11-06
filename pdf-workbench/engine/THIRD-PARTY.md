# PDF engine dependencies

The hash-pinned wheels in requirements.txt retain their installed distribution
license files. Keep those files when packaging or distributing the engine.

- pypdf6.20.1: BSD-3-Clause, `pypdf-6.20.1.dist-info/licenses/LICENSE`.
- pypdfium2 5.14.0: its BSD-3-Clause/Apache-2.0 notices and bundled PDFium
  dependency notices in `pypdfium2-5.14.0.dist-info/licenses/`, including the
  platform-specific BUILD_LICENSES directory.
- Pillow13.0.0: MIT-CMU, `pillow-13.0.0.dist-info/licenses/LICENSE`.

The engine image also retains its Debian package manifest at
`/opt/pdf-system-packages.txt` and the installed system-package copyright files.
