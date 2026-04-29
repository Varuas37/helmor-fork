// Vite config used only by the Playwright E2E harness. It aliases every
// @tauri-apps/* module the frontend touches to a browser-safe mock under
// src/test/e2e-mocks/*, so the React app can boot in plain WebKit without
// a running Rust backend.
//
// Entry: same `index.html` -> `src/main.tsx`. The only difference from the
// production Vite config is the alias table + a dedicated port.

import path from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const MOCK_DIR = path.resolve(__dirname, "./src/test/e2e-mocks");

export default defineConfig({
	plugins: [
		react(),
		babel({
			plugins: [["babel-plugin-react-compiler", {}]],
		}),
		tailwindcss(),
	],
	resolve: {
		dedupe: ["react", "react-dom"],
		alias: {
			"@": path.resolve(__dirname, "./src"),
			react: path.resolve(__dirname, "./node_modules/react"),
			"react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
			"react/jsx-runtime": path.resolve(
				__dirname,
				"./node_modules/react/jsx-runtime.js",
			),
			"react/jsx-dev-runtime": path.resolve(
				__dirname,
				"./node_modules/react/jsx-dev-runtime.js",
			),
			"@tauri-apps/api/core": path.resolve(MOCK_DIR, "tauri-core.ts"),
			"@tauri-apps/api/event": path.resolve(MOCK_DIR, "tauri-event.ts"),
			"@tauri-apps/api/window": path.resolve(MOCK_DIR, "tauri-window.ts"),
			"@tauri-apps/api/webview": path.resolve(MOCK_DIR, "tauri-webview.ts"),
			"@tauri-apps/plugin-opener": path.resolve(MOCK_DIR, "plugin-opener.ts"),
			"@tauri-apps/plugin-dialog": path.resolve(MOCK_DIR, "plugin-dialog.ts"),
			"@tauri-apps/plugin-notification": path.resolve(
				MOCK_DIR,
				"plugin-notification.ts",
			),
		},
	},
	optimizeDeps: {
		include: [
			"react",
			"react-dom",
			"react/jsx-runtime",
			"react/jsx-dev-runtime",
			"@tanstack/react-query",
			"lucide-react",
		],
		exclude: ["lexical", "@lexical/react"],
	},
	clearScreen: false,
	server: {
		port: 1430,
		strictPort: true,
	},
});
