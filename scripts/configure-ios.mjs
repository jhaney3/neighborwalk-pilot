import { readFile, writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { publicHttpsOrigin } from './lib/mobile-release-config.mjs';

if (process.argv.includes('--help')) {
  console.log('APPLE_TEAM_ID=YOURTEAMID npm run ios:configure\nReads NEXT_PUBLIC_INVITE_ORIGIN from mobile/.env.production.local. Writes public signing metadata only. Apple portal provisioning and Xcode validation are still required.');
  process.exit(0);
}
const env = { ...loadEnv('production', 'mobile', ''), ...process.env };
const team = env.APPLE_TEAM_ID;
if (!/^[A-Z0-9]{10}$/.test(team ?? '')) throw new Error('Set the actual ten-character APPLE_TEAM_ID. Apple ownership must be verified separately.');
const host = new URL(publicHttpsOrigin(env.NEXT_PUBLIC_INVITE_ORIGIN, 'NEXT_PUBLIC_INVITE_ORIGIN')).hostname;
const projectPath = 'ios/App/App.xcodeproj/project.pbxproj';
const entitlementPath = 'ios/App/App/App.entitlements';
let project = await readFile(projectPath, 'utf8');
let entitlements = await readFile(entitlementPath, 'utf8');
if (!entitlements.includes('<key>aps-environment</key>')) throw new Error('Missing APNs entitlement; inspect the native project.');
const domain = `<key>com.apple.developer.associated-domains</key><array><string>applinks:${host}</string></array>`;
if (entitlements.includes('<key>com.apple.developer.associated-domains</key>')) {
  entitlements = entitlements.replace(/<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>[\s\S]*?<\/array>/, domain);
} else entitlements = entitlements.replace('</dict>', domain + '</dict>');
// Replace the team in all target configurations, including UI tests.
project = project.replace(/\bDEVELOPMENT_TEAM = [^;]*;\s*/g, '');
project = project.replace(/CODE_SIGN_STYLE = Automatic;/g, `CODE_SIGN_STYLE = Automatic; DEVELOPMENT_TEAM = ${team};`);
await writeFile(entitlementPath, entitlements);
await writeFile(projectPath, project);
console.log('Configured Apple team and invitation Associated Domain. Review the native diff and regenerate provisioning profiles on the Mac.');
