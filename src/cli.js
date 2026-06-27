import { readFile } from 'node:fs/promises';
import { logger } from './logger.js';
import { runSync } from './services/sync.js';
import { massDm } from './services/massdm.js';
import { getMembers } from './skool/client.js';
import { SkoolSession } from './skool/session.js';
import { getStore } from './store.js';

/**
 * CLI for manual / scripted operations:
 *
 *   npm run login              # log in once and save the session (use HEADLESS=false for 2FA)
 *   npm run sync               # run the daily sync now
 *   npm run sync:dry           # dry-run: scrape + diff, but send nothing, save nothing
 *   npm run members            # scrape and print the current member list
 *   npm run massdm -- --to @a,@b --template "Hi {{name}}"
 *   npm run massdm -- --all --template-file msg.txt --dry-run
 */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function cmdLogin() {
  const session = new SkoolSession();
  try {
    await session.ensureLogin();
    logger.info('Login OK — session saved to data/session.json');
  } finally {
    await session.close();
  }
}

async function cmdMembers() {
  const session = new SkoolSession();
  try {
    await session.ensureLogin();
    const page = await session.page();
    const members = await getMembers(page);
    await page.close();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(members, null, 2));
    logger.info({ count: members.length }, 'Done');
  } finally {
    await session.close();
  }
}

async function cmdSync(args) {
  const res = await runSync({ dryRun: Boolean(args['dry-run']) });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(res, null, 2));
}

async function cmdMassdm(args) {
  let template = args.template;
  if (args['template-file']) {
    template = (await readFile(args['template-file'], 'utf8')).trim();
  }
  if (!template) throw new Error('Provide --template "..." or --template-file path');

  let recipients;
  if (args.all) {
    recipients = 'all';
  } else if (args.to) {
    recipients = String(args.to).split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    throw new Error('Provide --all or --to @handle1,@handle2');
  }

  const res = await massDm({
    recipients,
    template,
    dryRun: Boolean(args['dry-run']),
    skipAlreadyMessaged: Boolean(args['skip-messaged']),
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(res, null, 2));
}

async function cmdStatus() {
  const store = await getStore();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    lastSyncAt: store.data.lastSyncAt,
    totalMembers: Object.keys(store.data.members).length,
    dmLogSize: store.data.dmLog.length,
  }, null, 2));
}

const COMMANDS = {
  login: cmdLogin,
  members: cmdMembers,
  sync: cmdSync,
  massdm: cmdMassdm,
  status: cmdStatus,
};

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  const handler = COMMANDS[cmd];
  if (!handler) {
    // eslint-disable-next-line no-console
    console.error(`Usage: node src/cli.js <${Object.keys(COMMANDS).join('|')}> [options]`);
    process.exit(1);
  }
  try {
    await handler(args);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, `Command "${cmd}" failed`);
    process.exit(1);
  }
}

main();
