export type UserId = string;

export enum Role {
  Admin = 'admin',
  Member = 'member',
}

/** A stored account. */
export interface User {
  id: UserId;
  name: string;
  passwordHash: string;
  role: Role;
}

const USERS = new Map<UserId, User>();

/** Looks up a user by id. */
export const findUser = (id: UserId): User | undefined => {
  return USERS.get(id);
};

export function saveUser(user: User): void {
  USERS.set(user.id, user);
}
