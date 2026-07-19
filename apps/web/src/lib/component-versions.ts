import rootPackage from "../../../../package.json";

export function resolveApplicationVersion(
  environment: { SHADOW_CLOUD_VERSION?: string } = process.env as unknown as {
    SHADOW_CLOUD_VERSION?: string;
  },
) {
  return environment.SHADOW_CLOUD_VERSION || rootPackage.version;
}

export const applicationVersion = resolveApplicationVersion();
export const componentVersionStatus = `VERSION: v${applicationVersion}`;
