export const releasesPageUrl =
  "https://github.com/1Solon/shadow-cloud/releases";

const releasesApiUrl =
  "https://api.github.com/repos/1Solon/shadow-cloud/releases?per_page=10";

export type Release = {
  name: string;
  publishedAt: string;
  body: string;
};

type GitHubRelease = {
  name: string | null;
  tag_name: string;
  published_at: string | null;
  body: string | null;
};

export async function listReleases(): Promise<Release[]> {
  try {
    const response = await fetch(releasesApiUrl, {
      headers: { accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return [];
    }

    const releases = (await response.json()) as GitHubRelease[];

    return releases.map((release) => ({
      name: release.name || release.tag_name,
      publishedAt: release.published_at ?? "",
      body: release.body ?? "",
    }));
  } catch {
    return [];
  }
}
