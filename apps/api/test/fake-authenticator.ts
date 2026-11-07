// Software WebAuthn authenticator (ES256) for end-to-end tests.

const enc = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
export function fromB64u(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

// ---- minimal CBOR encoder ----
type Cbor = number | Uint8Array | string | Map<Cbor, Cbor>;

function head(major: number, n: number): Uint8Array {
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 0x100) return Uint8Array.of(m | 24, n);
  if (n < 0x10000) return Uint8Array.of(m | 25, n >> 8, n & 0xff);
  return Uint8Array.of(m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

export function cbor(v: Cbor): Uint8Array {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (v instanceof Uint8Array) return concat(head(2, v.length), v);
  if (typeof v === 'string') {
    const b = enc.encode(v);
    return concat(head(3, b.length), b);
  }
  const parts: Uint8Array[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return concat(...parts);
}

/** Convert raw r||s (64 bytes) to an ASN.1 DER ECDSA signature. */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v: Uint8Array = b.slice(i);
    if (v[0]! & 0x80) v = concat(Uint8Array.of(0), v);
    return concat(Uint8Array.of(0x02, v.length), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

function be32(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

interface StoredCredential {
  id: Uint8Array;
  rpId: string;
  userHandle: string | null; // base64url
  privateKey: CryptoKey;
  counter: number;
}

export class FakeAuthenticator {
  readonly credentials: StoredCredential[] = [];

  async create(optionsJSON: any, origin: string): Promise<any> {
    const rpId: string = optionsJSON.rp.id;
    const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const x = fromB64u(jwk.x!);
    const y = fromB64u(jwk.y!);
    const id = crypto.getRandomValues(new Uint8Array(32));

    const cose = new Map<Cbor, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, x],
      [-3, y],
    ]);
    const counter = 0;
    const authData = concat(
      await sha256(enc.encode(rpId)),
      Uint8Array.of(0x45),
      be32(counter),
      new Uint8Array(16),
      Uint8Array.of(id.length >> 8, id.length & 0xff),
      id,
      cbor(cose),
    );
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    const clientDataJSON = enc.encode(
      JSON.stringify({ type: 'webauthn.create', challenge: optionsJSON.challenge, origin, crossOrigin: false }),
    );

    this.credentials.push({
      id,
      rpId,
      userHandle: optionsJSON.user?.id ?? null,
      privateKey: keys.privateKey,
      counter,
    });

    return {
      id: b64u(id),
      rawId: b64u(id),
      type: 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  async get(optionsJSON: any, origin: string, credentialId?: string): Promise<any> {
    const rpId: string = optionsJSON.rpId;
    const allowed: string[] | undefined = optionsJSON.allowCredentials?.map((c: any) => c.id);
    const cred = this.credentials.find(
      (c) =>
        c.rpId === rpId &&
        (credentialId ? b64u(c.id) === credentialId : true) &&
        (!allowed?.length || allowed.includes(b64u(c.id))),
    );
    if (!cred) throw new Error('no matching credential');
    cred.counter += 1;
    const authData = concat(await sha256(enc.encode(rpId)), Uint8Array.of(0x05), be32(cred.counter));
    const clientDataJSON = enc.encode(
      JSON.stringify({ type: 'webauthn.get', challenge: optionsJSON.challenge, origin, crossOrigin: false }),
    );
    const signed = concat(authData, await sha256(clientDataJSON));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cred.privateKey, signed as BufferSource));
    return {
      id: b64u(cred.id),
      rawId: b64u(cred.id),
      type: 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(derSignature(raw)),
        ...(cred.userHandle ? { userHandle: cred.userHandle } : {}),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** Test helper: the current signature counter of a credential. */
  counterOf(credentialId: string): number {
    return this.credentials.find((c) => b64u(c.id) === credentialId)!.counter;
  }
}

