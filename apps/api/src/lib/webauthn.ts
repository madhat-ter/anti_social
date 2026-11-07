import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { passkeys } from '@anti/db';
import type { Config } from '../config';
import { ApiError } from './errors';

type PasskeyRow = typeof passkeys.$inferSelect;

/** Passkeys are the only factor, so user verification (biometric/PIN) is required. */
export function registrationOptions(
  cfg: Config,
  user: { id: string; handle: string; displayName: string },
  exclude: PasskeyRow[] = [],
) {
  return generateRegistrationOptions({
    rpName: cfg.rpName,
    rpID: cfg.rpId,
    userName: user.handle,
    userDisplayName: user.displayName,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: exclude.map((p) => ({ id: p.id, transports: p.transports ?? undefined })),
  });
}

export async function verifyRegistration(cfg: Config, response: unknown, expectedChallenge: string) {
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: cfg.webOrigin,
      expectedRPID: cfg.rpId,
    });
  } catch (e) {
    throw new ApiError(400, 'passkey_invalid', (e as Error).message);
  }
  if (!result.verified) throw new ApiError(400, 'passkey_invalid');
  const { credential } = result.registrationInfo;
  return {
    id: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? null,
  };
}

export function authenticationOptions(cfg: Config) {
  return generateAuthenticationOptions({ rpID: cfg.rpId, userVerification: 'required' });
}

export async function verifyAuthentication(cfg: Config, response: unknown, expectedChallenge: string, passkey: PasskeyRow) {
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: cfg.webOrigin,
      expectedRPID: cfg.rpId,
      credential: {
        id: passkey.id,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: (passkey.transports ?? undefined) as never,
      },
    });
  } catch (e) {
    throw new ApiError(401, 'passkey_invalid', (e as Error).message);
  }
  if (!result.verified) throw new ApiError(401, 'passkey_invalid');
  return result.authenticationInfo;
}
