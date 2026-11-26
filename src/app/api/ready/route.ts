import { one } from "@/lib/db";
export async function GET() {
  try {
    const status = await one<{ ready: boolean }>("SELECT EXISTS(SELECT 1 FROM seasons) AS ready");
    return Response.json(
      { status: status.ready ? "ready" : "starting" },
      { status: status.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
