import { Tiktoken } from 'js-tiktoken/lite';
import o200k from 'js-tiktoken/ranks/o200k_base';

let encoder: Tiktoken | undefined;

/** Approximate token count: real models tokenize differently, so treat it as an estimate. */
export function countTokens(text: string): number {
  encoder ??= new Tiktoken(o200k);
  return encoder.encode(text).length;
}
