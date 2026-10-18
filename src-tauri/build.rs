fn main() {
    link_clang_runtime();
    tauri_build::build()
}

/// whisper.cpp's Metal backend uses Objective-C `@available` checks, which
/// call `___isPlatformVersionAtLeast` from the clang runtime. Rust links with
/// `-nodefaultlibs`, and with LTO (release builds) nothing else provides it.
fn link_clang_runtime() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let Ok(out) = std::process::Command::new("cc").arg("--print-file-name=libclang_rt.osx.a").output() else {
        return;
    };
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if std::path::Path::new(&path).is_absolute() && std::path::Path::new(&path).exists() {
        println!("cargo:rustc-link-arg-bins={path}");
    }
}
