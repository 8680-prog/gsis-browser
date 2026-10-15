import { promises as dns, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

/**
 * Network guards that stop the inspector from being used to reach private,
 * loopback, link-local or cloud-metadata addresses (SSRF protection).
 */

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

export { isPublicAddress, isPublicHostname } from './addressPolicy.js';

export class BlockedTargetError extends Error {
  readonly code = 'EBLOCKED';
}

export const systemResolver: Resolver = (hostname) =>
  dns.lookup(hostname, { all: true, verbatim: true });

/**
 * Builds a `lookup` function for http(s).request that resolves the hostname
 * once, refuses the connection if any resolved address is not allowed, and
 * hands only validated addresses to the socket. Because the socket connects to
 * exactly the addresses checked here, DNS rebinding between check and connect
 * is not possible.
 */
export function createGuardedLookup(
  resolver: Resolver,
  isAddressAllowed: (ip: string) => boolean,
): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname)
      .then((addresses) => {
        if (addresses.length === 0) {
          const err = Object.assign(new Error(`No addresses for ${hostname}`), { code: 'ENOTFOUND' });
          throw err;
        }
        const blocked = addresses.find((a) => !isAddressAllowed(a.address));
        if (blocked) {
          throw new BlockedTargetError(`${hostname} resolves to a non-public address`);
        }
        const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
        const usable = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
        if (usable.length === 0) {
          throw Object.assign(new Error(`No IPv${wanted} address for ${hostname}`), { code: 'ENOTFOUND' });
        }
        if (options.all) {
          callback(null, usable);
        } else {
          callback(null, usable[0].address, usable[0].family);
        }
      })
      .catch((err: NodeJS.ErrnoException) => callback(err, '', 0));
  };
}
