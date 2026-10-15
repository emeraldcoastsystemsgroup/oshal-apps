//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Bound stdin and return one JSON result from the isolated compositor worker.
//! 2 | maintainer@emeraldcoastsystemsgroup.com | Report compiled source identity and bind every worker result to the bridge handshake.
use std::io::{Read, Write};
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args == ["--identity"] {
        if serde_json::to_writer(std::io::stdout().lock(), &serde_json::json!({
            "protocol":1,"buildHash":env!("MOTION_ADAPTER_BUILD_HASH"),"upstream":oshal_motion_engine::UPSTREAM
        })).is_err() { std::process::exit(1); }
        return;
    }
    if !args.is_empty() {
        std::process::exit(2);
    }
    let mut bytes = Vec::new();
    if let Err(error) = std::io::stdin()
        .take((oshal_motion_engine::MAX_REQUEST + 1) as u64)
        .read_to_end(&mut bytes)
    {
        eprintln!("motion input failed: {error}");
        std::process::exit(1);
    }
    let mut result = oshal_motion_engine::handle(&bytes);
    if let Some(fields) = result.as_object_mut() {
        fields.insert(
            "buildHash".into(),
            serde_json::json!(env!("MOTION_ADAPTER_BUILD_HASH")),
        );
    }
    let write = serde_json::to_writer(std::io::stdout().lock(), &result).and_then(|()| {
        std::io::stdout()
            .write_all(b"\n")
            .map_err(serde_json::Error::io)
    });
    if let Err(error) = write {
        eprintln!("motion output failed: {error}");
        std::process::exit(1);
    }
    if result.get("ok") != Some(&serde_json::Value::Bool(true)) {
        std::process::exit(2);
    }
}
