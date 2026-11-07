// Prints a fresh VAPID key pair for Web Push: bun run ops:vapid-keys
import { generateVAPIDKeys } from 'web-push';

const k = generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
