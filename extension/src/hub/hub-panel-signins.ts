import * as vscode from 'vscode'
import type { WebviewToExtensionMessage } from '../protocol'
import { hub } from './hub-service'
import { awsLogin, cliLogin, openLogin } from './actions'
import { addAwsProfile, browserFor, deleteAwsProfile, moveProfile, parseAwsConfig, readAwsConfig, readLabels, readPrefs, readSessions, renameAwsProfile, renameLabel, validProfileName, writeLabels, writePrefs, writeSessions } from './aws'
import { CLI_APPS } from './cli-logins'
import { LOGINS, applyLink, applyLogin, loginFor, pruneLinks, readLinks, readLogins, writeLogins, type LinkCommand, type LoginCommand } from './logins'
import { keyStatus, keyStore, keyTest, removeKey, saveKey, testKey } from './keys'
import { envSetup, fillRecipes } from './env-setup'
import { refuse, type HubReply } from './hub-panel-shared'

/** The Sign-ins panel's commands: AWS profiles, logins, keys and the browser pick. */
export function signInsPanel(d: { refreshAws: (force?: boolean) => Promise<void>; refreshCli: (force?: boolean) => Promise<void>; projectBrowser: () => string | undefined; readSignIns: () => void; workspace: () => string | undefined }) {
  const { refreshAws, refreshCli, projectBrowser, readSignIns, workspace } = d
  /** The Sign-ins panel's commands; a string is why one was refused. */
  function awsCommand(m: Extract<WebviewToExtensionMessage, { type: `hub-aws-${string}` }>): string | undefined {
    const known = (p: string) => validProfileName(p) && parseAwsConfig(readAwsConfig()).some(s => s.name === p)
    const after = () => { void refreshAws(true) }
    switch (m.type) {
      case 'hub-aws-check': after(); return undefined
      case 'hub-aws-login':
        if (!known(m.profile)) return `no AWS profile named ${m.profile}`
        return awsLogin(m.profile, m.chrome, after, projectBrowser())
      case 'hub-aws-add': {
        // A name already there is a retry: new region, same login lines, and it never folds into a twin.
        const was = known(m.profile)
        return addAwsProfile(m.profile, m.region, m.chrome, hub.get().signIns.chrome.map(c => c.dir)) ?? awsLogin(m.profile, m.chrome, after, projectBrowser(), !was)
      }
      case 'hub-aws-rename': {
        if (!known(m.profile)) return `no AWS profile named ${m.profile}`
        const problem = renameAwsProfile(m.profile, m.to)
        if (problem) return problem
        writePrefs(moveProfile(readPrefs(), m.profile, m.to))
        const labels = renameLabel(readLabels(), m.profile, m.to)
        if (labels) writeLabels(labels)
        const { [m.profile]: s, ...sessions } = readSessions()
        if (s) writeSessions({ ...sessions, [m.to]: s })
        readSignIns()
        hub.set({ aws: hub.get().aws.map(a => (a.name === m.profile ? { ...a, name: m.to } : a)) })
        after()
        return undefined
      }
      case 'hub-aws-label': {
        const row = hub.get().aws.find(a => a.name === m.profile)
        if (!row || !known(m.profile)) return `no AWS profile named ${m.profile}`
        const key = row.account ?? `profile:${row.name}`
        const label = m.label.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80)
        const { [key]: _old, ...rest } = readLabels()
        writeLabels(label ? { ...rest, [key]: label } : rest)
        hub.set({ aws: hub.get().aws.map(a => (a.account ?? `profile:${a.name}`) === key ? { ...a, label: label || undefined } : a) })
        return undefined
      }
      case 'hub-aws-delete': {
        if (!known(m.profile)) return `no AWS profile named ${m.profile}`
        const problem = deleteAwsProfile(m.profile)
        if (problem) return problem
        // Projects that picked it go to Not used.
        const prefs = readPrefs()
        const { [m.profile]: _c, ...chrome } = prefs.chrome
        writePrefs({ ...prefs, chrome, projects: Object.fromEntries(Object.entries(prefs.projects).filter(([, p]) => p !== m.profile)) })
        readSignIns()
        hub.set({ aws: hub.get().aws.filter(a => a.name !== m.profile) })
        after()
        return undefined
      }
      case 'hub-aws-window': {
        const ws = workspace()
        if (!ws) return 'this window has no folder open'
        if (m.profile !== null && !known(m.profile)) return `no AWS profile named ${m.profile}`
        const prefs = readPrefs()
        const { [ws]: _was, ...rest } = prefs.projects
        writePrefs({ ...prefs, projects: m.profile === null ? rest : { ...rest, [ws]: m.profile } })
        readSignIns()
        return undefined
      }
    }
  }

  /** Saved web logins: the change is written to logins.json; Sign in then opens the login in its Chrome profile. */
  function loginCommand(m: LoginCommand | LinkCommand): string | undefined {
    const apps = readLogins(), links = readLinks(LOGINS, apps)
    if (m.type === 'hub-login-link') {
      const folders = [...hub.get().projects.map(p => p.path), ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)]
      const next = applyLink(apps, links, m, folders)
      if (typeof next === 'string') return next
      writeLogins(apps, LOGINS, next)
      hub.set({ signIns: { ...hub.get().signIns, links: next } })
      return undefined
    }
    // Sign in with no id opens the project's pick for the app.
    const app = m.type === 'hub-login-open' && m.id === undefined ? apps.find(a => a.id === m.app) : undefined
    const c = app && m.type === 'hub-login-open' ? { ...m, id: loginFor(app, links, m.folder) } : m
    // A CLI app with no tenant yet: the login itself adds them.
    if (c.type === 'hub-login-open' && CLI_APPS[c.app] && !apps.find(a => a.id === c.app)?.logins.some(l => l.id === c.id)) {
      return cliLogin(c.app, c.chrome, browserFor(readPrefs().browsers, c.folder ?? workspace() ?? ''), `login:${c.app}:new`, () => { void refreshCli(true) })
    }
    const known = hub.get().signIns.chrome.map(x => x.dir)
    // A pick of a Chrome profile since deleted is dropped from the login, then skipped with a note when it opens.
    const dead = c.type === 'hub-login-open' && !!c.chrome && known.length > 0 && !known.includes(c.chrome) ? c.chrome : undefined
    const next = applyLogin(apps, dead && c.type === 'hub-login-open' ? { ...c, chrome: '' } : c, undefined, known)
    if (typeof next === 'string') return next
    writeLogins(next, LOGINS, links)
    hub.set({ signIns: { ...hub.get().signIns, apps: next, links: pruneLinks(links, next) } })
    if (c.type !== 'hub-login-open') return undefined
    const row = next.find(a => a.id === c.app)?.logins.find(l => l.id === c.id)
    // The login's own Chrome profile holds its account; without one, the project's browser ('' counts as none).
    if (!row) return 'no such login'
    const project = browserFor(readPrefs().browsers, c.folder ?? workspace() ?? '')
    return CLI_APPS[c.app]
      ? cliLogin(c.app, dead ?? row.chrome, project, `login:${c.app}:${row.id}`, () => { void refreshCli(true) })
      : openLogin(row.url, dead ?? row.chrome, project, `login:${c.app}:${row.id}`)
  }

  const keys = keyStore()

  /** Save, test or remove an API key; save tests it too. Only keyStatus (last four, last test) reaches the hub. */
  async function keyCommand(m: Extract<WebviewToExtensionMessage, { type: `hub-key-${string}` }>): Promise<string | undefined> {
    const show = () => hub.set({ signIns: { ...hub.get().signIns, keys: keyStatus() } })
    if (m.type === 'hub-key-remove') { removeKey(keys, m.name); show(); return undefined }
    if (m.type === 'hub-key-save') {
      const problem = saveKey(keys, m.name, m.value)
      if (problem) return problem
      show()
      // MiroFish and other recipe projects get the new key in their .env; set values stay.
      const filled = fillRecipes(hub.get().projects.map(p => p.path), m.name, keys).filter(r => !('error' in r)).at(-1)
      if (filled && !('error' in filled)) hub.set({ signIns: { ...hub.get().signIns, envSetup: filled } })
    }
    const key = keys.get(m.name)
    if (!key) return `no ${m.name} saved`
    keyTest(m.name, await testKey(m.name, key))
    show()
    return undefined
  }

  /** The browser a project's links and terminal sign-ins open in; null forgets it. */
  function browserCommand(m: Extract<WebviewToExtensionMessage, { type: 'hub-browser' }>): string | undefined {
    const folders = [...hub.get().projects.map(p => p.path), ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)]
    if (!folders.includes(m.folder)) return 'that folder is not in the project list'
    if (m.chrome && !hub.get().signIns.chrome.some(c => c.dir === m.chrome)) return 'That Chrome profile is not in Chrome\'s list'
    const prefs = readPrefs()
    const { [m.folder]: _was, ...rest } = prefs.browsers
    writePrefs({ ...prefs, browsers: m.chrome === null ? rest : { ...rest, [m.folder]: m.chrome } })
    readSignIns()
    return undefined
  }
  /** Its share of the hub messages; undefined for any other type. */
  function handle(m: WebviewToExtensionMessage): HubReply | undefined {
    switch (m.type) {
      case 'hub-aws-login':
      case 'hub-aws-add':
      case 'hub-aws-rename':
      case 'hub-aws-label':
      case 'hub-aws-window':
      case 'hub-aws-delete':
      case 'hub-aws-check': {
        let problem: string | undefined
        try { problem = awsCommand(m) } catch (err) { problem = `could not change the AWS config (${(err as Error).message})` }
        return problem ? refuse(problem) : true
      }
      case 'hub-login-app-add':
      case 'hub-login-add':
      case 'hub-login-open':
      case 'hub-login-active':
      case 'hub-login-rename':
      case 'hub-login-delete':
      case 'hub-login-app-delete':
      case 'hub-login-link': {
        let problem: string | undefined
        try { problem = loginCommand(m) } catch (err) { problem = `could not save the login (${(err as Error).message})` }
        return problem ? refuse(problem) : true
      }
      case 'hub-key-save':
      case 'hub-key-test':
      case 'hub-key-remove':
        return keyCommand(m).then(p => (p ? refuse(p) : true), () => refuse(`could not change ${m.name}`))
      case 'hub-env-setup': {
        // Names and filled/missing only reach the hub.
        if (!hub.get().projects.some(p => p.path === m.folder) && !(vscode.workspace.workspaceFolders ?? []).some(f => f.uri.fsPath === m.folder)) return refuse('that folder is not in the project list')
        const r = envSetup(m.folder, keys)
        if ('error' in r) return refuse(r.error)
        hub.set({ signIns: { ...hub.get().signIns, envSetup: r } })
        return true
      }
      case 'hub-browser': {
        let problem: string | undefined
        try { problem = browserCommand(m) } catch (err) { problem = `could not save the browser (${(err as Error).message})` }
        return problem ? refuse(problem) : true
      }
      default:
        return undefined
    }
  }
  return { keys, awsCommand, loginCommand, keyCommand, browserCommand, handle }
}
