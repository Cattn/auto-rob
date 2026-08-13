import fs from "node:fs";
import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import MakerAppImage from "@reforged/maker-appimage";
import { MakerZIP } from "@electron-forge/maker-zip"
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const require = createRequire(import.meta.url);

const KEEP_PAK = new Set(["en-US.pak", "en-GB.pak"]);
const KEEP_LPROJ = new Set([
  "en.lproj",
  "en_US.lproj",
  "en_GB.lproj",
  "Base.lproj",
  "English.lproj",
]);

async function trimElectronLocales(buildPath: string, platform: string) {
  if (platform === "win32" || platform === "linux") {
    const localesDir = path.resolve(buildPath, "..", "..", "locales");
    let names: string[];
    try {
      names = await readdir(localesDir);
    } catch {
      return;
    }
    await Promise.all(
      names
        .filter((name) => name.endsWith(".pak") && !KEEP_PAK.has(name))
        .map((name) => rm(path.join(localesDir, name), { force: true })),
    );
    return;
  }

  if (platform !== "darwin" && platform !== "mas") return;

  const frameworkResources = path.resolve(
    buildPath,
    "..",
    "..",
    "Frameworks",
    "Electron Framework.framework",
    "Versions",
    "A",
    "Resources",
  );
  let names: string[];
  try {
    names = await readdir(frameworkResources);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.endsWith(".lproj") && !KEEP_LPROJ.has(name))
      .map((name) =>
        rm(path.join(frameworkResources, name), { recursive: true, force: true }),
      ),
  );
}

function ensureSquirrelVendor() {
  if (process.platform !== "win32") return;

  if (!process.env.SQUIRREL_TEMP) {
    const temp = path.join(os.tmpdir(), "SquirrelTemp");
    fs.mkdirSync(temp, { recursive: true });
    process.env.SQUIRREL_TEMP = temp;
  }

  const vendorDir = path.join(
    path.dirname(require.resolve("electron-winstaller/package.json")),
    "vendor",
  );
  const arch = os.arch();
  fs.copyFileSync(
    path.join(vendorDir, `7z-${arch}.exe`),
    path.join(vendorDir, "7z.exe"),
  );
  fs.copyFileSync(
    path.join(vendorDir, `7z-${arch}.dll`),
    path.join(vendorDir, "7z.dll"),
  );
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  hooks: {
    preMake: async () => {
      ensureSquirrelVendor();
    },
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform) => {
      await trimElectronLocales(buildPath, platform);
    },
  },
  makers: [
    new MakerSquirrel({
      name: "electronSvelte",
      authors: "auto-rob",
      description: "Electron Svelte",
      exe: "electron-svelte.exe",
      setupExe: "electron-svelte-Setup.exe",
    }),
    new MakerDMG({}),
    new MakerRpm({
      options: {
        license: "ISC",
      },
    }),
    new MakerDeb({}),
    new MakerAppImage({
      options: {
        categories: ["Finance"],
      },
    }),
    new MakerZIP({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "electron/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "electron/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.config.ts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
