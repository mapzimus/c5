export const GAME_PARAM = "game";

export function gameIdFromSearch(search: string, known: Iterable<string>): string | null {
  const wanted = new URLSearchParams(search).get(GAME_PARAM)?.trim().toLowerCase();
  if (!wanted) return null;
  for (const id of known) {
    if (id.toLowerCase() === wanted) return id;
  }
  return null;
}

export function searchWithGame(search: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id) params.set(GAME_PARAM, id);
  else params.delete(GAME_PARAM);
  const query = params.toString();
  return query ? `?${query}` : "";
}
