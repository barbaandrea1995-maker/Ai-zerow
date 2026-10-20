import { GET as read, POST as write } from "@/app/api/workflows/[module]/route";

function deprecated(response: Response) {
  response.headers.set("deprecation", "true");
  response.headers.set("link", '</api/finance/entries>; rel="successor-version"');
  response.headers.set("x-zerow-contract", "W10_WORKFLOW_PROPOSALS_NOT_LEDGER_FACTS");
  return response;
}

export const GET = async (request: Request) => deprecated(await read(request, { params: Promise.resolve({ module: "finance" }) }));
export const POST = async (request: Request) => deprecated(await write(request, { params: Promise.resolve({ module: "finance" }) }));
