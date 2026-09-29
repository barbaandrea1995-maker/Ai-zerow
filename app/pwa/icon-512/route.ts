export async function GET(request: Request) {
  return fetch(new URL("/icons/ai-zerow-512.png", request.url));
}
