pub struct ServiceConfiguration {
    pub api_base_url: String,
    pub web_base_url: String,
}

impl ServiceConfiguration {
    pub fn resolve(development: bool, lookup: impl Fn(&str) -> Option<String>) -> Self {
        if !development {
            return Self {
                api_base_url: "https://shadow-cloud.solonsstuff.com".into(),
                web_base_url: "https://shadow-cloud.solonsstuff.com".into(),
            };
        }
        let value = |name| lookup(name).filter(|value| !value.trim().is_empty());
        Self {
            api_base_url: value("SHADOW_CLOUD_API_URL").unwrap_or_else(|| {
                let port = value("PORT")
                    .or_else(|| value("API_PORT"))
                    .unwrap_or_else(|| "3001".into());
                format!("http://localhost:{port}")
            }),
            web_base_url: value("SHADOW_CLOUD_WEB_URL")
                .or_else(|| value("AUTH_URL"))
                .unwrap_or_else(|| {
                    let port = value("WEB_PORT").unwrap_or_else(|| "3000".into());
                    format!("http://localhost:{port}")
                }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ServiceConfiguration;

    #[test]
    fn tauri_dev_defaults_to_the_local_api_and_webui() {
        let configuration = ServiceConfiguration::resolve(true, |_| None);
        assert_eq!(configuration.api_base_url, "http://localhost:3001");
        assert_eq!(configuration.web_base_url, "http://localhost:3000");
    }

    #[test]
    fn tauri_dev_uses_the_same_configured_endpoints_as_the_web_stack() {
        let configuration = ServiceConfiguration::resolve(true, |name| match name {
            "SHADOW_CLOUD_API_URL" => Some("http://localhost:3101".into()),
            "AUTH_URL" => Some("http://localhost:3200".into()),
            _ => None,
        });
        assert_eq!(configuration.api_base_url, "http://localhost:3101");
        assert_eq!(configuration.web_base_url, "http://localhost:3200");
    }

    #[test]
    fn tauri_dev_honors_custom_api_and_web_ports_without_explicit_urls() {
        let configuration = ServiceConfiguration::resolve(true, |name| match name {
            "API_PORT" => Some("3101".into()),
            "WEB_PORT" => Some("3200".into()),
            _ => None,
        });
        assert_eq!(configuration.api_base_url, "http://localhost:3101");
        assert_eq!(configuration.web_base_url, "http://localhost:3200");
    }

    #[test]
    fn explicit_urls_take_priority_over_auth_url_and_port_settings() {
        let configuration = ServiceConfiguration::resolve(true, |name| match name {
            "SHADOW_CLOUD_API_URL" => Some("http://localhost:4101".into()),
            "SHADOW_CLOUD_WEB_URL" => Some("http://localhost:4200".into()),
            "AUTH_URL" => Some("http://localhost:5200".into()),
            "PORT" | "API_PORT" | "WEB_PORT" => Some("6100".into()),
            _ => None,
        });
        assert_eq!(configuration.api_base_url, "http://localhost:4101");
        assert_eq!(configuration.web_base_url, "http://localhost:4200");
    }

    #[test]
    fn the_api_port_precedence_matches_the_api_server() {
        let configuration = ServiceConfiguration::resolve(true, |name| match name {
            "PORT" => Some("4101".into()),
            "API_PORT" => Some("3101".into()),
            _ => None,
        });
        assert_eq!(configuration.api_base_url, "http://localhost:4101");
    }

    #[test]
    fn packaged_builds_ignore_local_environment_settings() {
        let configuration = ServiceConfiguration::resolve(false, |_| {
            panic!("packaged builds must not read development environment settings")
        });
        assert_eq!(
            configuration.api_base_url,
            "https://shadow-cloud.solonsstuff.com"
        );
        assert_eq!(
            configuration.web_base_url,
            "https://shadow-cloud.solonsstuff.com"
        );
    }
}
