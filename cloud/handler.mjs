// AWS Lambda entry shim. The runtime loads `cloud/handler.handler`; tsx lets us run the
// TypeScript handler (and the rest of rerender's TS) directly, exactly like the CLI does.
import { register } from 'tsx/esm/api';

register();

export const handler = async (event) => (await import('./handler.ts')).handler(event);
