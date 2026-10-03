import { GET as catalog } from "@/app/api/documents/catalog/route";
import { POST as write } from "@/app/api/s05/[module]/route";

export const GET = catalog;
export const POST = (request: Request) => write(request, { params: Promise.resolve({ module: "documents" }) });
