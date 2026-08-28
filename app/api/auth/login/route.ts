import { createSessionCookie, validateCredentials } from "../../../auth";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      username?: string;
      password?: string;
    };
    const username = String(payload.username || "").slice(0, 100);
    const password = String(payload.password || "").slice(0, 200);
    if (!(await validateCredentials(username, password))) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return Response.json(
        { error: "Usuário ou senha incorretos." },
        { status: 401 },
      );
    }
    const secureCookie = new URL(request.url).protocol === "https:";
    return Response.json(
      { authenticated: true },
      { headers: { "set-cookie": await createSessionCookie(secureCookie) } },
    );
  } catch (error) {
    console.error("Falha ao iniciar sessão no GMOBS", error);
    return Response.json(
      { error: "Não foi possível entrar agora." },
      { status: 500 },
    );
  }
}
