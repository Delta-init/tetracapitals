/** Parse a request's JSON body, returning `any` (callers validate). */
export async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
