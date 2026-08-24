import { authenticatedUsername } from "../../../auth";

export async function GET(request: Request) {
  const username = await authenticatedUsername(request);
  return username
    ? Response.json({ authenticated: true, username })
    : Response.json({ authenticated: false }, { status: 401 });
}
