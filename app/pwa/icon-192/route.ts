export async function GET(request: Request) {
  return fetch(new URL("/icons/ai-zerow-192.png", request.url));
}
