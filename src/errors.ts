/** Base class for errors whose message is safe and useful to show to the user. */
export class RemimemError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class GrammarError extends RemimemError {}
export class PathError extends RemimemError {}
export class ConfigError extends RemimemError {}
export class StoreError extends RemimemError {}
