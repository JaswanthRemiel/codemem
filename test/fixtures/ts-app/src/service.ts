import { authenticateUser, parseToken } from './auth';
import { findUser, type User } from './db';

function Injectable(): ClassDecorator {
  return () => undefined;
}

function Log(label: string): MethodDecorator {
  return () => {
    console.log(label);
  };
}

abstract class BaseService {
  abstract dispose(): void;

  protected now(): number {
    return Date.now();
  }
}

/** Login and lookup operations for users. */
@Injectable()
export class UserService extends BaseService {
  private attempts = new Map<string, number>();

  static create = (): UserService => new UserService();

  constructor() {
    super();
  }

  @Log('login')
  async login(id: string, password: string): Promise<boolean> {
    const ok = await authenticateUser(id, password);
    this.audit(id, ok);
    return ok;
  }

  find(id: string): User | undefined;
  find(id: string, required: true): User;
  find(id: string, required = false): User | undefined {
    const user = findUser(id);
    if (!user && required) throw new Error(`no user ${id}`);
    return user;
  }

  fromToken(token: string): User | undefined {
    return this.find(parseToken(token).sub);
  }

  private audit(id: string, ok: boolean): void {
    this.attempts.set(id, (this.attempts.get(id) ?? 0) + (ok ? 0 : 1));
  }

  dispose(): void {
    this.attempts.clear();
  }
}
