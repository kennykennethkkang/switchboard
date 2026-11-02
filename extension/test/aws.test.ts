/** AWS sign-ins: reading ~/.aws/config, rewriting [default], labels, Chrome profiles and status. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'path'
import * as fs from 'fs'
import { accountOf, addProfile, AWS_SESSION_MS, awsProfiles, awsStatus, browserEnv, chromeCall, chromeChoice, chromeProfiles, chromeState, dueHeadsUps, HEADS_UP_MS, loginCacheFile, loginError, openChromeScript, rowText, makeDefault, parseAwsConfig, profileFor, trackSessions, validProfileName, validRegion } from '../src/hub/aws'

const ARN = (acct: string) => `arn:aws:iam::${acct}:root`
const CONFIG = [
  '[default]', 'region = us-west-1', 'output = json', `login_session = ${ARN('137809407381')}`, '',
  '[profile live]', 'region = us-west-1', `login_session = ${ARN('137809407381')}`,
  '[profile yo]', 'region = us-east-1', `login_session = ${ARN('457884741882')}`, '',
  '[sso-session corp]', 'sso_start_url = https://x.awsapps.com/start', '',
  '[profile sso]', 'sso_account_id = 111122223333', 'sso_session = corp', 'region = eu-central-1', '',
].join('\n')

describe('aws config', () => {
  it('reads profiles with their settings, default first, skipping sso-session blocks', () => {
    const s = parseAwsConfig(CONFIG)
    assert.deepEqual(s.map(x => [x.name, x.isDefault]), [['default', true], ['live', false], ['yo', false], ['sso', false]])
    assert.equal(s[2].values.region, 'us-east-1')
  })

  it('finds the account from a login session, an SSO account or a role arn', () => {
    assert.equal(accountOf({ login_session: ARN('137809407381') }), '137809407381')
    assert.equal(accountOf({ sso_account_id: '111122223333' }), '111122223333')
    assert.equal(accountOf({ role_arn: 'arn:aws:iam::444455556666:role/admin' }), '444455556666')
    assert.equal(accountOf({ region: 'us-west-1' }), undefined)
  })

  it('makes a profile the default and backs up the old default when its account differs', () => {
    const out = makeDefault(CONFIG, 'yo', Date.UTC(2026, 9, 28, 15, 4, 5))!
    const s = parseAwsConfig(out)
    const def = s.find(x => x.isDefault)!
    assert.equal(def.values.region, 'us-east-1')
    assert.equal(accountOf(def.values), '457884741882')
    const backup = s.find(x => x.name.startsWith('previous-default-'))!
    assert.match(backup.name, /^previous-default-20261028-150405$/)
    assert.equal(accountOf(backup.values), '137809407381')
    assert.equal(backup.values.output, 'json')
    // Everything else is left as it was.
    assert.ok(out.includes('[sso-session corp]') && out.includes('[profile live]') && out.includes('[profile yo]'))
  })

  it('skips the backup only when the old default is the same as the new one, and refuses an unknown profile', () => {
    const same = '[default]\nregion = us-west-1\n\n[profile twin]\nregion = us-west-1\n'
    assert.ok(!makeDefault(same, 'twin', 1)!.includes('previous-default'))
    // Same account, another role: the old role must survive.
    const roles = '[default]\nrole_arn = arn:aws:iam::111122223333:role/Admin\n\n[profile ro]\nrole_arn = arn:aws:iam::111122223333:role/ReadOnly\n'
    assert.match(makeDefault(roles, 'ro', 1)!, /\[profile previous-default-[^\]]+\]\nrole_arn = arn:aws:iam::111122223333:role\/Admin/)
    // No account on either side: still kept.
    const proc = '[default]\ncredential_process = /usr/local/bin/creds\n\n[profile bare]\nregion = us-east-2\n'
    assert.match(makeDefault(proc, 'bare', 1)!, /\[profile previous-default-[^\]]+\]\ncredential_process = \/usr\/local\/bin\/creds/)
    const out = makeDefault(CONFIG, 'live', 1)!
    assert.ok(out.includes('previous-default'))
    assert.equal(makeDefault(CONFIG, 'nope', 1), undefined)
    assert.equal(makeDefault(CONFIG, 'default', 1), undefined)
  })

  it('points source_profile = default at the backup when the old [default] held keys in config', () => {
    const text = '[default]\naws_access_key_id = AKIAEXAMPLE\naws_secret_access_key = x\n\n[profile admin]\nrole_arn = arn:aws:iam::444444444444:role/A\nsource_profile = default\n'
    const s = parseAwsConfig(makeDefault(text, 'admin', Date.UTC(2026, 9, 28, 15, 4, 5))!)
    assert.equal(s.find(x => x.isDefault)?.values.source_profile, 'previous-default-20261028-150405')
  })

  it('moves every profile sourcing from a keyed [default] to the backup, not just the new default', () => {
    const text = '[default]\naws_access_key_id = AKIAEXAMPLE\n\n[profile admin]\nrole_arn = arn:aws:iam::444444444444:role/A\nsource_profile = default\n\n[profile ops]\nrole_arn = arn:aws:iam::555555555555:role/B\nsource_profile = default\n'
    const s = parseAwsConfig(makeDefault(text, 'admin', Date.UTC(2026, 9, 28, 15, 4, 5))!)
    for (const n of ['admin', 'ops']) assert.equal(s.find(x => x.name === n)?.values.source_profile, 'previous-default-20261028-150405')
  })

  it('keeps source_profile = default, since its keys live in credentials [default]', () => {
    const text = '[default]\naws_account_id = 333333333333\n\n[profile admin]\nrole_arn = arn:aws:iam::444444444444:role/A\nsource_profile = default\n'
    const s = parseAwsConfig(makeDefault(text, 'admin', Date.UTC(2026, 9, 28, 15, 4, 5))!)
    assert.equal(s.find(x => x.isDefault)?.values.source_profile, 'default')
    assert.equal(s.find(x => x.name === 'admin')?.values.source_profile, 'default')
  })

  it('leaves a comment that heads the next section with that section', () => {
    const text = '[default]\nregion = us-west-1\n\n[profile a]\nregion = us-east-2\n# the sandbox account\n[profile b]\nregion = eu-west-1\n'
    const out = makeDefault(text, 'a', 1)!
    const def = out.slice(out.indexOf('[default]'), out.indexOf('[profile a]'))
    assert.ok(!def.includes('sandbox'), def)
    assert.ok(out.includes('# the sandbox account\n[profile b]'))
  })

  it('adds [default] when there is none', () => {
    const out = makeDefault('[profile a]\nregion = us-east-2\n', 'a', 1)!
    assert.equal(parseAwsConfig(out).find(x => x.isDefault)?.values.region, 'us-east-2')
  })

  it('adds a profile once, with its region', () => {
    const out = addProfile(CONFIG, 'new.one', 'ap-southeast-2')!
    assert.equal(parseAwsConfig(out).find(x => x.name === 'new.one')?.values.region, 'ap-southeast-2')
    assert.equal(addProfile(CONFIG, 'live', 'us-west-1'), undefined)
    assert.equal(addProfile(CONFIG, 'bad name', 'us-west-1'), undefined)
    assert.equal(addProfile(CONFIG, 'ok', 'us-west-1; rm'), undefined)
  })

  it('takes only safe profile names and real-looking regions', () => {
    for (const ok of ['live', 'a.b_c-d', 'me@corp+dev', 'x'.repeat(64)]) assert.ok(validProfileName(ok), ok)
    for (const bad of ['', 'a b', 'a]b', '$(x)', 'x'.repeat(65), 'a\nb']) assert.ok(!validProfileName(bad), bad)
    for (const ok of ['us-west-1', 'eu-central-1', 'us-gov-west-1', 'ap-southeast-2']) assert.ok(validRegion(ok), ok)
    for (const bad of ['', 'west', 'us-west', 'US-WEST-1', 'us-west-1 ']) assert.ok(!validRegion(bad), bad)
  })
})

describe('aws status and helpers', () => {
  it('says signed in, expired or never', () => {
    assert.equal(awsStatus(true, '', {}), 'signed-in')
    assert.equal(awsStatus(false, 'Unable to locate credentials.', { region: 'us-west-1' }), 'never')
    assert.equal(awsStatus(false, 'Your session has expired. Please reauthenticate using aws login.', { login_session: ARN('137809407381') }), 'expired')
    assert.equal(awsStatus(false, 'Token has expired and refresh failed', { sso_session: 'corp' }), 'expired')
    assert.equal(awsStatus(false, 'timed out', {}), 'never')
  })

  it('reads Chrome profiles from Local State', () => {
    const state = JSON.stringify({ profile: { info_cache: { Default: { name: 'Personal', user_name: 'k@gmail.com' }, 'Profile 2': { name: 'Work' }, bad: 3 } } })
    assert.deepEqual(chromeProfiles(state), [{ dir: 'Default', name: 'Personal', email: 'k@gmail.com' }, { dir: 'Profile 2', name: 'Work' }])
    assert.deepEqual(chromeProfiles('nope'), [])
  })

  it('picks the profile of the deepest project folder holding a path', () => {
    const projects = { '/u/GitHub': 'live', '/u/GitHub/Armasu': 'yo' }
    assert.equal(profileFor(projects, '/u/GitHub/Armasu/web'), 'yo')
    assert.equal(profileFor(projects, '/u/GitHub/agent-flow'), 'live')
    assert.equal(profileFor(projects, '/u/GitHubX'), undefined)
  })

  it('finds Chrome\'s Local State on each OS', () => {
    assert.equal(chromeState('darwin', '/h', {}), path.join('/h', 'Library', 'Application Support', 'Google', 'Chrome', 'Local State'))
    assert.equal(chromeState('linux', '/h', {}), path.join('/h', '.config', 'google-chrome', 'Local State'))
    assert.equal(chromeState('win32', 'C:\\Users\\k', { LOCALAPPDATA: 'C:\\Users\\k\\AppData\\Local' }), path.join('C:\\Users\\k\\AppData\\Local', 'Google', 'Chrome', 'User Data', 'Local State'))
    assert.equal(chromeState('win32', 'C:\\Users\\k', {}), path.join('C:\\Users\\k', 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Local State'))
  })

  it('opens a URL in one Chrome profile without a shell', () => {
    const url = 'https://signin.aws.amazon.com/a?x=1&y=2'
    assert.deepEqual(chromeCall(url, 'Profile 2', 'darwin', {}, () => false), { cmd: '/usr/bin/open', args: ['-na', 'Google Chrome', '--args', '--profile-directory=Profile 2', url] })
    const pf = path.join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
    assert.deepEqual(chromeCall(url, 'Default', 'win32', { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\L' }, f => f === pf), { cmd: pf, args: ['--profile-directory=Default', url] })
    const la = path.join('C:\\L', 'Google', 'Chrome', 'Application', 'chrome.exe')
    assert.equal(chromeCall(url, 'Default', 'win32', { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\L' }, f => f === la)?.cmd, la)
    assert.equal(chromeCall(url, 'Default', 'win32', {}, () => false), undefined)
    assert.equal(chromeCall(url, 'Default', 'linux', {}, () => false)?.cmd, 'google-chrome')
  })

  it('writes a BROWSER script on macOS and Linux only; a .cmd would split a URL at &', () => {
    assert.match(openChromeScript('darwin')!, /\/usr\/bin\/open -na "Google Chrome" --args --profile-directory="\$SWITCHBOARD_CHROME_DIR" "\$1"/)
    assert.match(openChromeScript('linux')!, /google-chrome --profile-directory="\$SWITCHBOARD_CHROME_DIR" "\$1"/)
    assert.equal(openChromeScript('win32'), undefined)
  })

  it('opens Chrome itself, in its last used profile, when no profile is picked', () => {
    const url = 'https://signin.aws.amazon.com/a'
    assert.deepEqual(chromeCall(url, '', 'darwin', {}, () => false), { cmd: '/usr/bin/open', args: ['-a', 'Google Chrome', url] })
    assert.deepEqual(chromeCall(url, '', 'linux', {}, () => false), { cmd: 'google-chrome', args: [url] })
    assert.match(openChromeScript('darwin')!, /if \[ -z "\$SWITCHBOARD_CHROME_DIR" \]; then exec \/usr\/bin\/open -a "Google Chrome" "\$1"; fi/)
    assert.match(openChromeScript('linux')!, /if \[ -z "\$SWITCHBOARD_CHROME_DIR" \]; then exec google-chrome "\$1"; fi/)
  })

  it('points every terminal\'s BROWSER at the opener, with or without a project browser', () => {
    assert.deepEqual(browserEnv('Profile 4', '/s.sh'), { BROWSER: '/s.sh', SWITCHBOARD_CHROME_DIR: 'Profile 4' })
    assert.deepEqual(browserEnv(undefined, '/s.sh'), { BROWSER: '/s.sh', SWITCHBOARD_CHROME_DIR: '' })
    assert.deepEqual(browserEnv('', '/s.sh'), { BROWSER: '/s.sh', SWITCHBOARD_CHROME_DIR: '' })
    // Windows has no script: leave BROWSER alone.
    assert.deepEqual(browserEnv('Profile 4', ''), {})
  })

  it('lists every Chrome profile by name from a real Local State', () => {
    const rows = chromeProfiles(fs.readFileSync(path.join(__dirname, 'fixtures', 'chrome-local-state.json'), 'utf8'))
    assert.deepEqual(rows.map(r => `${r.dir}=${r.name}`), ['Default=Main', 'Profile 1=SCU', 'Profile 3=SCU TSA', 'Profile 4=Work', 'Profile 5=Yo', 'Profile 9=TheArmoire', 'Profile 10=Zellizard Inc.', 'Profile 11=Tsai'])
    assert.ok(rows.every(r => !('email' in r)))
  })

  it('signs in with the login\'s own Chrome pick, else the project\'s, else Chrome\'s last used', () => {
    const known = ['Profile 4', 'Profile 9']
    assert.deepEqual(chromeChoice('Profile 9', 'Profile 4', known), { dir: 'Profile 9', gone: [] })
    assert.deepEqual(chromeChoice('', 'Profile 4', known), { dir: 'Profile 4', gone: [] })
    assert.deepEqual(chromeChoice(undefined, 'Profile 4', known), { dir: 'Profile 4', gone: [] })
    assert.deepEqual(chromeChoice('', undefined, known), { dir: '', gone: [] })
    assert.deepEqual(chromeChoice(undefined, '', known), { dir: '', gone: [] })
  })

  it('sets and clears one row\'s note or error, and says when nothing changed', () => {
    assert.deepEqual(rowText(undefined, 'aws:live', 'moved'), { 'aws:live': 'moved' })
    assert.deepEqual(rowText({ 'aws:live': 'moved', 'aws:yo': 'x' }, 'aws:live'), { 'aws:yo': 'x' })
    assert.equal(rowText({ 'aws:yo': 'x' }, 'aws:live'), undefined)
    assert.equal(rowText({ 'aws:live': 'same' }, 'aws:live', 'same'), undefined)
  })

  it('skips a Chrome profile that was deleted and says which', () => {
    const known = ['Profile 4']
    assert.deepEqual(chromeChoice('Profile 7', 'Profile 4', known), { dir: 'Profile 4', gone: ['Profile 7'] })
    assert.deepEqual(chromeChoice('Profile 7', 'Profile 8', known), { dir: '', gone: ['Profile 7', 'Profile 8'] })
    assert.deepEqual(chromeChoice('', 'Profile 8', known), { dir: '', gone: ['Profile 8'] })
    // Chrome's list unreadable: nothing is called gone.
    assert.deepEqual(chromeChoice('Profile 7', undefined, []), { dir: '', gone: [] })
  })

  it('keeps the last lines of a failed aws login, with keys, tokens and URL queries cut', () => {
    const out = [
      'Attempting to open your default browser.', '', 'https://us-west-1.signin.aws.amazon.com/authorize?client_id=x&state=abc',
      '\x1b[31mAccess denied for AKIAABCDEFGHIJKLMNOP\x1b[0m', 'token eyJhbGciOiJFUzI1.eyJzdWIiOiJ4eXoifQ.c2lnbmF0dXJlMTIz', 'aws: [ERROR]: An error occurred (AccessDeniedException)',
    ].join('\n')
    const text = loginError(out)
    assert.equal(text.split('\n').length, 5)
    assert.ok(!text.includes('AKIAABCDEFGHIJKLMNOP') && !text.includes('eyJhbGci') && !text.includes('state=abc') && !text.includes('\x1b'))
    assert.match(text, /AccessDeniedException/)
    assert.match(text, /signin\.aws\.amazon\.com\/authorize/)
    assert.equal(loginError('  \n'), '')
    assert.ok(loginError('x'.repeat(5000)).length <= 600)
  })
})

describe('aws session length', () => {
  const H = 3600_000
  it('starts a session when a profile is first seen signed in and keeps it through a failed check', () => {
    const rows = [{ name: 'live', status: 'signed-in' as const }, { name: 'yo', status: 'expired' as const }]
    assert.deepEqual(trackSessions({}, rows, 100), { live: { at: 100 } })
    // Still in the same 12 h: kept as is, even when a check timed out.
    assert.deepEqual(trackSessions({ live: { at: 100, warned: 100 }, yo: { at: 5 }, gone: { at: 5 } }, rows, 100 + H), { live: { at: 100, warned: 100 }, yo: { at: 5, out: 100 + H } })
    assert.deepEqual(trackSessions({ yo: { at: 5 } }, rows.slice(1), 5 + AWS_SESSION_MS), {})
    // Signed in past the old session's end: a new sign-in happened outside Switchboard.
    assert.deepEqual(trackSessions({ live: { at: 100 } }, rows, 100 + AWS_SESSION_MS + 1), { live: { at: 100 + AWS_SESSION_MS + 1 } })
  })

  it('never marks a session signed out on a check that could not tell', () => {
    const unsure = [{ name: 'live', status: 'expired' as const, unsure: true }], on = [{ name: 'live', status: 'signed-in' as const }]
    const s = trackSessions({ live: { at: H } }, unsure, 2 * H, { live: { birth: 1, mtime: 1.9 * H } })
    assert.deepEqual(s, { live: { at: H } })
    // The next refresh writes the file: still the same session.
    assert.deepEqual(trackSessions(s, on, 2.3 * H, { live: { birth: 1, mtime: 2.25 * H } }), { live: { at: H } })
  })

  it('says a status check could not tell when STS gave no sign-out answer', async () => {
    const sts = async (name: string) => (name === 'live' ? { ok: false, stderr: 'Connect timeout on endpoint URL' } : name === 'yo' ? { ok: false, stderr: 'Your session has expired. Please reauthenticate using aws login.' } : { ok: true, account: '137809407381', stderr: '' })
    const rows = await awsProfiles(1, sts, CONFIG)
    assert.equal(rows.find(r => r.name === 'live')?.unsure, true)
    assert.equal(rows.find(r => r.name === 'yo')?.unsure, undefined)
    assert.equal(rows.find(r => r.name === 'default')?.unsure, undefined)
  })

  it('finds a profile\'s login cache file the way the CLI names it', () => {
    assert.equal(loginCacheFile('arn:aws:iam::123456789012:user/k', '/c'), path.join('/c', 'c964cac7a1761ad896e867060a3f8faa5bb3dd2d855d1184a6beeae03ad6410e.json'))
  })

  it('dates sessions started outside Switchboard from the login cache file\'s times', () => {
    const on = [{ name: 'live', status: 'signed-in' as const }], off = [{ name: 'live', status: 'expired' as const }]
    // First seen signed in: the file was made at its sign-in; refreshes only move mtime.
    assert.deepEqual(trackSessions({}, on, 10 * H, { live: { birth: 3 * H, mtime: 8 * H } }), { live: { at: 3 * H } })
    // A birth over 12 h back cannot start a live session (a later login rewrote the file): its last write, the latest start.
    assert.deepEqual(trackSessions({}, on, 20 * H, { live: { birth: 1, mtime: 18 * H } }), { live: { at: 18 * H } })
    // No birth time on this disk: mtime.
    assert.deepEqual(trackSessions({}, on, 10 * H, { live: { birth: 0, mtime: 8 * H } }), { live: { at: 8 * H } })
    // A refresh rewrites the file in place: not a new session.
    assert.deepEqual(trackSessions({ live: { at: H, warned: H } }, on, 3 * H, { live: { birth: 1, mtime: 2 * H } }), { live: { at: H, warned: H } })
    // A file made after the session began (aws logout, then aws login): a new session, its heads-up not sent.
    assert.deepEqual(trackSessions({ live: { at: H, warned: H } }, on, 3 * H, { live: { birth: 2 * H, mtime: 2.5 * H } }), { live: { at: 2 * H } })
    // Seen signed out, then written and signed in again: aws login ran in a terminal.
    const out = trackSessions({ live: { at: H } }, off, 2 * H, { live: { birth: 1, mtime: 1.5 * H } })
    assert.deepEqual(out, { live: { at: H, out: 2 * H } })
    assert.deepEqual(trackSessions(out, on, 3 * H, { live: { birth: 1, mtime: 2.5 * H } }), { live: { at: 2.5 * H } })
    // Signed in again with no new write: the same session.
    assert.deepEqual(trackSessions(out, on, 3 * H, { live: { birth: 1, mtime: 1.5 * H } }), { live: { at: H } })
  })

  it('gives one heads-up per session, about 30 minutes before it ends', () => {
    const at = 1000, end = at + AWS_SESSION_MS
    assert.deepEqual(dueHeadsUps({ live: { at } }, end - HEADS_UP_MS - 1), [])
    assert.deepEqual(dueHeadsUps({ live: { at } }, end - HEADS_UP_MS), ['live'])
    assert.deepEqual(dueHeadsUps({ live: { at, warned: at } }, end - 60_000), [])
    assert.deepEqual(dueHeadsUps({ live: { at, warned: at - 1 } }, end - 60_000), ['live'])
    assert.deepEqual(dueHeadsUps({ live: { at } }, end), [])
  })
})

describe('aws status checks', () => {
  it('skips old default backups and runs two STS calls at a time', async () => {
    const config = `${CONFIG}\n[profile previous-default-20261001-1200]\nregion = us-west-1\n[profile extra]\nregion = us-west-2\n`
    const asked: string[] = []
    let open = 0, peak = 0
    const sts = async (name: string) => {
      asked.push(name); peak = Math.max(peak, ++open)
      await new Promise(r => setTimeout(r, 5))
      open--
      return { ok: false, stderr: 'Unable to locate credentials' }
    }
    const rows = await awsProfiles(1, sts, config)
    assert.deepEqual(rows.map(r => r.name), ['default', 'live', 'yo', 'sso', 'previous-default-20261001-1200', 'extra'])
    assert.ok(!asked.includes('previous-default-20261001-1200'))
    assert.equal(asked.length, 5)
    assert.equal(peak, 2)
    assert.equal(rows[4].stale, true)
  })
})
