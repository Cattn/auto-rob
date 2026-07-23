import type { AutoRobApi } from "../../shared/ipc";

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		autoRob?: AutoRobApi;
	}
}

export {};
