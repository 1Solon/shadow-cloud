use shadow_cloud_companion_engine::{Command, ConnectionState, Engine, Theme, RELEASE};

#[test]
fn exact_protocol_match_is_required_before_the_companion_can_connect() {
    let mut engine = Engine::new();
    assert_eq!(
        engine.snapshot().connection.state,
        ConnectionState::Checking
    );

    engine.observe_protocol(Ok("0.0.0".into()));
    let mismatch = engine.snapshot();
    assert_eq!(mismatch.connection.state, ConnectionState::UpdateRequired);
    assert!(mismatch.read_only);
    assert_eq!(
        mismatch.connection.server_protocol_version.as_deref(),
        Some("0.0.0")
    );

    // Read-only protection does not lock the player out of interface preferences.
    engine
        .command(Command::SetTheme {
            theme: Theme::Light,
        })
        .unwrap();
    assert_eq!(engine.snapshot().preferences.theme, Theme::Light);
    assert_eq!(
        engine.snapshot().connection.state,
        ConnectionState::UpdateRequired
    );

    engine.observe_protocol(Ok(RELEASE.into()));
    assert_eq!(
        engine.snapshot().connection.state,
        ConnectionState::Connected
    );
    assert!(!engine.snapshot().read_only);
}

#[test]
fn subscriptions_replay_the_latest_revision_and_coalesce_unread_changes() {
    let mut engine = Engine::new();
    let mut subscriber = engine.subscribe();
    assert_eq!(subscriber.borrow_and_update().revision, 0);

    engine
        .command(Command::SetTheme { theme: Theme::Dark })
        .unwrap();
    engine.command(Command::SetPaused { paused: true }).unwrap();
    assert!(subscriber.has_changed().unwrap());
    let latest = subscriber.borrow_and_update().clone();
    assert_eq!(latest.revision, 2);
    assert_eq!(latest.preferences.theme, Theme::Dark);
    assert!(latest.paused);
    assert!(!subscriber.has_changed().unwrap());

    // A window recreated after these changes receives current state, not a stale initial view.
    assert_eq!(engine.subscribe().borrow().revision, 2);
    engine.command(Command::SetPaused { paused: true }).unwrap();
    assert!(!subscriber.has_changed().unwrap());
}

#[test]
fn a_failed_connection_does_not_clear_a_known_protocol_mismatch_or_player_preferences() {
    use shadow_cloud_companion_engine::CommandError;
    let mut engine = Engine::new();
    engine.command(Command::SetPaused { paused: true }).unwrap();
    engine
        .command(Command::SetAutomaticUploads { enabled: false })
        .unwrap();
    engine.observe_protocol(Ok("0.0.0".into()));
    engine.observe_protocol(Err(()));
    let before = engine.snapshot();
    assert!(before.read_only);
    assert!(!before.connection.reachable);
    assert!(before.paused);
    assert!(!before.preferences.automatic_uploads);
    assert_eq!(
        engine.command(Command::SetPaused { paused: false }),
        Err(CommandError::UpdateRequired)
    );
    assert_eq!(
        engine.command(Command::SetAutomaticUploads { enabled: true }),
        Err(CommandError::UpdateRequired)
    );
    assert_eq!(engine.snapshot(), before);
    engine.observe_protocol(Ok(RELEASE.into()));
    assert!(engine.snapshot().connection.reachable);
    assert!(engine.snapshot().paused);
    assert!(!engine.snapshot().preferences.automatic_uploads);
}

#[test]
fn typed_commands_reject_unknown_fields_and_never_offer_force_send() {
    for command in [
        r#"{"type":"force-send","campaignId":"campaign"}"#,
        r#"{"type":"set-theme","theme":"dark","token":"secret"}"#,
        r#"{"type":"set-paused","paused":"false"}"#,
    ] {
        assert!(serde_json::from_str::<Command>(command).is_err());
    }
}
