import { clearSessionCookie } from "../../../auth";

export async function POST(request: Request) {
  const secureCookie = new URL(request.url).protocol === "https:";
  return Response.json(
    { authenticated: false },
    { headers: { "set-cookie": clearSessionCookie(secureCookie) } },
  );
}
