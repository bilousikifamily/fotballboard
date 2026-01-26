const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type AdminJwtClaims = {
  sub: string;
  scope: "admin";
  iat: number;
  exp: number;
};

let cachedSecret: string | null = null;
let cachedKey: CryptoKey | null = null;

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const base64 = `${normalized}${padding}`;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedSecret === secret) {
    return cachedKey;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  cachedKey = key;
  cachedSecret = secret;
  return key;
}

export async function createAdminJwt(claims: Omit<AdminJwtClaims, "iat" | "exp">, secret: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: AdminJwtClaims = {
    ...claims,
    iat: issuedAt,
    exp: issuedAt + 15 * 60
  };
  const header = { alg: "HS256", typ: "JWT" };
  const segments = [header, payload].map((segment) => {
    const encoded = textEncoder.encode(JSON.stringify(segment));
    return toBase64Url(encoded.buffer);
  });
  const signingKey = await getSigningKey(secret);
  const data = `${segments[0]}.${segments[1]}`;
  const signature = await crypto.subtle.sign("HMAC", signingKey, textEncoder.encode(data));
  segments.push(toBase64Url(signature));
  return segments.join(".");
}

export async function verifyAdminJwt(token: string, secret: string): Promise<{ ok: true; claims: AdminJwtClaims } | { ok: false; error: "invalid_format" | "invalid_signature" | "expired" | "invalid_claims" }> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "invalid_format" };
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  let header: { alg?: string; typ?: string };
  let payload: AdminJwtClaims;
  try {
    header = JSON.parse(textDecoder.decode(fromBase64Url(headerSegment)));
    payload = JSON.parse(textDecoder.decode(fromBase64Url(payloadSegment)));
  } catch {
    return { ok: false, error: "invalid_format" };
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    return { ok: false, error: "invalid_format" };
  }
  if (payload.scope !== "admin" || typeof payload.sub !== "string" || typeof payload.exp !== "number" || typeof payload.iat !== "number") {
    return { ok: false, error: "invalid_claims" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return { ok: false, error: "expired" };
  }
  const signingKey = await getSigningKey(secret);
  const data = `${headerSegment}.${payloadSegment}`;
  const expectedSig = await crypto.subtle.sign("HMAC", signingKey, textEncoder.encode(data));
  const providedSig = fromBase64Url(signatureSegment);
  if (!timingSafeEqual(new Uint8Array(expectedSig), providedSig)) {
    return { ok: false, error: "invalid_signature" };
  }
  return { ok: true, claims: payload };
}
