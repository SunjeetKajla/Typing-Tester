import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function proxy(request: NextRequest) {
  // The public origin can be HTTPS even when the container receives HTTP.
  const publicUrl = new URL(process.env.WEB_URL || request.nextUrl.origin);
  const headers = new Headers();
  for (const name of ["cookie", "origin", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-forwarded-proto", publicUrl.protocol.replace(":", ""));

  try {
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, process.env.SERVER_URL || "http://localhost:8000");
    const upstream = await fetch(url, {
      method: request.method, headers, redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const response = new NextResponse(await upstream.arrayBuffer(), { status: upstream.status });
    for (const name of ["content-type", "location"]) {
      const value = upstream.headers.get(name);
      if (value) response.headers.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    if (request.nextUrl.pathname.includes("/google")) {
      return NextResponse.redirect(new URL("/?auth_error=unavailable", publicUrl));
    }
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
