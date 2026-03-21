import type { CollectionEntry } from "astro:content";
import postFilter from "./postFilter";
import { SITE } from "@/config";

const getSortedPosts = (posts: CollectionEntry<"blog">[]) => {
  const filtered = posts.filter(postFilter);

  if (SITE.defaultSort === "pinned-date") {
    // Posts with a sortOrder number are pinned first (ascending by sortOrder),
    // then the remaining posts sorted newest-first.
    const pinned = filtered
      .filter(p => p.data.sortOrder !== undefined)
      .sort((a, b) => (a.data.sortOrder as number) - (b.data.sortOrder as number));

    const rest = filtered
      .filter(p => p.data.sortOrder === undefined)
      .sort(
        (a, b) =>
          Math.floor(
            new Date(b.data.modDatetime ?? b.data.pubDatetime).getTime() / 1000
          ) -
          Math.floor(
            new Date(a.data.modDatetime ?? a.data.pubDatetime).getTime() / 1000
          )
      );

    return [...pinned, ...rest];
  }

  // Default: "date-desc" — newest first
  return filtered.sort(
    (a, b) =>
      Math.floor(
        new Date(b.data.modDatetime ?? b.data.pubDatetime).getTime() / 1000
      ) -
      Math.floor(
        new Date(a.data.modDatetime ?? a.data.pubDatetime).getTime() / 1000
      )
  );
};

export default getSortedPosts;
