// Augments Express's Request with the authenticated user id resolved by `requireAuth`
// (see index.ts). Deliberately optional — routes that don't run `requireAuth` never have
// this set, and TypeScript will force every handler that reads it to have gone through
// the middleware (or to explicitly check for `undefined`).
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}
