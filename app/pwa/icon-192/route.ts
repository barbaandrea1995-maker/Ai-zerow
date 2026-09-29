export async function GET(request: Request) {
  return fetch(new URL("/ai-zerow-icon.jpeg", request.url));
}
