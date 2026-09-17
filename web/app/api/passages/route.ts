import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const upstreamUrl = new URL("/api/passages", process.env.SERVER_URL || "http://localhost:8000");
    upstreamUrl.search = request.nextUrl.search;
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = await upstream.arrayBuffer();
    const response = new NextResponse(body, { status: upstream.status });
    const contentType = upstream.headers.get("content-type");
    if (contentType) response.headers.set("content-type", contentType);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "Could not generate a passage. Please try again." } },
      { status: 503 },
    );
  }
}
