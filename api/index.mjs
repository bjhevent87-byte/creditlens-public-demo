// The public Vercel edition never exposes the local case and evidence store.
process.env.CREDIT_PLATFORM_PUBLIC_DEMO = "1";
process.env.CREDIT_PLATFORM_SERVERLESS = "1";

export default async function handler(req, res) {
  const incoming = new URL(req.url, "http://localhost");
  const route = incoming.searchParams.get("_credit_route");
  if (route && /^[a-z0-9/_-]+$/i.test(route)) {
    incoming.searchParams.delete("_credit_route");
    const query = incoming.searchParams.toString();
    req.url = `/api/${route}${query ? `?${query}` : ""}`;
  }
  const { handleRequest } = await import("../server.mjs");
  return handleRequest(req, res);
}
