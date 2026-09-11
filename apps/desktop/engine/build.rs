fn main() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../package.json");
    println!("cargo:rerun-if-changed={}", path.display());
    let package: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    println!(
        "cargo:rustc-env=COMPANION_RELEASE={}",
        package["version"].as_str().unwrap()
    );
}
