// cPanel's "Setup Node.js App" starts this file (its web server loads it with require()).
// Everything real is in anti/server.mjs; see docs/deploy-cpanel.md.
import('./anti/server.mjs').catch((e) => {
  console.error('anti failed to start:', e);
  process.exit(1);
});
