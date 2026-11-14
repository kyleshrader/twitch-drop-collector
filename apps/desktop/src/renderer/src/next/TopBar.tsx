// The top bar: brand, page links, and on the right app updates, notifications and the account.
import { useMutation } from '@tanstack/react-query'
import {
  imageSrc,
  type ApiIssuesView,
  type AuthStateView,
  type MinerView,
  type UpdateView
} from '@tdc/ipc-contract'
import { useState, type ReactNode } from 'react'
import { invoke } from '../ipc'
import { useOpenExternal } from './data'
import { minutesUntil } from './format'
import { icons } from './icons'
import { Popover } from './parts'
import { navigate, routeHref, type Route } from './router'
import { strings } from './strings'
import ui from './ui.module.css'

const t = strings.header
const Icon = icons
const {
  top,
  brand,
  mark,
  nav,
  navLink,
  topRight,
  iconButton,
  count,
  pip,
  account,
  avatar,
  menuItem,
  menuItemEnd,
  popHeading,
  separator,
  note,
  keyValue,
  btn,
  btnSmall,
  ghost,
  muted
} = ui

const TWITCH_INVENTORY_URL = 'https://www.twitch.tv/drops/inventory'
const TWITCH_CAMPAIGNS_URL = 'https://www.twitch.tv/drops/campaigns'

interface Notice {
  key: string
  icon: ReactNode
  title: string
  detail?: string
  to: Route
}

function noticesOf(
  miner: MinerView | undefined,
  apiIssues: ApiIssuesView | undefined,
  now: number
): Notice[] {
  const notices: Notice[] = []
  // All API issues as one notice; its key changes with the counts, so new ones show as unread.
  if (apiIssues && apiIssues.issues.length > 0) {
    const { errors, warnings } = apiIssues
    notices.push({
      key: `api:${errors}:${warnings}`,
      icon: <Icon.twitchApi style={{ color: errors > 0 ? 'var(--bad)' : 'var(--warn)' }} />,
      title: strings.twitchApi.notice(errors, warnings),
      detail: strings.twitchApi.noticeDetail,
      to: { page: 'twitchApi' }
    })
  }
  if (!miner) return notices
  const byId = new Map(miner.campaigns.map((c) => [c.id, c]))
  for (const piece of miner.queue?.pieces ?? []) {
    for (const entry of piece.entries) {
      const c = byId.get(entry.campaignId)
      if (!entry.warning || !c) continue
      notices.push({
        key: `warn:${c.id}`,
        icon: <Icon.warning style={{ color: 'var(--warn)' }} />,
        title: t.wontFinish(c.name),
        detail: t.wontFinishDetail(c.game, entry.needMinutes, minutesUntil(c.endsAt, now)),
        to: { page: 'drops', target: c.id }
      })
    }
  }
  for (const c of miner.campaigns) {
    for (const d of c.drops) {
      if (!d.awaitsConnection) continue
      notices.push({
        key: `link:${d.id}`,
        icon: <Icon.link style={{ color: 'var(--accent)' }} />,
        title: t.linkToClaim(d.name),
        detail: t.linkToClaimDetail(c.game),
        to: { page: 'drops', target: d.id }
      })
    }
  }
  if (miner.status === 'error') {
    notices.push({
      key: `error:${miner.message ?? ''}`,
      icon: <Icon.error style={{ color: 'var(--bad)' }} />,
      title: t.minerError,
      ...(miner.message ? { detail: miner.message } : {}),
      to: { page: 'drops' }
    })
  }
  return notices
}

function Notifications(props: {
  miner: MinerView | undefined
  apiIssues: ApiIssuesView | undefined
  now: number
}): ReactNode {
  const notices = noticesOf(props.miner, props.apiIssues, props.now)
  // Read marks last while the app runs; the history data will keep them (ui-design.md).
  const [read, setRead] = useState<ReadonlySet<string>>(new Set())
  const unread = notices.filter((n) => !read.has(n.key)).length
  return (
    <Popover
      label={t.notifications}
      buttonClass={iconButton}
      button={
        <>
          <Icon.bell />
          {unread > 0 && <span className={count}>{unread}</span>}
        </>
      }
      align="end"
      width={360}
    >
      {(close) => (
        <>
          <div className={popHeading}>
            {t.notifications}
            {unread > 0 && (
              <button
                type="button"
                className={`${btn} ${btnSmall} ${ghost}`}
                onClick={() => setRead(new Set(notices.map((n) => n.key)))}
              >
                {t.markRead}
              </button>
            )}
          </div>
          {notices.length === 0 && <div className={note}>{t.noNotifications}</div>}
          {notices.map((n) => (
            <button
              key={n.key}
              type="button"
              className={menuItem}
              style={{ alignItems: 'flex-start', fontWeight: read.has(n.key) ? 400 : 600 }}
              onClick={() => {
                close()
                navigate(n.to)
              }}
            >
              {n.icon}
              <span>
                {n.title}
                {n.detail && (
                  <span
                    className={muted}
                    style={{ display: 'block', fontSize: 12, fontWeight: 400 }}
                  >
                    {n.detail}
                  </span>
                )}
              </span>
            </button>
          ))}
        </>
      )}
    </Popover>
  )
}

function AccountMenu(props: {
  auth: Extract<AuthStateView, { status: 'signedIn' }>
  avatarUrl: string | undefined
}): ReactNode {
  const { auth, avatarUrl } = props
  const [avatarFailed, setAvatarFailed] = useState(false)
  const openExternal = useOpenExternal()
  const signOut = useMutation({ mutationFn: () => invoke('auth:signOut') })
  return (
    <Popover
      label={t.account}
      buttonClass={account}
      button={
        <>
          <span className={avatar}>
            {auth.user.login.slice(0, 2)}
            {avatarUrl && !avatarFailed && (
              <img src={imageSrc(avatarUrl)} alt="" onError={() => setAvatarFailed(true)} />
            )}
          </span>
          {auth.user.login}
          <Icon.down />
        </>
      }
      align="end"
      width={250}
      shortcut="F1"
      tip={`${t.account} (F1)`}
    >
      {(close) => (
        <>
          <div className={keyValue}>
            <span>{t.session}</span>
            <span>{auth.verified ? t.sessionOk : t.unverified}</span>
          </div>
          <hr className={separator} />
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              close()
              navigate({ page: 'settings' })
            }}
          >
            <Icon.settings />
            {t.settings}
          </button>
          <button
            type="button"
            className={menuItem}
            onClick={() => openExternal(TWITCH_INVENTORY_URL)}
          >
            <Icon.inventory />
            {t.inventory}
            <span className={menuItemEnd}>
              <Icon.external />
            </span>
          </button>
          <button
            type="button"
            className={menuItem}
            onClick={() => openExternal(TWITCH_CAMPAIGNS_URL)}
          >
            <Icon.reward />
            {t.dropsPage}
            <span className={menuItemEnd}>
              <Icon.external />
            </span>
          </button>
          <hr className={separator} />
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              close()
              signOut.mutate()
            }}
          >
            <Icon.signOut />
            {t.signOut}
          </button>
        </>
      )}
    </Popover>
  )
}

const UPDATE_SHOWN: ReadonlySet<UpdateView['status']> = new Set([
  'available',
  'downloading',
  'ready'
])

export function TopBar(props: {
  route: Route
  auth: AuthStateView | undefined
  miner: MinerView | undefined
  updates: UpdateView | undefined
  apiIssues: ApiIssuesView | undefined
  now: number
}): ReactNode {
  const { route, auth, miner, updates, apiIssues, now } = props
  const signedIn = auth?.status === 'signedIn' ? auth : undefined
  const link = (to: Route, label: string, shortcut: string, extra?: ReactNode): ReactNode => (
    <a
      className={navLink}
      href={routeHref(to)}
      aria-current={route.page === to.page ? 'page' : undefined}
      aria-keyshortcuts={shortcut}
      data-tip={`${label} (${shortcut})`}
    >
      {label}
      {extra}
    </a>
  )
  return (
    <header className={top}>
      <div className={brand}>
        <span className={mark}>
          <Icon.brand />
        </span>
        {strings.brand}
      </div>
      {signedIn && (
        <nav className={nav} aria-label={strings.nav.label}>
          {link({ page: 'library' }, strings.nav.library, 'Alt+1')}
          {link(
            { page: 'drops' },
            strings.nav.drops,
            'Alt+2',
            miner?.userPaused && (
              <span data-tip={strings.nav.pausedTip} aria-label={strings.nav.pausedTip} role="img">
                <Icon.pause />
              </span>
            )
          )}
          {link({ page: 'history' }, strings.nav.history, 'Alt+3')}
        </nav>
      )}
      <div className={topRight}>
        {updates && UPDATE_SHOWN.has(updates.status) && !updates.dismissed && (
          <a
            className={iconButton}
            href={routeHref({ page: 'updates' })}
            aria-label={updates.status === 'ready' ? t.updateReady : t.updates}
            data-tip={updates.status === 'ready' ? t.updateReady : t.updates}
          >
            <Icon.update />
            <span className={pip} />
          </a>
        )}
        {(signedIn || (apiIssues?.issues.length ?? 0) > 0) && (
          <Notifications miner={miner} apiIssues={apiIssues} now={now} />
        )}
        {signedIn && <AccountMenu auth={signedIn} avatarUrl={miner?.avatarUrl} />}
      </div>
    </header>
  )
}
