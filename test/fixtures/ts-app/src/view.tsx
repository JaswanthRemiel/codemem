import type { User } from './db';

interface Props {
  user: User;
}

function formatName(user: User): string {
  return `${user.name} (${user.role})`;
}

export const UserBadge = ({ user }: Props) => <span className="badge">{formatName(user)}</span>;
