mod service_config;

use std::{collections::HashMap, path::Path};

fn main() {
    for variable in [
        "SHADOW_CLOUD_API_URL",
        "SHADOW_CLOUD_WEB_URL",
        "AUTH_URL",
        "PORT",
        "API_PORT",
        "WEB_PORT",
    ] {
        println!("cargo:rerun-if-env-changed={variable}");
    }
    if tauri_build::is_dev() {
        // Direct `tauri dev` must read the same root environment as `pnpm dev`.
        // Only the resolved service URLs are embedded, never other .env values.
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.env");
        println!("cargo:rerun-if-changed={}", path.display());
        let mut file_environment = HashMap::new();
        match dotenvy::from_path_iter(&path) {
            Ok(entries) => {
                for entry in entries {
                    let (key, value) = entry.unwrap_or_else(|_| {
                        panic!("could not parse the root development .env file")
                    });
                    file_environment.insert(key, value);
                }
            }
            Err(dotenvy::Error::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => panic!("could not read the root development .env file"),
        }
        let configuration = service_config::ServiceConfiguration::resolve(true, |variable| {
            std::env::var(variable)
                .ok()
                .or_else(|| file_environment.get(variable).cloned())
        });
        println!(
            "cargo:rustc-env=SHADOW_CLOUD_DEV_API_URL={}",
            configuration.api_base_url
        );
        println!(
            "cargo:rustc-env=SHADOW_CLOUD_DEV_WEB_URL={}",
            configuration.web_base_url
        );
    }
    tauri_build::build()
}
