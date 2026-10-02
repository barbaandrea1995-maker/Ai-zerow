import { GET as read, POST as write } from "@/app/api/workflows/[module]/route";

export const GET = (request: Request) => read(request, { params: Promise.resolve({ module: "procurement" }) });
export const POST = (request: Request) => write(request, { params: Promise.resolve({ module: "procurement" }) });
