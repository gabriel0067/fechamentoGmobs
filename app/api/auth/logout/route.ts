import { clearSessionCookie } from "../../../auth";

export async function POST() {
  return Response.json(
    { authenticated: false },
    { headers: { "set-cookie": clearSessionCookie() } },
  );
}
