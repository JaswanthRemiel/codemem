/** Base class for errors whose message is safe and useful to show to the user. */
export class CodememError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class GrammarError extends CodememError {}
export class PathError extends CodememError {}
