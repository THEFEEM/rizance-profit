import packageJson from "../package.json";

/** Display version from package.json (e.g. 2.0.0 → v2.0). */
export function getAppVersionLabel(): string {
  const [major, minor] = packageJson.version.split(".");
  return `v${major}.${minor ?? "0"}`;
}
