import { invoke } from '@tauri-apps/api/core';

export async function setMinimizeToTrayOnClose(enabled: boolean) {
  await invoke('set_minimize_to_tray_on_close', { enabled });
}
