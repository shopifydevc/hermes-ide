// ─── Settings API ─────────────────────────────────────────────────────
//
// All app settings are stored as key-value pairs in the settings table.
// Valid keys are defined in VALID_SETTING_KEYS (src-tauri/src/db/mod.rs).
//
// Export/Import:
//   - exportSettings() writes a JSON file with all non-machine-specific
//     settings plus metadata (_hermes_export_version, _hermes_app_version).
//   - importSettings() reads the file, skips unknown/metadata keys, and
//     returns the merged settings map.
//   - Machine-specific keys (window geometry, workspace layout, etc.) are
//     excluded from export via EXPORT_EXCLUDED_KEYS in the Rust backend.
//
// Plugin settings are stored in a separate table (plugin_storage) and
// are NOT included in app settings export/import.
//
// When adding new settings: update VALID_SETTING_KEYS in db/mod.rs.

import { invoke } from "@tauri-apps/api/core";

export type SettingsMap = Record<string, string>;

export function getSettings(): Promise<SettingsMap> {
  return invoke<SettingsMap>("get_settings");
}

export async function getSetting(key: string): Promise<string> {
  // NOTE: There is no singular "get_setting" Tauri command — only "get_settings"
  // (plural) is registered.  We fetch all settings and extract the requested key.
  const all = await invoke<SettingsMap>("get_settings");
  return all[key] ?? "";
}

export function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

export function exportSettings(path: string): Promise<void> {
  return invoke("export_settings", { path });
}

export function importSettings(path: string): Promise<SettingsMap> {
  return invoke<SettingsMap>("import_settings", { path });
}
