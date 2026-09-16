import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const url = new URL("/api/leaderboard", process.env.SERVER_URL || "http://localhost:3001");
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error("Leaderboard API unavailable");

    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "The leaderboard is temporarily unavailable. Please try again." } },
      { status: 503 },
    );
  }
}
