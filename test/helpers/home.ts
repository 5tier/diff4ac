import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDirectory, removeTempDirectory } from "./cleanup";

export interface TempHome {
  readonly path: string;
  readonly configDirectory: string;
  readonly globalConfigPath: string;
  writeGlobalConfig(value: unknown): string;
  dispose(): void;
}

export function createTempHome(): TempHome {
  const path = realpathSync(createTempDirectory("diff4ac-home-"));
  const configDirectory = join(path, ".diff4ac");
  const globalConfigPath = join(configDirectory, "config.json");

  return {
    path,
    configDirectory,
    globalConfigPath,
    writeGlobalConfig(value) {
      mkdirSync(configDirectory, { recursive: true });
      writeFileSync(
        globalConfigPath,
        typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
      );
      return globalConfigPath;
    },
    dispose() {
      removeTempDirectory(path);
    },
  };
}
