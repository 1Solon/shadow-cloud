fn main() {
    println!("cargo:rerun-if-env-changed=SHADOW_CLOUD_API_URL");
    tauri_build::build()
}
