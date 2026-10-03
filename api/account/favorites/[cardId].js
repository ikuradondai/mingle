// Explicit Vercel route for favorite writes. Some deployments do not match
// the account catch-all at this nested depth; keep the same handler contract.
export { default } from '../../account.js';
