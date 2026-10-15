# EffectCraft render derivative

Original: https://github.com/storytold/effectcraft at67434e90388b6dca4417555346fa6850b6f96033, crates/render.

All44original source/package files are retained. Only Cargo.toml (standalone pinned dependency definitions), src/text.rs (complete2D/per-character3Dtext raster surfaces within32MP with refusal tracking and per-layer glyph aggregate preflight), src/lib.rs (skip refused sources before masks/effects), src/text/tests.rs (surface/independent viewport proofs), and src/disk_cache.rs (explicit synthetic u128 boundary fixture) change. No document/text/font/transform/effect/model schema is replaced. MIT OR Apache-2.0; both original license texts are retained here.

Original file SHA256 values, before the documented patch:

`Cargo.toml` 1e19760edc2e573a24b71f4f58bf2cb33fe493806e69c153e28c9f5e0db4e969

`src/audio.rs` f347585ac6dcd898d25398b436709b708d8a5471ba3b01cd6e2006ae74734f69

`src/auto.rs` 1d20e1b015a2916aad3ae3eaf33b96736dec2e5f7c141af75c3932643920b9d8

`src/cache/dependencies.rs` d2e09766033e5edb391531814d8f5ed1262519ccf75260a990632c5dca1c82ae

`src/cache.rs` 448854afbf536125854a0f2c9b372c12bebfd478c9759bbe8878adf2e2845f12

`src/color.rs` 1761de7757896841b8a0e0e75b1ec79a11b3019b953d24012ab5c450e1b4dc91

`src/disk_cache.rs` e2c73902f9377880dbed1a76b5c9242221bddcbd5ad5d85b680495d62dbb0d6c

`src/eval.rs` a1915e7d3735eb25135cd788aa1fbdc19d81d8b1464060b30a46cafc219cd88d

`src/lib.rs` d6331dd0acc9afab3bb4395720dc6c3c29a9d502fdc4b5036b54fbd3b7b46781

`src/masks.rs` 873d80a30d60e8393f1b35cd01259f507c3dadb9371671e728cc0bce8258bb50

`src/passes.rs` a1726aec5a405f2e48953cf6368fa893538c7174349cba7af3688b4142dd3d17

`src/shapes/tests.rs` 644b74d0794a34087ae518abf7c31849893c1d9826f03e821ed67ccde7a677b0

`src/shapes.rs` db53c226bfa917f8bdb214f9a65a39671bd8d6c56c99000f52b6aa99e17faf0a

`src/styles.rs` 543aab4f83bfb23d108d8bd8bf0b0211d6e143e7acda547c96e7fa348d259566

`src/tests.rs` 3e89f138183d79c2efd8df697001d93dea10d9d88863bf88a89c84c96b233101

`src/tests_audio_fx.rs` 70b6c00de96bde90aa5a9860f9d8ebbcd2acb023c8aab4b36d95b16db0e01016

`src/tests_auto.rs` e3c91d8ae393e4e43b955f4f63ca23c71d706453b65fe5cc803d1eb5494a73d7

`src/tests_aux.rs` 5d39920fc3cd6739f4a77f3a07510db982ad232f9cd406643f9da6daa2028806

`src/tests_collapse.rs` 769f2e5577bc2a7167f0b8bc5f744347589c9efa386b4fb9d771d0c5c9d83047

`src/tests_color.rs` 64d9536edf6347fdbb84b67adb2b4ad9faff1b3182c7462b254065aa2fdf2b37

`src/tests_footage_size.rs` 4ab67ce6726750eb337de86ae486d6d0fe2b9c3df1998c6df7a92bb98c947b4f

`src/tests_frame_blend.rs` f9af2ab68557a49a232b92cc4319bc812e6c73fbf4ca6a43661e81a5590863ca

`src/tests_mask_blur.rs` 8859a3354080b2de813a31499cfefacb9651adae4bdac8a69a83bbd368cacd25

`src/tests_nested.rs` c49697ee0499efe1a7a8d027c592d9834a8a5ae09747be1bbc77f4770c625c5d

`src/tests_paint.rs` 8889b53fc4dc89c1f82afe7eeaa5f608e2e54dfd48f81b16021f066d8eb8afb8

`src/tests_remap.rs` 408b8936086473cea4c52eeb965194498844b3e1d68a81c9a280c2068b8c2da6

`src/tests_roi.rs` 9636448dd1be45951dc7afbfaf1e06f51a6b4ea49368e50965602ef602ded2d2

`src/tests_styles.rs` c32ca07bb809610bd4d3d37eaae0d44921687c0c6461d1b4d2d00ed88a8674c2

`src/tests_time.rs` ba0ee8ae170e47f3cc3896eb264c462555015434d314442986931cb192da9675

`src/text/tests.rs` 9bfa3f7c08cce18b564d02b12e36f9a08433b50258f1bc26724bf7f472555177

`src/text.rs` 7a0fc37f23510ec53352265bf4695d7dd6584dee68d7116328ae54af2dbbc33c

`src/three_d/adv/dof.rs` 981992fc993b2b1e9901f6d66f6a31223deedca70bba3d4af4bff149f263dc84

`src/three_d/adv/mod.rs` b1d23e75949a06b2752cfa27e8dd3028014363ba021a2e03ab7664df047e4a94

`src/three_d/adv/raster.rs` 78e4fe19c8f366776210b021a0cb0a740a8c75e576c9cf1de7f98eabff0ed9b4

`src/three_d/adv/scene.rs` 548e38d5312c2b0752441f41c4f19342c85b791f0ab76f49e3fb3ca64446bb99

`src/three_d/adv/shade.rs` 15dde171b1e8c55213d68ab645097ec5585a998022cfcbeb074b60fd8e148aee

`src/three_d/adv/tests.rs` c5a21304b2f072052a45e2f5cb2323dae6233c4e7053a9e920cda8913bafe7f3

`src/three_d/bokeh.rs` 292e4011b348755abcd77de081ae49736b78d979eaed74f7e161d2889b2db636

`src/three_d/camera.rs` 79e3bc514229e58a13088bb5f08ba2e34c155d778da87cc8663f73bf5b00048f

`src/three_d/compose.rs` bb151d93cbefaf511a0463669035bf9126806699e0431076f5c5edcbd35d9613

`src/three_d/light.rs` 2047a235911385019186ac7c867735e0257b2d0fc9975482bfc3edde6e482678

`src/three_d/mod.rs` 2a898e8867d5e70ca8aaddefa60f55b67ff44483d06aa52c53a2a24d81618ff8

`src/three_d/tests.rs` 1137c6ce96bfa46a66e40d0dfd6accd3f08a21eba4fdca2fd0974593ba51c170

`src/three_d/tests_orient.rs` 0056c1781019d04cb30ea3bcc4ddb7d8bd5a9252bb53c7637c8d8e9380c87db3


Per-character3D follow-up: src/text.rs replaces silent4096pixel side clamping with full native glyph bounds/offsets, preflights the sum of live glyph surface pixels before raster allocation and flags invalid/aggregate-overbudget planes. src/text/tests.rs adds full native large-glyph viewport and preflight proofs. No original source checksum, license, model or dependency pin changes.
