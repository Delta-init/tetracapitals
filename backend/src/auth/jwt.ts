import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";

const secret = new TextEncoder().encode(config.jwtSecret);

export interface JwtClaims {
  sub: string;          // user id
  email: string;
  app_role: string;
  full_name?: string;
}

export async function signJwt(claims: JwtClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .setSubject(claims.sub)
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<JwtClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ""),
      app_role: String(payload.app_role ?? ""),
      full_name: payload.full_name ? String(payload.full_name) : undefined,
    };
  } catch {
    return null;
  }
}
