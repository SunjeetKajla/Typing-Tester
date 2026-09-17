import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SERVER_FALLBACK = "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const headers = new Headers();
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);

    const upstream = await fetch(new URL("/api/results/me", process.env.SERVER_URL || SERVER_FALLBACK), {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const body = await upstream.arrayBuffer();
    const response = new NextResponse(body, { status: upstream.status });
    const contentType = upstream.headers.get("content-type");
    if (contentType) response.headers.set("content-type", contentType);
    for (const setCookie of upstream.headers.getSetCookie()) response.headers.append("set-cookie", setCookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "Could not load your results." } },
      { status: 503 },
    );
  }
}
