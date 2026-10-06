// Explicit Vercel route for the authenticated LINE account-link bind step.
// The daily handler keeps the request/authentication contract and dispatches
// by pathname; this wrapper only makes the deep filesystem route unambiguous.
export { default } from '../../../daily.js';
