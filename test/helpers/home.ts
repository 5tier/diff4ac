import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempHome {
  readonly path: string;
  readonly configDirectory: string;
  readonly globalConfigPath: string;
  writeGlobalConfig(value: unknown): string;
  dispose(): void;
}

export function createTempHome(): TempHome {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "diff4ac-home-")));
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
      rmSync(path, { recursive: true, force: true });
    },
  };
}
