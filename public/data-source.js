// The application and static showcase share rendering; only their data source differs.
export function createDashboardSource({ staticDataUrl = null, fetcher = fetch } = {}) {
  let bundle;
  async function json(url) {
    const response = await fetcher(url, { headers: { accept: "application/json" }, cache: staticDataUrl ? "default" : "no-store" });
    if (!response.ok) throw new Error(`Dashboard data request failed with HTTP ${response.status}`);
    return response.json();
  }
  function staticBundle() {
    bundle ??= json(staticDataUrl).catch(error => { bundle = undefined; throw error; });
    return bundle;
  }
  async function snapshot(state) {
    if (!staticDataUrl) return json(state ? `/api/v1/dashboard?demo=${encodeURIComponent(state)}` : "/api/v1/dashboard");
    const data = await staticBundle();
    const selected = state || "showcase";
    if (!Object.hasOwn(data.snapshots, selected)) throw new Error("Unknown demo scenario");
    const result = structuredClone(data.snapshots[selected]);
    for (const movie of result.panels.movies?.data?.movies ?? []) {
      if (movie.posterUrl?.startsWith("/assets/demo-posters/")) movie.posterUrl = new URL(`.${movie.posterUrl}`, staticDataUrl).href;
    }
    return result;
  }
  return {
    isStatic: Boolean(staticDataUrl),
    configuration: async () => staticDataUrl ? (await staticBundle()).configuration : json("/api/v1/configuration"),
    snapshot,
    episodes: async (date, state) => {
      if (!staticDataUrl) {
        const demo = state ? `&demo=${encodeURIComponent(state)}` : "";
        return json(`/api/v1/episodes?date=${encodeURIComponent(date)}${demo}`);
      }
      const data = (await snapshot(state)).panels.episodes.data;
      return data?.localDate === date ? data : { localDate: date, episodes: [] };
    },
  };
}
