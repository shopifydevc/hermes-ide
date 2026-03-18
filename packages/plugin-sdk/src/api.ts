// ─── Core Types ──────────────────────────────────────────

export interface Disposable {
	dispose(): void;
}

export interface PluginPanelProps {
	pluginId: string;
	panelId: string;
}

// ─── Manifest Types ──────────────────────────────────────

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	author: string;
	activationEvents: ActivationEvent[];
	contributes: PluginContributions;
	permissions?: PluginPermission[];
}

export type ActivationEvent =
	| { type: "onStartup" }
	| { type: "onCommand"; command: string }
	| { type: "onView"; viewId: string };

export interface PluginContributions {
	commands?: PluginCommandContribution[];
	panels?: PluginPanelContribution[];
	statusBarItems?: PluginStatusBarItem[];
	sessionActions?: PluginSessionActionContribution[];
	settings?: PluginSettingsSchema;
}

export interface PluginSessionActionContribution {
	id: string;
	panelId: string;
	name: string;
	icon: string;
}

export interface PluginCommandContribution {
	command: string;
	title: string;
	category?: string;
	keybinding?: string;
}

export interface PluginPanelContribution {
	id: string;
	name: string;
	side: "left" | "right";
	icon: string;
}

export interface PluginStatusBarItem {
	id: string;
	text: string;
	tooltip?: string;
	alignment: "left" | "right";
	priority?: number;
	command?: string;
}

export type PluginPermission =
	| "clipboard.read"
	| "clipboard.write"
	| "storage"
	| "terminal.read"
	| "terminal.write"
	| "sessions.read"
	| "notifications"
	| "network"
	| "shell.exec";

// ─── Settings Schema ─────────────────────────────────────

export interface PluginSettingsSchema {
	[key: string]: PluginSettingDefinition;
}

export type PluginSettingDefinition =
	| PluginSettingString
	| PluginSettingNumber
	| PluginSettingBoolean
	| PluginSettingSelect;

interface PluginSettingBase {
	title: string;
	description?: string;
	order?: number;
}

export interface PluginSettingString extends PluginSettingBase {
	type: "string";
	default: string;
	placeholder?: string;
	maxLength?: number;
}

export interface PluginSettingNumber extends PluginSettingBase {
	type: "number";
	default: number;
	min?: number;
	max?: number;
	step?: number;
}

export interface PluginSettingBoolean extends PluginSettingBase {
	type: "boolean";
	default: boolean;
}

export interface PluginSettingSelect extends PluginSettingBase {
	type: "select";
	default: string;
	options: { value: string; label: string }[];
}

// ─── Events ──────────────────────────────────────────────

export type HermesEvent =
	| "theme.changed"
	| "session.created"
	| "session.closed"
	| "window.focused"
	| "window.blurred";

// ─── Plugin API ──────────────────────────────────────────

export interface HermesPluginAPI {
	ui: {
		registerPanel(panelId: string, component: React.ComponentType<PluginPanelProps>): Disposable;
		showPanel(panelId: string): void;
		hidePanel(panelId: string): void;
		togglePanel(panelId: string): void;
		showToast(message: string, options?: { type?: "info" | "success" | "warning" | "error"; duration?: number }): void;
		updateStatusBarItem(itemId: string, update: { text?: string; tooltip?: string; visible?: boolean }): void;
		updateSessionActionBadge(actionId: string, badge: { text?: string; count?: number }): void;
	};
	commands: {
		register(commandId: string, handler: () => void | Promise<void>): Disposable;
		execute(commandId: string): Promise<void>;
	};
	clipboard: {
		readText(): Promise<string>;
		writeText(text: string): Promise<void>;
	};
	storage: {
		get(key: string): Promise<string | null>;
		set(key: string, value: string): Promise<void>;
		delete(key: string): Promise<void>;
	};
	settings: {
		get<T = string | number | boolean>(key: string): Promise<T>;
		update(key: string, value: string | number | boolean): Promise<void>;
		onDidChange(key: string, callback: (newValue: string | number | boolean) => void): Disposable;
		getAll(): Promise<Record<string, string | number | boolean>>;
	};
	events: {
		on(event: HermesEvent, callback: (...args: any[]) => void): Disposable;
	};
	notifications: {
		send(options: { title: string; body?: string }): Promise<void>;
	};
	network: {
		/** Fetch a URL and return the response body as text. Requires "network" permission. */
		fetch(url: string): Promise<string>;
	};
	shell: {
		/** Open a URL in the user's default browser. Requires "network" permission. */
		openExternal(url: string): Promise<void>;
		/** Execute a shell command and return its output. Requires "shell.exec" permission. */
		exec(command: string, args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
	};
	sessions: {
		getActive(): Promise<{ id: string; name: string } | null>;
		list(): Promise<{ id: string; name: string }[]>;
		focus(sessionId: string): Promise<void>;
	};
	agents: {
		/** Watch a session's AI agent transcript in real time. Requires "sessions.read" permission. */
		watchTranscript(
			sessionId: string,
			callback: (event: { type: string; tool_name?: string; timestamp: number; session_id: string }) => void,
		): Promise<Disposable>;
	};
	subscriptions: Disposable[];
}
