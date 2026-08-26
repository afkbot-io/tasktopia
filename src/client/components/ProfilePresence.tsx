import { Button, cx } from "./ui";

export function ProfilePresence({ initial, online, onOpen }: { initial: string; online: boolean; onOpen: () => void }) {
  return <Button
    className="header-control account-button profile-presence min-h-0 px-0 text-xs text-skyline"
    onClick={onOpen}
    title="Настройки аккаунта"
    aria-label={`Настройки аккаунта, ${online ? "в сети" : "подключение"}`}
  >
    <span aria-hidden="true">{initial}</span>
    <i className={cx("profile-presence-dot", online ? "profile-presence-dot-online" : "profile-presence-dot-connecting")} aria-hidden="true" />
  </Button>;
}
