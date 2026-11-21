// Exercise the installed file associations and native Save dialog on a Windows runner.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');

function shell(action, document) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'windows_project_dialog.ps1'), '-Action', action];
  if (document) args.push('-Document', document);
  execFileSync('powershell.exe', args, { stdio: 'inherit', timeout: 65000 });
}

async function openDocument(document, profile) {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  // Start the installed app with a private test profile. Explorer may start
  // applications through a broker which does not inherit test environment variables.
  const binary = path.join(process.env.RUNNER_TEMP, 'viewer-install', 'phasesmith-viewer.exe');
  const viewer = spawn(binary, [], { stdio: 'inherit', env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --enable-unsafe-swiftshader --use-angle=swiftshader`,
  } });
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90000;
  while (true) {
    try {
      if ((await fetch(endpoint + '/json/version')).ok) break;
    } catch { /* WebView2 is still starting. */ }
    if (viewer.exitCode !== null) throw new Error('Installed viewer exited at startup: ' + viewer.exitCode);
    if (Date.now() > deadline) throw new Error('The installed viewer did not start WebView2 for ' + document);
    await delay(300);
  }
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page');
  page.on('pageerror', error => console.error('Viewer error:', error));
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-desktop-app')
    && window.viewerDiagnostics?.().history.ready, null, { timeout: 60000 });
  console.log('Connected to the installed desktop viewer. Opening ' + path.basename(document));
  shell('Open', document);
  await page.waitForFunction(() => window.viewerDiagnostics?.().block === 'periodic_distance'
    && window.viewerDiagnostics().history.ready, null, { timeout: 60000 });
  return { browser, page };
}

async function main() {
  const dir = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, 'viewer project '));
  const cif = path.join(dir, 'Distance check.cif');
  const project = path.join(dir, 'Saved structure.psv');
  const original = await fs.readFile(path.join(__dirname, 'known-distance.cif'), 'utf8');
  await fs.writeFile(cif, original);

  const first = await openDocument(cif, path.join(dir, 'first profile'));
  const atoms = await first.page.evaluate(() => viewerDiagnostics().atoms.map(a => [a.label, a.frac]));
  assert.ok(atoms.some(([label]) => label === 'Cl1'));
  await first.page.locator('#show-atoms').uncheck();
  await first.page.locator('#file-menu-button').click();
  await first.page.locator('#project-save').click();
  shell('Save', project);
  await first.page.waitForFunction(() => document.getElementById('project-status').textContent.startsWith('Saved Saved structure.psv.'));
  const saved = JSON.parse(await fs.readFile(project, 'utf8'));
  assert.deepEqual(saved.document, { filename: path.basename(cif), text: original });
  assert.equal(saved.state.atoms.show, false);
  shell('Close');
  await first.browser.close();
  await fs.unlink(cif);

  // A new WebView2 profile and the missing source CIF rule out autosave and source-file recovery.
  const second = await openDocument(project, path.join(dir, 'second profile'));
  await second.page.waitForFunction(() => document.getElementById('project-status').textContent === 'Opened Saved structure.psv.');
  assert.deepEqual(await second.page.evaluate(() => viewerDiagnostics().atoms.map(a => [a.label, a.frac])), atoms);
  assert.equal(await second.page.locator('#show-atoms').isChecked(), false);
  shell('Close');
  await second.browser.close();
  console.log('Installed viewer opened the associated CIF, wrote a PSV through Windows Save, and reopened it with the same atoms and display setting.');
}

main().catch(error => { console.error(error); process.exit(1); });
