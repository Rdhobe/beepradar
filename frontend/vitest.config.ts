import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    },
  },
});