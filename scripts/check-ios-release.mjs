import { readFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { mobileReleaseConfig } from './lib/mobile-release-config.mjs';

const env = { ...loadEnv('production', 'mobile', ''), ...process.env };
const checks = [];
const check = async (name, operation) => {
  try { await operation(); checks.push({ name, status: 'PASS' }); }
  catch (error) { checks.push({ name, status: 'BLOCKED', reason: error.message }); }
};
let config;
await check('Public mobile configuration', () => {
  config = mobileReleaseConfig(env);
  if (env.NEXT_PUBLIC_SUPABASE_URL !== 'https://llhrbtlkcneldgrhkwpf.supabase.co') throw new Error('Set the approved production Supabase URL.');
  if (env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED !== 'true' || env.NEXT_PUBLIC_APNS_ENVIRONMENT !== 'production') throw new Error('Enable production APNs in the mobile configuration.');
});
let team;
await check('Native signing and capabilities', async () => {
  const project = await readFile('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
  const entitlements = await readFile('ios/App/App/App.entitlements', 'utf8');
  team = project.match(/DEVELOPMENT_TEAM = ([A-Z0-9]{10});/)?.[1];
  if (!team) throw new Error('Run ios:configure with the real Apple team identifier.');
  if (!config || !entitlements.includes(`applinks:${new URL(config.inviteOrigin).hostname}`)) throw new Error('Configure the matching invitation Associated Domain.');
  if (!entitlements.includes('<key>aps-environment</key>') || !project.includes('APS_ENVIRONMENT = production;')) throw new Error('Production APNs signing configuration is missing.');
});
const get = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error(`Public endpoint returned HTTP ${response.status}.`);
  return response;
};
if (config) {
  await check('Invitation hosting and Apple association', async () => {
    const page = await get(`${config.inviteOrigin}/invite`);
    if (!(await page.text()).includes('Open SendMe')) throw new Error('Invitation handoff page is missing.');
    const association = await get(`${config.inviteOrigin}/.well-known/apple-app-site-association`);
    if (!association.headers.get('content-type')?.includes('application/json')) throw new Error('AASA must be served as JSON without redirects.');
    const body = await association.json();
    if (!team || !body.applinks?.details?.some(detail => detail.appIDs?.includes(`${team}.app.neighborwalk.ios`)
      && detail.components?.some(component => component['/'] === '/invite'))) throw new Error('AASA does not match the app, team and invitation path.');
  });
  for (const path of ['/privacy','/help','/terms']) await check(`Public ${path} page`, async () => {
    const page = await get(config.serviceOrigin + path);
    const html = await page.text();
    if (/Draft for operator|operator identity has not yet|support address is still awaiting|request channel is pending|policies pending approval/i.test(html)) throw new Error('Page still contains draft operator/support/policy notices.');
  });
}
console.log(JSON.stringify({ checks, stillRequiresHumanVerification: ['Policy accuracy, retention and deletion ownership', 'Live authentication, deletion fulfillment and APNs delivery', 'Apple portal capabilities and signed archive privacy report', 'Physical iPhone/iPad, accessibility and TestFlight acceptance', 'App Store listing and reviewer access'] }, null, 2));
if (checks.some(check => check.status !== 'PASS')) process.exitCode = 1;
