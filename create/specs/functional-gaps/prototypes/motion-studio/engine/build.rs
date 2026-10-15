//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Embed the exact worker/bridge source identity; changes rebuild instead of silently using stale engine code.
//! 2 | maintainer@emeraldcoastsystemsgroup.com | Fingerprint normalized packaging and retained notice sources with the same ordered list as the bridge.
//! 3 | maintainer@emeraldcoastsystemsgroup.com | Include exact native keyframe adapter source in the worker identity.
use sha2::{Digest, Sha256};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let mut digest = Sha256::new();
    for name in [
        "Cargo.toml",
        "Cargo.lock",
        "build.rs",
        "src/lib.rs",
        "src/main.rs",
        "src/owned_assets.rs",
        "src/graph.rs",
        "src/exact_keys.rs",
        "src/exact_text.rs",
        "src/exact_masks.rs",
        "src/exact_properties.rs",
        "bridge.mjs",
        "package-identity.mjs",
        "container/Dockerfile",
        "container/compose.yaml",
        "container/self-test.mjs",
        "container/png.mjs",
        "container/wire.mjs",
        "container/dependency-notices.mjs",
        "install-engine.sh",
        ".dockerignore",
        "NOTICE",
        "licenses/EffectCraft-Apache-2.0.txt",
        "licenses/EffectCraft-MIT.txt",
        "licenses/OFL-Inter.txt",
        "licenses/OFL-JetBrainsMono.txt",
        "licenses/OFL-NotoSerif.txt",
        "licenses/Inter-Regular.ttf.attribution",
        "licenses/Inter-Medium.ttf.attribution",
        "licenses/Inter-SemiBold.ttf.attribution",
        "licenses/Inter-Bold.ttf.attribution",
        "licenses/Inter-Italic.ttf.attribution",
        "licenses/JetBrainsMono-Regular.ttf.attribution",
        "licenses/NotoSerif-Regular.ttf.attribution",
        "vendor/effectcraft-render/Cargo.toml",
        "vendor/effectcraft-render/LICENSE-APACHE",
        "vendor/effectcraft-render/LICENSE-MIT",
        "vendor/effectcraft-render/UPSTREAM.md",
        "vendor/effectcraft-render/src/audio.rs",
        "vendor/effectcraft-render/src/auto.rs",
        "vendor/effectcraft-render/src/cache/dependencies.rs",
        "vendor/effectcraft-render/src/cache.rs",
        "vendor/effectcraft-render/src/color.rs",
        "vendor/effectcraft-render/src/disk_cache.rs",
        "vendor/effectcraft-render/src/eval.rs",
        "vendor/effectcraft-render/src/lib.rs",
        "vendor/effectcraft-render/src/masks.rs",
        "vendor/effectcraft-render/src/passes.rs",
        "vendor/effectcraft-render/src/shapes/tests.rs",
        "vendor/effectcraft-render/src/shapes.rs",
        "vendor/effectcraft-render/src/styles.rs",
        "vendor/effectcraft-render/src/tests.rs",
        "vendor/effectcraft-render/src/tests_audio_fx.rs",
        "vendor/effectcraft-render/src/tests_auto.rs",
        "vendor/effectcraft-render/src/tests_aux.rs",
        "vendor/effectcraft-render/src/tests_collapse.rs",
        "vendor/effectcraft-render/src/tests_color.rs",
        "vendor/effectcraft-render/src/tests_footage_size.rs",
        "vendor/effectcraft-render/src/tests_frame_blend.rs",
        "vendor/effectcraft-render/src/tests_mask_blur.rs",
        "vendor/effectcraft-render/src/tests_nested.rs",
        "vendor/effectcraft-render/src/tests_paint.rs",
        "vendor/effectcraft-render/src/tests_remap.rs",
        "vendor/effectcraft-render/src/tests_roi.rs",
        "vendor/effectcraft-render/src/tests_styles.rs",
        "vendor/effectcraft-render/src/tests_time.rs",
        "vendor/effectcraft-render/src/text/tests.rs",
        "vendor/effectcraft-render/src/text.rs",
        "vendor/effectcraft-render/src/three_d/adv/dof.rs",
        "vendor/effectcraft-render/src/three_d/adv/mod.rs",
        "vendor/effectcraft-render/src/three_d/adv/raster.rs",
        "vendor/effectcraft-render/src/three_d/adv/scene.rs",
        "vendor/effectcraft-render/src/three_d/adv/shade.rs",
        "vendor/effectcraft-render/src/three_d/adv/tests.rs",
        "vendor/effectcraft-render/src/three_d/bokeh.rs",
        "vendor/effectcraft-render/src/three_d/camera.rs",
        "vendor/effectcraft-render/src/three_d/compose.rs",
        "vendor/effectcraft-render/src/three_d/light.rs",
        "vendor/effectcraft-render/src/three_d/mod.rs",
        "vendor/effectcraft-render/src/three_d/tests.rs",
        "vendor/effectcraft-render/src/three_d/tests_orient.rs",
    ] {
        println!("cargo:rerun-if-changed={name}");
        digest.update(name);
        digest.update([0]);
        digest.update(std::fs::read_to_string(root.join(name))?.replace("\r\n", "\n"));
        digest.update([0]);
    }
    println!(
        "cargo:rustc-env=MOTION_ADAPTER_BUILD_HASH={:x}",
        digest.finalize()
    );
    Ok(())
}
