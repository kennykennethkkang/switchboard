/** AWS sign-ins: reading and rewriting ~/.aws/config, identity, Chrome profiles and status. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'path'
import * as fs from 'fs'
import { accountOf, addProfile, AWS_SESSION_MS, awsProfiles, awsStatus, browserEnv, chromeCall, chromeChoice, chromeProfiles, chromeState, dueHeadsUps, HEADS_UP_MS, loginCacheFile, loginError, openChromeScript, rowText, identityOf, moveProfile, browserFor, hasSection, renameLabel, parseAwsConfig, renameProfile, sameLogin, profileFor, trackSessions, validProfileName, validRegion } from '../src/hub/aws'

const ARN = (acct: string) => `arn:aws:iam::${acct}:root`
const CONFIG = [
  '[default]', 'region = us-west-1', 'output = json', `login_session = ${ARN('137809407381')}`, '',
  '[profile live]', 'region = us-west-1', `login_session = ${ARN('137809407381')}`,
  '[profile yo]', 'region = us-east-1', `login_session = ${ARN('457884741882')}`, '',
  '[sso-session corp]', 'sso_start_url = https://x.awsapps.com/start', '',
  '[profile sso]', 'sso_account_id = 111122223333', 'sso_session = corp', 'region = eu-central-1', '',
].join('\n')

describe('aws config', () => {
  it('reads profiles in file order with their settings, skipping sso-session blocks', () => {
    const s = parseAwsConfig(CONFIG)
    assert.deepEqual(s.map(x => x.name), ['default', 'live', 'yo', 'sso'])
    assert.equal(s[2].values.region, 'us-east-1')
  })

  it('finds the account from a login session, an SSO account or a role arn', () => {
    assert.equal(accountOf({ login_session: ARN('137809407381') }), '137809407381')
    assert.equal(accountOf({ sso_account_id: '111122223333' }), '111122223333')
    assert.equal(accountOf({ role_arn: 'arn:aws:iam::444455556666:role/admin' }), '444455556666')
    assert.equal(accountOf({ region: 'us-west-1' }), undefined)
  })

  it('finds the profile a fresh sign-in duplicates: same login_session and region, first in the file', () => {
    assert.equal(sameLogin(CONFIG, 'live'), 'default')
    // [default] is a profile like any other.
    assert.equal(sameLogin(CONFIG, 'default'), 'live')
    assert.equal(sameLogin(CONFIG, 'yo'), undefined)
    assert.equal(sameLogin(CONFIG, 'sso'), undefined)
    const two = `${CONFIG}\n[profile again]\nregion = us-west-1\nlogin_session = ${ARN('137809407381')}\n`
    assert.equal(sameLogin(two, 'again'), 'default')
    // Another region is a different setup, not a copy.
    const east = `${CONFIG}\n[profile east]\nregion = us-east-1\nlogin_session = ${ARN('137809407381')}\n`
    assert.equal(sameLogin(east, 'east'), undefined)
  })

  it('adds a profile with its region; a taken name keeps its login and takes the new region', () => {
    const out = addProfile(CONFIG, 'new.one', 'ap-southeast-2')!
    assert.equal(parseAwsConfig(out).find(x => x.name === 'new.one')?.values.region, 'ap-southeast-2')
    const again = addProfile(CONFIG, 'yo', 'eu-west-2')!
    const yo = parseAwsConfig(again).filter(x => x.name === 'yo')
    assert.equal(yo.length, 1)
    assert.deepEqual(yo[0].values, { region: 'eu-west-2', login_session: ARN('457884741882') })
    assert.equal(again.replace('eu-west-2', 'us-east-1'), CONFIG)
    // No region line yet: one goes under the header.
    assert.deepEqual(parseAwsConfig(addProfile('[profile a]\noutput = json\n', 'a', 'us-east-2')!)[0].values, { region: 'us-east-2', output: 'json' })
    assert.equal(addProfile(CONFIG, 'default', 'us-west-1'), undefined)
    assert.equal(addProfile(CONFIG, 'bad name', 'us-west-1'), undefined)
    assert.equal(addProfile(CONFIG, 'ok', 'us-west-1; rm'), undefined)
  })

  it('renames a profile in place and points source_profile at the new name', () => {
    const text = `${CONFIG}\n# admin role\n[profile admin]\nrole_arn = arn:aws:iam::1:role/A\nsource_profile = yo\n`
    const out = renameProfile(text, 'yo', 'wardrobe')!
    assert.deepEqual(parseAwsConfig(out).map(x => x.name), ['default', 'live', 'wardrobe', 'sso', 'admin'])
    assert.equal(parseAwsConfig(out).find(x => x.name === 'admin')?.values.source_profile, 'wardrobe')
    assert.equal(out.replace('[profile wardrobe]', '[profile yo]').replace('source_profile = wardrobe', 'source_profile = yo'), text)
    assert.equal(parseAwsConfig(renameProfile(CONFIG, 'default', 'main')!)[0].name, 'main')
    for (const [from, to] of [['nope', 'x'], ['yo', 'live'], ['yo', 'bad name'], ['yo', 'default'], ['yo', 'yo']]) assert.equal(renameProfile(CONFIG, from, to), undefined, `${from} -> ${to}`)
  })

  it('moves Chrome and project picks to a new name; a pick already on the new name wins', () => {
    const prefs = { chrome: { yo: 'Profile 2', live: '' }, projects: { '/a': 'yo', '/b': 'live' }, browsers: { '/a': 'Default' } }
    assert.deepEqual(moveProfile(prefs, 'yo', 'wardrobe'), { chrome: { live: '', wardrobe: 'Profile 2' }, projects: { '/a': 'wardrobe', '/b': 'live' }, browsers: { '/a': 'Default' } })
    assert.deepEqual(moveProfile(prefs, 'yo', 'live').chrome, { live: '' })
  })

  it('finds a credentials section by its header alone', () => {
    const creds = '[default]\naws_access_key_id = AKIA\n\n[ wardrobe ]\naws_secret_access_key = x\n# [ghost]\n'
    assert.equal(hasSection(creds, 'wardrobe'), true)
    assert.equal(hasSection(creds, 'default'), true)
    assert.equal(hasSection(creds, 'ghost'), false)
    assert.equal(hasSection(creds, 'AKIA'), false)
  })

  it('moves a hand-typed email kept by profile name; by-account ones stay', () => {
    assert.deepEqual(renameLabel({ 'profile:yo': 'a@x.com', '111122223333': 'b@x.com' }, 'yo', 'sandbox'), { '111122223333': 'b@x.com', 'profile:sandbox': 'a@x.com' })
    assert.equal(renameLabel({ '111122223333': 'b@x.com' }, 'yo', 'sandbox'), undefined)
  })

  it('takes the account name and email from what AWS answered, skipping what it refused', () => {
    assert.deepEqual(identityOf({ AccountAliases: ['armasu'] }, { ContactInformation: { FullName: 'K Kang' } }, { PrimaryEmail: 'k@x.com' }), { name: 'armasu', email: 'k@x.com' })
    assert.deepEqual(identityOf({ AccountAliases: [] }, { ContactInformation: { CompanyName: 'Armasu' } }, undefined), { name: 'Armasu' })
    // The company names the account; the contact's own name is the last resort (a root login reports both).
    assert.deepEqual(identityOf(undefined, { ContactInformation: { FullName: 'Kenneth Kang', CompanyName: ' Armasu ' } }, { PrimaryEmail: 'not an email' }), { name: 'Armasu' })
    assert.deepEqual(identityOf(undefined, { ContactInformation: { FullName: ' K ' } }, undefined), { name: 'K' })
    assert.deepEqual(identityOf(undefined, undefined, undefined), {})
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
    assert.equal(profileFor(projects, '/u/GitHub/switchboard'), 'live')
    assert.equal(profileFor(projects, '/u/GitHubX'), undefined)
    // AWS has no default: a '*' entry is never used for a profile.
    assert.equal(profileFor({ ...projects, '*': 'live' }, '/u/GitHubX'), undefined)
    // The browser falls back to '*'; a folder's own pick still wins.
    assert.equal(browserFor({ ...projects, '*': 'Profile 4' }, '/u/GitHubX'), 'Profile 4')
    assert.equal(browserFor({ ...projects, '*': 'Profile 4' }, '/u/GitHub/Armasu/web'), 'yo')
    assert.equal(browserFor(projects, '/u/GitHubX'), undefined)
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
    // -g: an aws login an agent runs opens Chrome behind what Kenneth is doing
    assert.match(openChromeScript('darwin')!, /exec \/usr\/bin\/open -g -a "Google Chrome" "\$1"/)
    assert.match(openChromeScript('darwin')!, /\/usr\/bin\/open -gna "Google Chrome" --args --profile-directory="\$SWITCHBOARD_CHROME_DIR" "\$1"/)
    assert.match(openChromeScript('linux')!, /google-chrome --profile-directory="\$SWITCHBOARD_CHROME_DIR" "\$1"/)
    assert.equal(openChromeScript('win32'), undefined)
  })

  it('opens Chrome itself, in its last used profile, when no profile is picked', () => {
    const url = 'https://signin.aws.amazon.com/a'
    assert.deepEqual(chromeCall(url, '', 'darwin', {}, () => false), { cmd: '/usr/bin/open', args: ['-a', 'Google Chrome', url] })
    assert.deepEqual(chromeCall(url, '', 'linux', {}, () => false), { cmd: 'google-chrome', args: [url] })
    assert.match(openChromeScript('darwin')!, /if \[ -z "\$SWITCHBOARD_CHROME_DIR" \]; then exec \/usr\/bin\/open -g -a "Google Chrome" "\$1"; fi/)
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
  it('runs two STS calls at a time', async () => {
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
    assert.equal(asked.length, 6)
    assert.equal(peak, 2)
  })
})

describe('pages Switchboard opens', () => {
  it('go through the folder Chrome pick, not openExternal (last used profile)', () => {
    for (const f of ['hub-panel.ts', 'actions.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '../src/hub', f), 'utf8')
      const raw = src.split('\n').filter(l => l.includes('openExternal(') && !l.includes('if (!c)'))
      assert.deepEqual(raw, [], f)
    }
  })
})
