import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Search public YouTube results; only return IDs with verified player metadata. */
export const searchSongs = createServerFn({ method: "GET" })
  .inputValidator((query: string) => z.string().trim().min(2).max(100).parse(query))
  .handler(async ({ data }) => {
    try {
      const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(data + " song")}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!response.ok) return { songs: [], error: "Song search is unavailable right now." };
      const html = await response.text();
      const ids = [...html.matchAll(/"videoRenderer":\{"videoId":"([\w-]{11})"/g)]
        .map((match) => match[1])
        .filter((id): id is string => Boolean(id));
      const unique = [...new Set(ids)].slice(0, 8);
      const songs = await Promise.all(unique.map(async (id) => {
        try {
          const result = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
          if (!result.ok) return null;
          const meta = await result.json() as { title?: string; author_name?: string };
          return meta.title ? { id, title: meta.title, artist: meta.author_name ?? "YouTube" } : null;
        } catch { return null; }
      }));
      const valid = songs.filter((song): song is NonNullable<typeof song> => song !== null).slice(0, 5);
      return { songs: valid, error: valid.length ? null : "No playable songs found. Try another title." };
    } catch {
      return { songs: [], error: "Song search is unavailable right now." };
    }
  });