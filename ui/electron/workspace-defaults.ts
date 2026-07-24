import defaultPrompt from "../../prompt.default.md?raw";
import defaultConfig from "../../auto-rob.config.json?raw";
import cursorCliJson from "../../.cursor/cli.json?raw";
import cursorPermissionsJson from "../../.cursor/permissions.json?raw";
import envExample from "../../.env.example?raw";
import type { WorkspaceDefaults } from "../../workspace";

export const BUNDLED_WORKSPACE_DEFAULTS: WorkspaceDefaults = {
	promptDefault: defaultPrompt,
	configJson: defaultConfig,
	cursorCliJson,
	cursorPermissionsJson,
	envExample,
};
