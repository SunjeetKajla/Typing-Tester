import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SERVER_FALLBACK = "http://localhost:8000";

function backendUrl(path: string) {
  return new URL(path, process.env.SERVER_URL || SERVER_FALLBACK);
}

function forwardHeaders(request: NextRequest) {
  const headers = new Headers();
  for (const name of ["cookie", "origin", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function POST(request: NextRequest) {
  try {
    const upstream = await fetch(backendUrl("/api/results"), {
      method: "POST",
      headers: forwardHeaders(request),
      body: await request.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const body = await upstream.arrayBuffer();
    const response = new NextResponse(body, { status: upstream.status });
    const contentType = upstream.headers.get("content-type");
    if (contentType) response.headers.set("content-type", contentType);
    for (const cookie of upstream.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "Could not save the result. Please try again." } },
      { status: 503 },
    );
  }
}
