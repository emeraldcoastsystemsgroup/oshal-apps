# Original PSD fixture corpus

`psd-fixtures.mjs` produces genuine PSDv1 binary files from explicit format fields,
without using the production parser or copying upstream application/corpus bytes.
The generated PSD binary bytes are dedicated to the public domain under CC0-1.0;
source code retains the repository's existing license. Fixtures cover raw/RLE pixel
planes, transparency/opacity/placement, normal folders/Unicode and unsupported
semantic metadata. They are specification fixtures, not files exported by an
installed Photoshop application. Pillow independently decodes raw/RLE samples;
folder semantics and editable native geometry receive separate model/render checks.

## Licensed upstream binary fixtures

Actual unchanged Pillow10.2.0 files are included under its HPND license, reproduced in `PILLOW-LICENSE.txt`. They are not covered by the CC0 dedication above. Primary upstream: https://github.com/python-pillow/Pillow/tree/10.2.0/Tests/images.

- `pillow-hopper-merged.psd` from `hopper_merged.psd`; SHA256 `924c9939472b04946c597b1fa679beacad00b522d7b3691dec9c3e240dba7c8f`.
- `pillow-rgba.psd` from `rgba.psd`; SHA256 `03e541834ca6f27dd6d7040de936be7878793f22e406910131a9c60567851898`.

The128x128 merged RGB fixture yields exact independent Pillow RGBA pixels in both its merged cache and imported pixel layer. The upstream RGBA ZIP-compressed fixture is refused by this raw/RLE profile. Opaque unknown semantic payload fixtures test tag detection/refusal, not complete decoding of text/effect descriptors.
