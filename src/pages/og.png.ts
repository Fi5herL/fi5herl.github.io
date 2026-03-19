import type { APIRoute } from "astro";

// Static OG image — dynamic generation requires Google Fonts network access.
// The astropaper-og.jpg in public/ is used as the default site OG image.
export const GET: APIRoute = async () => {
  return new Response(null, {
    status: 302,
    headers: { Location: "/astropaper-og.jpg" },
  });
};
