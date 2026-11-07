export type Config = {
  rpId: string;
  rpName: string;
  webOrigin: string;
  cookieSecure: boolean;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  return {
    rpId: need('RP_ID'),
    rpName: env.RP_NAME ?? 'Anti',
    webOrigin: need('WEB_ORIGIN'),
    cookieSecure: env.COOKIE_SECURE !== 'false',
  };
}
