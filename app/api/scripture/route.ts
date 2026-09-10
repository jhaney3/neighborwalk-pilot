// Compatibility response for older installed clients. No provider key or paid
// request is used. A future licensed reader needs its own access controls.
export async function GET() {
  return Response.json({ code: "reference_only", error: "NeighborWalk now uses scripture reference links. Open the passage on ESV.org." }, {
    status: 410, headers: { "Cache-Control": "no-store" },
  });
}
