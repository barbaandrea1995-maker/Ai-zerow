import { GET as read, POST as write } from "@/app/api/s05/[module]/route";

export const GET = (request: Request) => read(request, { params: Promise.resolve({ module: "finance" }) });
export const POST = (request: Request) => write(request, { params: Promise.resolve({ module: "finance" }) });
