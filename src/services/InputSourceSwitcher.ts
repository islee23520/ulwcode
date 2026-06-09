import { execFile } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { OutputChannelService } from "./OutputChannelService";

export type KeyboardInputSourceTarget = "english" | "korean";

type InputSourceSwitcherLogger = Pick<OutputChannelService, "debug" | "warn">;

interface InputSourceSwitcherOptions {
  readonly platform?: NodeJS.Platform;
  readonly swiftPath?: string;
  readonly tmpDir?: string;
  readonly logger?: InputSourceSwitcherLogger;
}

const INPUT_SOURCE_SWIFT = `
import Carbon
import Foundation

let target = CommandLine.arguments.dropFirst().first ?? ""
let sourceIds: [String]

switch target {
case "english":
  sourceIds = ["com.apple.keylayout.ABC", "com.apple.keylayout.US"]
case "korean":
  sourceIds = [
    "com.apple.inputmethod.Korean.2SetKorean",
    "com.apple.inputmethod.Korean",
    "com.apple.inputmethod.Korean.390Sebulshik",
    "com.apple.inputmethod.Korean.GongjinCheongRomaja"
  ]
default:
  exit(64)
}

for sourceId in sourceIds {
  let filter = [kTISPropertyInputSourceID as String: sourceId] as CFDictionary
  guard let unmanagedList = TISCreateInputSourceList(filter, false) else {
    continue
  }
  let list = unmanagedList.takeRetainedValue() as NSArray
  guard let source = list.firstObject else {
    continue
  }
  let status = TISSelectInputSource(source as! TISInputSource)
  exit(status == noErr ? 0 : 70)
}

exit(69)
`;

const execFileAsync = (file: string, args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

export class InputSourceSwitcher {
  private readonly platform: NodeJS.Platform;
  private readonly swiftPath: string;
  private readonly tmpDir: string;
  private readonly logger?: InputSourceSwitcherLogger;
  private lastRequestedTarget: KeyboardInputSourceTarget | undefined;

  public constructor(options: InputSourceSwitcherOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.swiftPath = options.swiftPath ?? "/usr/bin/swift";
    this.tmpDir = options.tmpDir ?? os.tmpdir();
    this.logger = options.logger;
  }

  public async switchTo(target: KeyboardInputSourceTarget): Promise<void> {
    if (this.platform !== "darwin") {
      return;
    }

    if (this.lastRequestedTarget === target) {
      return;
    }

    this.lastRequestedTarget = target;
    const scriptPath = path.join(
      this.tmpDir,
      `ulw-input-source-${randomUUID()}.swift`,
    );

    try {
      await fs.writeFile(scriptPath, INPUT_SOURCE_SWIFT, "utf8");
      await execFileAsync(this.swiftPath, [scriptPath, target]);
      this.logger?.debug(`[InputSourceSwitcher] switched to ${target}`);
    } catch (error) {
      this.logger?.warn(
        `[InputSourceSwitcher] failed to switch to ${target}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      await fs.unlink(scriptPath).catch(() => undefined);
    }
  }
}
