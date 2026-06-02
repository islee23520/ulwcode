import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ulwcode",
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "out"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
      exclude: [
        "node_modules/",
        "dist/",
        "out/",
        "src/**/*.test.ts",
        "src/webview/**",
      ],
    },
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      vscode: "./src/test/mocks/vscode.ts",
    },
  },
});
