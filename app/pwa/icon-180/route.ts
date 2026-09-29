export async function GET(request: Request) {
  return fetch(new URL("/icons/ai-zerow-180.png", request.url));
}
