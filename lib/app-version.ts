import packageJson from "../package.json";

/** Display version from package.json (e.g. 2.3.0 → Version 2.3). */
export function getAppVersionLabel(): string {
  const [major, minor] = packageJson.version.split(".");
  return `Version ${major}.${minor ?? "0"}`;
}
